/**
 * The signed-in Privy session token, shared by services that call wallet-owner
 * API routes. PrivySession installs the provider once the user is authenticated.
 * The wait covers child effects that fetch in the same commit, before that
 * effect runs.
 */
export const SESSION_PROVIDER_WAIT_MS = 3_000;

type TokenProvider = () => Promise<string | null>;

let provider: TokenProvider | undefined;
let waiters: Array<() => void> = [];

export function setSessionTokenProvider(next?: TokenProvider) {
  provider = next;
  if (next) {
    for (const resolve of waiters) resolve();
    waiters = [];
  }
}

/**
 * Child components can fetch in the same commit that signs the user in, before
 * the session effect installs the provider, so wait briefly for it.
 */
async function currentProvider(waitMs: number): Promise<TokenProvider | undefined> {
  if (provider || waitMs <= 0) return provider;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter !== done);
      resolve();
    }, waitMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    waiters.push(done);
  });
  return provider;
}

export async function sessionAuthorization(waitMs = 0): Promise<Record<string, string>> {
  const token = await (await currentProvider(waitMs))?.();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
