export function isJupiterSlippageFailure(
  error: unknown,
  program?: string,
): boolean {
  if (
    program !== 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' ||
    !error ||
    typeof error !== 'object' ||
    !('InstructionError' in error)
  )
    return false;
  const detail = error.InstructionError;
  return (
    Array.isArray(detail) &&
    Number.isSafeInteger(detail[0]) &&
    detail[1]?.Custom === 6001
  );
}
