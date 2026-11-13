/** Bounded metadata only: never return SDK messages or request/response bodies. */
export function signingFailureDetails(error: unknown) {
  const e = error as {
    status?: unknown;
    headers?: { get?: (key: string) => unknown };
  } | null;
  const status =
    typeof e?.status === 'number' &&
    Number.isInteger(e.status) &&
    e.status >= 400 &&
    e.status <= 599
      ? e.status
      : undefined;
  let requestId: unknown;
  try {
    requestId = e?.headers?.get?.('x-request-id');
  } catch {
    /* optional metadata */
  }
  return {
    errorCode:
      status && [400, 401, 403, 404, 409, 422].includes(status)
        ? `privy_rejected_${status}`
        : 'privy_uncertain',
    status: status ?? 'unknown',
    requestId:
      typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId)
        ? requestId
        : 'unknown',
  };
}

export function signingOutcome(
  errorCode: string | null | undefined,
  signature?: string | null,
) {
  if (
    signature ||
    !(
      errorCode === 'signing_uncertain' ||
      errorCode === 'signing_rejected' ||
      errorCode === 'privy_uncertain' ||
      /^privy_rejected_(400|401|403|404|409|422)$/.test(errorCode ?? '')
    )
  )
    return {};
  return {
    submissionState: 'not_broadcast',
    reason:
      errorCode === 'privy_uncertain' || errorCode === 'signing_uncertain'
        ? 'signing_uncertain'
        : 'signing_rejected',
    message:
      'Wallet signing did not complete. No transaction was broadcast by Oren. Do not report this as submitted or retry a new trade until this attempt is resolved.',
  };
}
