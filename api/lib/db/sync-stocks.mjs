import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: '.env' });

const databaseUrl = requiredEnv('POSTGRES_URL');
const apiKey = requiredEnv('TOKENS_API_KEY');
const apiBaseUrl = (
  process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz'
).replace(/\/$/, '');
const migrationsFolder = fileURLToPath(
  new URL('./migrations', import.meta.url),
);
const connection = postgres(databaseUrl, { max: 2 });
const db = drizzle(connection);

try {
  console.log('Applying database migrations...');
  await migrate(db, { migrationsFolder });

  console.log('Fetching the stock catalog from Tokens...');
  const stocks = await fetchAllStocks();
  if (stocks.length === 0) {
    throw new Error(
      'Tokens returned an empty stock catalog; existing cache was preserved',
    );
  }

  const cachedAt = new Date();
  const expiresAt = new Date(cachedAt.getTime() + 60_000);
  const cachedAtIso = cachedAt.toISOString();
  const expiresAtIso = expiresAt.toISOString();
  const rows = stocks.map((stock, sortRank) => ({
    asset_id: stock.assetId,
    ticker: stock.ticker,
    name: stock.name,
    category: stock.category,
    logo: stock.logo,
    price: stock.price,
    price_change_24h: stock.priceChange24h,
    volume_24h: stock.volume24h,
    liquidity: stock.liquidity,
    sort_rank: sortRank,
    cached_at: cachedAtIso,
    expires_at: expiresAtIso,
  }));

  await connection.begin(async (sql) => {
    await sql`delete from cached_stocks`;
    await sql`
      insert into cached_stocks ${sql(
        rows,
        'asset_id',
        'ticker',
        'name',
        'category',
        'logo',
        'price',
        'price_change_24h',
        'volume_24h',
        'liquidity',
        'sort_rank',
        'cached_at',
        'expires_at',
      )}
    `;
  });

  console.log(`Cached ${rows.length} stocks in Postgres.`);
} catch (error) {
  console.error(
    'Stock catalog sync failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await connection.end({ timeout: 5 });
}

async function fetchAllStocks() {
  const stocksById = new Map();
  const limit = 250;
  let offset = 0;

  while (true) {
    const url = new URL('/v1/assets/curated', apiBaseUrl);
    url.searchParams.set('list', 'stocks');
    url.searchParams.set('groupBy', 'asset');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Tokens request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const assets = Array.isArray(payload?.assets)
      ? payload.assets
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

    for (const raw of assets) {
      const stock = normalizeStock(raw);
      if (stock) stocksById.set(stock.assetId, stock);
    }

    const pagination = payload?.pagination;
    if (!pagination?.hasMore || pagination.nextOffset == null) break;
    offset = Number(pagination.nextOffset);
  }

  return [...stocksById.values()];
}

function normalizeStock(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const assetId = stringValue(raw.assetId ?? raw.id);
  if (!assetId) return null;
  const market = raw.primaryVariant?.market;
  const stats = raw.stats;

  return {
    assetId,
    ticker: stringValue(raw.ticker ?? raw.symbol ?? assetId).toUpperCase(),
    name: stringValue(raw.name ?? raw.ticker ?? raw.symbol ?? assetId),
    category: ['equity', 'etf', 'index'].includes(raw.category)
      ? raw.category
      : 'equity',
    logo: stringOrNull(
      raw.imageUrl ?? raw.logo ?? raw.logoUrl ?? market?.logoURI,
    ),
    price: numberOrNull(raw.price ?? stats?.price ?? market?.price),
    priceChange24h: numberOrNull(
      raw.priceChange24hPercent ??
        raw.priceChange24h ??
        stats?.priceChange24hPercent ??
        market?.priceChange24hPercent,
    ),
    volume24h: numberOrNull(
      raw.volume24hUSD ??
        raw.volume24h ??
        stats?.volume24hUSD ??
        market?.volume24hUSD,
    ),
    liquidity: numberOrNull(
      raw.liquidity ??
        stats?.liquidity ??
        market?.liquidity ??
        market?.liquidityUSD,
    ),
  };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrNull(value) {
  const normalized = stringValue(value);
  return normalized || null;
}

function numberOrNull(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}
