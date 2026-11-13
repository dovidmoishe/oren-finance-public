import { ApprovalService } from './approval.service';
import type { ApprovalRow } from './approval.repository';
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
function fixture(status = 'prepared') {
  let row = {
    id: 'approval',
    userId: 'user',
    walletId: 'privy-wallet',
    wallet: 'wallet',
    kind: 'swap',
    referenceId: 'quote',
    executionId: 'execution',
    transaction: 'unsigned',
    signedTransaction: null,
    signature: null,
    status,
    details: { quote: { id: 'quote' } },
    feeLamports: '5000',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  } as ApprovalRow;
  const auth = {
    signingRequest: jest.fn().mockReturnValue({
      version: 1,
      method: 'POST',
      body: { transaction: 'unsigned' },
    }),
    requireWallet: jest.fn().mockResolvedValue('user'),
    requireSigner: jest.fn().mockResolvedValue({
      userId: 'user',
      walletId: 'privy-wallet',
      token: 'user-jwt',
    }),
    signTransaction: jest.fn().mockResolvedValue('signed'),
  };
  const approvals = {
    pending: jest.fn(() => Promise.resolve([{ ...row }])),
    get: jest.fn(() => Promise.resolve({ ...row })),
    create: jest.fn(() => Promise.resolve(row)),
    claim: jest.fn(() => {
      if (row.status !== 'prepared') return Promise.resolve(undefined);
      row = { ...row, status: 'signing' };
      return Promise.resolve({ ...row });
    }),
    patch: jest.fn((_id: string, patch: Partial<ApprovalRow>) => {
      row = { ...row, ...patch };
      return Promise.resolve({ ...row });
    }),
  };
  const rpc = {
    expiryHeight: jest.fn().mockResolvedValue(200),
    inspect: jest.fn().mockResolvedValue('5000'),
    validateSigned: jest.fn().mockReturnValue('signature'),
    broadcast: jest.fn().mockResolvedValue('signature'),
    status: jest.fn().mockResolvedValue(null),
    blockhashValid: jest.fn().mockResolvedValue(true),
    currentSlot: jest.fn().mockResolvedValue(100),
  };
  const executedQuote = {
    id: 'quote',
    provider: 'jupiter',
    expiresAt: new Date(Date.now() + 60000),
    routePayload: { secret: 'route' },
  };
  const expectation = {
    inputMint: 'in',
    outputMint: 'out',
    maxInRaw: '100',
    minOutRaw: '99',
  };
  const execution = {
    prepareWithQuote: jest.fn().mockResolvedValue({
      prepared: {
        transaction: 'unsigned',
        executionId: 'execution',
        expiresAt: new Date(Date.now() + 60000),
      },
      quote: executedQuote,
      expectation,
    }),
  };
  const executions = {
    findById: jest.fn().mockResolvedValue({ status: 'awaiting_signature' }),
    submitAndEnqueue: jest.fn(),
    updateStatus: jest.fn(),
  };
  const cachedQuote = {
    quote: { id: 'quote', expiresAt: new Date(Date.now() + 60000) },
  };
  const quotes = {
    get: jest.fn().mockReturnValue(cachedQuote),
    peek: jest.fn().mockReturnValue(cachedQuote),
  };
  const orders = {
    upsert: jest.fn(),
    updateStatus: jest.fn(),
    findByOrderKey: jest.fn(),
  };
  const withdrawalStocks = {
    assertReviewed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApprovalService(
    auth as never,
    approvals as never,
    rpc as never,
    execution as never,
    executions as never,
    orders as never,
    quotes as never,
    {} as never,
    { SOLANA_NETWORK: 'mainnet' } as never,
    withdrawalStocks as never,
  );
  return {
    service,
    withdrawalStocks,
    auth,
    approvals,
    rpc,
    execution,
    executions,
    orders,
    quotes,
    executedQuote,
    expectation,
    row: () => row,
    set: (patch: Partial<ApprovalRow>) => {
      row = { ...row, ...patch };
    },
  };
}
describe('server trade approvals', () => {
  it('keeps an uncertain prepared withdrawal pending until its approval expires', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'prepared',
    );
    f.set({ expiresAt: new Date(0) });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('does not sign or broadcast a stock withdrawal after its share adjustment changes', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal', details: { asset: 'STOCK', mint: 'mint' } });
    f.withdrawalStocks.assertReviewed.mockRejectedValue(
      new Error('Share adjustment changed'),
    );
    await expect(
      f.service.approve('Bearer token', 'approval', 'owner-authorization'),
    ).rejects.toThrow('Share adjustment changed');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('requires explicit authorization before signing a withdrawal', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    await expect(
      f.service.approve('Bearer token', 'approval'),
    ).rejects.toThrow();
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('confirms a withdrawal without treating it as a stock execution', async () => {
    const f = fixture('submitted');
    f.set({ kind: 'withdrawal', signature: 'signature' });
    f.rpc.status.mockResolvedValue({
      err: null,
      confirmationStatus: 'confirmed',
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'confirmed',
    );
    expect(f.executions.updateStatus).not.toHaveBeenCalled();
    expect(f.orders.upsert).not.toHaveBeenCalled();
  });
  it('persists a signed withdrawal before broadcast and retries only those same bytes', async () => {
    const f = fixture();
    f.set({ kind: 'withdrawal' });
    f.rpc.broadcast.mockRejectedValueOnce(new Error('Lost response'));
    expect(
      (
        await f.service.approve(
          'Bearer token',
          'approval',
          'owner-authorization',
        )
      ).status,
    ).toBe('signed');
    expect(f.approvals.patch).toHaveBeenCalledWith(
      'approval',
      expect.objectContaining({
        status: 'signed',
        signedTransaction: 'signed',
      }),
      'signing',
    );
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    await f.service.approve('Bearer token', 'approval');
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast.mock.calls).toEqual([['signed'], ['signed']]);
    expect(f.executions.updateStatus).not.toHaveBeenCalled();
  });
  it('binds the approval to the quote prepare executed, without re-reading the cache (H5)', async () => {
    const f = fixture();
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      referenceId: 'quote',
      wallet: 'wallet',
    });
    expect(f.execution.prepareWithQuote).toHaveBeenCalledWith({
      quoteId: 'quote',
      wallet: 'wallet',
    });
    expect(f.quotes.peek).not.toHaveBeenCalled();
    expect(f.quotes.get).not.toHaveBeenCalled();
    const { routePayload: _omit, ...publicExecuted } = f.executedQuote;
    void _omit;
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          quote: publicExecuted,
          expectation: f.expectation,
        }) as unknown,
      }),
    );
    // Route payloads never reach the approval row / client.
    const created = (f.approvals.create.mock.calls[0] as unknown[])[0] as {
      details: { quote: Record<string, unknown> };
    };
    expect(created.details.quote).not.toHaveProperty('routePayload');
  });
  it('caps approval validity at the route expiry from prepare', async () => {
    const f = fixture();
    const routeExpiry = new Date(Date.now() + 10_000);
    f.execution.prepareWithQuote.mockResolvedValueOnce({
      prepared: {
        transaction: 'unsigned',
        executionId: 'execution',
        expiresAt: routeExpiry,
        expiresAfterSlot: 500,
      },
      quote: f.executedQuote,
      expectation: f.expectation,
    });
    await f.service.prepare('Bearer token', {
      kind: 'swap',
      referenceId: 'quote',
      wallet: 'wallet',
    });
    expect(f.approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: routeExpiry,
        details: expect.objectContaining({ expiresAfterSlot: 500 }) as unknown,
      }),
    );
  });
  it('re-checks balances against the reviewed expectation and the slot before signing', async () => {
    const f = fixture();
    f.set({
      details: {
        quote: { id: 'quote' },
        expectation: f.expectation,
        expiresAfterSlot: 150,
      },
    });
    await f.service.approve('Bearer token', 'approval', 'request-signature');
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      f.expectation,
    );
    expect(f.rpc.currentSlot).toHaveBeenCalled();
  });
  it('refuses to sign once the route slot has passed', async () => {
    const f = fixture();
    f.set({ details: { quote: { id: 'quote' }, expiresAfterSlot: 99 } });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('expired');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.approvals.claim).not.toHaveBeenCalled();
  });
  it('checks fresh wallet ownership for status without reloading the signing wallet', async () => {
    const f = fixture('submitted');
    f.set({ signature: 'signature' });
    await f.service.status('Bearer token', 'approval');
    expect(f.auth.requireWallet).toHaveBeenCalledWith('Bearer token', 'wallet');
    expect(f.auth.requireSigner).not.toHaveBeenCalled();
    f.rpc.status.mockClear();
    f.auth.requireWallet.mockResolvedValueOnce('other-user');
    await expect(
      f.service.status('Bearer token', 'approval'),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.rpc.status).not.toHaveBeenCalled();
  });
  it('requires request authorization before signing and returns only the stored canonical request for authorization', async () => {
    const f = fixture();
    await expect(f.service.approve('Bearer token', 'approval')).rejects.toThrow(
      'Authorize this trade',
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.inspect).not.toHaveBeenCalled();
    await f.service.authorizationRequest('Bearer token', 'approval');
    expect(f.auth.signingRequest).toHaveBeenCalledWith(
      'privy-wallet',
      'unsigned',
      'approval',
      f.row().expiresAt,
    );
    f.set({ expiresAt: new Date(0) });
    f.auth.signingRequest.mockClear();
    await expect(
      f.service.authorizationRequest('Bearer token', 'approval'),
    ).rejects.toThrow('expired');
    expect(f.auth.signingRequest).not.toHaveBeenCalled();
  });
  it('does not submit when expiry recovery wins the atomic signed-state transition', async () => {
    const f = fixture();
    f.approvals.patch.mockResolvedValueOnce(undefined as never);
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('expired before submission');
    expect(f.approvals.patch).toHaveBeenCalledWith(
      'approval',
      expect.objectContaining({ status: 'signed' }),
      'signing',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('recovers pending approvals only for the authenticated wallet without returning signing material', async () => {
    const f = fixture('signed');
    const rows = await f.service.pending('Bearer token', 'wallet');
    expect(f.auth.requireWallet).toHaveBeenCalledWith('Bearer token', 'wallet');
    expect(f.approvals.pending).toHaveBeenCalledWith('user', 'wallet');
    expect(rows[0]).not.toHaveProperty('transaction');
    expect(rows[0]).not.toHaveProperty('signedTransaction');
    expect(rows[0]).not.toHaveProperty('walletId');
    f.auth.requireWallet.mockRejectedValueOnce(new Error('unlinked'));
    f.approvals.pending.mockClear();
    await expect(f.service.pending('Bearer token', 'other')).rejects.toThrow(
      'unlinked',
    );
    expect(f.approvals.pending).not.toHaveBeenCalled();
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('prepares a canonical server transaction without signing or submitting', async () => {
    const f = fixture();
    await f.service.prepare('Bearer token', {
      wallet: 'wallet',
      kind: 'swap',
      referenceId: 'quote',
    });
    expect(f.rpc.inspect).toHaveBeenCalledWith(
      'unsigned',
      'wallet',
      f.expectation,
    );
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('rejects another user or unlinked wallet before signing', async () => {
    const f = fixture();
    f.auth.requireSigner.mockResolvedValue({
      userId: 'other',
      walletId: 'privy-wallet',
      token: 'jwt',
    });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('rejects expired approvals and simulation failures', async () => {
    const f = fixture();
    f.set({ expiresAt: new Date(0) });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toMatchObject({ status: 400 });
    f.set({ expiresAt: new Date(Date.now() + 60000) });
    f.rpc.inspect.mockRejectedValueOnce(new Error('simulation failed'));
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('simulation failed');
    expect(f.auth.signTransaction).not.toHaveBeenCalled();
  });
  it('claims once and never signs twice on concurrent approvals', async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      f.service.approve('Bearer token', 'approval', 'request-signature'),
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast).toHaveBeenCalledTimes(1);
    expect(f.approvals.patch.mock.calls[0][1]).toMatchObject({
      status: 'signed',
      signedTransaction: 'signed',
      signature: 'signature',
    });
  });
  it('never broadcasts a signature that changes the reviewed transaction', async () => {
    const f = fixture();
    f.rpc.validateSigned.mockImplementation(() => {
      throw new Error('message changed');
    });
    await expect(
      f.service.approve('Bearer token', 'approval', 'request-signature'),
    ).rejects.toThrow('message changed');
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
    expect(f.row().status).toBe('failed');
  });
  it('preserves signed bytes after an uncertain send and retries only the same transaction', async () => {
    const f = fixture();
    f.rpc.broadcast.mockRejectedValueOnce(new Error('network timeout'));
    const pending = await f.service.approve(
      'Bearer token',
      'approval',
      'request-signature',
    );
    expect(pending.status).toBe('signed');
    const sent = await f.service.approve(
      'Bearer token',
      'approval',
      'request-signature',
    );
    expect(sent.status).toBe('submitted');
    expect(f.auth.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.rpc.broadcast.mock.calls).toEqual([['signed'], ['signed']]);
    await f.service.approve('Bearer token', 'approval', 'request-signature');
    expect(f.rpc.broadcast).toHaveBeenCalledTimes(2);
  });
  it('retains the wallet lock while a signed transaction can still land', async () => {
    const f = fixture('signed');
    f.set({
      signature: 'signature',
      signedTransaction: 'signed',
      expiresAt: new Date(0),
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'signed',
    );
    f.rpc.blockhashValid.mockResolvedValue(false);
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('clears an expired signing claim without submitting anything', async () => {
    const f = fixture('signing');
    f.set({ expiresAt: new Date(0) });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'failed',
    );
    expect(f.rpc.broadcast).not.toHaveBeenCalled();
  });
  it('does not mark a limit order open until confirmation', async () => {
    const f = fixture('submitted');
    f.set({
      kind: 'limit',
      signature: 'signature',
      details: { orderKey: 'order', proposal: { expiredAt: 1900000000 } },
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'submitted',
    );
    expect(f.orders.upsert).not.toHaveBeenCalled();
    f.rpc.status.mockResolvedValue({
      err: null,
      confirmationStatus: 'confirmed',
    });
    expect((await f.service.status('Bearer token', 'approval')).status).toBe(
      'confirmed',
    );
    expect(f.orders.upsert).toHaveBeenCalledTimes(1);
  });
});
