import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import type { Database } from '../database/database.provider';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { mcpApiTradeGrants } from '../database/schema';
import { ApiTradeAuthorization } from './api-trade-authorization';
import { ownerPermissionMessage, type OwnerMessage } from './grant-owner-proof';
import { SignerGateClient } from './signer-gate.client';
import {
  gatePolicyFingerprint,
  SignerGateService,
  type SignerGateConfig,
} from '../signer-gate/signer-gate.service';
import { HOUR_MS, MAX_GRANT_HOURS } from './grant-duration';

jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);

function fixture(
  access: { allowedUsers: Set<string>; publicAccess?: boolean } = {
    allowedUsers: new Set(['owner']),
  },
) {
  const keys = generateKeyPairSync('ed25519');
  const owner = {
    userId: 'owner',
    walletId: 'wallet-id',
    wallet: new PublicKey(
      keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
    ).toBase58(),
  };
  let saved: typeof mcpApiTradeGrants.$inferSelect | undefined;
  const db = {
    select: () => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve(saved ? [saved] : []), {
            for: () => Promise.resolve(saved ? [saved] : []),
          }),
      }),
    }),
    insert: () => ({
      values: (value: typeof mcpApiTradeGrants.$inferSelect) => ({
        onConflictDoNothing: () => {
          saved ??= { ...value, status: 'pending', activatedAt: null };
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<typeof mcpApiTradeGrants.$inferSelect>) => ({
        where: () => {
          if (saved) Object.assign(saved, values);
          return Promise.resolve();
        },
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const auth = {
    requireMcpIdentity: jest.fn().mockResolvedValue(owner),
    verifyMcpWallet: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApiTradeAuthorization({
    db: db as unknown as Database,
    auth: auth as unknown as PrivyWalletAuth,
    appId: 'app',
    connection: {} as never,
    tokens: {} as never,
    rpc: {} as never,
    ...access,
    buysEnabled: true,
    sellsEnabled: false,
    signerQuorumId: 'quorum',
  });
  const settings = {
    perTradeUsd: 0.1,
    dailyUsd: 0.2,
    allowSell: false,
    maxSlippageBps: 50,
    durationHours: 1 as number | null,
  };
  const signed = (message: string) => ({
    message,
    signature: sign(null, Buffer.from(message), keys.privateKey).toString(
      'base64',
    ),
  });
  const getProof = async (action: OwnerMessage['action'], id?: string) =>
    signed(
      (
        await service.ownerChallenge(
          'owner-token',
          action,
          action === 'prepare'
            ? { settings, signerId: 'quorum', policyId: 'policy' }
            : { delegationId: id },
        )
      ).message,
    );
  return {
    service,
    settings,
    signed,
    getProof,
    owner,
    auth,
    saved: () => saved,
  };
}

describe('owner-bound grant enrollment', () => {
  afterEach(() => jest.restoreAllMocks());
  it('records and activates an explicit until-revoked grant, and rejects a timed proof in its place', async () => {
    const f = fixture();
    const timedProof = await f.getProof('prepare');
    f.settings.durationHours = null;
    await expect(
      f.service.verifyPreparation('owner-token', timedProof, f.settings),
    ).rejects.toThrow('Browser did not approve');
    const proof = await f.getProof('prepare');
    const value = await f.service.verifyPreparation(
      'owner-token',
      proof,
      f.settings,
    );
    expect(value.terms?.expiresAt).toBeNull();
    await f.service.recordPending('owner-token', proof, f.settings, {
      delegationId: value.delegationId,
      wallet: value.wallet,
      signerId: 'quorum',
      policyId: 'policy',
      ...value.terms!,
    });
    const activation = await f.getProof('activate', value.delegationId);
    await f.service.activate(
      'owner-token',
      activation,
      value.delegationId,
      () => Promise.resolve({ active: true }),
    );
    expect(f.saved()).toMatchObject({ expiresAt: null, status: 'active' });
    const revoke = await f.getProof('revoke', value.delegationId);
    await f.service.revoke('owner-token', revoke, value.delegationId);
    expect(f.saved()?.status).toBe('revoked');
  });
  it('binds the selected three-day duration to the owner proof', async () => {
    const f = fixture();
    f.settings.durationHours = MAX_GRANT_HOURS;
    const proof = await f.getProof('prepare');
    const value = await f.service.verifyPreparation(
      'owner-token',
      proof,
      f.settings,
    );
    expect(Date.parse(value.terms?.expiresAt ?? '') - value.issuedAt).toBe(
      72 * HOUR_MS,
    );
    await expect(
      f.service.verifyPreparation('owner-token', proof, {
        ...f.settings,
        durationHours: 48,
      }),
    ).rejects.toThrow('Browser did not approve');
    f.settings.durationHours = 73;
    await expect(f.getProof('prepare')).rejects.toThrow(
      'Enrollment unavailable',
    );
  });

  it('limits enrollment to the remaining time of the pinned Privy policy', async () => {
    const f = fixture();
    f.settings.durationHours = 72;
    const expiry = Math.floor(Date.now() / 1000) + 60 * 3600 + 10;
    const policy = {
      owner_id: 'policy-owner',
      chain_type: 'solana',
      version: '1.0',
      rules: [
        {
          method: 'signTransaction',
          action: 'DENY',
          name: 'deny after policy expiry',
          conditions: [
            {
              field_source: 'system',
              field: 'current_unix_timestamp',
              operator: 'gte',
              value: String(expiry),
            },
          ],
        },
        ...['allow compute', 'allow bounded jupiter buy'].map((name) => ({
          method: 'signTransaction',
          action: 'ALLOW',
          name,
          conditions: [],
        })),
      ],
    } as Parameters<typeof gatePolicyFingerprint>[0];
    const gate = new SignerGateService(
      {
        enabled: true,
        appId: 'app',
        signerQuorumId: 'quorum',
        policyId: 'policy',
        policyOwnerId: 'policy-owner',
        policyHash: gatePolicyFingerprint(policy),
        allowedUsers: new Set(['owner']),
        buysEnabled: true,
        sellsEnabled: false,
      } as SignerGateConfig,
      {
        auth: f.auth,
        privy: { policies: () => ({ get: () => Promise.resolve(policy) }) },
      } as never,
    );
    await expect(gate.grantLimits()).resolves.toEqual({
      maxDurationHours: 60,
      spendLimits: { maxPerTradeUsd: 25, maxDailyUsd: 50 },
    });
    await expect(
      gate.prepareGrant(await f.getProof('prepare'), f.settings),
    ).rejects.toThrow('Grant duration exceeds the signing policy expiry');
    f.settings.durationHours = null;
    await expect(
      gate.prepareGrant(await f.getProof('prepare'), f.settings),
    ).rejects.toThrow('Grant duration exceeds the signing policy expiry');
  });

  it.each([false, true])(
    'enforces the pinned policy for larger owner-signed grants (custom: %s)',
    async (custom) => {
      const f = fixture();
      Object.assign(f.settings, {
        perTradeUsd: 125.5,
        dailyUsd: 600,
        durationHours: null,
      });
      const proof = await f.getProof('prepare');
      const owner = JSON.parse(proof.message.split('\n')[1]) as OwnerMessage;
      const policy = {
        owner_id: 'policy-owner',
        chain_type: 'solana',
        version: '1.0',
        rules: [
          {
            name: 'allow compute budget',
            method: 'signTransaction',
            action: 'ALLOW',
            conditions: [],
          },
          {
            name: 'allow bounded jupiter buy',
            method: 'signTransaction',
            action: 'ALLOW',
            conditions: [
              {
                field_source: 'solana_instruction_data',
                field: 'shared_accounts_route.args.in_amount',
                operator: 'lte',
                value: custom ? '100000000000' : '25000000',
              },
            ],
          },
        ],
      } as Parameters<typeof gatePolicyFingerprint>[0];
      const gate = new SignerGateService(
        {
          enabled: true,
          appId: 'app',
          signerQuorumId: 'quorum',
          policyId: 'policy',
          policyOwnerId: 'policy-owner',
          policyHash: gatePolicyFingerprint(policy),
          allowedUsers: new Set(['owner']),
          buysEnabled: true,
          sellsEnabled: false,
        } as SignerGateConfig,
        {
          auth: f.auth,
          privy: { policies: () => ({ get: () => Promise.resolve(policy) }) },
          db: {
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () =>
                    Promise.resolve([
                      {
                        id: owner.delegationId,
                        status: 'pending_signer',
                        signerId: 'quorum',
                        policyId: 'policy',
                        wallet: owner.wallet,
                        perTradeLimitUsd: '125.500000',
                        dailyLimitUsd: '600.000000',
                        maxSlippageBps: 50,
                        expiresAt: null,
                        allowSell: false,
                      },
                    ]),
                }),
              }),
            }),
          },
        } as never,
      );
      const prepare = gate.prepareGrant(proof, f.settings);
      if (!custom) {
        await expect(prepare).rejects.toThrow(
          'Grant exceeds the signing policy spend limits',
        );
        return;
      }
      const grant = await prepare;
      expect(grant).toMatchObject({
        perTradeUsd: '125.500000',
        dailyUsd: '600.000000',
      });
      await f.service.recordPending('owner-token', proof, f.settings, grant);
      expect(f.saved()).toMatchObject({
        perTradeLimitUsd: '125.500000',
        dailyLimitUsd: '600.000000',
      });
      await expect(
        gate.prepareGrant(proof, { ...f.settings, dailyUsd: 601 }),
      ).rejects.toThrow('wallet-authorized');
    },
  );

  it('lets a non-allowlisted user enroll only when public access is on, within the same limits', async () => {
    const closed = fixture({ allowedUsers: new Set(['someone-else']) });
    await expect(closed.getProof('prepare')).rejects.toThrow(
      'Enrollment unavailable',
    );
    const open = fixture({ allowedUsers: new Set(), publicAccess: true });
    const proof = await open.getProof('prepare');
    await expect(
      open.service.verifyPreparation('owner-token', proof, {
        ...open.settings,
        dailyUsd: 50,
      }),
    ).rejects.toThrow();
  });
  it('records approved terms and activates only an exact signed snapshot', async () => {
    const f = fixture();
    const proof = await f.getProof('prepare');
    const value = JSON.parse(proof.message.split('\n')[1]) as OwnerMessage;
    const prepared = {
      delegationId: value.delegationId,
      wallet: value.wallet,
      signerId: 'quorum',
      policyId: 'policy',
      ...value.terms!,
    };
    await f.service.recordPending('owner-token', proof, f.settings, prepared);
    const activation = await f.getProof('activate', prepared.delegationId);
    const gateCall = jest.fn().mockResolvedValue({ active: true });
    await f.service.activate(
      'owner-token',
      activation,
      prepared.delegationId,
      gateCall,
    );
    expect(f.saved()?.status).toBe('active');
    await expect(
      f.service.activate(
        'owner-token',
        activation,
        prepared.delegationId,
        gateCall,
      ),
    ).rejects.toThrow();
    expect(gateCall).toHaveBeenCalledTimes(1);
    const revoke = await f.getProof('revoke', prepared.delegationId);
    await f.service.revoke('owner-token', revoke, prepared.delegationId);
    await expect(
      f.service.recordPending('owner-token', proof, f.settings, prepared),
    ).rejects.toThrow();
    expect(f.saved()?.status).toBe('revoked');
  });
  it('cannot create a larger independent grant from the original owner proof', async () => {
    const f = fixture();
    const proof = await f.getProof('prepare');
    await expect(
      f.service.verifyPreparation('owner-token', proof, {
        ...f.settings,
        dailyUsd: 50,
      }),
    ).rejects.toThrow();
    const changed = JSON.parse(proof.message.split('\n')[1]) as OwnerMessage;
    changed.delegationId = randomUUID();
    changed.terms!.dailyUsd = '50.000000';
    await expect(
      f.service.verifyPreparation(
        'owner-token',
        { ...proof, message: ownerPermissionMessage(changed) },
        { ...f.settings, dailyUsd: 50 },
      ),
    ).rejects.toThrow();
    expect(f.saved()).toBeUndefined();
  });
  it('gate independently rejects altered signed settings without an owner bearer', async () => {
    const f = fixture();
    const proof = await f.getProof('prepare');
    const config = {
      enabled: true,
      appId: 'app',
      signerQuorumId: 'quorum',
      policyId: 'policy',
      allowedUsers: new Set(['owner']),
    } as SignerGateConfig;
    const gate = new SignerGateService(config, { auth: f.auth } as never);
    await expect(
      gate.prepareGrant(proof, { ...f.settings, dailyUsd: 50 }),
    ).rejects.toThrow('wallet-authorized');
    expect(f.auth.verifyMcpWallet).toHaveBeenCalledWith(
      f.owner.userId,
      f.owner.walletId,
      f.owner.wallet,
    );
  });
  it('gate transport carries bounded proofs and never carries the Privy session', async () => {
    const f = fixture();
    const proof = await f.getProof('prepare');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);
    const client = new SignerGateClient(
      'http://signer-gate:3001',
      'gate-token',
      '',
    );
    await client.prepareGrant(proof, f.settings);
    await client.activateGrant(proof, randomUUID());
    await client.revokeGrant(proof, randomUUID());
    for (const [, options] of fetchMock.mock.calls) {
      if (typeof options?.body !== 'string')
        throw new Error('Expected JSON body');
      const body = JSON.parse(options.body) as {
        authorization: unknown;
        userToken?: string;
      };
      expect(body.authorization).toEqual(proof);
      expect(body.userToken).toBeUndefined();
      expect(options.body).not.toContain('owner-token');
    }
  });
});
