"use client";

import {
  ChartCandlestickIcon,
  ChartLineData01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  CandlestickData,
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, LoadingState, Tabs, cn, formatCurrency, formatDate, formatPercent } from "@/components/ui";
import { useI18n } from "@/i18n/i18n";

// lightweight-charts is only needed once there is data to draw, so it loads on
// demand instead of with every page that shows a chart card.
let chartLibrary: Promise<typeof import("lightweight-charts")> | undefined;
function loadChartLibrary() {
  chartLibrary ??= import("lightweight-charts").catch((cause: unknown) => {
    chartLibrary = undefined;
    throw cause;
  });
  return chartLibrary;
}

export type MarketChartMode = "line" | "candles";
export type MarketChartRange = "24H" | "7D" | "30D" | "90D" | "1Y";

export interface MarketLinePoint {
  timestamp: string;
  value: number;
}

export interface MarketCandlePoint {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MarketChartProps {
  mode: MarketChartMode;
  lineData?: MarketLinePoint[];
  candleData?: MarketCandlePoint[];
  ranges?: MarketChartRange[];
  activeRange: MarketChartRange;
  onRangeChange: (range: MarketChartRange) => void;
  onModeChange: (mode: MarketChartMode) => void;
  value?: number;
  changePct?: number;
  dateLabel?: string;
  loading?: boolean;
  error?: string;
  emptyDescription?: string;
  className?: string;
  compact?: boolean;
}

function toTime(timestamp: string): UTCTimestamp {
  return Math.floor(new Date(timestamp).getTime() / 1000) as UTCTimestamp;
}

/** lightweight-charts requires strictly ascending unique times. */
function normalizeByTime<T extends { time: UTCTimestamp }>(points: T[]): T[] {
  if (points.length === 0) return points;

  const sorted = [...points].sort((a, b) => a.time - b.time);
  const unique: T[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const point = sorted[i];
    if (point.time === unique[unique.length - 1].time) {
      unique[unique.length - 1] = point;
    } else {
      unique.push(point);
    }
  }

  return unique;
}

function buildLineData(points: MarketLinePoint[]): LineData<Time>[] {
  return normalizeByTime(
    points
      .filter((point) => Number.isFinite(point.value) && !Number.isNaN(new Date(point.timestamp).getTime()))
      .map((point) => ({ time: toTime(point.timestamp), value: point.value })),
  );
}

function buildCandleData(points: MarketCandlePoint[]): CandlestickData<Time>[] {
  return normalizeByTime(
    points
      .filter((point) => !Number.isNaN(new Date(point.timestamp).getTime()))
      .map((point) => ({
        time: toTime(point.timestamp),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
      })),
  );
}

export function MarketChart({
  mode,
  lineData = [],
  candleData = [],
  ranges = ["24H", "7D", "30D", "90D", "1Y"],
  activeRange,
  onRangeChange,
  onModeChange,
  value,
  changePct,
  dateLabel,
  loading,
  error,
  emptyDescription,
  className,
  compact = false,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line" | "Candlestick", Time> | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; value: string; date: string } | null>(null);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const canUseCandles = candleData.length > 0;
  const effectiveMode = mode === "candles" && canUseCandles ? "candles" : "line";
  const { locale, timeZone, t } = useI18n();
  const formattedDate = dateLabel ?? formatDate(lineData.at(-1)?.timestamp ?? candleData.at(-1)?.timestamp, locale, timeZone, t("common.notUpdated"));
  const lineSeriesData = useMemo(() => buildLineData(lineData), [lineData]);
  const candleSeriesData = useMemo(() => buildCandleData(candleData), [candleData]);
  const hasData = effectiveMode === "candles" ? candleSeriesData.length > 0 : lineSeriesData.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasData || loading || error) {
      return;
    }

    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadChartLibrary().then(({ CandlestickSeries, ColorType, CrosshairMode, LineSeries, LineStyle, createChart }) => {
      if (disposed) return;
      setLibraryFailed(false);
      const chart = createChart(container, {
        autoSize: true,
        layout: {
          background: { color: "transparent", type: ColorType.Solid },
          textColor: "#b7b7b0",
          fontFamily: "var(--font-oren-sans)",
        },
        grid: {
          horzLines: { color: "#eeeeea", style: LineStyle.Dotted },
          vertLines: { color: "#f5f5f2", style: LineStyle.Dotted },
        },
        rightPriceScale: {
          borderVisible: false,
          entireTextOnly: true,
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 4,
          barSpacing: 8,
        },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: "#d6d6d0", labelVisible: false, style: LineStyle.Solid },
          horzLine: { color: "#c9c9c2", labelVisible: false, style: LineStyle.Dashed },
        },
        handleScale: true,
        handleScroll: true,
      });

      chartRef.current = chart;

      if (effectiveMode === "candles") {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: "#21c978",
          downColor: "#ff4d4d",
          borderUpColor: "#21c978",
          borderDownColor: "#ff4d4d",
          wickUpColor: "#21c978",
          wickDownColor: "#ff4d4d",
        });
        series.setData(candleSeriesData);
        seriesRef.current = series;
      } else {
        const series = chart.addSeries(LineSeries, {
          color: "#65625d",
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: true,
          priceLineColor: "#c9c9c2",
          priceLineStyle: LineStyle.Dashed,
        });
        series.setData(lineSeriesData);
        seriesRef.current = series;
      }

      chart.timeScale().fitContent();

      const handleCrosshairMove = (param: MouseEventParams<Time>) => {
        if (!param.point || !seriesRef.current || !param.time || param.point.x < 0 || param.point.y < 0) {
          setTooltip(null);
          return;
        }

        const datum = param.seriesData.get(seriesRef.current);
        if (!datum) {
          setTooltip(null);
          return;
        }

        const rawValue =
          "value" in datum
            ? datum.value
            : "close" in datum
              ? datum.close
              : undefined;

        if (typeof rawValue !== "number") {
          setTooltip(null);
          return;
        }

        const epochSeconds = typeof param.time === "number" ? param.time : undefined;
        setTooltip({
          x: param.point.x,
          y: param.point.y,
          value: formatCurrency(rawValue, locale),
          date: epochSeconds ? formatDate(new Date(epochSeconds * 1000).toISOString(), locale, timeZone, "") : "",
        });
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);

      dispose = () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.remove();
        chartRef.current = null;
        seriesRef.current = null;
      };
    }).catch(() => {
      if (!disposed) setLibraryFailed(true);
    });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [candleSeriesData, effectiveMode, error, hasData, lineSeriesData, loading, locale, timeZone]);

  return (
    <section className={cn("flex flex-col rounded-[24px] border border-border bg-panel shadow-[0_18px_60px_rgba(23,23,23,0.025)]", compact ? "p-3" : "p-[var(--app-card-padding,1.5rem)]", className)}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <p className={cn("font-display font-semibold tracking-normal", compact ? "text-3xl" : "text-6xl")}>{formatCurrency(value, locale)}</p>
          <div className={cn("mt-1 flex items-center gap-3", compact ? "text-xs" : "text-sm")}>
            <span className={cn((changePct ?? 0) < 0 ? "text-negative" : "text-positive")}>
              {(changePct ?? 0) < 0 ? "▼" : "▲"} {formatPercent(changePct, locale)}
            </span>
            <span className="text-muted">{formattedDate}</span>
          </div>
        </div>
      </div>

      <div className={cn("relative", compact ? "mt-3 h-[180px] min-h-[160px] flex-1 sm:h-[200px] sm:min-h-[180px]" : "mt-[var(--app-chart-gap,2rem)] h-[var(--app-chart-height,430px)] min-h-[var(--app-chart-min-height,340px)]")}>
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingState label={t("common.loadingChart")} />
          </div>
        ) : error || libraryFailed ? (
          <EmptyState title={t("common.chartUnavailable")} description={error || t("common.chartLoadFailed")} />
        ) : !hasData ? (
          <EmptyState
            title={t("common.noChartHistory")}
            description={emptyDescription ?? t("common.chartEmptyDefault")}
          />
        ) : (
          <>
            <div className="h-full w-full" ref={containerRef} />
            {tooltip ? (
              <div
                className="pointer-events-none absolute rounded-[10px] border border-border bg-panel px-2.5 py-1.5 text-xs text-foreground shadow-sm"
                style={{ left: Math.min(tooltip.x + 14, 340), top: Math.max(tooltip.y - 36, 0) }}
              >
                <span className="font-medium">{tooltip.value}</span>
                <span className="ml-2 text-muted">{tooltip.date}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className={cn("flex shrink-0 flex-wrap items-center justify-between gap-3", compact ? "mt-3" : "mt-6")}>
        <Tabs ariaLabel={t("common.chartRange")} items={ranges} onValueChange={onRangeChange} value={activeRange} />
        <div className="flex items-center gap-2 rounded-full bg-panel-subtle p-1">
          <Button
            aria-label={t("common.lineMode")}
            onClick={() => onModeChange("line")}
            size="icon"
            title={t("common.lineChart")}
            variant={effectiveMode === "line" ? "secondary" : "ghost"}
          >
            <HugeiconsIcon color="currentColor" icon={ChartLineData01Icon} size={16} strokeWidth={1.8} />
          </Button>
          <Button
            aria-label={t("common.candleMode")}
            disabled={!canUseCandles}
            onClick={() => onModeChange("candles")}
            size="icon"
            title={canUseCandles ? t("common.candleChart") : t("common.candlesNeedOhlc")}
            variant={effectiveMode === "candles" ? "secondary" : "ghost"}
          >
            <HugeiconsIcon color="currentColor" icon={ChartCandlestickIcon} size={16} strokeWidth={1.8} />
          </Button>
        </div>
      </div>
    </section>
  );
}
