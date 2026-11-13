import type { Quote } from '../../types/quote';
import {
  NYSE_CALENDAR_COVERED_THROUGH,
  NYSE_EARLY_CLOSE_DATES,
  NYSE_FULL_CLOSE_DATES,
  marketSessionForTrade,
  stampQuoteMarketSession,
  usMarketSession,
} from './us-market-session';

const at = (iso: string) => new Date(iso);

describe('us market session', () => {
  it('treats 9:30 ET as regular and 16:00 ET as after-hours', () => {
    expect(usMarketSession(at('2026-11-03T14:29:00Z')).state).toBe(
      'pre_market',
    );
    expect(usMarketSession(at('2026-11-03T14:30:00Z'))).toMatchObject({
      state: 'regular',
      regular: true,
      thinBook: false,
    });
    expect(usMarketSession(at('2026-11-03T20:59:00Z')).state).toBe('regular');
    expect(usMarketSession(at('2026-11-03T21:00:00Z')).state).toBe(
      'after_hours',
    );
    expect(usMarketSession(at('2026-11-04T00:59:00Z')).state).toBe(
      'after_hours',
    );
    expect(usMarketSession(at('2026-11-04T01:00:00Z')).state).toBe('overnight');
    expect(usMarketSession(at('2026-11-03T08:59:00Z')).state).toBe('overnight');
    expect(usMarketSession(at('2026-11-03T09:00:00Z')).state).toBe(
      'pre_market',
    );
  });

  it('keeps the same clock across the 2026 DST transitions', () => {
    expect(usMarketSession(at('2026-03-06T15:00:00Z')).state).toBe('regular');
    expect(usMarketSession(at('2026-03-09T14:00:00Z')).state).toBe('regular');
    expect(usMarketSession(at('2026-10-30T14:00:00Z')).state).toBe('regular');
    expect(usMarketSession(at('2026-11-02T15:00:00Z')).state).toBe('regular');
  });

  it('closes weekends, full holidays, and the night after a holiday', () => {
    expect(usMarketSession(at('2026-11-07T15:00:00Z')).state).toBe('closed');
    expect(usMarketSession(at('2026-11-08T15:00:00Z')).state).toBe('closed');
    expect(usMarketSession(at('2026-11-07T05:00:00Z')).state).toBe('closed');
    expect(usMarketSession(at('2026-11-06T02:00:00Z')).state).toBe('overnight');
    for (const day of NYSE_FULL_CLOSE_DATES) {
      expect(usMarketSession(at(`${day}T15:00:00Z`)).state).toBe('closed');
      expect(usMarketSession(at(`${day}T22:00:00Z`)).state).toBe('closed');
    }
    expect(usMarketSession(at('2026-07-03T15:00:00Z')).state).toBe('closed');
    expect(usMarketSession(at('2027-12-24T15:00:00Z')).state).toBe('closed');
    expect(usMarketSession(at('2027-06-18T15:00:00Z')).state).toBe('closed');
  });

  it('ends regular hours at 13:00 ET on published early-close dates', () => {
    for (const day of NYSE_EARLY_CLOSE_DATES) {
      expect(usMarketSession(at(`${day}T17:59:00Z`)).state).toBe('regular');
      expect(usMarketSession(at(`${day}T18:00:00Z`)).state).toBe('early_close');
      expect(usMarketSession(at(`${day}T23:59:00Z`)).state).toBe('early_close');
    }
    expect(usMarketSession(at('2026-11-28T01:00:00Z')).state).toBe('overnight');
    expect(usMarketSession(at('2026-07-02T18:00:00Z')).state).toBe('regular');
    expect(usMarketSession(at('2027-07-02T18:00:00Z')).state).toBe('regular');
  });

  it('uses the approved copy for every non-regular state', () => {
    expect(usMarketSession(at('2026-11-03T14:00:00Z')).summary).toBe(
      "US markets aren't in the regular session yet. This price is the on-chain market, and it can differ from the next open.",
    );
    expect(usMarketSession(at('2026-11-03T21:30:00Z')).summary).toBe(
      'The regular US session is over. On-chain prices can drift until the next open.',
    );
    expect(usMarketSession(at('2026-11-27T18:30:00Z')).summary).toBe(
      'The regular US session is over. On-chain prices can drift until the next open.',
    );
    expect(usMarketSession(at('2026-11-04T02:00:00Z')).summary).toBe(
      'US markets are closed for the night. The on-chain book is often thinner, and the price can sit away from the stock until the open.',
    );
    expect(usMarketSession(at('2026-11-07T15:00:00Z')).summary).toBe(
      'US markets are closed. On-chain liquidity is often thinner, and the price can sit away from the stock until the next open.',
    );
    expect(usMarketSession(at('2026-11-26T15:00:00Z')).summary).toBe(
      'US markets are closed. On-chain liquidity is often thinner, and the price can sit away from the stock until the next open.',
    );
  });

  it('marks a thin book outside regular hours when impact or liquidity crosses the line', () => {
    const closed = at('2026-11-07T15:00:00Z');
    const open = at('2026-11-03T15:00:00Z');
    const thinImpact = marketSessionForTrade({
      at: closed,
      priceImpactPercent: 1,
    });
    expect(thinImpact.thinBook).toBe(true);
    expect(thinImpact.summary).toContain(
      'This size also moves the on-chain price more than a typical fill. A smaller amount usually lands closer.',
    );
    expect(
      marketSessionForTrade({
        at: closed,
        priceImpactPercent: 0.99,
        liquidityUsd: 100_000,
      }).thinBook,
    ).toBe(false);
    expect(
      marketSessionForTrade({ at: closed, liquidityUsd: 99_999 }).thinBook,
    ).toBe(true);
    expect(
      marketSessionForTrade({ at: closed, priceImpactPercent: 0 }).thinBook,
    ).toBe(false);
    expect(
      marketSessionForTrade({
        at: open,
        priceImpactPercent: 5,
        liquidityUsd: 1,
      }).thinBook,
    ).toBe(false);
  });

  it('uses the shorter limit line and does not append the thin-book sentence', () => {
    const session = marketSessionForTrade({
      at: at('2026-11-07T15:00:00Z'),
      kind: 'limit',
      liquidityUsd: 1_000,
      priceImpactPercent: 4,
    });
    expect(session.thinBook).toBe(true);
    expect(session.summary).toBe(
      "US markets aren't in the regular session. This limit uses the on-chain price, which may not match the next open. It fills only if the market reaches your price.",
    );
    expect(
      marketSessionForTrade({
        at: at('2026-11-03T15:00:00Z'),
        kind: 'limit',
        liquidityUsd: 1,
      }).regular,
    ).toBe(true);
  });

  it('stamps catalog stock quotes and leaves unresolved mints alone', () => {
    const stock = quote({ assetId: 'nvda', liquidity: 50_000, impact: 0.2 });
    stampQuoteMarketSession(stock, at('2026-11-07T15:00:00Z'));
    expect(stock.marketSession?.thinBook).toBe(true);

    const unknown = quote({ assetId: 'unknown', liquidity: 1, impact: 9 });
    stampQuoteMarketSession(unknown, at('2026-11-07T15:00:00Z'));
    expect(unknown.marketSession).toBeUndefined();
  });

  it('covers every date through the end of next calendar year', () => {
    const nextYearEnd = `${new Date().getUTCFullYear() + 1}-12-31`;
    expect(NYSE_CALENDAR_COVERED_THROUGH >= nextYearEnd).toBe(true);

    let cursor = Date.parse('2026-01-01T15:00:00Z');
    const stop = Date.parse(`${NYSE_CALENDAR_COVERED_THROUGH}T15:00:00Z`);
    while (cursor <= stop) {
      const session = usMarketSession(new Date(cursor));
      expect(session.state).toBeTruthy();
      expect(session.observedAt).toBe(new Date(cursor).toISOString());
      expect(session.regular).toBe(session.state === 'regular');
      cursor += 86_400_000;
    }
  });
});

function quote(input: {
  assetId: string;
  liquidity?: number;
  impact: number;
}): Quote {
  const now = new Date('2026-11-07T15:00:00Z');
  return {
    id: 'q',
    side: 'buy',
    assetId: input.assetId,
    ticker: 'NVDA',
    variant: {
      mint: 'mint',
      symbol: 'NVDAx',
      name: 'NVIDIA',
      liquidity: input.liquidity,
      tradable: true,
    },
    inputMint: 'usdc',
    outputMint: 'mint',
    inputSymbol: 'USDC',
    outputSymbol: 'NVDAx',
    inputAmount: 100,
    outputAmount: 1,
    estimatedPriceUsd: 100,
    amountUsd: 100,
    priceImpactPercent: input.impact,
    slippageBps: 50,
    provider: 'jupiter',
    quotedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
  };
}
