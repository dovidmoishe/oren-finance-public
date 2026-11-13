/** Drip ticker path: letters, digits, dot, hyphen, at most 10 characters. */
export const DRIP_TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;

export interface DripEquityMatch {
  ticker: string;
  variants?: Array<{ symbol: string }>;
}

export interface ResolvedDripTicker {
  ticker: string;
  mappedFrom?: string;
}

/**
 * xStocks spell the token as the equity ticker plus a lowercase "x"
 * (`NVDAx`, `QQQx`, `BRK.Bx`). A trailing uppercase X can be part of a real
 * ticker (`SPX`), so that form is only accepted when catalog metadata agrees.
 */
export function xStockUnderlying(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (!trimmed.endsWith('x')) return null;
  const underlying = trimmed.slice(0, -1).toUpperCase();
  if (!DRIP_TICKER_PATTERN.test(underlying)) return null;
  return underlying;
}

export async function resolveDripTicker(
  input: string,
  lookup: (query: string) => Promise<DripEquityMatch | null>,
): Promise<ResolvedDripTicker | null> {
  const raw = input.trim();
  if (!raw) return null;

  const direct = await lookup(raw).catch(() => null);
  if (direct) {
    const fromCatalog = tickerFromMatch(raw, direct);
    if (fromCatalog) return fromCatalog;
  }

  const stripped = xStockUnderlying(raw);
  if (stripped) {
    const confirmed = await lookup(stripped).catch(() => null);
    const ticker = normalizeTicker(confirmed?.ticker) ?? stripped;
    return { ticker, mappedFrom: raw };
  }

  const upper = raw.toUpperCase();
  if (upper.endsWith('X') && upper.length > 1) {
    const candidate = upper.slice(0, -1);
    if (DRIP_TICKER_PATTERN.test(candidate)) {
      const confirmed = await lookup(candidate).catch(() => null);
      if (confirmed && hasXStockVariant(confirmed, upper)) {
        const ticker = normalizeTicker(confirmed.ticker);
        if (ticker) return { ticker, mappedFrom: raw };
      }
    }
  }

  if (DRIP_TICKER_PATTERN.test(upper)) return { ticker: upper };
  return null;
}

function tickerFromMatch(
  raw: string,
  match: DripEquityMatch,
): ResolvedDripTicker | null {
  const ticker = normalizeTicker(match.ticker);
  if (!ticker) return null;
  const upper = raw.toUpperCase();
  if (upper === ticker) return { ticker };
  const variant = match.variants?.find(
    (item) => item.symbol.trim().toUpperCase() === upper,
  );
  if (variant) return { ticker, mappedFrom: variant.symbol.trim() };
  return { ticker, mappedFrom: raw };
}

function hasXStockVariant(
  match: DripEquityMatch,
  upperSymbol: string,
): boolean {
  return (match.variants ?? []).some(
    (variant) => variant.symbol.trim().toUpperCase() === upperSymbol,
  );
}

function normalizeTicker(value: string | undefined): string | null {
  const ticker = value?.trim().toUpperCase() ?? '';
  return DRIP_TICKER_PATTERN.test(ticker) ? ticker : null;
}
