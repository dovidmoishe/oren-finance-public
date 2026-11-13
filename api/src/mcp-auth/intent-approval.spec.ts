import { USDC_MINT } from '../config/constants';
import { approvalMatchesMcpIntent } from './intent-approval';

const mint = 'stock-mint';
const quote = {
  id: 'quote-1',
  side: 'sell',
  assetId: 'apple',
  variant: { mint },
  inputMint: mint,
  outputMint: USDC_MINT,
  inputAmount: 2.5,
  slippageBps: 50,
};
const intent = {
  side: 'sell' as const,
  assetId: 'apple',
  stockMint: mint,
  amountUsd: null,
  amountShares: '2.500000000000',
  maxInRaw: '2500000000',
  slippageBps: 50,
};
const expectation = { maxInRaw: '2500000000' };

describe('MCP sell browser approval', () => {
  it('accepts the exact stock mint, share input, and raw input bound', () => {
    expect(approvalMatchesMcpIntent(intent, quote, expectation, quote.id)).toBe(
      true,
    );
  });

  it.each([
    ['different mint', { variant: { mint: 'other-stock' } }, expectation],
    ['different share input', { inputAmount: 3 }, expectation],
    ['different side', { side: 'buy' }, expectation],
    ['different output mint', { outputMint: mint }, expectation],
    ['higher slippage', { slippageBps: 51 }, expectation],
    ['different raw input', {}, { maxInRaw: '3000000000' }],
  ])('rejects %s', (_name, change, raw) => {
    expect(
      approvalMatchesMcpIntent(intent, { ...quote, ...change }, raw, quote.id),
    ).toBe(false);
  });
});
