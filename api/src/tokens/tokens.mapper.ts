import type {
  Equity,
  EquityCategory,
  TokenizedEquity,
} from '../../types/equity';
import type { MarketCandle, OhlcvBar } from '../../types/market';
import type { EquityRisk, MarketNewsItem } from '../../types/news';
import type {
  TokensAssetRaw,
  TokensCandleRaw,
  TokensNewsItemRaw,
  TokensRiskRaw,
  TokensVariantRaw,
} from './tokens.types';

function asCategory(value?: string): EquityCategory {
  const v = (value ?? 'equity').toLowerCase();
  if (v === 'etf' || v === 'index' || v === 'equity') return v;
  if (v === 'stock' || v === 'stocks' || v === 'rwa') return 'equity';
  return 'equity';
}

function pickAsset(raw: TokensAssetRaw): TokensAssetRaw {
  return raw.asset ?? raw;
}

const EQUITY_CLASSIFICATIONS = new Set([
  'equity',
  'equities',
  'etf',
  'index',
  'rwa',
  'stock',
  'stocks',
  'tokenized_equity',
  'tokenized-equity',
]);

/**
 * The provider's curated stocks endpoint has occasionally included unrelated
 * crypto assets. Only admit assets carrying explicit equity metadata; never
 * infer that an unknown category is a stock merely because it was returned by
 * that list.
 */
export function isEquityAsset(rawInput: TokensAssetRaw): boolean {
  const raw = pickAsset(rawInput);
  const classifications = [
    raw.category,
    raw.assetClass,
    raw.assetType,
    raw.classification,
    raw.type,
  ];

  if (
    classifications.some((value) =>
      value ? EQUITY_CLASSIFICATIONS.has(value.trim().toLowerCase()) : false,
    )
  ) {
    return true;
  }

  return [raw.primaryVariant, ...(raw.variants ?? [])].some(
    (variant) =>
      variant?.kind?.toLowerCase() === 'tokenized_equity' ||
      Boolean(variant?.stockVariantTier),
  );
}

export function mapVariant(raw: TokensVariantRaw): TokenizedEquity | null {
  if (!raw.mint) return null;
  return {
    mint: raw.mint,
    symbol: raw.symbol ?? raw.label ?? raw.mint.slice(0, 6),
    name: raw.name ?? raw.symbol ?? raw.mint,
    issuer: raw.label,
    decimals: raw.decimals,
    liquidity: raw.liquidity ?? raw.market?.liquidityUSD,
    liquidityTier: raw.liquidityTier,
    trustTier: raw.trustTier,
    stockVariantTier: raw.stockVariantTier,
    tradable: raw.tradable ?? true,
  };
}

export function mapVariants(raws?: TokensVariantRaw[]): TokenizedEquity[] {
  if (!raws?.length) return [];
  return raws.map(mapVariant).filter((v): v is TokenizedEquity => v !== null);
}

export function mapEquity(rawInput: TokensAssetRaw): Equity {
  const raw = pickAsset(rawInput);
  const id = raw.assetId ?? raw.id ?? '';
  const variants = mapVariants(raw.variants);
  const primary = raw.primaryVariant
    ? mapVariant(raw.primaryVariant)
    : undefined;
  if (primary && !variants.some((v) => v.mint === primary.mint)) {
    variants.unshift(primary);
  }

  const price =
    raw.price ?? raw.stats?.price ?? raw.primaryVariant?.market?.price;

  return {
    id,
    ticker: (raw.ticker ?? raw.symbol ?? id).toUpperCase(),
    name: raw.name ?? raw.ticker ?? id,
    category: asCategory(raw.category),
    logo:
      raw.imageUrl ??
      raw.logo ??
      raw.logoUrl ??
      raw.primaryVariant?.market?.logoURI ??
      undefined,
    price: typeof price === 'number' ? price : undefined,
    priceChange24h:
      raw.priceChange24hPercent ??
      raw.priceChange24h ??
      raw.stats?.priceChange24hPercent ??
      raw.primaryVariant?.market?.priceChange24hPercent,
    volume24h:
      raw.volume24hUSD ??
      raw.volume24h ??
      raw.stats?.volume24hUSD ??
      raw.primaryVariant?.market?.volume24hUSD,
    liquidity:
      raw.liquidity ??
      raw.stats?.liquidity ??
      raw.primaryVariant?.market?.liquidity ??
      raw.primaryVariant?.market?.liquidityUSD,
    sector: raw.sector,
    variants,
  };
}

export function mapEquityList(items?: TokensAssetRaw[] | null): Equity[] {
  if (!items?.length) return [];
  return items
    .filter(isEquityAsset)
    .map((item) => {
      try {
        return mapEquity(item);
      } catch {
        return null;
      }
    })
    .filter((e): e is Equity => e !== null && Boolean(e.id));
}

export function mapCandle(rawInput: unknown): MarketCandle | null {
  const raw = Array.isArray(rawInput)
    ? tupleToCandle(rawInput)
    : rawInput && typeof rawInput === 'object'
      ? (rawInput as TokensCandleRaw)
      : null;
  if (!raw) return null;

  const ts = raw.timestamp ?? raw.t ?? raw.time ?? raw.date;
  if (ts === undefined) return null;
  const open = toFiniteNumber(raw.open ?? raw.o);
  const high = toFiniteNumber(raw.high ?? raw.h);
  const low = toFiniteNumber(raw.low ?? raw.l);
  const close = toFiniteNumber(raw.close ?? raw.c);
  if (
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  ) {
    return null;
  }
  const ms = timestampToMs(ts);
  if (ms === undefined) return null;
  return {
    timestamp: new Date(ms),
    open,
    high,
    low,
    close,
    volume: toFiniteNumber(
      raw.volume ?? raw.v ?? raw.volume_base ?? raw.volume_quote_usd,
    ),
  };
}

export function mapCandles(raws?: unknown[]): MarketCandle[] {
  if (!raws?.length) return [];
  return raws.map(mapCandle).filter((c): c is MarketCandle => c !== null);
}

export function mapOhlcv(
  assetId: string,
  raws?: TokensCandleRaw[],
): OhlcvBar[] {
  return mapCandles(raws).map((c) => ({ ...c, assetId }));
}

export function mapRisk(
  assetId: string,
  ticker: string,
  raw: TokensRiskRaw,
): EquityRisk {
  return {
    assetId: raw.assetId ?? assetId,
    ticker,
    score: raw.score,
    label: raw.label ?? raw.grade,
    volatility: raw.volatility,
    metadata: raw,
  };
}

export function mapNewsItem(raw: TokensNewsItemRaw): MarketNewsItem | null {
  const headline = raw.headline ?? raw.title;
  if (!headline) return null;
  const published = raw.publishedAt ?? raw.published_at;
  let publishedAt = new Date();
  if (typeof published === 'number') {
    publishedAt = new Date(
      published > 1_000_000_000_000 ? published : published * 1000,
    );
  } else if (typeof published === 'string') {
    publishedAt = new Date(published);
  }
  return {
    id: raw.id,
    assetId: raw.assetId,
    ticker: raw.ticker,
    headline,
    source: raw.source,
    summary: raw.summary ?? raw.description,
    url: raw.url,
    publishedAt,
    imageUrl: raw.imageUrl ?? raw.image,
  };
}

export function mapNewsFeed(
  items?: TokensNewsItemRaw[] | null,
): MarketNewsItem[] {
  if (!items?.length) return [];
  return items.map(mapNewsItem).filter((n): n is MarketNewsItem => n !== null);
}

export function extractAssetList(payload: unknown): TokensAssetRaw[] {
  if (Array.isArray(payload)) return toObjectArray<TokensAssetRaw>(payload);
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.results)) return toObjectArray<TokensAssetRaw>(p.results);
  if (Array.isArray(p.assets)) return toObjectArray<TokensAssetRaw>(p.assets);
  if (Array.isArray(p.items)) return toObjectArray<TokensAssetRaw>(p.items);
  if (p.asset && typeof p.asset === 'object')
    return toObjectArray<TokensAssetRaw>([p.asset]);
  if (p.assetId || p.id) return toObjectArray<TokensAssetRaw>([p]);
  return [];
}

export function extractCandles(payload: unknown): TokensCandleRaw[] {
  if (Array.isArray(payload)) return payload as TokensCandleRaw[];
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.candles)) return p.candles as TokensCandleRaw[];
  if (Array.isArray(p.data)) return p.data as TokensCandleRaw[];
  if (Array.isArray(p.bars)) return p.bars as TokensCandleRaw[];
  if (Array.isArray(p.ohlcv)) return p.ohlcv as TokensCandleRaw[];
  if (Array.isArray(p.values)) return p.values as TokensCandleRaw[];
  if (Array.isArray(p.series)) return p.series as TokensCandleRaw[];
  if (Array.isArray(p.prices)) return pricePairsToCandles(p.prices);
  if (p.chart && typeof p.chart === 'object') return extractCandles(p.chart);
  return [];
}

function tupleToCandle(tuple: unknown[]): TokensCandleRaw | null {
  if (tuple.length < 5) return null;
  const numeric = tuple.map((value) =>
    typeof value === 'number' ? value : Number(value),
  );
  if (numeric.some((value) => !Number.isFinite(value))) return null;

  const [first, second, third, fourth, fifth, sixth] = numeric;
  const firstLooksLikeTimestamp = first > 1_000_000_000;

  return firstLooksLikeTimestamp
    ? {
        timestamp: first,
        open: second,
        high: third,
        low: fourth,
        close: fifth,
        volume: sixth,
      }
    : {
        open: first,
        high: second,
        low: third,
        close: fourth,
        volume: fifth,
        timestamp: sixth,
      };
}

function pricePairsToCandles(values: unknown[]): TokensCandleRaw[] {
  const candles: Array<TokensCandleRaw | null> = values.map((value) => {
    if (!Array.isArray(value) || value.length < 2) return null;
    const timestamp = Number(value[0]);
    const price = Number(value[1]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) return null;
    return {
      timestamp,
      open: price,
      high: price,
      low: price,
      close: price,
    } satisfies TokensCandleRaw;
  });

  return candles.filter((candle): candle is TokensCandleRaw => candle !== null);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function timestampToMs(value: unknown): number | undefined {
  if (typeof value === 'string' && Number.isNaN(Number(value))) {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }

  const timestamp = toFiniteNumber(value);
  if (timestamp === undefined) return undefined;
  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

export function extractNews(payload: unknown): TokensNewsItemRaw[] {
  if (Array.isArray(payload)) return toObjectArray<TokensNewsItemRaw>(payload);
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.items)) return toObjectArray<TokensNewsItemRaw>(p.items);
  if (Array.isArray(p.results))
    return toObjectArray<TokensNewsItemRaw>(p.results);
  if (Array.isArray(p.feed)) return toObjectArray<TokensNewsItemRaw>(p.feed);
  return [];
}

function toObjectArray<T extends object>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const items: unknown[] = value;
  return items.filter(
    (item): item is T => item !== null && typeof item === 'object',
  );
}
