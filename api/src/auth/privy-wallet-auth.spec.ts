import { PrivyWalletAuth } from './privy-wallet-auth';
import { Logger } from '@nestjs/common';

const verify = jest.fn();
const getUser = jest.fn();
const getWallet = jest.fn();
const signTransaction = jest.fn();
jest.mock('@privy-io/node', () => ({
  PrivyClient: jest.fn().mockImplementation(() => ({
    utils: () => ({ auth: () => ({ verifyAccessToken: verify }) }),
    users: () => ({ _get: getUser }),
    wallets: () => ({ get: getWallet, solana: () => ({ signTransaction }) }),
  })),
}));

describe('PrivyWalletAuth', () => {
  const auth = new PrivyWalletAuth('app', 'secret');
  beforeEach(() => {
    jest.resetAllMocks();
    verify.mockResolvedValue({ user_id: 'did:privy:user' });
    getUser.mockResolvedValue({
      linked_accounts: [
        { type: 'wallet', chain_type: 'solana', address: 'owned' },
        { type: 'wallet', chain_type: 'ethereum', address: 'other-chain' },
      ],
    });
  });

  it('requires configuration and a bearer token', async () => {
    await expect(
      new PrivyWalletAuth().requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(auth.requireWallet(undefined, 'owned')).rejects.toMatchObject({
      status: 401,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and mismatched wallets', async () => {
    verify.mockRejectedValueOnce(new Error('bad token'));
    await expect(
      auth.requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      auth.requireWallet('Bearer token', 'other-chain'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      auth.requireWallet('Bearer token', 'unlinked'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed when the user lookup fails', async () => {
    getUser.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      auth.requireWallet('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('identifies a bearer session and ignores a bad token', async () => {
    getUser.mockResolvedValueOnce({
      email: { address: 'owner@example.com' },
      linked_accounts: [],
    });
    await expect(auth.tryIdentify('Bearer token')).resolves.toEqual({
      userId: 'did:privy:user',
      email: 'owner@example.com',
    });
    verify.mockRejectedValueOnce(new Error('bad token'));
    await expect(auth.tryIdentify('Bearer token')).resolves.toBeUndefined();
    await expect(auth.tryIdentify(undefined)).resolves.toBeUndefined();
  });

  it('accepts a verified linked Solana wallet', async () => {
    await expect(auth.requireWallet('Bearer token', 'owned')).resolves.toBe(
      'did:privy:user',
    );
    expect(getUser).toHaveBeenCalledWith('did:privy:user');
  });
  it('binds research identity to the verified linked wallet', async () => {
    await expect(
      auth.requireResearchIdentity('Bearer token', 'owned'),
    ).resolves.toMatchObject({
      userId: 'did:privy:user',
      walletAddress: 'owned',
    });
    await expect(
      auth.requireResearchIdentity('Bearer token', 'unlinked'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('requires an embedded wallet ID and matches its canonical address', async () => {
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
    getUser.mockResolvedValue({
      linked_accounts: [
        {
          type: 'wallet',
          chain_type: 'solana',
          address: 'owned',
          wallet_client_type: 'privy',
          id: 'wallet-id',
        },
      ],
    });
    getWallet.mockResolvedValue({ chain_type: 'solana', address: 'owned' });
    getUser.mockClear();
    await expect(auth.requireSigner('Bearer token', 'owned')).resolves.toEqual({
      userId: 'did:privy:user',
      walletId: 'wallet-id',
      token: 'token',
    });
    expect(getUser).toHaveBeenCalledTimes(1);
    // A subsequent request must recheck current links, not use a cached owner.
    getUser.mockResolvedValueOnce({ linked_accounts: [] });
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
    getWallet.mockResolvedValue({
      chain_type: 'solana',
      address: 'someone-else',
    });
    await expect(
      auth.requireSigner('Bearer token', 'owned'),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('authorizes sign-only with the exact request signature and approval idempotency key', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    signTransaction.mockResolvedValue({ signed_transaction: 'signed' });
    const expiry = new Date(Date.now() + 60000);
    await expect(
      auth.signTransaction(
        'wallet-id',
        'token',
        'unsigned',
        'approval-id',
        expiry,
      ),
    ).resolves.toBe('signed');
    expect(signTransaction).toHaveBeenCalledWith('wallet-id', {
      transaction: 'unsigned',
      authorization_context: { signatures: ['token'] },
      idempotency_key: 'approval-id',
      request_expiry: expiry.getTime(),
    });
    signTransaction.mockRejectedValue(
      new Error('secret-sdk-request-with-token'),
    );
    await expect(
      auth.signTransaction(
        'wallet-id',
        'token',
        'unsigned',
        'approval-id',
        expiry,
      ),
    ).rejects.toThrow('Privy could not authorize');
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'secret-sdk-request-with-token',
    );
    warning.mockRestore();
  });
  it('returns a definite pre-submission failure and logs only safe provider metadata', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    signTransaction.mockRejectedValue({
      status: 403,
      error: { code: 'authorization_denied', message: 'private-request-token' },
      headers: new Headers({
        'x-request-id': 'request-123',
        authorization: 'private-request-token',
      }),
    });
    try {
      await auth.signTransaction(
        'wallet-id',
        'user-secret-token',
        'unsigned',
        'approval-id',
        new Date(Date.now() + 60000),
      );
      throw new Error('Expected refusal');
    } catch (error) {
      expect((error as { getResponse(): unknown }).getResponse()).toEqual(
        expect.objectContaining({
          code: 'PRIVY_SIGNING_FAILED',
          submissionState: 'not_submitted',
        }),
      );
      expect(warning.mock.calls.flat().join(' ')).toContain(
        'status=403 code=authorization_denied requestId=request-123',
      );
      expect(warning.mock.calls.flat().join(' ')).not.toMatch(
        /private-request-token|user-secret-token/,
      );
    } finally {
      warning.mockRestore();
    }
  });
});
