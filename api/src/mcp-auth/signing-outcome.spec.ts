import { signingFailureDetails, signingOutcome } from './signing-outcome';

describe('delegated signing outcomes', () => {
  it('keeps timeouts uncertain and unbroadcast, without leaking provider text', () => {
    const failure = signingFailureDetails(new Error('secret request payload'));
    expect(failure).toEqual({
      errorCode: 'privy_uncertain',
      status: 'unknown',
      requestId: 'unknown',
    });
    expect(signingOutcome(failure.errorCode)).toMatchObject({
      submissionState: 'not_broadcast',
      reason: 'signing_uncertain',
    });
  });
  it('records HTTP rejection metadata without assuming the provider reason', () => {
    expect(
      signingFailureDetails({
        status: 403,
        error: { message: 'secret' },
        headers: new Headers({ 'x-request-id': 'req-123' }),
      }),
    ).toEqual({
      errorCode: 'privy_rejected_403',
      status: 403,
      requestId: 'req-123',
    });
    expect(signingOutcome('privy_rejected_403').reason).toBe(
      'signing_rejected',
    );
    expect(signingFailureDetails({ status: 503 }).errorCode).toBe(
      'privy_uncertain',
    );
  });
  it('never claims not broadcast when a signature is recorded or failure is from broadcast', () => {
    expect(signingOutcome('privy_uncertain', 'chain-signature')).toEqual({});
    expect(signingOutcome('broadcast_uncertain')).toEqual({});
    expect(signingOutcome('secret')).toEqual({});
  });
  it('ignores malformed optional request headers', () => {
    expect(
      signingFailureDetails({
        headers: {
          get() {
            throw Error('secret');
          },
        },
      }).requestId,
    ).toBe('unknown');
  });
});
