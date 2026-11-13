"use client";

import { financialExecutionEnabled } from "@/services/environment";
import { routeVenueLabel } from "@/services/route-label";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Loading03Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button, Modal, Toast, formatCurrency, formatNumber } from "@/components/ui";
import type { ExecutionStatus, QuoteResponse } from "@/types";
import { useApprovalReview } from "@/hooks/use-approval-review";
import { MarketSessionNotice } from "./market-session-notice";
import { PriceMovedReview } from "./price-moved-review";
import { useI18n, type Translate } from "@/i18n/i18n";

type TradeFlowStatus = "idle" | "quoted" | "preparing" | "signing" | "confirming" | "submitted" | "confirmed" | "failed";

interface QuoteReviewModalProps {
  open: boolean;
  quote?: QuoteResponse;
  status: TradeFlowStatus;
  confirmation?: ExecutionStatus;
  error?: string;
  secondsLeft?: number;
  isRefreshingQuote?: boolean;
  refreshFailed?: boolean;
  onRefreshQuote?: () => void;
  onClose: () => void;
  /** Sign the approval; `quote` is the one it was prepared for. */
  onSign: (approvalId: string, quote: QuoteResponse) => Promise<void>;
  /**
   * The user accepted the alternative offered with PRICE_MOVED. Callers that
   * own the quote (e.g. the store) swap it in; otherwise the modal reviews
   * the alternative itself. Either way a new approval is prepared for it.
   */
  onAcceptAlternative?: (quote: QuoteResponse) => void;
}

function formatExpiryLabel(t: Translate, secondsLeft: number, refreshing: boolean) {
  if (refreshing) return t("review.updatingQuote");
  if (secondsLeft <= 0) return t("review.refreshing");
  if (secondsLeft < 60) return t("review.secondsLeft", { seconds: secondsLeft });
  return t("review.minutesLeft", { minutes: Math.floor(secondsLeft / 60), seconds: secondsLeft % 60 });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono font-medium">{value}</span>
    </div>
  );
}

export function QuoteReviewModal({
  open,
  quote: requestedQuote,
  status,
  confirmation,
  error,
  secondsLeft: quoteSecondsLeft,
  isRefreshingQuote = false,
  refreshFailed = false,
  onRefreshQuote,
  onClose,
  onSign,
  onAcceptAlternative,
}: QuoteReviewModalProps) {
  const { locale, t } = useI18n();
  const [accepted, setAccepted] = useState<{ forId: string; quote: QuoteResponse }>();
  // An accepted alternative replaces the requested quote until that changes.
  const reviewQuote =
    accepted && accepted.forId === requestedQuote?.id ? accepted.quote : requestedQuote;
  const review = useApprovalReview('swap', reviewQuote?.id, open);
  const quote = review.approval?.details.quote ?? reviewQuote;
  const acceptAlternative = (alternative: QuoteResponse) => {
    if (onAcceptAlternative) onAcceptAlternative(alternative);
    else if (requestedQuote) setAccepted({ forId: requestedQuote.id, quote: alternative });
  };
  const secondsLeft = quoteSecondsLeft ?? review.secondsLeft;
  const expired = Boolean(quote && secondsLeft <= 0);
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const signed = status === "confirming" || status === "submitted" || status === "confirmed";
  const confirmed = status === "confirmed";
  const submitted = status === "submitted";
  const waitingOnRefresh = expired || isRefreshingQuote;
  const signDisabled = !quote || !review.approval || review.approval.status !== 'prepared' || review.expired || waitingOnRefresh || isBusy || submitted || confirmed || refreshFailed;
  const minimumReceived = quote
    ? quote.outputAmount * (1 - quote.slippageBps / 10_000)
    : 0;
  const route = routeVenueLabel(quote?.provider);
  const warnings = [
    quote && quote.priceImpactPercent >= 1 ? t("review.priceImpactWarning", { percent: formatNumber(quote.priceImpactPercent, locale, 2) }) : null,
    refreshFailed ? t("review.refreshFailedWarning") : null,
  ].filter((warning): warning is string => Boolean(warning));

  return (
    <Modal open={open} onClose={onClose} side="right" title={quote ? t(quote.side === "buy" ? "review.titleBuy" : "review.titleSell", { ticker: quote.ticker }) : t("review.titleTrade")}>
      {!quote ? (
        <Toast title={t("review.noQuoteTitle")} description={t("review.noQuoteDescription")} tone="error" />
      ) : review.priceMoved ? (
        <PriceMovedReview
          details={review.priceMoved}
          disabled={!financialExecutionEnabled || isBusy}
          onAccept={acceptAlternative}
          onCancel={onClose}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3 rounded-[24px] border border-border p-4">
            <Row label={t("review.youPay")} value={`${formatNumber(quote.inputAmount, locale, 6)} ${quote.inputSymbol}`} />
            <Row label={t("review.youReceive")} value={`${formatNumber(quote.outputAmount, locale, 6)} ${quote.outputSymbol}`} />
            <Row label={t("review.minimumReceived")} value={`${formatNumber(minimumReceived, locale, 6)} ${quote.outputSymbol}`} />
            <Row label={t("review.estimatedPrice")} value={formatCurrency(quote.estimatedPriceUsd, locale)} />
            <Row label={t("review.priceImpact")} value={`${formatNumber(quote.priceImpactPercent, locale, 2)}%`} />
            <Row label={t("review.slippage")} value={`${formatNumber(quote.slippageBps / 100, locale, 2)}%`} />
            {route ? <Row label={t("review.route")} value={route} /> : null}
            <Row label={t("review.estimatedFee")} value={review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : t("review.preparing")} />
            <Row label={t("review.quoteExpiry")} value={formatExpiryLabel(t, secondsLeft, isRefreshingQuote)} />
          </div>

          <MarketSessionNotice session={quote.marketSession} />

          {warnings.length ? (
            <div className="space-y-2">
              {warnings.map((warning) => (
                <Toast key={warning} title={t("review.warningTitle")} description={warning} tone="info" />
              ))}
            </div>
          ) : null}

          {error ? <Toast title={t("review.tradeError")} description={error} tone="error" /> : null}
          {review.error ? <Toast title={t("review.prepareFailed")} description={review.error} tone="error" /> : null}
          {review.error ? <Button onClick={() => void review.prepare()} disabled={!financialExecutionEnabled || isBusy} variant="secondary">{t("review.retryPreparation")}</Button> : null}
          {review.expired && !signed ? <Toast title={t("review.approvalExpired")} description={t("review.approvalExpiredDescription")} tone="info" /> : null}

          {confirmation ? (
            <div className="rounded-[18px] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-start gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">{t("review.tracking")}</p>
                  <p className="mt-1 text-xs opacity-75">{t("review.trackingDescription")}</p>
                  {route ? <p className="mt-1 text-xs font-medium">{t("review.routedThrough", { route })}</p> : null}
                  <p className="mt-1 break-all text-xs opacity-75">{confirmation.signature}</p>
                </div>
              </div>
            </div>
          ) : null}

          {refreshFailed && onRefreshQuote ? (
            <Button className="h-12 w-full rounded-[16px]" onClick={onRefreshQuote} variant="secondary">
              <HugeiconsIcon color="currentColor" icon={AlertCircleIcon} size={16} strokeWidth={1.8} />
              {t("review.retryRefresh")}
            </Button>
          ) : (
            <Button className="h-12 w-full rounded-[16px]" disabled={!financialExecutionEnabled || signDisabled} onClick={() => review.approval && reviewQuote && void onSign(review.approval.id, reviewQuote)} variant="primary">
              {isBusy ? (
                <>
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                  {status === "preparing" ? t("review.preparingShort") : status === "signing" ? t("review.approvingTrade") : t("review.confirming")}
                </>
              ) : status === "submitted" ? (
                <>
                  <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                  {t("review.submittedSyncing")}
                </>
              ) : confirmed ? (
                <>
                  <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                  {t("review.confirmed")}
                </>
              ) : waitingOnRefresh ? (
                <>
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
                  {t("review.updatingQuote")}
                </>
              ) : (
                <>
                  <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                  {review.loading ? t("review.preparingTrade") : quote.side === "buy" ? t("review.confirmBuy") : t("review.confirmSell")}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
