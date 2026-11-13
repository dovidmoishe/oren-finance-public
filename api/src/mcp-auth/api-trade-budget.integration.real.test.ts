import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { formatRequestForAuthorizationSignature } from '@privy-io/node';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { Database } from '../database/database.provider';
import {
  mcpApiTradeGrants,
  mcpApiTradeAuthorizations,
  mcpConnections,
  mcpTradeIntents,
  mcpTradeDelegations,
} from '../database/schema';
import { ApiTradeAuthorization } from './api-trade-authorization';
import { inspectApiTradeTransaction } from './api-trade-transaction';
import { HOUR_MS } from './grant-duration';

jest.mock('./api-trade-transaction', () => ({
  inspectApiTradeTransaction: jest.fn(),
}));
jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);

const url = process.env.MCP_TEST_POSTGRES_URL;
const describeDatabase = url ? describe : describe.skip;
describeDatabase('independent API spend reservations in real Postgres', () => {
  let client: ReturnType<typeof postgres>;
  let db: Database;
  beforeAll(async () => {
    if (
      !url ||
      !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1):\d+\/oren_mcp_test(?:\?|$)/.test(
        url,
      )
    )
      throw new Error(
        'Requires explicitly configured local oren_mcp_test database',
      );
    client = postgres(url, { max: 20 });
    db = drizzle(client);
    await migrate(db, {
      migrationsFolder: resolve(process.cwd(), 'lib/db/migrations'),
    });
  }, 90000);
  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });
  beforeEach(() =>
    jest.mocked(inspectApiTradeTransaction).mockResolvedValue('1.000000'),
  );

  async function fixture() {
    const now = Date.now();
    const id = randomUUID();
    const actor = {
      grantId: randomUUID(),
      clientId: 'integration-client',
      userId: `owner-${id}`,
      walletId: `wallet-${id}`,
      wallet: `address-${id}`,
    };
    await db.insert(mcpApiTradeGrants).values({
      id,
      userId: actor.userId,
      walletId: actor.walletId,
      wallet: actor.wallet,
      signerId: 'quorum',
      policyId: 'policy',
      status: 'active',
      perTradeLimitUsd: '1.000000',
      dailyLimitUsd: '2.000000',
      maxSlippageBps: 50,
      allowSell: false,
      createdAt: new Date(now - 60000),
      activatedAt: new Date(now - 30000),
      expiresAt: new Date(now + 3600000),
    });
    await db.insert(mcpConnections).values({
      ...actor,
      scopes: 'oren.trade.execute',
      createdAt: new Date(now - 10000),
    });
    const walletAuth = new PrivyWalletAuth('app');
    const auth = {
      signingRequest: (
        ...args: Parameters<PrivyWalletAuth['signingRequest']>
      ) => walletAuth.signingRequest(...args),
      verifyMcpWallet: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrivyWalletAuth;
    const service = new ApiTradeAuthorization({
      db,
      auth,
      appId: 'app',
      signerQuorumId: 'quorum',
      allowedUsers: new Set([actor.userId]),
      buysEnabled: true,
      sellsEnabled: false,
      connection: {} as never,
      rpc: {} as never,
      tokens: {} as never,
    });
    async function trade() {
      const intentId = randomUUID();
      const key = randomUUID();
      const executionId = randomUUID();
      await db.insert(mcpTradeIntents).values({
        id: intentId,
        grantId: actor.grantId,
        clientId: actor.clientId,
        userId: actor.userId,
        wallet: actor.wallet,
        assetId: 'stock',
        ticker: 'TEST',
        side: 'buy',
        mode: 'delegated',
        status: 'executing',
        delegationId: null,
        amountUsd: '1.000000',
        maxInRaw: '1000000',
        minOutRaw: '1',
        stockMint: 'stock-mint',
        slippageBps: 50,
        expiresAt: new Date(now + 300000),
      });
      // Independent grants deliberately have no FK from the gate's mutable rows.
      // A gate delegation is required only to populate the intent's existing FK.
      return { intentId, key, executionId };
    }
    return { id, actor, auth, service, trade };
  }

  // Exercise the ledger with real FK-compatible gate delegations and intents.
  async function connectedFixture() {
    const f = await fixture();
    await db.insert(mcpTradeDelegations).values({
      id: f.id,
      userId: f.actor.userId,
      walletId: f.actor.walletId,
      wallet: f.actor.wallet,
      signerId: 'quorum',
      policyId: 'policy',
      policyHash: 'hash',
      policyTier: 1,
      perTradeLimitUsd: '1',
      dailyLimitUsd: '2',
      maxSlippageBps: 50,
      expiresAt: new Date(Date.now() + 3600000),
    });
    async function request() {
      const trade = await f.trade();
      await db
        .update(mcpTradeIntents)
        .set({ delegationId: f.id })
        .where(eq(mcpTradeIntents.id, trade.intentId));
      const canonical = Buffer.from(
        formatRequestForAuthorizationSignature(
          f.auth.signingRequest(
            f.actor.walletId,
            'fixed-transaction',
            trade.executionId,
            new Date(Date.now() + 20000),
          ),
        ),
      ).toString('base64');
      return {
        ...trade,
        canonical,
        run: () =>
          f.service.authorize(trade.intentId, trade.key, f.actor, {
            executionId: trade.executionId,
            canonicalRequestBase64: canonical,
          }),
      };
    }
    return { ...f, request };
  }

  it('serializes competing requests against the independent $2 cap', async () => {
    const f = await connectedFixture();
    const requests = await Promise.all(
      Array.from({ length: 10 }, () => f.request()),
    );
    const results = await Promise.allSettled(
      requests.map((request) => request.run()),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(mcpApiTradeAuthorizations)
        .where(eq(mcpApiTradeAuthorizations.delegationId, f.id)),
    ).toHaveLength(2);
  }, 90000);

  it('counts concurrent identical retries only once and denies changed bytes', async () => {
    const f = await connectedFixture();
    const request = await f.request();
    await Promise.all(Array.from({ length: 10 }, () => request.run()));
    expect(
      await db
        .select()
        .from(mcpApiTradeAuthorizations)
        .where(eq(mcpApiTradeAuthorizations.delegationId, f.id)),
    ).toHaveLength(1);
    const changed = Buffer.from(
      formatRequestForAuthorizationSignature(
        f.auth.signingRequest(
          f.actor.walletId,
          'replacement-transaction',
          request.executionId,
          new Date(Date.now() + 20000),
        ),
      ),
    ).toString('base64');
    await expect(
      f.service.authorize(request.intentId, request.key, f.actor, {
        executionId: request.executionId,
        canonicalRequestBase64: changed,
      }),
    ).rejects.toThrow('different bytes');
  }, 90000);

  it.each([20, null])(
    'allows an older grant to spend again after the rolling window (hours left: %s)',
    async (hoursLeft) => {
      const f = await connectedFixture();
      const now = Date.now();
      await db
        .update(mcpApiTradeGrants)
        .set({
          createdAt: new Date(now - 48 * HOUR_MS),
          activatedAt: new Date(now - 47 * HOUR_MS),
          expiresAt:
            hoursLeft === null ? null : new Date(now + hoursLeft * HOUR_MS),
        })
        .where(eq(mcpApiTradeGrants.id, f.id));

      const older = await f.request();
      await older.run();
      await db
        .update(mcpApiTradeAuthorizations)
        .set({ createdAt: new Date(now - 25 * HOUR_MS) })
        .where(eq(mcpApiTradeAuthorizations.intentId, older.intentId));

      await (await f.request()).run();
      await (await f.request()).run();
      await expect((await f.request()).run()).rejects.toThrow(
        'Independent trade budget exceeded',
      );
    },
    90000,
  );
});
