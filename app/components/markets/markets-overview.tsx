"use client";

import { ArrowDown01Icon, ArrowUp01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton, cn, formatCompactCurrency, formatCurrency, formatPercent } from "@/components/ui";
import { getStockChart } from "@/services";
import { useMarketStore } from "@/store";
import type { MarketCandle, StockSummary } from "@/types";
import { useI18n, useT } from "@/i18n/i18n";

const sparklineCache = new Map<string, MarketCandle[]>();

function SortIcon() {
  return (
    <span className="inline-flex flex-col text-muted">
      <HugeiconsIcon color="currentColor" icon={ArrowUp01Icon} size={10} strokeWidth={2} />
      <HugeiconsIcon className="-mt-1.5" color="currentColor" icon={ArrowDown01Icon} size={10} strokeWidth={2} />
    </span>
  );
}

function StockLogo({ stock }: { stock: StockSummary }) {
  const t = useT();
  const [failed, setFailed] = useState(false);

  if (stock.logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={t("markets.logoAlt", { name: stock.name })}
        className="h-7 w-7 rounded-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
        src={normalizeLogoUrl(stock.logoUrl)}
      />
    );
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-panel-subtle font-mono text-[10px] font-semibold">
      {stock.ticker.slice(0, 2)}
    </div>
  );
}

function buildSparklinePoints(candles: MarketCandle[]) {
  const closes = candles
    .map((candle) => candle.close)
    .filter((value) => Number.isFinite(value));

  if (closes.length < 2) return undefined;

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const spread = Math.max(max - min, 0.000001);

  return closes
    .map((value, index) => {
      const x = 2 + (index / (closes.length - 1)) * 124;
      const y = 4 + ((max - value) / spread) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({ stock }: { stock: StockSummary }) {
  const t = useT();
  const cacheKey = `${stock.assetId}:1D`;
  const [candles, setCandles] = useState<MarketCandle[] | undefined>(() => sparklineCache.get(cacheKey));

  useEffect(() => {
    let cancelled = false;
    const cached = sparklineCache.get(cacheKey);

    if (cached) {
      return;
    }

    void getStockChart(stock.assetId, "1D")
      .then((chart) => {
        if (cancelled) return;
        sparklineCache.set(cacheKey, chart);
        setCandles(chart);
      })
      .catch(() => {
        if (cancelled) return;
        sparklineCache.set(cacheKey, []);
        setCandles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, stock.assetId]);

  if (!candles) {
    return <Skeleton className="h-8 w-32 rounded-full" />;
  }

  const points = buildSparklinePoints(candles);
  if (!points) {
    return <span className="text-xs text-muted">{t("markets.noData24h")}</span>;
  }

  const first = candles.find((candle) => Number.isFinite(candle.close))?.close ?? 0;
  const last = [...candles].reverse().find((candle) => Number.isFinite(candle.close))?.close ?? first;
  const positive = last >= first;
  const lastPoint = points.split(" ").at(-1);
  const [lastX = "126", lastY = "16"] = lastPoint?.split(",") ?? [];

  return (
    <svg
      aria-label={t("markets.sparklineLabel", { ticker: stock.ticker })}
      className={cn("h-8 w-32", positive ? "text-positive" : "text-negative")}
      preserveAspectRatio="none"
      viewBox="0 0 128 32"
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} fill="currentColor" r="3" />
    </svg>
  );
}

function normalizeLogoUrl(url: string) {
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice("ipfs://".length)}`;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return url;
}

function StockRow({ stock }: { stock: StockSummary }) {
  const { locale } = useI18n();
  const positive = (stock.change24hPct ?? 0) >= 0;

  return (
    <Link
      className="grid min-w-[700px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px] items-center border-t border-border px-4 py-3 text-sm transition-colors hover:bg-panel-subtle"
      href={`/app/stocks/${stock.assetId}`}
      prefetch={false}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StockLogo stock={stock} />
        <div className="min-w-0">
          <span className="font-medium">{stock.name}</span>
          <span className="ml-2 font-mono text-muted">${stock.ticker}</span>
        </div>
      </div>
      <div className="font-mono">{formatCurrency(stock.priceUsd, locale)}</div>
      <div className={cn("font-mono", positive ? "text-positive" : "text-negative")}>
        {positive ? "▲" : "▼"} {formatPercent(Math.abs(stock.change24hPct ?? 0), locale, false)}
      </div>
      <Sparkline stock={stock} />
      <div className="font-mono">{formatCompactCurrency(stock.liquidityUsd, locale)}</div>
    </Link>
  );
}

function TableSkeleton({ count = 10 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          className="grid min-w-[700px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px] items-center gap-4 border-t border-border px-4 py-3"
          key={index}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </>
  );
}

export function MarketsOverview() {
  const stocks = useMarketStore((state) => state.stocks);
  const trending = useMarketStore((state) => state.trending);
  const opportunities = useMarketStore((state) => state.opportunities);
  const searchResults = useMarketStore((state) => state.searchResults);
  const isLoading = useMarketStore((state) => state.isLoading);
  const isLoadingMore = useMarketStore((state) => state.isLoadingMore);
  const loadMoreError = useMarketStore((state) => state.loadMoreError);
  const isSearching = useMarketStore((state) => state.isSearching);
  const hasMore = useMarketStore((state) => state.hasMore);
  const error = useMarketStore((state) => state.error);
  const loadMarkets = useMarketStore((state) => state.loadMarkets);
  const loadNextStocks = useMarketStore((state) => state.loadNextStocks);
  const search = useMarketStore((state) => state.search);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const { locale, t } = useI18n();

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      void search("");
      return;
    }

    const timeout = window.setTimeout(() => void search(normalized), 300);
    return () => window.clearTimeout(timeout);
  }, [query, search]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || isLoading || isLoadingMore || loadMoreError || query.trim()) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void loadNextStocks();
        }
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, loadMoreError, loadNextStocks, query, stocks.length]);

  const searching = Boolean(query.trim());
  const rows = useMemo(
    () => (searching ? searchResults : stocks),
    [searchResults, searching, stocks],
  );
  const featured = [
    {
      key: "trending",
      title: t("markets.trending"),
      detail: t("markets.trendingDetail"),
      stock: trending[0] ?? stocks[0],
      className: "bg-accent-yellow",
    },
    {
      key: "opportunity",
      title: t("markets.opportunity"),
      detail: t("markets.opportunityDetail"),
      stock: opportunities[0] ?? stocks[1],
      className: "bg-accent-pink",
    },
    {
      key: "coverage",
      title: t("markets.coverage"),
      detail: t("markets.coverageDetail", { count: stocks.length }),
      stock: stocks[2],
      className: "bg-accent-lavender",
    },
  ];

  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{t("markets.explore")}</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">{t("markets.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("markets.subtitle")}</p>
        </div>
        <label className="flex h-11 w-full items-center gap-2 rounded-[14px] border border-border bg-panel px-4 shadow-sm focus-within:border-border-strong sm:w-[360px]">
          <HugeiconsIcon className="text-muted" color="currentColor" icon={Search01Icon} size={17} strokeWidth={1.8} />
          <span className="sr-only">{t("markets.searchLabel")}</span>
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-2"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("markets.searchPlaceholder")}
            type="search"
            value={query}
          />
          {isSearching ? <span className="text-xs text-muted">{t("markets.searching")}</span> : null}
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {featured.map((item) => (
          <section className={cn("rounded-[24px] p-4 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", item.className)} key={item.key}>
            <p className="text-base font-semibold">{item.title}</p>
            <p className="mt-1 text-xs text-foreground/65">{item.detail}</p>
            {item.stock ? (
              <Link className="mt-6 flex items-end justify-between gap-4" href={`/app/stocks/${item.stock.assetId}`} prefetch={false}>
                <div>
                  <p className="font-display text-3xl font-semibold">{item.stock.ticker}</p>
                  <p className="mt-1 line-clamp-1 text-sm text-foreground/70">{item.stock.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">{formatCurrency(item.stock.priceUsd, locale)}</p>
                  <ChangePill positive={(item.stock.change24hPct ?? 0) >= 0} value={item.stock.change24hPct} />
                </div>
              </Link>
            ) : (
              <div className="mt-6 text-sm text-foreground/60">{t("markets.loadingData")}</div>
            )}
          </section>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[24px] border border-border bg-panel shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
        <div className="grid min-w-[700px] grid-cols-[minmax(240px,1.5fr)_140px_120px_220px_150px] bg-panel-subtle/70 px-4 py-3 text-xs font-semibold text-foreground">
          <div className="flex items-center gap-1">{t("markets.colName")} <SortIcon /></div>
          <div className="flex items-center gap-1">{t("markets.colPrice")} <SortIcon /></div>
          <div className="flex items-center gap-1">{t("markets.col1d")} <SortIcon /></div>
          <div>{t("markets.colLast24h")}</div>
          <div className="flex items-center gap-1">{t("markets.colLiquidity")} <SortIcon /></div>
        </div>
        {(isLoading || isSearching) && rows.length === 0 ? <TableSkeleton /> : null}
        {rows.length && !(isSearching && searchResults.length === 0)
          ? rows.map((stock) => <StockRow key={stock.assetId} stock={stock} />)
          : null}
        {rows.length && !searching ? (
          <div aria-live="polite" ref={loadMoreRef}>
            {hasMore ? (
              <>
                {isLoadingMore ? <TableSkeleton count={4} /> : (
                  <div className="border-t border-border px-4 py-5 text-center">
                    {loadMoreError && <p className="mb-3 text-sm text-muted" role="alert">{t("markets.loadMoreError")}</p>}
                    <Button disabled={isLoading} onClick={() => void loadNextStocks()} size="sm" variant="secondary">{loadMoreError ? t("markets.retryLoad") : t("markets.loadMore")}</Button>
                  </div>
                )}
              </>
            ) : (
              <div className="border-t border-border px-4 py-4 text-center text-xs text-muted">
                {t("markets.allLoaded", { count: rows.length })}
              </div>
            )}
          </div>
        ) : null}
        {!isLoading && !isSearching && rows.length === 0 ? (
          <div className="border-t border-border px-4 py-12 text-center text-sm text-muted">
            {error
              ? t("markets.unavailable")
              : searching
                ? t("markets.noResults", { query: query.trim() })
                : t("markets.empty")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChangePill({ positive, value }: { positive: boolean; value?: number }) {
  const { locale } = useI18n();
  return (
    <span className={cn("mt-2 inline-flex rounded-full bg-panel px-2 py-1 text-xs font-semibold", positive ? "text-foreground" : "text-negative")}>
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(value ?? 0), locale, false)}
    </span>
  );
}
