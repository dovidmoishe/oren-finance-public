import { BadRequestException } from '@nestjs/common';
import { SignerGateClient } from './signer-gate.client';
import { SignerGateRejection } from './signer-gate.errors';
import { slippageExceededMessage } from '../execution/simulation-reason';

jest.mock('@privy-io/node', () => ({
  generateAuthorizationSignature: jest.fn(() => 'auth-sig'),
}));

const EXECUTION = '11111111-1111-4111-8111-111111111111';
const actor = {
  grantId: 'grant',
  clientId: 'client',
  userId: 'user',
  walletId: 'wallet-id',
  wallet: 'wallet',
};

function slippageError() {
  return new BadRequestException({
    message: slippageExceededMessage(50),
    code: 'QUOTE_SLIPPAGE_EXCEEDED',
  });
}

function mockGate(
  handler: (path: string, body: Record<string, unknown>) => unknown,
) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  global.fetch = jest.fn((url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const raw = init?.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<
      string,
      unknown
    >;
    calls.push({ path, body });
    const result = handler(path, body);
    const failed =
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error?: unknown }).error === 'string';
    return Promise.resolve({
      ok: !failed,
      json: () => Promise.resolve(result),
    } as Response);
  }) as typeof fetch;
  return calls;
}

describe('SignerGateClient slippage retry', () => {
  const authorize = jest.fn();

  beforeEach(() => {
    authorize.mockReset();
  });

  function client() {
    return new SignerGateClient(
      'http://signer-gate:3001',
      'token',
      'private-key',
      { authorize },
    );
  }

  it('re-quotes once after a slippage simulation and then submits', async () => {
    const calls = mockGate((path) => {
      if (path === '/challenge')
        return {
          executionId: EXECUTION,
          state: 'challenged',
          canonicalRequestBase64: 'YQ==',
        };
      if (path === '/slippage-retry')
        return {
          executionId: EXECUTION,
          state: 'challenged',
          canonicalRequestBase64: 'Yg==',
          slippageRequoted: true,
        };
      if (path === '/complete')
        return {
          executionId: EXECUTION,
          state: 'broadcast',
          chainSignature: 'sig',
        };
      throw new Error(path);
    });
    authorize
      .mockRejectedValueOnce(slippageError())
      .mockResolvedValueOnce(Buffer.from('bytes'));
    const result = await client().execute('intent', 'idempotency-key-1', actor);
    expect(result).toMatchObject({ state: 'broadcast', chainSignature: 'sig' });
    expect(calls.map((call) => call.path)).toEqual([
      '/challenge',
      '/slippage-retry',
      '/complete',
    ]);
    expect(calls[1].body).toEqual({ executionId: EXECUTION });
    expect(calls[1].body).not.toHaveProperty('slippageBps');
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('returns slippage_exceeded after a second simulation rejection', async () => {
    const calls = mockGate((path) => {
      if (path === '/abort-unsigned') return { aborted: true };
      if (path === '/challenge' || path === '/slippage-retry')
        return {
          executionId: EXECUTION,
          state: 'challenged',
          canonicalRequestBase64: 'YQ==',
          slippageRequoted: path === '/slippage-retry',
        };
      throw new Error(path);
    });
    authorize.mockRejectedValue(slippageError());
    await expect(
      client().execute('intent', 'idempotency-key-1', actor),
    ).rejects.toMatchObject({ code: 'slippage_exceeded' });
    expect(calls.map((call) => call.path)).toEqual([
      '/challenge',
      '/slippage-retry',
      '/abort-unsigned',
    ]);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('does not re-quote when the signing grant is actually inactive', async () => {
    const calls = mockGate((path) => {
      if (path === '/challenge')
        return {
          executionId: EXECUTION,
          state: 'challenged',
          canonicalRequestBase64: 'YQ==',
        };
      throw new Error(path);
    });
    authorize.mockRejectedValue(
      new Error('Independent trade authorization is inactive'),
    );
    const attempt = client().execute('intent', 'idempotency-key-1', actor);
    await expect(attempt).rejects.toBeInstanceOf(SignerGateRejection);
    await expect(attempt).rejects.toMatchObject({
      code: 'inactive_delegation',
    });
    expect(calls.every((call) => call.path === '/challenge')).toBe(true);
    expect(calls.some((call) => call.path === '/slippage-retry')).toBe(false);
  });
});
