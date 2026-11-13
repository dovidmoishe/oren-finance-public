export class SignerGateRejection extends Error {
  constructor(readonly code: string) {
    super(`Signer gate: ${code}`);
  }
}

/** Only bounded gate codes may reach MCP clients; arbitrary provider text stays private. */
export function publicGateFailureCode(error: unknown): string {
  const allowed = new Set([
    'over_budget',
    'inactive_delegation',
    'unsupported_route',
    'simulation_failed',
    'slippage_exceeded',
    'insufficient_balance',
    'insufficient_sol_for_rent',
    'insufficient_sol_for_fees',
    'transaction_expired',
    'reviewed_terms_changed',
    'intent_unavailable',
    'fresh_connection_required',
    'gate_rejected',
  ]);
  return error instanceof SignerGateRejection && allowed.has(error.code)
    ? error.code
    : 'unavailable';
}
