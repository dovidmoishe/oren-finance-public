import type {
  ResearchChange,
  ResearchSnapshot,
  StockResearch,
} from '../../types/research';

function opinionKey(author: string, url: string): string {
  return `${author.toLowerCase()}|${url}`;
}

export function snapshotOf(report: StockResearch): ResearchSnapshot {
  const opinions = report.opinions.data?.items ?? [];
  return {
    score: report.analysis.data?.opportunityScore,
    analysisObservedAt: report.analysis.observedAt,
    opinionKeys: opinions.map((item) => opinionKey(item.author, item.url)),
    opinionStances: Object.fromEntries(
      opinions.map((item) => [
        opinionKey(item.author, item.url),
        `${item.stance ?? 'UNSTATED'}:${item.action ?? 'UNSTATED'}`,
      ]),
    ),
    opinionCitations: opinions,
    newsUrls: (report.news.data ?? []).flatMap((item) =>
      safeLink(item.url) ? [item.url] : [],
    ),
    newsCitations: (report.news.data ?? []).flatMap((item) =>
      safeLink(item.url)
        ? [
            {
              headline: item.headline,
              url: item.url,
              publishedAt: item.publishedAt.toISOString(),
            },
          ]
        : [],
    ),
    capturedAt: report.generatedAt,
  };
}

export function changesSince(
  snapshot: ResearchSnapshot,
  report: StockResearch,
): ResearchChange[] {
  const changes: ResearchChange[] = [];
  if (
    report.analysis.available &&
    snapshot.score !== undefined &&
    report.analysis.data?.opportunityScore !== undefined
  ) {
    const change = Math.round(
      report.analysis.data.opportunityScore - snapshot.score,
    );
    if (Math.abs(change) >= 5)
      changes.push({
        kind: 'score',
        text: `Oren Score ${change > 0 ? 'rose' : 'fell'} ${Math.abs(change)} points since you saved this view.`,
      });
  }
  if (report.opinions.available) {
    const old = new Set(snapshot.opinionKeys);
    for (const item of report.opinions.data?.items ?? []) {
      const key = opinionKey(item.author, item.url);
      if (!old.has(key))
        changes.push({
          kind: 'opinion_added',
          text: `${item.author}'s ${item.stance?.toLowerCase() ?? 'unstated'} view newly appears in the covered sample.`,
          url: item.url,
        });
      else if (
        snapshot.opinionStances[key] !==
        `${item.stance ?? 'UNSTATED'}:${item.action ?? 'UNSTATED'}`
      )
        changes.push({
          kind: 'opinion_changed',
          text: `${item.author}'s stance or action changed.`,
          url: item.url,
        });
    }
  }
  if (report.news.available) {
    const old = new Set(snapshot.newsUrls);
    for (const item of report.news.data ?? []) {
      if (safeLink(item.url) && !old.has(item.url))
        changes.push({
          kind: 'news_added',
          text: item.headline,
          url: item.url,
        });
    }
  }
  return changes.slice(0, 10);
}

function safeLink(value?: string): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}
