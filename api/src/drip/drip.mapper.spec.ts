import { selectHighlights } from './drip-dedupe';
import {
  compactPicks,
  compactTickerCoverage,
  presentOpinions,
} from './drip.mapper';
import type { DripCitation, DripStance } from './drip.types';

function dated(
  author: string,
  stance: DripStance | undefined,
  day: number,
): DripCitation {
  return {
    author,
    stance,
    date: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  };
}

describe('selectHighlights', () => {
  it('keeps a bearish view when newer bullish posts could fill every slot', () => {
    const highlights = selectHighlights(
      [
        dated('bull-a', 'BULLISH', 20),
        dated('bull-b', 'BULLISH', 19),
        dated('bull-c', 'BULLISH', 18),
        dated('bull-d', 'BULLISH', 17),
        dated('bear-a', 'BEARISH', 10),
        dated('bear-b', 'BEARISH', 9),
      ],
      4,
    );
    expect(highlights).toHaveLength(4);
    expect(highlights.map((item) => item.stance)).toContain('BEARISH');
  });

  it('fills remaining slots with the newest posts from new authors', () => {
    const highlights = selectHighlights(
      [
        dated('bull-a', 'BULLISH', 20),
        dated('bull-b', 'BULLISH', 19),
        dated('bull-a', 'BULLISH', 18),
        dated('bear-a', 'BEARISH', 10),
      ],
      4,
    );
    expect(highlights.map((item) => item.author)).toEqual([
      'bull-a',
      'bull-b',
      'bear-a',
    ]);
  });
});

describe('Drip response mapping', () => {
  it('keeps a short cited opinion and the stance summary', () => {
    const compact = compactTickerCoverage({
      meta: {
        ticker: 'nvda',
        from: '2026-10-01',
        to: '2026-10-31',
        asOf: '2026-11-01T00:00:00.000Z',
        truncated: false,
      },
      summary: {
        calls: 2,
        analysts: 1,
        bullish: 1,
        bearish: 1,
        neutral: 0,
        byAction: { ADD: 1, EXIT: 1 },
      },
      authors: [
        {
          author: 'Example Analyst',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              evidenceQuote: 'Adding to NVDA on the pullback.',
              articleTitle: 'Example Finance Newsletter',
              articleUrl:
                'https://dripstack.com/api/v2/sources/example/nvda-review',
              publishedAt: '2026-10-30T11:24:07.000Z',
              thesis:
                'The author adds after a drawdown, citing datacenter demand.',
              speakerIsGuest: false,
            },
            {
              sentiment: null,
              action: 'OPINION',
              evidenceQuote: '   ',
              thesis: '',
              articleUrl: 'javascript:alert(1)',
            },
          ],
        },
      ],
    });

    expect(compact?.ticker).toBe('NVDA');
    expect(compact?.opinions).toEqual([
      {
        author: 'Example Analyst',
        source: 'Example Finance Newsletter',
        sourceKind: 'article',
        sourceLabel: 'Article',
        linkLabel: 'Example Analyst',
        date: '2026-10-30T11:24:07.000Z',
        stance: 'BULLISH',
        action: 'ADD',
        summary: 'The author adds after a drawdown, citing datacenter demand.',
        quote: 'Adding to NVDA on the pullback.',
        url: 'https://dripstack.com/api/v2/sources/example/nvda-review',
      },
    ]);
    const presented = presentOpinions(compact!, 'NVDAx', 'NVDAx', 8);
    expect(presented).toMatchObject({
      available: true,
      queried: 'NVDAx',
      ticker: 'NVDA',
      mappedFrom: 'NVDAx',
      windowComplete: true,
      summary: {
        calls: 1,
        analysts: 1,
        bullish: 1,
        bearish: 0,
        byAction: { ADD: 1 },
        bySource: { Article: 1 },
      },
    });
    expect(presented.disclaimer).toContain('not financial advice');
  });

  it('compacts picks to author, source, date, stance, quote, and link', () => {
    const compact = compactPicks({
      meta: {
        plan: 'PRO',
        appliedRange: { from: '2026-10-30', to: '2026-10-31' },
        asOf: '2026-11-01T00:00:00.000Z',
      },
      pagination: { count: 1, nextCursor: null },
      picks: [
        {
          ticker: 'tsla',
          action: 'NEW_POSITION',
          author: 'Podcast Host',
          publicationTitle: 'The Daily Tape',
          articleUrl: 'https://example.com/tsla',
          sentiment: 'BEARISH',
          evidenceQuote: 'A'.repeat(400),
          thesis: null,
          publishedAt: '2026-10-31T09:00:00.000Z',
          speakerIsGuest: true,
        },
      ],
    });

    expect(compact?.picks).toHaveLength(1);
    expect(compact?.picks[0]).toMatchObject({
      ticker: 'TSLA',
      author: 'Podcast Host',
      source: 'The Daily Tape',
      stance: 'BEARISH',
      action: 'NEW_POSITION',
      guest: true,
      url: 'https://example.com/tsla',
    });
    expect(compact?.picks[0].quote?.endsWith('…')).toBe(true);
    expect(compact?.picks[0].quote?.length).toBeLessThanOrEqual(180);
  });

  it('rejects a payload that is not the documented envelope', () => {
    expect(compactTickerCoverage({ picks: [] })).toBeNull();
    expect(compactPicks({ authors: [] })).toBeNull();
  });

  it('drops uncitable and duplicate opinions before selecting the visible sample', () => {
    const mention = {
      thesis: 'Same thesis',
      articleUrl: 'https://example.com/a',
      publishedAt: '2026-11-01',
      sentiment: 'BULLISH',
    };
    const result = compactTickerCoverage({
      meta: { ticker: 'NVDA' },
      summary: { calls: 4 },
      authors: [
        {
          author: 'Alice',
          mentions: [
            mention,
            { ...mention, articleUrl: 'https://example.com/b' },
            { ...mention, thesis: 'No link', articleUrl: undefined },
            { ...mention, thesis: 'Bad date', publishedAt: 'not a date' },
          ],
        },
      ],
    });
    expect(result?.summary.calls).toBe(1);
    expect(result?.summary.bullish).toBe(1);
    expect(result?.summary.byAction).toEqual({ UNSTATED: 1 });
    expect(result?.opinions).toHaveLength(1);
  });

  it('labels X posts, Substack, and podcasts from the payload', () => {
    const result = compactTickerCoverage({
      meta: { ticker: 'TSLA', truncated: false },
      authors: [
        {
          author: 'BowTied Bull',
          platform: 'TWITTER',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              thesis: 'Still adding on weakness.',
              articleUrl: 'https://x.com/BowTiedBull/status/10',
              publishedAt: '2026-11-01T12:00:00.000Z',
            },
          ],
        },
        {
          author: 'TheLongInvest',
          mentions: [
            {
              sentiment: 'BEARISH',
              action: 'OPINION',
              thesis: 'Too extended for me.',
              articleUrl: 'https://x.com/TheLongInvest/status/11',
              publishedAt: '2026-11-01T13:00:00.000Z',
            },
          ],
        },
        {
          author: 'Letter Writer',
          mentions: [
            {
              platform: 'SUBSTACK',
              sentiment: 'BULLISH',
              thesis: 'The letter stays long.',
              articleUrl: 'https://example.substack.com/p/tsla',
              publishedAt: '2026-11-01T14:00:00.000Z',
            },
          ],
        },
        {
          author: 'Podcast Host',
          mentions: [
            {
              sentiment: 'NEUTRAL',
              thesis: 'Waiting for the next print.',
              articleUrl: 'https://example.com/episode',
              publishedAt: '2026-11-01T15:00:00.000Z',
              speakerIsGuest: true,
            },
          ],
        },
      ],
    });

    expect(
      result?.opinions.map((item) => [item.linkLabel, item.sourceKind]),
    ).toEqual([
      ['Podcast Host', 'podcast'],
      ['Letter Writer', 'substack'],
      ['@TheLongInvest', 'x_post'],
      ['BowTied Bull', 'x_post'],
    ]);
    expect(result?.summary.bySource).toEqual({
      'X post': 2,
      Substack: 1,
      Podcast: 1,
    });
  });

  it('drops near-duplicate posts and keeps action and stance counts on that set', () => {
    const result = compactTickerCoverage({
      meta: { ticker: 'TSLA', truncated: true },
      summary: {
        calls: 4,
        analysts: 2,
        bullish: 3,
        bearish: 1,
        neutral: 0,
        byAction: { OPINION: 3, EXIT: 1 },
      },
      authors: [
        {
          author: 'cantonmeow',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'OPINION',
              thesis: 'TSLA robotaxi timeline still looks intact to me',
              articleUrl: 'https://x.com/cantonmeow/status/2117284934335553894',
              publishedAt: '2026-11-01T16:00:36.000Z',
            },
            {
              sentiment: 'BULLISH',
              action: 'OPINION',
              thesis: 'TSLA robotaxi timeline still looks intact to me!',
              articleUrl: 'https://x.com/cantonmeow/status/2117284781243388167',
              publishedAt: '2026-11-01T16:00:00.000Z',
            },
            {
              sentiment: 'BULLISH',
              action: 'ADD',
              thesis: 'Adding a little after the delivery miss.',
              articleUrl: 'https://x.com/cantonmeow/status/99',
              publishedAt: '2026-10-20T12:00:00.000Z',
            },
          ],
        },
        {
          author: 'Other Writer',
          mentions: [
            {
              sentiment: 'BEARISH',
              action: 'EXIT',
              thesis: 'Closed the long.',
              articleUrl: 'https://x.com/other/status/5',
              publishedAt: '2026-11-01T10:00:00.000Z',
            },
          ],
        },
      ],
    });

    expect(result?.opinions).toHaveLength(3);
    expect(result?.summary).toMatchObject({
      calls: 3,
      analysts: 2,
      bullish: 2,
      bearish: 1,
      neutral: 0,
      byAction: { OPINION: 1, ADD: 1, EXIT: 1 },
    });
    const summary = result?.summary;
    expect(
      (summary?.bullish ?? 0) +
        (summary?.bearish ?? 0) +
        (summary?.neutral ?? 0),
    ).toBe(summary?.calls);
    expect(
      Object.values(result!.summary.byAction).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(result?.summary.calls);
    expect(result?.truncated).toBe(true);
    const presented = presentOpinions(result!, 'TSLA', undefined, 1);
    expect(presented.opinions).toHaveLength(1);
    expect(presented.summary.calls).toBe(3);
    expect(presented.windowComplete).toBe(false);
    expect(presented.truncated).toBe(true);
    expect(presented.highlights?.length).toBeGreaterThan(1);
  });

  it('labels zastocks.com as a newsletter and other sites as articles', () => {
    const result = compactTickerCoverage({
      meta: { ticker: 'SPCX', truncated: false },
      authors: [
        {
          author: 'Za',
          mentions: [
            {
              sentiment: 'BULLISH',
              action: 'OPINION',
              thesis: 'SPCX still has room if the rollout lands.',
              articleUrl: 'https://zastocks.com/spcx-note',
              publishedAt: '2026-10-28T12:00:00.000Z',
            },
          ],
        },
        {
          author: 'Blog Writer',
          mentions: [
            {
              sentiment: 'BEARISH',
              thesis: 'The valuation assumes a flawless launch.',
              articleUrl: 'https://example.com/spcx',
              publishedAt: '2026-10-27T12:00:00.000Z',
            },
          ],
        },
      ],
    });

    expect(result?.opinions.map((item) => item.sourceLabel)).toEqual([
      'Newsletter',
      'Article',
    ]);
  });

  it('filters the full window by stance, author, and action before the page slice', () => {
    const opinions = [
      citation('Ada', 'BULLISH', 'ADD', 'Still adding.'),
      citation('Bea', 'BEARISH', 'OPINION', 'Dilution is the risk.'),
      citation('Cal', 'BEARISH', 'EXIT', 'I am out.'),
      citation('Bea Long', 'BULLISH', 'HOLD', 'Holding the core.'),
    ];
    const cached = {
      ticker: 'SPCX',
      truncated: false,
      summary: {
        calls: 99,
        analysts: 99,
        bullish: 99,
        bearish: 0,
        neutral: 0,
        byAction: { OPINION: 99 },
      },
      opinions,
    };

    const bears = presentOpinions(cached, 'SPCX', undefined, 40, {
      stance: 'BEARISH',
    });
    expect(bears.opinions.map((item) => item.author)).toEqual(['Bea', 'Cal']);
    expect(bears.summary).toMatchObject({
      calls: 2,
      bearish: 2,
      bullish: 0,
    });
    expect(bears.appliedFilter).toEqual({ stance: 'BEARISH' });
    expect(bears.opinions[0]?.quote).toBe('Dilution is the risk.');

    const byAuthor = presentOpinions(cached, 'SPCX', undefined, 40, {
      author: 'bea',
    });
    expect(byAuthor.opinions.map((item) => item.author)).toEqual([
      'Bea',
      'Bea Long',
    ]);

    const exits = presentOpinions(cached, 'SPCX', undefined, 1, {
      action: 'exit',
    });
    expect(exits.summary.calls).toBe(1);
    expect(exits.opinions).toHaveLength(1);
    expect(exits.opinions[0]?.action).toBe('EXIT');
  });
});

function citation(
  author: string,
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  action: string,
  quote: string,
) {
  return {
    author,
    stance,
    action,
    quote,
    date: '2026-10-30T00:00:00.000Z',
    url: `https://example.com/${author}`,
    sourceLabel: 'Article',
  };
}
