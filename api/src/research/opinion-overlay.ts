import type { DripOpinionResult } from '../drip/drip.types';
import type { OpinionOverlay, ResearchOpinion } from '../../types/research';

const STALE_DAYS = 30;

export function opinionOverlay(
  result: DripOpinionResult,
  now = new Date(),
): OpinionOverlay | undefined {
  if (!result.available) return undefined;
  const seen = new Set<string>();
  const items: ResearchOpinion[] = [];
  for (const citation of result.opinions) {
    if (!citation.author || !citation.url || !citation.date) continue;
    if (
      !/^https?:\/\//i.test(citation.url) ||
      !Number.isFinite(Date.parse(citation.date))
    )
      continue;
    const summary = citation.summary ?? citation.quote;
    if (!summary) continue;
    const key = `${citation.author.toLowerCase()}|${summary.toLowerCase().replace(/\W+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      author: citation.author,
      source: citation.source ?? citation.sourceLabel ?? citation.author,
      sourceLabel: citation.sourceLabel,
      linkLabel: citation.linkLabel,
      date: citation.date,
      url: citation.url,
      stance: citation.stance,
      action: citation.action,
      summary,
    });
  }
  const byAuthor = new Map<string, ResearchOpinion>();
  for (const item of items) {
    const key = item.author.toLowerCase();
    if (!byAuthor.has(key)) byAuthor.set(key, item);
  }
  const stances = { bullish: 0, bearish: 0, neutral: 0 };
  for (const item of byAuthor.values()) {
    // An EXIT is a closed position, not necessarily a fresh bearish call.
    if (item.action?.toUpperCase() === 'EXIT') continue;
    if (item.stance === 'BULLISH') stances.bullish++;
    if (item.stance === 'BEARISH') stances.bearish++;
    if (item.stance === 'NEUTRAL') stances.neutral++;
  }
  const newest = items.length
    ? Math.max(...items.map((item) => Date.parse(item.date)))
    : 0;
  const coverage =
    items.length === 0
      ? 'empty'
      : newest < now.getTime() - STALE_DAYS * 86_400_000
        ? 'stale'
        : byAuthor.size < 3
          ? 'thin'
          : 'current';
  return {
    items,
    asOf: result.asOf,
    window: result.window,
    mentionCount: result.summary.calls,
    distinctAuthors: byAuthor.size,
    stanceByAuthor: stances,
    coverage,
    disagreement: stances.bullish > 0 && stances.bearish > 0,
    truncated: result.truncated,
  };
}
