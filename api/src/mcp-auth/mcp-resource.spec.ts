import type { Request } from 'express';
import { requireMcpAccess, type McpResourceDeps } from './mcp-resource';

const resource = 'https://api.oren.finance/mcp';
const connection = {
  grantId: 'grant-1',
  clientId: 'client-1',
  userId: 'user-1',
  walletId: 'wallet-1',
  wallet: 'solana-wallet',
  scopes: 'oren.read',
  createdAt: new Date(),
};

function fixture(overrides: Record<string, unknown> = {}, rows = [connection]) {
  const find = jest.fn().mockResolvedValue({
    isValid: true,
    aud: resource,
    scopes: new Set(['oren.read']),
    accountId: connection.userId,
    clientId: connection.clientId,
    grantId: connection.grantId,
    ...overrides,
  });
  const limit = jest.fn().mockResolvedValue(rows);
  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit }),
      }),
    }),
  };
  const verifyMcpWallet = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db,
    auth: { verifyMcpWallet },
    oauth: { resource, provider: { AccessToken: { find } } },
  } as unknown as McpResourceDeps;
  const req = { headers: { authorization: 'Bearer opaque-token' } } as Request;
  return { deps, req, db, find, verifyMcpWallet };
}

describe('MCP resource access', () => {
  it('rejects a token for another resource before looking up a wallet', async () => {
    const { deps, req, db, verifyMcpWallet } = fixture({
      aud: 'https://other.example/mcp',
    });
    await expect(requireMcpAccess(req, deps)).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
    expect(verifyMcpWallet).not.toHaveBeenCalled();
  });

  it('rejects a token with no active connection', async () => {
    const { deps, req, verifyMcpWallet } = fixture({}, []);
    await expect(requireMcpAccess(req, deps)).resolves.toBeUndefined();
    expect(verifyMcpWallet).not.toHaveBeenCalled();
  });

  it('rejects a token that claims a scope the connection did not grant', async () => {
    const { deps, req, verifyMcpWallet } = fixture({
      scopes: new Set(['oren.read', 'oren.trade.prepare']),
    });
    await expect(requireMcpAccess(req, deps)).resolves.toBeUndefined();
    expect(verifyMcpWallet).not.toHaveBeenCalled();
  });

  it('rejects an execution scope absent from browser consent', async () => {
    const { deps, req, verifyMcpWallet } = fixture({
      scopes: new Set(['oren.read', 'oren.trade.execute']),
    });
    await expect(requireMcpAccess(req, deps)).resolves.toBeUndefined();
    expect(verifyMcpWallet).not.toHaveBeenCalled();
  });

  it('rejects a connection after seven days even with a valid token', async () => {
    const expired = {
      ...connection,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
    };
    const { deps, req, verifyMcpWallet } = fixture({}, [expired]);
    await expect(requireMcpAccess(req, deps)).resolves.toBeUndefined();
    expect(verifyMcpWallet).not.toHaveBeenCalled();
  });

  it('rechecks the exact wallet linked during consent', async () => {
    const { deps, req, verifyMcpWallet } = fixture();
    await expect(requireMcpAccess(req, deps)).resolves.toMatchObject(
      connection,
    );
    expect(verifyMcpWallet).toHaveBeenCalledWith(
      'user-1',
      'wallet-1',
      'solana-wallet',
    );
  });
});
