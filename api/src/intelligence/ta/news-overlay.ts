import type {
  NewsAlignment,
  NewsOverlayItem,
  TrendRegime,
} from '../../../types/analysis';
import type { MarketNewsItem } from '../../../types/news';

const BULLISH = [
  'surge',
  'rally',
  'beat',
  'upgrade',
  'record',
  'jump',
  'gain',
  'soar',
  'strong',
  'growth',
];
const BEARISH = [
  'fall',
  'drop',
  'miss',
  'downgrade',
  'probe',
  'slump',
  'cut',
  'weak',
  'decline',
  'lawsuit',
];

function sentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const normalized = text.toLowerCase();
  const bullishHits = BULLISH.filter((word) => normalized.includes(word)).length;
  const bearishHits = BEARISH.filter((word) => normalized.includes(word)).length;
  if (bullishHits > bearishHits) return 'bullish';
  if (bearishHits > bullishHits) return 'bearish';
  return 'neutral';
}

function alignmentForRegime(
  regime: TrendRegime,
  headlineSentiment: 'bullish' | 'bearish' | 'neutral',
): NewsAlignment {
  if (headlineSentiment === 'neutral' || regime === 'range') return 'neutral';
  if (regime === 'uptrend') {
    return headlineSentiment === 'bullish' ? 'with_regime' : 'against_regime';
  }
  return headlineSentiment === 'bearish' ? 'with_regime' : 'against_regime';
}

export function buildNewsOverlay(
  items: MarketNewsItem[],
  regime: TrendRegime,
  limit = 3,
): NewsOverlayItem[] {
  return items.slice(0, limit).map((item) => {
    const text = `${item.headline} ${item.summary ?? ''}`;
    const headlineSentiment = sentiment(text);
    return {
      headline: item.headline,
      alignment: alignmentForRegime(regime, headlineSentiment),
      publishedAt: item.publishedAt,
      url: item.url,
    };
  });
}
