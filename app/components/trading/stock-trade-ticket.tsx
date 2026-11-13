"use client";

import { financialExecutionEnabled } from "@/services/environment";
import { formatQuotedRoute } from "@/services/route-label";

import { AlertCircleIcon, CoinsSwapIcon, Loading03Icon, Wallet02Icon, ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuoteExecution } from "@/hooks/use-quote-execution";
import { useQuoteRefresh } from "@/hooks/use-quote-refresh";
import { useLimitOrderExecution } from "@/hooks/use-limit-order-execution";
import { listLimitOrders, proposeLimitOrder } from "@/services";
import { Button, Card, cn, formatCurrency, formatNumber } from "@/components/ui";
import { useExecutionStore, usePortfolioStore } from "@/store";
import type { LimitOrderProposal, LimitOrderRecord, LimitZone, QuoteResponse, StockDetail, TradeSide } from "@/types";
import { MarketSessionNotice } from "./market-session-notice";
import { QuoteReviewModal } from "./quote-review-modal";
import { LimitOrderReviewModal } from "./limit-order-review-modal";
import { CancelOrderReviewModal } from "./cancel-order-review-modal";
import { LimitOrderToggle, OrderControls } from "./order-controls";
import { useI18n } from "@/i18n/i18n";

type OrderMode = "market" | "limit";

interface StockTradeTicketProps {
  stock: StockDetail;
  limitZones?: LimitZone[];
  onConfirmed?: () => Promise<void> | void;
}

function normalizeLogoUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function TokenBadge({
  symbol,
  name,
  logoUrl,
  tone = "stock",
}: {
  symbol: string;
  name: string;
  logoUrl?: string;
  tone?: "stock" | "cash";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`${name} logo`} className="h-6 w-6 rounded-full border border-border bg-white object-contain p-0.5" src={logoUrl} />
      ) : (
        <div
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
            tone === "cash" ? "bg-accent-yellow text-foreground" : "bg-accent-pink text-foreground",
          )}
        >
          {symbol.slice(0, 2)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold leading-tight">{symbol}</p>
        <p className="truncate text-[11px] leading-tight text-muted">{name}</p>
      </div>
    </div>
  );
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono text-xs font-medium">{value}</span>
    </div>
  );
}

function roughlyEqual(left: number, right: number) {
  return Math.abs(left - right) < 0.000001;
}

function isNoRouteError(message?: string) {
  // Matches the API's venue-neutral "No swap routes" and the older "No Jupiter routes".
  return /no (swap |jupiter )?routes/.test(message?.toLowerCase() ?? "");
}

export function StockTradeTicket({ stock, limitZones, onConfirmed }: StockTradeTicketProps) {
  const limitFieldsId = useId();
  const { publicKey, connected } = useWallet();
  const auth = useOrenAuth();
  const { locale, t } = useI18n();
  const { authenticated, error: walletError, open: openSignIn } = auth;
  const wallet = publicKey?.toBase58();
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const quote = useExecutionStore((state) => state.quote);
  const prepared = useExecutionStore((state) => state.prepared);
  const isLoading = useExecutionStore((state) => state.isLoading);
  const isRefreshingQuote = useExecutionStore((state) => state.isRefreshingQuote);
  const quoteTrade = useExecutionStore((state) => state.quoteTrade);
  const resetTrade = useExecutionStore((state) => state.resetTrade);
  const seedQuote = useExecutionStore((state) => state.seedQuote);
  const [openOrders, setOpenOrders] = useState<LimitOrderRecord[]>([]);
  const refreshOpenOrders = useCallback(async () => {
    if (!wallet) {
      setOpenOrders([]);
      return;
    }
    try {
      const orders = await listLimitOrders(wallet);
      setOpenOrders(
        orders.filter(
          (order) =>
            order.status === "open" &&
            (order.assetId === stock.assetId || order.ticker === stock.ticker),
        ),
      );
    } catch {
      // Keep last known list; listing is best-effort.
    }
  }, [stock.assetId, stock.ticker, wallet]);
  const {
    confirmation,
    error: executionError,
    executeQuote,
    flowStatus,
    resetFeedback,
    setError: setLocalError,
    setFlowStatus,
  } = useQuoteExecution(onConfirmed);
  const {
    confirmation: limitConfirmation,
    error: limitError,
    executeLimitOrder,
    cancelLimitOrder,
    flowStatus: limitFlowStatus,
    resetFeedback: resetLimitFeedback,
  } = useLimitOrderExecution(useCallback(async () => {
    await refreshOpenOrders();
    await onConfirmed?.();
  }, [onConfirmed, refreshOpenOrders]));
  const {
    secondsLeft,
    refreshFailed,
    refreshQuote,
  } = useQuoteRefresh({
    enabled: Boolean(connected && wallet),
    flowStatus,
  });
  const [orderMode, setOrderMode] = useState<OrderMode>("market");
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("100");
  const [limitPrice, setLimitPrice] = useState(() => {
    const buyZone = limitZones?.find((zone) => zone.side === "buy");
    return buyZone ? String(buyZone.preferredUsd) : "";
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [limitProposal, setLimitProposal] = useState<LimitOrderProposal>();
  const [limitReviewOpen, setLimitReviewOpen] = useState(false);
  const [cancelReviewKey, setCancelReviewKey] = useState<string>();
  const [limitBusy, setLimitBusy] = useState(false);
  const autoQuoteKeyRef = useRef<string | undefined>(undefined);
  const tradableRoutes = stock.variants.filter((variant) => variant.tradable).length;
  const position = useMemo(
    () => portfolio?.positions.find((item) => item.assetId === stock.assetId || item.ticker === stock.ticker),
    [portfolio?.positions, stock.assetId, stock.ticker],
  );
  const cashBalance = portfolio?.cashValueUsd;
  const stockBalance = position?.availableQuantity ?? 0;
  const parsedAmount = Number(amount);
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const parsedLimitPrice = Number(limitPrice);
  const limitPriceIsValid = Number.isFinite(parsedLimitPrice) && parsedLimitPrice > 0;
  const sideZone = limitZones?.find((zone) => zone.side === side);
  const buyAmountUsd = side === "buy" && amountIsValid ? parsedAmount : 0;
  const sellQuantity = side === "sell" && amountIsValid ? parsedAmount : 0;
  const activeQuote =
    quote &&
    quote.assetId === stock.assetId &&
    quote.side === side &&
    (side === "buy" ? roughlyEqual(quote.amountUsd, parsedAmount) : roughlyEqual(quote.inputAmount, parsedAmount))
      ? quote
      : undefined;
  const estimatedReceive =
    activeQuote
      ? activeQuote.outputAmount
      : side === "buy"
        ? stock.priceUsd
          ? buyAmountUsd / stock.priceUsd
          : 0
        : sellQuantity * (stock.priceUsd ?? 0);
  const formattedOutput =
    side === "buy"
      ? `${formatNumber(estimatedReceive, locale, 6)} ${stock.ticker}`
      : formatCurrency(estimatedReceive, locale);
  const blockingError =
    tradableRoutes === 0
      ? t("ticket.noRoute")
      : !amountIsValid
        ? t("ticket.amountPositive")
        : side === "buy" && typeof cashBalance === "number" && parsedAmount > cashBalance
          ? t("ticket.insufficientCash")
          : side === "sell" && parsedAmount > stockBalance
            ? t("ticket.insufficientStock")
            : undefined;
  const logoUrl = normalizeLogoUrl(stock.logoUrl);
  const displayedError = executionError;
  const liveRouteUnavailable = isNoRouteError(displayedError);
  const routeValue = activeQuote
    ? formatQuotedRoute(activeQuote.provider, activeQuote.variant.symbol)
    : isLoading
      ? t("ticket.fetchingQuote")
      : liveRouteUnavailable
        ? t("ticket.noLiveRoute")
        : tradableRoutes
          ? t("ticket.catalogRoutes", { count: tradableRoutes })
          : t("ticket.noRouteShort");
  const minimumReceivedValue = activeQuote
    ? `${formatNumber(activeQuote.outputAmount * (1 - activeQuote.slippageBps / 10_000), locale, 6)} ${activeQuote.outputSymbol}`
    : isLoading
      ? t("ticket.fetchingQuote")
      : liveRouteUnavailable
        ? t("ticket.unavailable")
        : t("ticket.waitingQuote");

  useEffect(() => {
    if (wallet && (!portfolio || portfolio.wallet !== wallet)) {
      void loadPortfolio(wallet);
    }
  }, [loadPortfolio, portfolio, wallet]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshOpenOrders();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshOpenOrders]);

  useEffect(() => {
    resetTrade();
    resetFeedback();
    resetLimitFeedback();
    return resetTrade;
  }, [resetFeedback, resetLimitFeedback, resetTrade]);

  const requestQuote = useCallback(
    async ({ openReview }: { openReview: boolean }) => {
      setLocalError(undefined);

      if (!connected || !wallet) {
        if (openReview) {
          if (authenticated) setLocalError(walletError || t("ticket.walletPreparing"));
          else openSignIn();
        }
        return;
      }

      if (blockingError) {
        setLocalError(blockingError);
        return;
      }

      setFlowStatus("idle");
      await quoteTrade({
        wallet,
        assetId: stock.assetId,
        ticker: stock.ticker,
        side,
        amountUsd: side === "buy" ? parsedAmount : undefined,
        amount: side === "sell" ? parsedAmount : undefined,
        slippageBps: 50,
      });

      const nextQuote = useExecutionStore.getState().quote;
      const nextError = useExecutionStore.getState().error;
      if (nextQuote) {
        setFlowStatus("quoted");
        if (openReview) setReviewOpen(true);
      } else if (nextError) {
        setFlowStatus("failed");
        setLocalError(nextError);
      }
    },
    // `t` only labels the wallet message; a language change must not re-run the auto-quote effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      blockingError,
      connected,
      parsedAmount,
      quoteTrade,
      setFlowStatus,
      setLocalError,
      authenticated,
      walletError,
      openSignIn,
      side,
      stock.assetId,
      stock.ticker,
      wallet,
    ],
  );

  useEffect(() => {
    if (orderMode !== "market") return;
    if (!connected || !wallet || blockingError || isLoading || isRefreshingQuote) {
      return;
    }

    const quoteKey = `${wallet}:${stock.assetId}:${side}:${parsedAmount}`;
    const hasMatchingLiveQuote =
      activeQuote && new Date(activeQuote.expiresAt).getTime() > Date.now();
    if (hasMatchingLiveQuote) {
      autoQuoteKeyRef.current = quoteKey;
      return;
    }

    if (autoQuoteKeyRef.current === quoteKey && activeQuote) {
      return;
    }

    const timeout = window.setTimeout(() => {
      autoQuoteKeyRef.current = quoteKey;
      void requestQuote({ openReview: false });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [
    activeQuote,
    blockingError,
    connected,
    isLoading,
    isRefreshingQuote,
    orderMode,
    parsedAmount,
    requestQuote,
    side,
    stock.assetId,
    wallet,
  ]);

  const handleModeChange = (nextMode: OrderMode) => {
    setOrderMode(nextMode);
    setReviewOpen(false);
    setLimitReviewOpen(false);
    setLimitProposal(undefined);
    setLocalError(undefined);
    resetLimitFeedback();
    if (nextMode === "market") {
      autoQuoteKeyRef.current = undefined;
    }
  };

  const handleSideChange = (nextSide: TradeSide) => {
    setSide(nextSide);
    autoQuoteKeyRef.current = undefined;
    resetTrade();
    setFlowStatus("idle");
    setLocalError(undefined);
    setReviewOpen(false);
    setLimitProposal(undefined);
    setLimitReviewOpen(false);
    const zone = limitZones?.find((item) => item.side === nextSide);
    setLimitPrice(zone ? String(zone.preferredUsd) : "");
  };

  const handleAmountChange = (nextAmount: string) => {
    setAmount(nextAmount);
    autoQuoteKeyRef.current = undefined;
    if (quote || prepared || confirmation) {
      resetTrade();
      setFlowStatus("idle");
      setLocalError(undefined);
    }
  };

  const handleQuote = async () => {
    await requestQuote({ openReview: true });
  };

  const handlePrepareSignConfirm = async (approvalId: string, reviewedQuote: QuoteResponse) => {
    await executeQuote(reviewedQuote, approvalId);
  };

  // PRICE_MOVED: the user chose the Jupiter alternative. Make it the active
  // quote (same intent, so refresh keeps working); the review modal then
  // prepares a fresh approval for it. Nothing is signed here.
  const handleAcceptAlternative = (alternative: QuoteResponse) => {
    seedQuote(alternative, useExecutionStore.getState().lastQuoteIntent);
    resetFeedback();
  };

  const handleProposeLimit = async () => {
    setLocalError(undefined);
    if (!connected || !wallet) {
      if (auth.authenticated) setLocalError(auth.error || t("ticket.walletPreparing"));
      else auth.open();
      return;
    }
    if (blockingError) {
      setLocalError(blockingError);
      return;
    }
    if (!limitPriceIsValid) {
      setLocalError(t("ticket.invalidLimit"));
      return;
    }

    setLimitBusy(true);
    try {
      const proposal = await proposeLimitOrder({
        wallet,
        assetId: stock.assetId,
        ticker: stock.ticker,
        side,
        amountUsd: side === "buy" ? parsedAmount : undefined,
        amount: side === "sell" ? parsedAmount : undefined,
        limitPriceUsd: parsedLimitPrice,
        basis: sideZone?.basis,
        slippageBps: 0,
      });
      setLimitProposal(proposal);
      setLimitReviewOpen(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("ticket.limitFailed"));
    } finally {
      setLimitBusy(false);
    }
  };

  const ctaLabel = !auth.ready
    ? t("ticket.restoring")
    : !connected || !wallet
      ? auth.authenticated
        ? auth.error ? t("ticket.retryWallet") : t("ticket.preparingWallet")
        : auth.configured ? t("ticket.signIn") : t("ticket.signInUnavailable")
    : orderMode === "limit"
      ? t("ticket.reviewLimit")
      : isRefreshingQuote
        ? t("ticket.updatingQuote")
        : activeQuote
          ? t("ticket.reviewQuote")
          : t("ticket.getQuote");

  const limitEstimatedReceive =
    orderMode === "limit" && amountIsValid && limitPriceIsValid
      ? side === "buy"
        ? parsedAmount / parsedLimitPrice
        : parsedAmount * parsedLimitPrice
      : 0;
  const inputSymbol = side === "buy" ? "USDC" : stock.ticker;
  const outputSymbol = side === "buy" ? stock.ticker : "USDC";
  const inputName = side === "buy" ? "USD Coin" : stock.name;
  const outputName = side === "buy" ? stock.name : "USD Coin";
  const inputBalance =
    side === "buy"
      ? typeof cashBalance === "number"
        ? formatCurrency(cashBalance, locale)
        : auth.authenticated ? t("ticket.loadingBalance") : t("ticket.signInToLoad")
      : `${formatNumber(stockBalance, locale, 6)} ${stock.ticker}`;
  const outputEstimate = activeQuote ? `${formatNumber(activeQuote.outputAmount, locale, 6)} ${activeQuote.outputSymbol}` : formattedOutput;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Card className="flex h-full min-h-0 flex-col overflow-hidden p-3">
        <OrderControls
          side={side}
          onSideChange={handleSideChange}
        />

        <div className="relative space-y-1.5">
          <div className="rounded-[16px] border border-border bg-panel-subtle p-2.5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
              <span>{side === "buy" ? t("ticket.pay") : t("ticket.sell")}</span>
              <div className="flex items-center gap-2 normal-case tracking-normal">
                <button
                  className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!financialExecutionEnabled || side !== "sell" || stockBalance <= 0}
                  onClick={() => handleAmountChange(String(stockBalance))}
                  type="button"
                >
                  {t("ticket.max")}
                </button>
                <span>{inputBalance}</span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <TokenBadge logoUrl={side === "buy" ? "/usdc.svg" : logoUrl} name={inputName} symbol={inputSymbol} tone={side === "buy" ? "cash" : "stock"} />
              <input
                aria-label={t("ticket.amountLabel", { symbol: side === "buy" ? "USDC" : stock.ticker })}
                className="min-w-0 flex-1 bg-transparent text-right font-display text-xl font-semibold outline-none placeholder:text-muted-2"
                inputMode="decimal"
                onChange={(event) => handleAmountChange(event.target.value)}
                placeholder="0"
                value={amount}
              />
            </div>
          </div>

          <button aria-label={side === "buy" ? t("ticket.switchToSell") : t("ticket.switchToBuy")} className="absolute left-1/2 top-[calc(50%-16px)] z-10 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border-4 border-background bg-panel shadow-sm hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => handleSideChange(side === "buy" ? "sell" : "buy")} type="button">
            <HugeiconsIcon icon={ArrowUpDownIcon} size={20} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />
          </button>

          <div className="rounded-[16px] border border-border bg-panel-subtle p-2.5">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
              <span>{side === "buy" ? t("ticket.buy") : t("ticket.receive")}</span>
              <span>{outputEstimate}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <TokenBadge logoUrl={side === "buy" ? logoUrl : "/usdc.svg"} name={outputName} symbol={outputSymbol} tone={side === "buy" ? "stock" : "cash"} />
              <p className="min-w-0 flex-1 truncate text-right font-display text-xl font-semibold">
                {orderMode === "limit"
                  ? amountIsValid && limitPriceIsValid
                    ? formatNumber(limitEstimatedReceive, locale, side === "buy" ? 4 : 2)
                    : "0"
                  : activeQuote
                    ? formatNumber(activeQuote.outputAmount, locale, 4)
                    : amountIsValid
                      ? formatNumber(estimatedReceive, locale, side === "buy" ? 4 : 2)
                      : "0"}
              </p>
            </div>
          </div>
        </div>

        <LimitOrderToggle
          limit={orderMode === "limit"}
          limitFieldsId={limitFieldsId}
          onLimitChange={(enabled) => handleModeChange(enabled ? "limit" : "market")}
        />
        <div className="mb-2 space-y-2" hidden={orderMode !== "limit"} id={limitFieldsId}>
            <div className="rounded-[18px] border border-border bg-panel-subtle px-3 py-2.5">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-muted">
                <span>{t("ticket.limitPriceUsd")}</span>
                {stock.priceUsd ? <span>{t("ticket.market", { price: formatCurrency(stock.priceUsd, locale) })}</span> : null}
              </div>
              <input
                aria-label={t("ticket.limitPriceAria")}
                className="mt-1.5 w-full bg-transparent font-display text-2xl font-semibold outline-none placeholder:text-muted-2"
                inputMode="decimal"
                onChange={(event) => setLimitPrice(event.target.value)}
                placeholder="0.00"
                value={limitPrice}
              />
            </div>
            {limitZones?.length ? (
              <div className="flex flex-wrap gap-2">
                {limitZones
                  .filter((zone) => zone.side === side)
                  .map((zone) => (
                    <button
                      className="rounded-full bg-panel px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-border"
                      key={`${zone.side}-${zone.preferredUsd}`}
                      onClick={() => setLimitPrice(String(zone.preferredUsd))}
                      type="button"
                    >
                      {t("ticket.taZone", { price: formatCurrency(zone.preferredUsd, locale) })}
                    </button>
                  ))}
              </div>
            ) : null}
        </div>

        <div className="mt-auto flex flex-col pt-3">
          <MarketSessionNotice
            className="mb-3"
            session={orderMode === "market" ? activeQuote?.marketSession : limitProposal?.marketSession}
          />
          <div className="space-y-1.5">
            {orderMode === "market" ? (
              <>
                <RouteRow label={t("ticket.route")} value={routeValue} />
                <RouteRow label={t("ticket.minimumReceived")} value={minimumReceivedValue} />
                <RouteRow label={t("ticket.rate")} value={activeQuote ? `1 ${activeQuote.outputSymbol} ~ ${formatCurrency(activeQuote.estimatedPriceUsd, locale)}` : stock.priceUsd ? formatCurrency(stock.priceUsd, locale) : t("ticket.unavailable")} />
                <RouteRow label={t("ticket.networkFee")} value={activeQuote?.networkFeeUsd ? formatCurrency(activeQuote.networkFeeUsd, locale, 4) : t("ticket.estimatedByWallet")} />
              </>
            ) : (
              <>
                <RouteRow label={t("ticket.orderType")} value={t("ticket.triggerLimit")} />
                <RouteRow
                  label={t("ticket.limitPrice")}
                  value={limitPriceIsValid ? formatCurrency(parsedLimitPrice, locale) : t("ticket.enterPrice")}
                />
                <RouteRow
                  label={t("ticket.ifFilled")}
                  value={
                    amountIsValid && limitPriceIsValid
                      ? side === "buy"
                        ? `${formatNumber(limitEstimatedReceive, locale, 6)} ${stock.ticker}`
                        : formatCurrency(limitEstimatedReceive, locale)
                      : "—"
                  }
                />
              </>
            )}
          </div>

          {blockingError || displayedError || limitError ? (
            <div className="mt-3 flex gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
              <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={14} strokeWidth={1.8} />
              <span>
                {liveRouteUnavailable && orderMode === "market"
                  ? t("ticket.noLiveRouteDetail", { ticker: stock.ticker })
                  : (limitError ?? executionError ?? blockingError)}
              </span>
            </div>
          ) : null}

          {openOrders.length ? (
            <div className="mt-4 space-y-2 rounded-[18px] border border-border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                {t("ticket.openOrders")}
              </p>
              {openOrders.map((order) => (
                <div className="flex items-center justify-between gap-3 text-xs" key={order.orderKey}>
                  <div>
                    <p className="font-semibold">
                      {t(order.side === "buy" ? "ticket.orderBuyAt" : "ticket.orderSellAt", { price: formatCurrency(order.limitPriceUsd, locale) })}
                    </p>
                    <p className="text-muted">{formatCurrency(order.amountUsd ?? 0, locale)}</p>
                  </div>
                  <Button
                    disabled={!financialExecutionEnabled || limitFlowStatus === "preparing" || limitFlowStatus === "signing"}
                    onClick={() => { resetLimitFeedback(); setCancelReviewKey(order.orderKey); }}
                    size="sm"
                    variant="secondary"
                  >
                    {t("ticket.cancel")}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Button
            className="mt-3 h-9 w-full rounded-[14px]"
            disabled={!financialExecutionEnabled ||
              !auth.ready || !auth.configured || (auth.authenticated && (!connected || !wallet) && !auth.error) || (connected
                ? Boolean(blockingError) ||
                  isLoading ||
                  isRefreshingQuote ||
                  limitBusy ||
                  (orderMode === "limit" && !limitPriceIsValid)
                : false)
            }
            onClick={() => {
              if (!connected || !wallet) {
                if (auth.authenticated) void auth.createWallet();
                else auth.open();
                return;
              }
              if (orderMode === "limit") {
                void handleProposeLimit();
                return;
              }
              if (activeQuote && !isRefreshingQuote) {
                setReviewOpen(true);
                return;
              }
              void handleQuote();
            }}
            variant="primary"
          >
            {isLoading || isRefreshingQuote || limitBusy ? (
              <>
                <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
                {limitBusy ? t("ticket.buildingLimit") : isRefreshingQuote ? t("ticket.updatingQuote") : t("ticket.loadingQuote")}
              </>
            ) : !connected ? (
              <>
                <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                {ctaLabel}
              </>
            ) : (
              <>
                <HugeiconsIcon color="currentColor" icon={CoinsSwapIcon} size={16} strokeWidth={1.8} />
                {ctaLabel}
              </>
            )}
          </Button>
        </div>
      </Card>

      <QuoteReviewModal
        confirmation={confirmation}
        error={executionError}
        isRefreshingQuote={isRefreshingQuote}
        onClose={() => {
          setReviewOpen(false);
          if (flowStatus === 'confirmed') { resetTrade(); resetFeedback(); autoQuoteKeyRef.current = undefined; }
        }}
        onRefreshQuote={() => void refreshQuote()}
        onAcceptAlternative={handleAcceptAlternative}
        onSign={handlePrepareSignConfirm}
        open={reviewOpen}
        quote={activeQuote}
        refreshFailed={refreshFailed}
        secondsLeft={secondsLeft}
        status={flowStatus}
      />

      <LimitOrderReviewModal
        confirmation={limitConfirmation}
        error={limitError}
        onClose={() => setLimitReviewOpen(false)}
        onSign={async (approvalId) => {
          if (!limitProposal) return;
          await executeLimitOrder(limitProposal, approvalId);
        }}
        open={limitReviewOpen}
        proposal={limitProposal}
        status={limitFlowStatus === "idle" ? "quoted" : limitFlowStatus}
      />
      {cancelReviewKey ? <CancelOrderReviewModal orderKey={cancelReviewKey} status={limitFlowStatus} error={limitError}
        onClose={() => setCancelReviewKey(undefined)} onConfirm={id => cancelLimitOrder(cancelReviewKey, id)} /> : null}
    </div>
  );
}
