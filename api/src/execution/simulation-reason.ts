import { SOL_FEE_MESSAGE, SOL_RENT_MESSAGE } from './simulation-failure';

/** Jupiter Aggregator v6. Custom 6001 is SlippageToleranceExceeded. */
export const JUPITER_V6_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
/**
 * Titan swap program. Custom 6008 is LessThanMinimumAmountOut
 * ("Amount less than minimum specified"). Custom 6001 on this program is
 * TooManyMintsSpecified, not slippage.
 */
export const TITAN_SWAP_PROGRAM = 'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type SimulationReason =
  | 'slippage_exceeded'
  | 'insufficient_balance'
  | 'insufficient_sol_for_rent'
  | 'insufficient_sol_for_fees'
  | 'simulation_failed';

export const INSUFFICIENT_BALANCE_MESSAGE =
  'The wallet does not have enough balance for this swap. Check the input token and SOL for fees.';

export const SIMULATION_FAILED_MESSAGE =
  'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.';

export function formatSlippagePercent(slippageBps: number): string {
  const percent = slippageBps / 100;
  const text = Number.isInteger(percent)
    ? String(percent)
    : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text}%`;
}

/** Spoken reason for a price move. Does not ask for a new permission. */
export function slippageExceededMessage(slippageBps?: number): string {
  const moved =
    typeof slippageBps === 'number' &&
    Number.isInteger(slippageBps) &&
    slippageBps > 0 &&
    slippageBps <= 10_000
      ? `more than ${formatSlippagePercent(slippageBps)}`
      : 'past the approved slippage limit';
  return `The price moved ${moved} after the quote. Try again or allow higher slippage.`;
}

export function simulationReason(
  error: unknown,
  program?: string,
): SimulationReason {
  if (error === 'InsufficientFundsForFee') return 'insufficient_sol_for_fees';
  if (error && typeof error === 'object' && 'InsufficientFundsForRent' in error)
    return 'insufficient_sol_for_rent';
  const custom = instructionCustom(error);
  if (!custom) return 'simulation_failed';
  if (program === JUPITER_V6_PROGRAM && (custom === 6001 || custom === 6004))
    return 'slippage_exceeded';
  if (program === TITAN_SWAP_PROGRAM && custom === 6008)
    return 'slippage_exceeded';
  if (
    (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) &&
    custom === 1
  )
    return 'insufficient_balance';
  if (program === JUPITER_V6_PROGRAM && custom === 6024)
    return 'insufficient_balance';
  return 'simulation_failed';
}

function instructionCustom(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('InstructionError' in error))
    return undefined;
  const detail = (error as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(detail) || !Number.isSafeInteger(detail[0]))
    return undefined;
  const info: unknown = detail[1];
  if (
    !info ||
    typeof info !== 'object' ||
    !('Custom' in info) ||
    !Number.isSafeInteger((info as { Custom?: unknown }).Custom)
  )
    return undefined;
  return Number((info as { Custom: number }).Custom);
}

export function exceptionBodyCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('getResponse' in error))
    return undefined;
  const getResponse = (error as { getResponse?: unknown }).getResponse;
  if (typeof getResponse !== 'function') return undefined;
  try {
    const body: unknown = getResponse.call(error);
    if (!body || typeof body !== 'object' || !('code' in body))
      return undefined;
    const code = (body as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

export function simulationGateCode(error: unknown): string | undefined {
  switch (exceptionBodyCode(error)) {
    case 'QUOTE_SLIPPAGE_EXCEEDED':
      return 'slippage_exceeded';
    case 'INSUFFICIENT_BALANCE':
      return 'insufficient_balance';
    case 'INSUFFICIENT_SOL_FOR_RENT':
      return 'insufficient_sol_for_rent';
    case 'INSUFFICIENT_SOL_FOR_FEES':
      return 'insufficient_sol_for_fees';
    case 'SIMULATION_FAILED':
      return 'simulation_failed';
    default:
      return undefined;
  }
}

export function isSlippageSimulationError(error: unknown): boolean {
  return (
    exceptionBodyCode(error) === 'QUOTE_SLIPPAGE_EXCEEDED' ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'slippage_exceeded')
  );
}

/**
 * Run `run` once more when it fails because the quoted price moved.
 * The callback must keep the caller's original slippage; this helper never
 * receives a limit it could widen.
 */
export async function retryOnceOnSlippage<T>(
  run: () => Promise<T>,
): Promise<{ value: T; retried: boolean }> {
  try {
    return { value: await run(), retried: false };
  } catch (error) {
    if (!isSlippageSimulationError(error)) throw error;
    return { value: await run(), retried: true };
  }
}

export function toolFailurePayload(error: unknown): {
  error: string;
  code?: string;
} {
  const code = simulationGateCode(error);
  if (code === 'slippage_exceeded')
    return {
      error: slippageExceededMessage(),
      code,
    };
  if (code === 'insufficient_balance')
    return {
      error: INSUFFICIENT_BALANCE_MESSAGE,
      code,
    };
  if (code === 'insufficient_sol_for_rent')
    return { error: SOL_RENT_MESSAGE, code };
  if (code === 'insufficient_sol_for_fees')
    return { error: SOL_FEE_MESSAGE, code };
  if (code === 'simulation_failed')
    return { error: SIMULATION_FAILED_MESSAGE, code };
  return { error: error instanceof Error ? error.message : String(error) };
}

export function delegatedFailureBody(
  intentId: string,
  code: string,
  slippageBps?: number,
): Record<string, unknown> | undefined {
  const message =
    code === 'slippage_exceeded'
      ? slippageExceededMessage(slippageBps)
      : code === 'insufficient_balance'
        ? INSUFFICIENT_BALANCE_MESSAGE
        : code === 'simulation_failed'
          ? SIMULATION_FAILED_MESSAGE
          : undefined;
  if (!message) return undefined;
  return {
    intentId,
    status: code,
    reason: code,
    signingGrant: 'active',
    broadcast: false,
    message: `${message} The signing grant is still active; this is not a missing signing permission. No transaction was broadcast.`,
    ...(code === 'slippage_exceeded' && slippageBps !== undefined
      ? { slippageBps }
      : {}),
  };
}
