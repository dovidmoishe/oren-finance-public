/** Extract structural RPC failure details without logging RPC payloads. */
export function simulationFailureCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'InsufficientFundsForRent' in error
  ) {
    const detail = error.InsufficientFundsForRent;
    if (
      detail &&
      typeof detail === 'object' &&
      'account_index' in detail &&
      Number.isSafeInteger(detail.account_index) &&
      Number(detail.account_index) >= 0 &&
      Number(detail.account_index) <= 255
    )
      return `insufficient_rent_account_${Number(detail.account_index)}`;
  }
  if (
    [
      'BlockhashNotFound',
      'AccountNotFound',
      'InsufficientFundsForFee',
      'InvalidAccountForFee',
      'AlreadyProcessed',
    ].includes(error as string)
  )
    return error as string;
  if (error && typeof error === 'object' && 'InstructionError' in error) {
    const detail = error.InstructionError;
    const instructionDetail: unknown = Array.isArray(detail) ? detail[1] : null;
    if (
      Array.isArray(detail) &&
      Number.isSafeInteger(detail[0]) &&
      instructionDetail &&
      typeof instructionDetail === 'object' &&
      'Custom' in instructionDetail &&
      Number.isSafeInteger(instructionDetail.Custom)
    )
      return `instruction_${Number(detail[0])}_custom_${Number(instructionDetail.Custom)}`;
    return 'instruction_error';
  }
  return 'simulation_error';
}

export const SOL_RENT_MESSAGE =
  'Your wallet needs more SOL to cover token-account rent and transaction fees. Add SOL, then request a fresh quote.';
export const SOL_FEE_MESSAGE =
  'Your wallet needs more SOL to pay transaction fees. Add SOL, then request a fresh quote.';
