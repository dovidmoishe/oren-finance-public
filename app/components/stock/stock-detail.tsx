"use client";

import { ArrowLeft01Icon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketChart, type MarketChartMode, type MarketChartRange } from "@/components/charts";
import { StockMarketOutlook } from "@/components/stock/stock-market-outlook";
import { StockResearchPanel } from "@/components/stock/stock-research";
import { StockTradeTicket } from "@/components/trading";
import {
  Button,
  ErrorState,
  Skeleton,
  cn,
} from "@/components/ui";
import { useStockStore } from "@/store";
import type { ChartRange } from "@/types";
import { useT } from "@/i18n/i18n";

const rangeMap: Record<MarketChartRange, ChartRange> = {
  "24H": "1D",
  "7D": "1W",
  "30D": "1M",
  "90D": "3M",
  "1Y": "1Y",
};

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-12">
      <Skeleton className="h-8 w-48" />
      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-[320px]" />
        <Skeleton className="h-[320px]" />
      </div>
      <Skeleton className="h-72 rounded-[20px]" />
    </div>
  );
}

export function StockDetail({ assetId }: { assetId: string }) {
  const stock = useStockStore((state) => state.selected);
  const chart = useStockStore((state) => state.chart);
  const analysis = useStockStore((state) => state.analysis);
  const news = useStockStore((state) => state.news);
  const isLoading = useStockStore((state) => state.isLoading);
  const isChartLoading = useStockStore((state) => state.isChartLoading);
  const error = useStockStore((state) => state.error);
  const chartError = useStockStore((state) => state.chartError);
  const loadStock = useStockStore((state) => state.loadStock);
  const loadChart = useStockStore((state) => state.loadChart);
  const reset = useStockStore((state) => state.reset);
  const [range, setRange] = useState<MarketChartRange>("30D");
  const [mode, setMode] = useState<MarketChartMode>("line");
  const t = useT();

  useEffect(() => {
    void loadStock(assetId, "1M");
    return reset;
  }, [assetId, loadStock, reset]);

  const lineData = useMemo(
    () => chart.map((point) => ({ timestamp: point.timestamp, value: point.close })),
    [chart],
  );

  if (isLoading && !stock) return <DetailSkeleton />;

  if (!stock) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <ErrorState
          description={error ?? t("stock.loadFailed")}
          onRetry={() => void loadStock(assetId, rangeMap[range])}
          title={t("stock.unavailableTitle")}
        />
      </div>
    );
  }

  const handleRangeChange = (nextRange: MarketChartRange) => {
    setRange(nextRange);
    void loadChart(assetId, rangeMap[nextRange]);
  };

  const handleTradeConfirmed = () => loadStock(assetId, rangeMap[range]);

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted hover:text-foreground" href="/app/markets">
            <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={14} strokeWidth={1.8} />
            {t("stock.back")}
          </Link>
          <span aria-hidden className="text-border-strong">/</span>
          <h1 className="truncate font-display text-base font-semibold">{stock.name} <span className="ml-1 font-mono text-xs font-normal text-muted">${stock.ticker}</span></h1>
        </div>
        <Button aria-label={t("stock.refresh")} className="h-8 w-8" disabled={isLoading} onClick={() => void loadStock(assetId, rangeMap[range])} size="icon" variant="ghost">
          <HugeiconsIcon className={cn(isLoading && "animate-spin")} color="currentColor" icon={RefreshCwIcon} size={15} strokeWidth={1.8} />
        </Button>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <MarketChart
          compact
          activeRange={range}
          candleData={chart}
          changePct={stock.change24hPct}
          className="h-full min-w-0 rounded-[24px]"
          emptyDescription={t("stock.noCandles")}
          error={chartError}
          lineData={lineData}
          loading={isChartLoading}
          mode={mode}
          onModeChange={setMode}
          onRangeChange={handleRangeChange}
          value={stock.priceUsd ?? chart.at(-1)?.close}
        />
        <StockTradeTicket
          key={stock.assetId}
          limitZones={analysis?.technicalBrief?.limitZones}
          onConfirmed={handleTradeConfirmed}
          stock={stock}
        />
      </div>

      <StockMarketOutlook analysis={analysis} news={news} stock={stock} />
      <StockResearchPanel assetId={stock.assetId} />
    </div>
  );
}
