// Capture a generation at async action entry so old successes and errors cannot
// repopulate stores after switching wallets or signing out.
let generation = 0;
export function invalidateWalletSession() { generation += 1; }
export function walletSessionIsCurrent() {
  const started = generation;
  return () => started === generation;
}
export function sessionSetter<T extends (...args: never[]) => unknown>(set: T): T {
  const isCurrent = walletSessionIsCurrent();
  return ((...args: Parameters<T>) => { if (isCurrent()) return set(...args); }) as T;
}
