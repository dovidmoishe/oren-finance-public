"use client";

import { AlertCircleIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Toast, formatNumber } from "@/components/ui";
import { priceMovedChangePercent } from "@/services/price-moved";
import { routeVenueLabel } from "@/services/route-label";
import type { PriceMovedDetails, PriceMovedTerms, QuoteResponse } from "@/types";
import { useI18n } from "@/i18n/i18n";

interface PriceMovedReviewProps {
  details: PriceMovedDetails;
  /** Start a new review for the alternative. Never signs anything by itself. */
  onAccept: (alternative: QuoteResponse) => void;
  onCancel: () => void;
  disabled?: boolean;
}

function venueLabel(provider: string) {
  return routeVenueLabel(provider) ?? "—";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono font-medium">{value}</span>
    </div>
  );
}

function Terms({ title, terms }: { title: string; terms: PriceMovedTerms }) {
  const { locale, t } = useI18n();
  return (
    <div className="space-y-3 rounded-[24px] border border-border p-4" data-terms={title}>
      <p className="text-xs uppercase tracking-[0.12em] text-muted">{title}</p>
      <Row label={t("review.expected")} value={`${formatNumber(terms.outputAmount, locale, 6)} ${terms.outputSymbol}`} />
      <Row label={t("review.minimumReceived")} value={`${formatNumber(terms.minimumOutputAmount, locale, 6)} ${terms.outputSymbol}`} />
      <Row label={t("review.slippage")} value={`${formatNumber(terms.slippageBps / 100, locale, 2)}%`} />
      <Row label={t("review.route")} value={venueLabel(terms.provider)} />
    </div>
  );
}

/**
 * Shown when the API refuses to prepare a swap because the executable route
 * fell below the terms the user reviewed (409 PRICE_MOVED). Lists the old
 * and new terms and offers the fresh Jupiter quote as an alternative. Accept
 * only starts a new review/approval for that quote.
 */
export function PriceMovedReview({ details, onAccept, onCancel, disabled }: PriceMovedReviewProps) {
  const { locale, t } = useI18n();
  const alternative = details.alternative;
  const change = priceMovedChangePercent(details);
  return (
    <div className="space-y-4" data-price-moved={details.quoteId}>
      <Toast
        title={t("review.priceMoved")}
        description={t("review.priceMovedDescription")}
        tone="info"
      />
      <Terms title={t("review.youReviewed")} terms={details.reviewed} />
      {details.latest ? <Terms title={t("review.bestNow")} terms={details.latest} /> : null}
      {alternative ? (
        <>
          <Terms
            title={t("review.jupiterAlternative")}
            terms={{
              provider: alternative.provider,
              outputAmount: alternative.outputAmount,
              minimumOutputAmount: alternative.minimumOutputAmount,
              slippageBps: alternative.slippageBps,
              outputSymbol: alternative.outputSymbol,
              minOutRaw: alternative.minOutRaw,
            }}
          />
          {change !== undefined ? (
            <p className="text-sm text-muted">
              {t(change < 0 ? "review.receiveLess" : "review.receiveMore", { percent: formatNumber(Math.abs(change), locale, 2) })}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Button className="h-12 rounded-[16px]" disabled={disabled} onClick={onCancel} variant="secondary">
              {t("review.cancel")}
            </Button>
            <Button className="h-12 rounded-[16px]" disabled={disabled} onClick={() => onAccept(alternative)} variant="primary">
              <HugeiconsIcon color="currentColor" icon={ArrowRight01Icon} size={16} strokeWidth={1.8} />
              {t("review.reviewNewQuote")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2 text-sm text-muted">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={14} strokeWidth={1.8} />
            <span>{t("review.noAlternative")}</span>
          </div>
          <Button className="h-12 w-full rounded-[16px]" disabled={disabled} onClick={onCancel} variant="secondary">
            {t("review.cancel")}
          </Button>
        </>
      )}
    </div>
  );
}
