import type { StockResearch } from '../../types/research';
import { changesSince, snapshotOf } from './research-changes';

const report: StockResearch = {
  assetId: 'nvda',
  ticker: 'NVDA',
  name: 'NVIDIA',
  generatedAt: '2026-11-01T00:00:00Z',
  analysis: {
    available: true,
    observedAt: '2026-11-01T00:00:00Z',
    data: { opportunityScore: 60 } as never,
  },
  news: {
    available: true,
    data: [
      {
        headline: 'Older',
        url: 'https://news.test/old',
        publishedAt: new Date('2026-11-01'),
      },
    ],
  },
  portfolio: { available: true, data: null },
  opinions: {
    available: true,
    data: {
      items: [
        {
          author: 'Alice',
          source: 'A',
          date: '2026-11-01',
          url: 'https://a.test/old',
          stance: 'BULLISH',
          action: 'ADD',
          summary: 'Growing',
        },
      ],
      mentionCount: 1,
      distinctAuthors: 1,
      stanceByAuthor: { bullish: 1, bearish: 0, neutral: 0 },
      coverage: 'thin',
      disagreement: false,
      truncated: false,
    },
  },
};

it('reports only sourced changes against a saved snapshot', () => {
  const snapshot = snapshotOf(report);
  const next: StockResearch = {
    ...report,
    analysis: { ...report.analysis, data: { opportunityScore: 67 } as never },
    news: {
      available: true,
      data: [
        ...report.news.data!,
        {
          headline: 'New catalyst',
          url: 'https://news.test/new',
          publishedAt: new Date('2026-11-02'),
        },
      ],
    },
    opinions: {
      available: true,
      data: {
        ...report.opinions.data!,
        items: [
          ...report.opinions.data!.items,
          {
            author: 'Bob',
            source: 'B',
            date: '2026-11-02',
            url: 'https://b.test/new',
            stance: 'BEARISH',
            summary: 'Risk rises',
          },
        ],
      },
    },
  };
  expect(changesSince(snapshot, next)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'score' }),
      expect.objectContaining({
        kind: 'opinion_added',
        url: 'https://b.test/new',
      }),
      expect.objectContaining({
        kind: 'news_added',
        url: 'https://news.test/new',
      }),
    ]),
  );
  expect(
    changesSince(snapshot, {
      ...next,
      opinions: { available: false },
      news: { available: false },
    }).map((item) => item.kind),
  ).toEqual(['score']);
});
