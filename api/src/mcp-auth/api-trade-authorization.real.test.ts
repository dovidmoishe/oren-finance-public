import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { formatRequestForAuthorizationSignature } from '@privy-io/node';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { Database } from '../database/database.provider';
import {
  mcpApiTradeGrants,
  mcpApiTradeAuthorizations,
  mcpConnections,
  mcpTradeIntents,
} from '../database/schema';
import { ApiTradeAuthorization } from './api-trade-authorization';
import { inspectApiTradeTransaction } from './api-trade-transaction';
import { SignerGateClient } from './signer-gate.client';

jest.mock('./api-trade-transaction', () => ({
  inspectApiTradeTransaction: jest.fn(),
}));
jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);
const inspect = jest.mocked(inspectApiTradeTransaction);

function fixture() {
  const now = Date.now();
  const actor = {
    grantId: randomUUID(),
    clientId: 'client',
    userId: 'owner',
    walletId: 'wallet-id',
    wallet: 'wallet-address',
  };
  const grant = {
    id: randomUUID(),
    userId: actor.userId,
    walletId: actor.walletId,
    wallet: actor.wallet,
    signerId: 'quorum',
    policyId: 'policy',
    perTradeLimitUsd: '1.000000',
    dailyLimitUsd: '2.000000',
    maxSlippageBps: 50,
    allowSell: false,
    status: 'active',
    activatedAt: new Date(now - 30_000),
    createdAt: new Date(now - 60_000),
    expiresAt: new Date(now + 3_600_000) as Date | null,
  };
  const intent = {
    id: randomUUID(),
    ...actor,
    assetId: 'stock',
    ticker: 'STOCK',
    side: 'buy',
    stockMint: 'stock-mint',
    amountUsd: '1.000000',
    amountShares: null,
    maxInRaw: '1000000',
    minOutRaw: '9950',
    mode: 'delegated',
    status: 'executing',
    delegationId: grant.id,
    expiresAt: new Date(now + 300_000),
    slippageBps: 50,
  };
  const connection = {
    ...actor,
    scopes: 'oren.read oren.trade.execute',
    revokedAt: null as Date | null,
    createdAt: new Date(now - 10_000),
  };
  const authorizations: (typeof mcpApiTradeAuthorizations.$inferInsert)[] = [];
  const state = {
    grant,
    intent,
    connection,
    authorizations,
    missingGrant: false,
  };
  const db = {
    select: (fields?: { total?: unknown }) => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === mcpTradeIntents
              ? [state.intent]
              : table === mcpApiTradeGrants
                ? state.missingGrant
                  ? []
                  : [state.grant]
                : table === mcpConnections
                  ? [state.connection]
                  : fields?.total
                    ? [
                        {
                          total: state.authorizations
                            .reduce(
                              (sum, item) => sum + Number(item.amountUsd),
                              0,
                            )
                            .toFixed(6),
                        },
                      ]
                    : state.authorizations.filter(
                        (item) => item.intentId === state.intent.id,
                      );
          return Object.assign(Promise.resolve(rows), {
            for: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    insert: () => ({
      values: (value: typeof mcpApiTradeAuthorizations.$inferInsert) => {
        state.authorizations.push(value);
        return Promise.resolve();
      },
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const walletAuth = new PrivyWalletAuth('audit-app');
  const auth = {
    signingRequest: (...args: Parameters<PrivyWalletAuth['signingRequest']>) =>
      walletAuth.signingRequest(...args),
    verifyMcpWallet: jest.fn().mockResolvedValue(undefined),
  };
  const deps = {
    db: db as unknown as Database,
    auth: auth as unknown as PrivyWalletAuth,
    appId: 'audit-app',
    connection: {} as never,
    tokens: {} as never,
    rpc: {} as never,
    allowedUsers: new Set(['owner']),
    buysEnabled: true,
    sellsEnabled: false,
    signerQuorumId: 'quorum',
    signerPolicyId: 'policy',
  };
  const service = new ApiTradeAuthorization(deps);
  const executionId = randomUUID();
  const request = auth.signingRequest(
    actor.walletId,
    'transaction-fixture',
    executionId,
    new Date(now + 20_000),
  );
  const challenge = () => ({
    executionId,
    state: 'challenged',
    canonicalRequestBase64: Buffer.from(
      formatRequestForAuthorizationSignature(request),
    ).toString('base64'),
  });
  const key = 'independent-test-key';
  const authorize = () => service.authorize(intent.id, key, actor, challenge());
  return { state, deps, service, actor, request, challenge, key, authorize };
}

describe('independent API signing authorization', () => {
  beforeEach(() => {
    inspect.mockReset();
    inspect.mockResolvedValue('1.000000');
  });
  afterEach(() => jest.restoreAllMocks());

  it('independently authorizes an active multi-day grant within the maximum', async () => {
    const f = fixture();
    f.state.grant.createdAt = new Date(Date.now() - 48 * 3_600_000);
    await expect(f.authorize()).resolves.toBeInstanceOf(Buffer);
    expect(f.state.authorizations).toHaveLength(1);
  });

  it('accepts an older until-revoked grant and enforces explicit revocation', async () => {
    const active = fixture();
    active.state.grant.createdAt = new Date(Date.now() - 90 * 86_400_000);
    active.state.grant.expiresAt = null;
    await expect(active.authorize()).resolves.toBeInstanceOf(Buffer);

    const revoked = fixture();
    revoked.state.grant.expiresAt = null;
    revoked.state.grant.status = 'revoked';
    await expect(revoked.authorize()).rejects.toThrow(
      'Independent trade authorization is inactive',
    );
  });

  it('rejects an active grant pinned to a retired signing policy', async () => {
    const f = fixture();
    f.state.grant.policyId = 'retired-policy';
    await expect(f.authorize()).rejects.toThrow(
      'Independent trade authorization is inactive',
    );
    expect(f.state.authorizations).toHaveLength(0);
  });

  it('independently denies a grant beyond the maximum duration', async () => {
    const f = fixture();
    f.state.grant.createdAt = new Date(Date.now() - 72 * 3_600_000);
    await expect(f.authorize()).rejects.toThrow(
      'Independent trade authorization is inactive',
    );
    expect(f.state.authorizations).toHaveLength(0);
  });

  it('authorizes a sell only with explicit sell permission and independently charges its dollar value', async () => {
    const f = fixture();
    f.deps.sellsEnabled = true;
    f.state.intent.side = 'sell';
    f.state.grant.allowSell = true;
    f.state.grant.perTradeLimitUsd = '1.500000';
    inspect.mockResolvedValueOnce('1.250000');
    await f.authorize();
    expect(f.state.authorizations).toHaveLength(1);
    expect(f.state.authorizations[0].amountUsd).toBe('1.250000');
  });

  it('claims exact bytes once and permits only identical retries', async () => {
    const f = fixture();
    expect((await f.authorize()).toString('base64')).toBe(
      f.challenge().canonicalRequestBase64,
    );
    await f.authorize();
    expect(f.state.authorizations).toHaveLength(1);
    f.request.body.params.transaction = 'different-bytes';
    await expect(f.authorize()).rejects.toThrow('different bytes');
  });
  it.each(['wallet', 'app', 'execution'])(
    'rejects a gate-controlled %s envelope before inspecting transactions',
    async (mutation) => {
      const f = fixture();
      if (mutation === 'wallet')
        f.request.url = 'https://api.privy.io/v1/wallets/other/rpc';
      if (mutation === 'app') f.request.headers['privy-app-id'] = 'other-app';
      if (mutation === 'execution')
        f.request.headers['privy-idempotency-key'] = randomUUID();
      await expect(f.authorize()).rejects.toThrow();
      expect(inspect).not.toHaveBeenCalled();
      expect(f.state.authorizations).toHaveLength(0);
    },
  );
  it.each([-1_000, 120_000])(
    'rejects request expiry offset %s',
    async (offset) => {
      const f = fixture();
      f.request.headers['privy-request-expiry'] = String(Date.now() + offset);
      await expect(f.authorize()).rejects.toThrow('expiry');
    },
  );
  it('refuses gate-only grants, lower per-trade limits, and exhausted independent budget', async () => {
    const f = fixture();
    f.state.missingGrant = true;
    await expect(f.authorize()).rejects.toThrow('inactive');
    f.state.missingGrant = false;
    f.state.grant.perTradeLimitUsd = '0.100000';
    await expect(f.authorize()).rejects.toThrow('budget');
    f.state.grant.perTradeLimitUsd = '1.000000';
    f.state.authorizations.push({
      intentId: randomUUID(),
      delegationId: f.state.grant.id,
      executionId: randomUUID(),
      idempotencyKey: 'prior-key',
      canonicalRequestBase64: 'prior-bytes',
      amountUsd: '2.000000',
    });
    await expect(f.authorize()).rejects.toThrow('budget');
  });
  it.each([
    'revoked',
    'old-consent',
    'wrong-client',
    'wrong-wallet',
    'sell',
    'expired-grant',
    'disabled-side',
    'removed-user',
    'failed-intent',
  ])('refuses %s even if the gate offers a challenge', async (mutation) => {
    const f = fixture();
    if (mutation === 'revoked') f.state.connection.revokedAt = new Date();
    if (mutation === 'old-consent') f.state.connection.createdAt = new Date(0);
    if (mutation === 'wrong-client') f.state.connection.clientId = 'other';
    if (mutation === 'wrong-wallet') f.state.grant.walletId = 'other';
    if (mutation === 'sell') {
      f.state.intent.side = 'sell';
      f.deps.sellsEnabled = true;
    }
    if (mutation === 'expired-grant') f.state.grant.expiresAt = new Date(0);
    if (mutation === 'disabled-side') f.deps.buysEnabled = false;
    if (mutation === 'removed-user') f.deps.allowedUsers.clear();
    if (mutation === 'failed-intent') f.state.intent.status = 'failed';
    await expect(f.authorize()).rejects.toThrow();
    expect(f.state.authorizations).toHaveLength(0);
  });
  it('never sends a signature when independent transaction checks fail', async () => {
    const f = fixture();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(f.challenge()),
    } as Response);
    inspect.mockRejectedValueOnce(new Error('wrong destination'));
    const client = new SignerGateClient(
      'http://signer-gate:3001',
      'test-token',
      'unused-key',
      f.service,
    );
    await expect(
      client.execute(f.state.intent.id, f.key, f.actor),
    ).rejects.toThrow('wrong destination');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('signs only independently authorized bytes with the real P-256 key', async () => {
    const f = fixture();
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(f.challenge()),
      } as Response)
      .mockImplementationOnce((_url, options) => {
        if (typeof options?.body !== 'string')
          throw new Error('Expected JSON body');
        const body = JSON.parse(options.body) as {
          apiSignatureBase64: string;
          executionId: string;
        };
        expect(
          verify(
            'sha256',
            Buffer.from(f.challenge().canonicalRequestBase64, 'base64'),
            publicKey,
            Buffer.from(body.apiSignatureBase64, 'base64'),
          ),
        ).toBe(true);
        expect(f.state.authorizations).toHaveLength(1);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              executionId: body.executionId,
              state: 'signed',
            }),
        } as Response);
      });
    const client = new SignerGateClient(
      'http://signer-gate:3001',
      'test-token',
      privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      f.service,
    );
    await expect(
      client.execute(f.state.intent.id, f.key, f.actor),
    ).resolves.toMatchObject({ state: 'signed' });
  });
});
