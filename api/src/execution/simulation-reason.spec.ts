import { BadRequestException } from '@nestjs/common';
import {
  delegatedFailureBody,
  formatSlippagePercent,
  isSlippageSimulationError,
  JUPITER_V6_PROGRAM,
  retryOnceOnSlippage,
  simulationReason,
  slippageExceededMessage,
  TITAN_SWAP_PROGRAM,
  toolFailurePayload,
} from './simulation-reason';

const tokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

describe('simulation failure reasons', () => {
  it('maps Jupiter 6001 and Titan minimum-out to slippage, not other 6001s', () => {
    const jupiter = { InstructionError: [2, { Custom: 6001 }] };
    expect(simulationReason(jupiter, JUPITER_V6_PROGRAM)).toBe(
      'slippage_exceeded',
    );
    expect(simulationReason(jupiter, TITAN_SWAP_PROGRAM)).toBe(
      'simulation_failed',
    );
    expect(
      simulationReason(
        { InstructionError: [2, { Custom: 6008 }] },
        TITAN_SWAP_PROGRAM,
      ),
    ).toBe('slippage_exceeded');
    expect(
      simulationReason(
        { InstructionError: [2, { Custom: 6004 }] },
        JUPITER_V6_PROGRAM,
      ),
    ).toBe('slippage_exceeded');
  });

  it('maps balance and SOL funding failures without treating them as slippage', () => {
    expect(
      simulationReason({ InstructionError: [1, { Custom: 1 }] }, tokenProgram),
    ).toBe('insufficient_balance');
    expect(
      simulationReason(
        { InstructionError: [2, { Custom: 6024 }] },
        JUPITER_V6_PROGRAM,
      ),
    ).toBe('insufficient_balance');
    expect(simulationReason('InsufficientFundsForFee')).toBe(
      'insufficient_sol_for_fees',
    );
    expect(
      simulationReason({ InsufficientFundsForRent: { account_index: 0 } }),
    ).toBe('insufficient_sol_for_rent');
    expect(
      simulationReason(
        { InstructionError: [2, { Custom: 1 }] },
        JUPITER_V6_PROGRAM,
      ),
    ).toBe('simulation_failed');
  });

  it('describes 50 bps as 0.5% and does not call it a missing permission', () => {
    expect(formatSlippagePercent(50)).toBe('0.5%');
    const message = slippageExceededMessage(50);
    expect(message).toContain('more than 0.5%');
    expect(message).toContain('Try again or allow higher slippage');
    expect(message).not.toMatch(/signing grant|signing permission/i);
    expect(message).not.toMatch(/obtain fresh approval/i);
    const body = delegatedFailureBody('intent-1', 'slippage_exceeded', 50);
    expect(body).toMatchObject({
      status: 'slippage_exceeded',
      signingGrant: 'active',
      slippageBps: 50,
      broadcast: false,
      message: expect.stringContaining('The signing grant is still active'),
    });
  });

  it('gives the in-app copilot a slippage payload instead of a permission error', () => {
    const error = new BadRequestException({
      message: slippageExceededMessage(50),
      code: 'QUOTE_SLIPPAGE_EXCEEDED',
    });
    expect(isSlippageSimulationError(error)).toBe(true);
    expect(toolFailurePayload(error)).toEqual({
      error: slippageExceededMessage(),
      code: 'slippage_exceeded',
    });
    expect(
      toolFailurePayload(
        new Error('Independent trade authorization is inactive'),
      ),
    ).toEqual({ error: 'Independent trade authorization is inactive' });
  });
});

describe('retryOnceOnSlippage', () => {
  const slippage = () =>
    new BadRequestException({
      message: slippageExceededMessage(50),
      code: 'QUOTE_SLIPPAGE_EXCEEDED',
    });

  it('re-quotes once after slippage and keeps the original limit', async () => {
    const seen: number[] = [];
    const slippageBps = 50;
    let attempts = 0;
    const result = await retryOnceOnSlippage(() => {
      seen.push(slippageBps);
      attempts += 1;
      if (slippageBps !== 50) return Promise.reject(new Error('widened'));
      if (attempts === 1) return Promise.reject(slippage());
      return Promise.resolve('quoted');
    });
    expect(result).toEqual({ value: 'quoted', retried: true });
    expect(seen).toEqual([50, 50]);
  });

  it('returns the second slippage failure without a third quote', async () => {
    const run = jest.fn(() => Promise.reject(slippage()));
    await expect(retryOnceOnSlippage(run)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry a missing-permission failure', async () => {
    const run = jest.fn(() =>
      Promise.reject(
        new Error('Delegation is inactive or exceeds owner-only limits'),
      ),
    );
    await expect(retryOnceOnSlippage(run)).rejects.toThrow(/inactive/);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
