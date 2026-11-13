import { isJupiterSlippageFailure } from './jupiter-slippage';
const program = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
it('identifies Jupiter slippage without mislabeling other programs or fee failures', () => {
  expect(
    isJupiterSlippageFailure(
      { InstructionError: [3, { Custom: 6001 }] },
      program,
    ),
  ).toBe(true);
  expect(
    isJupiterSlippageFailure(
      { InstructionError: [3, { Custom: 6001 }] },
      'other',
    ),
  ).toBe(false);
  expect(
    isJupiterSlippageFailure(
      { InstructionError: [3, { Custom: 6024 }] },
      program,
    ),
  ).toBe(false);
  expect(isJupiterSlippageFailure('InsufficientFundsForFee', program)).toBe(
    false,
  );
});
