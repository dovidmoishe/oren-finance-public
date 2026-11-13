import { BadRequestException } from '@nestjs/common';
import { gateFailureCode } from './failure-code';
import { slippageExceededMessage } from '../execution/simulation-reason';
import { simulationFailureCode } from '../execution/simulation-failure';
import {
  SOL_RENT_MESSAGE,
  SOL_FEE_MESSAGE,
} from '../execution/simulation-failure';
import {
  publicGateFailureCode,
  SignerGateRejection,
} from '../mcp-auth/signer-gate.errors';

describe('bounded gate rejection reasons', () => {
  it('records structural simulation errors without arbitrary RPC payloads', () => {
    expect(simulationFailureCode('BlockhashNotFound')).toBe(
      'BlockhashNotFound',
    );
    expect(
      simulationFailureCode({ InstructionError: [3, { Custom: 6001 }] }),
    ).toBe('instruction_3_custom_6001');
    expect(
      simulationFailureCode({ InstructionError: [3, 'secret-provider-text'] }),
    ).toBe('instruction_error');
    expect(simulationFailureCode({ payload: 'secret-token' })).toBe(
      'simulation_error',
    );
  });
  it.each([
    [SOL_RENT_MESSAGE, 'insufficient_sol_for_rent'],
    [SOL_FEE_MESSAGE, 'insufficient_sol_for_fees'],
    [
      'Headless Jupiter requires an existing source token account',
      'unsupported_route',
    ],
    [
      'Destination account creation is outside the delegated policy',
      'unsupported_route',
    ],
    [
      'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.',
      'simulation_failed',
    ],
    ['Transaction expired. Request a fresh quote.', 'transaction_expired'],
    [
      'Fresh Jupiter quote moved outside the reviewed terms',
      'reviewed_terms_changed',
    ],
    [
      'Headless Jupiter requires existing source and destination token accounts',
      'unsupported_route',
    ],
    [
      'A newly consented execute connection is required',
      'fresh_connection_required',
    ],
  ])(
    'classifies %s without exposing provider payloads',
    (message, expected) => {
      const code = gateFailureCode(new Error(message));
      expect(code).toBe(expected);
      expect(publicGateFailureCode(new SignerGateRejection(code))).toBe(
        expected,
      );
    },
  );
  it('classifies a slippage simulation separately from a missing grant', () => {
    const slippage = gateFailureCode(
      new BadRequestException({
        message: slippageExceededMessage(50),
        code: 'QUOTE_SLIPPAGE_EXCEEDED',
      }),
    );
    expect(slippage).toBe('slippage_exceeded');
    expect(publicGateFailureCode(new SignerGateRejection(slippage))).toBe(
      'slippage_exceeded',
    );
    expect(
      gateFailureCode(
        new Error('Delegation is inactive or exceeds owner-only limits'),
      ),
    ).toBe('inactive_delegation');
    expect(
      gateFailureCode(
        new Error(
          'The price moved outside the approved tolerance. Request a fresh quote and review its minimum proceeds.',
        ),
      ),
    ).toBe('slippage_exceeded');
  });
  it('does not expose arbitrary exceptions or gate response strings', () => {
    expect(
      simulationFailureCode({ InsufficientFundsForRent: { account_index: 0 } }),
    ).toBe('insufficient_rent_account_0');
    for (const index of [-1, 256, 'secret-token', undefined])
      expect(
        simulationFailureCode({
          InsufficientFundsForRent: { account_index: index },
        }),
      ).toBe('simulation_error');
    const secret =
      'provider error containing secret-token and signed transaction';
    expect(gateFailureCode(new Error(secret))).toBe('gate_rejected');
    expect(gateFailureCode(null)).toBe('gate_rejected');
    expect(publicGateFailureCode(new SignerGateRejection(secret))).toBe(
      'unavailable',
    );
    expect(publicGateFailureCode(new Error(secret))).toBe('unavailable');
  });
});
