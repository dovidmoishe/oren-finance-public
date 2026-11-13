import {
  mapJupiterQuoteToDomain,
  parsePriceImpactPercent,
  rawAmountToUi,
  uiAmountToRaw,
} from './jupiter.mapper';
import type { JupiterQuoteRaw } from './jupiter.types';
import type { TokenizedEquity } from '../../../types/equity';

describe('jupiter.mapper', () => {
  const variant: TokenizedEquity = {
    mint: 'StockMint111',
    symbol: 'xAAPL',
    name: 'Apple xStock',
    decimals: 6,
    tradable: true,
  };

  const raw: JupiterQuoteRaw = {
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'StockMint111',
    inAmount: '100000000', // 100 USDC
    outAmount: '420000', // 0.42 stock @ 6 decimals
    slippageBps: 50,
    priceImpactPct: '0.03',
  };

  it('converts raw and ui amounts', () => {
    expect(rawAmountToUi('1000000', 6)).toBe(1);
    expect(uiAmountToRaw(1.5, 6)).toBe('1500000');
    expect(parsePriceImpactPercent('0.03')).toBe(3);
    expect(parsePriceImpactPercent('0.00020743931921022977')).toBeCloseTo(
      0.020743931921022977,
      8,
    );
    expect(parsePriceImpactPercent('')).toBe(0);
  });

  it('maps Jupiter quote into domain Quote', () => {
    const quote = mapJupiterQuoteToDomain({
      raw,
      side: 'buy',
      assetId: 'aapl',
      ticker: 'AAPL',
      variant,
      inputSymbol: 'USDC',
      outputSymbol: 'xAAPL',
      inputDecimals: 6,
      outputDecimals: 6,
      amountUsd: 100,
      slippageBps: 50,
      quoteId: 'q-1',
    });

    expect(quote.id).toBe('q-1');
    expect(quote.provider).toBe('jupiter');
    expect(quote.inputAmount).toBe(100);
    expect(quote.outputAmount).toBe(0.42);
    expect(quote.estimatedPriceUsd).toBeCloseTo(100 / 0.42);
    expect(quote.priceImpactPercent).toBe(3);
    expect(quote.routePayload).toBe(raw);
  });
});
