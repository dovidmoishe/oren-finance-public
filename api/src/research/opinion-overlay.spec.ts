import { opinionOverlay } from './opinion-overlay';

describe('opinionOverlay', () => {
  it('deduplicates repeated theses, caps authors, and treats EXIT separately', () => {
    const result = opinionOverlay(
      {
        available: true,
        source: 'drip',
        queried: 'NVDA',
        ticker: 'NVDA',
        summary: {
          calls: 8,
          analysts: 3,
          bullish: 4,
          bearish: 2,
          neutral: 2,
          byAction: {},
        },
        truncated: false,
        disclaimer: '',
        opinions: [
          {
            author: 'Alice',
            date: '2026-11-01',
            url: 'https://a.test/1',
            summary: 'Demand is growing',
            stance: 'BULLISH',
            action: 'ADD',
          },
          {
            author: 'Alice',
            date: '2026-11-01',
            url: 'https://a.test/2',
            summary: 'Demand is growing',
            stance: 'BULLISH',
            action: 'ADD',
          },
          {
            author: 'Bob',
            date: '2026-11-01',
            url: 'https://b.test/1',
            summary: 'Valuation is high',
            stance: 'BEARISH',
            action: 'OPINION',
          },
          {
            author: 'Cara',
            date: '2026-11-01',
            url: 'https://c.test/1',
            summary: 'Closed position',
            stance: 'BEARISH',
            action: 'EXIT',
          },
          {
            author: 'No link',
            date: '2026-11-01',
            summary: 'No citation',
            stance: 'BULLISH',
          },
        ],
      },
      new Date('2026-11-02'),
    );
    expect(result).toMatchObject({
      mentionCount: 8,
      distinctAuthors: 3,
      coverage: 'current',
      disagreement: true,
      stanceByAuthor: { bullish: 1, bearish: 1, neutral: 0 },
    });
    expect(result?.items).toHaveLength(3);
  });

  it('separates stale and empty coverage from a neutral stance', () => {
    const base = {
      available: true as const,
      source: 'drip' as const,
      queried: 'NVDA',
      ticker: 'NVDA',
      summary: {
        calls: 0,
        analysts: 0,
        bullish: 0,
        bearish: 0,
        neutral: 0,
        byAction: {},
      },
      truncated: false,
      disclaimer: '',
    };
    expect(opinionOverlay({ ...base, opinions: [] })?.coverage).toBe('empty');
    expect(
      opinionOverlay(
        {
          ...base,
          opinions: [
            {
              author: 'Alice',
              date: '2025-01-01',
              url: 'https://a.test/1',
              summary: 'Old view',
              stance: 'NEUTRAL',
            },
          ],
        },
        new Date('2026-11-02'),
      )?.coverage,
    ).toBe('stale');
  });
});
