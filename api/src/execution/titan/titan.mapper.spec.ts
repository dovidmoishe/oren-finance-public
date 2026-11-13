import {
  ALT_USED,
  STOCK,
  titanResponse,
  USDC,
  WALLET,
} from '../../test/titan.fixtures';
import { TitanError } from './titan.errors';
import {
  estimatePriceImpactPercent,
  isTitanQuote,
  mapTitanQuoteToDomain,
  selectTitanWinner,
  u64ToString,
} from './titan.mapper';
import type { TitanRoutePayload } from './titan.types';

const variant = {
  mint: STOCK,
  symbol: 'TSLAx',
  name: 'Tesla xStock',
  decimals: 8,
  tradable: true,
};

function map(
  response = titanResponse(),
  overrides: { slippageBps?: number } = {},
) {
  return mapTitanQuoteToDomain({
    response,
    side: 'buy',
    assetId: 'tsla',
    ticker: 'TSLA',
    variant,
    inputMint: USDC,
    outputMint: STOCK,
    inputSymbol: 'USDC',
    outputSymbol: 'TSLAx',
    inputDecimals: 6,
    outputDecimals: 8,
    amountUsd: 100,
    slippageBps: overrides.slippageBps ?? 50,
    amountRaw: '100000000',
    wallet: WALLET,
    quotedAt: new Date(1_800_000_000_000),
  });
}

describe('titan.mapper', () => {
  it('uses metadata.ExpectedWinner, not the highest outAmount', () => {
    const response = titanResponse({
      metadata: { ExpectedWinner: 'Titan' },
    });
    expect(selectTitanWinner(response).providerId).toBe('Titan');
  });

  it('accepts the lower-case expectedWinner alias', () => {
    const response = titanResponse({
      metadata: { expectedWinner: 'Titan' },
    });
    expect(selectTitanWinner(response).providerId).toBe('Titan');
  });

  it('rejects a winner that is missing from quotes', () => {
    const response = titanResponse({
      metadata: { ExpectedWinner: 'Ghost' },
    });
    expect(() => selectTitanWinner(response)).toThrow(TitanError);
  });

  it('maps the winning route into a domain Quote with a server payload', () => {
    const quote = map();
    expect(quote.provider).toBe('titan:Titan-DART');
    expect(quote.inputAmount).toBe(100);
    expect(quote.outputAmount).toBe(4.01);
    expect(quote.estimatedPriceUsd).toBeCloseTo(100 / 4.01, 10);
    expect(quote.slippageBps).toBe(50);
    expect(quote.quotedAt.getTime()).toBe(1_800_000_000_000);
    expect(quote.expiresAt.getTime()).toBe(1_800_000_030_000);
    expect(isTitanQuote(quote)).toBe(true);

    const payload = quote.routePayload as TitanRoutePayload;
    expect(payload).toMatchObject({
      kind: 'titan',
      quoteId: 'swap:test:0',
      providerId: 'Titan-DART',
      wallet: WALLET,
      quotedAtMs: 1_800_000_000_000,
      inAmountRaw: '100000000',
      outAmountRaw: '401000000',
      amountRaw: '100000000',
      inputDecimals: 6,
      outputDecimals: 8,
    });
    // Only lookup tables the chosen route references are retained.
    expect(payload.alts.map((alt) => alt.p)).toEqual([ALT_USED]);
  });

  it('estimates price impact from Titan reference prices', () => {
    // $100 in, 4.01 × $24.90 = $99.849 out → 0.151%.
    expect(estimatePriceImpactPercent(titanResponse(), 100, 4.01)).toBeCloseTo(
      0.151,
      6,
    );
    expect(
      estimatePriceImpactPercent(titanResponse({ metadata: {} }), 100, 4),
    ).toBe(0);
    expect(
      estimatePriceImpactPercent(
        titanResponse({
          metadata: { inputPriceUSD: 1, outputPriceUSD: 30 },
        }),
        100,
        4,
      ),
    ).toBe(0);
  });

  it('normalises u64 values and rejects unsafe numbers', () => {
    expect(u64ToString(12, 'x')).toBe('12');
    expect(u64ToString('18446744073709551615', 'x')).toBe(
      '18446744073709551615',
    );
    expect(() => u64ToString(2 ** 60, 'x')).toThrow(TitanError);
    expect(() => u64ToString(-1, 'x')).toThrow(TitanError);
    expect(() => u64ToString(undefined, 'x')).toThrow(TitanError);
  });

  describe('response validation (H3)', () => {
    const invalid = (
      response: ReturnType<typeof titanResponse>,
      slippage = 50,
    ) => {
      try {
        map(response, { slippageBps: slippage });
      } catch (err) {
        return (err as TitanError).titanCode;
      }
      return 'accepted';
    };
    const dart = (patch: Record<string, unknown>) => {
      const base = titanResponse();
      return titanResponse({
        quotes: {
          ...base.quotes,
          'Titan-DART': { ...base.quotes['Titan-DART'], ...patch },
        },
      });
    };

    it('rejects swapped or foreign mints', () => {
      expect(
        invalid(titanResponse({ inputMint: STOCK, outputMint: USDC })),
      ).toBe('invalid_response');
      expect(invalid(titanResponse({ outputMint: USDC }))).toBe(
        'invalid_response',
      );
    });

    it('rejects a route that spends more than requested', () => {
      expect(invalid(dart({ inAmount: 150_000_000 }))).toBe('invalid_response');
      expect(invalid(titanResponse({ amount: 150_000_000 }))).toBe(
        'invalid_response',
      );
    });

    it('accepts a route that spends less than requested', () => {
      expect(invalid(dart({ inAmount: 99_000_000 }))).toBe('accepted');
    });

    it('rejects route slippage above the requested slippage', () => {
      expect(invalid(dart({ slippageBps: 1000 }))).toBe('invalid_response');
      expect(invalid(dart({ slippageBps: 51 }))).toBe('invalid_response');
      expect(invalid(dart({ slippageBps: 30 }))).toBe('accepted');
    });

    it('hard-rejects a decimals mismatch with the catalog', () => {
      expect(
        invalid(
          titanResponse({
            metadata: {
              ExpectedWinner: 'Titan-DART',
              inputMintDecimals: 6,
              outputMintDecimals: 9,
            },
          }),
        ),
      ).toBe('invalid_response');
    });

    it('uses the route slippage as the quote slippage', () => {
      expect(map(dart({ slippageBps: 30 })).slippageBps).toBe(30);
    });
  });

  it('treats an empty quotes map as no_route', () => {
    try {
      map(titanResponse({ quotes: {}, metadata: {} }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as TitanError).titanCode).toBe('no_route');
    }
  });
});
