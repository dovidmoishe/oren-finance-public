"use client";

import { financialExecutionEnabled } from "@/services/environment";
import { routeVenueLabel } from "@/services/route-label";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Modal, Toast, formatCurrency, formatDateTime, formatNumber } from "@/components/ui";
import type { LimitOrderProposal } from "@/types";
import type { TradeFlowStatus } from "@/hooks/use-quote-execution";
import { useApprovalReview } from "@/hooks/use-approval-review";
import { MarketSessionNotice } from "./market-session-notice";
import { useI18n } from "@/i18n/i18n";

interface LimitOrderReviewModalProps {
  open: boolean;
  proposal?: LimitOrderProposal;
  status: TradeFlowStatus;
  confirmation?: { signature: string; orderKey?: string };
  error?: string;
  onClose: () => void;
  onSign: (approvalId: string) => Promise<void>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono font-medium">{value}</span>
    </div>
  );
}

export function LimitOrderReviewModal({
  open,
  proposal: requestedProposal,
  status,
  confirmation,
  error,
  onClose,
  onSign,
}: LimitOrderReviewModalProps) {
  const { locale, timeZone, t } = useI18n();
  const review = useApprovalReview('limit', requestedProposal?.id, open);
  const proposal = review.approval?.details.proposal ?? requestedProposal;
  const isBusy = status === "preparing" || status === "signing" || status === "confirming";
  const confirmed = status === "confirmed";
  const signDisabled = !proposal || !review.approval || review.approval.status !== 'prepared' || review.expired || isBusy || confirmed || status === 'submitted';
  const expiresLabel = proposal
    ? formatDateTime(new Date(proposal.expiredAt * 1000).toISOString(), locale, timeZone, t("common.unknown"))
    : "—";
  const route = routeVenueLabel(proposal?.provider);

  return (
    <Modal open={open} onClose={onClose} side="right" title={proposal ? t(proposal.side === "buy" ? "review.limitTitleBuy" : "review.limitTitleSell", { ticker: proposal.ticker }) : t("review.limitTitle")}>
      {!proposal ? (
        <Toast title={t("review.noLimitTitle")} description={t("review.noLimitDescription")} tone="error" />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3 rounded-[24px] border border-border p-4">
            <Row label={t("review.limitPrice")} value={formatCurrency(proposal.limitPriceUsd, locale)} />
            <Row label={t("review.youLock")} value={`${formatNumber(proposal.makingAmount, locale, 6)} ${proposal.inputSymbol}`} />
            <Row label={t("review.receiveIfFilled")} value={`${formatNumber(proposal.takingAmount, locale, 6)} ${proposal.outputSymbol}`} />
            <Row label={t("review.notional")} value={formatCurrency(proposal.amountUsd, locale)} />
            {proposal.marketPriceUsd !== undefined ? (
              <Row label={t("review.marketPrice")} value={formatCurrency(proposal.marketPriceUsd, locale)} />
            ) : null}
            <Row label={t("review.expires")} value={expiresLabel} />
            {route ? <Row label={t("review.route")} value={route} /> : null}
            {proposal.basis ? (
              <Row label={t("review.taBasis")} value={proposal.basis.replaceAll("_", " ")} />
            ) : null}
          </div>

          <MarketSessionNotice session={proposal.marketSession} />

          {proposal.wouldFillImmediately ? (
            <Toast
              title={t("review.fillImmediately")}
              description={t("review.fillImmediatelyDescription")}
              tone="info"
            />
          ) : null}

          {error ? <Toast title={t("review.limitError")} description={error} tone="error" /> : null}

          {confirmation ? (
            <div className="rounded-[18px] border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              <div className="flex items-start gap-3">
                <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                <div>
                  <p className="font-semibold">{t("review.limitOpened")}</p>
                  {route ? <p className="mt-1 text-xs font-medium">{t("review.routedThrough", { route })}</p> : null}
                  {confirmation.orderKey ? (
                    <p className="mt-1 break-all text-xs opacity-75">{t("review.orderKey", { key: confirmation.orderKey })}</p>
                  ) : null}
                  <p className="mt-1 break-all text-xs opacity-75">{confirmation.signature}</p>
                </div>
              </div>
            </div>
          ) : null}

          {review.error ? <Toast title={t("review.prepareOrderFailed")} description={review.error} tone="error" /> : null}
          {review.expired ? <Toast title={t("review.reviewExpired")} description={t("review.reviewExpiredDescription")} tone="info" /> : null}
          <p className="text-xs text-muted">{t("review.feeLine", { fee: review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : t("review.preparing") })}</p>
          <Button className="h-12 w-full rounded-[16px]" disabled={!financialExecutionEnabled || signDisabled} onClick={() => review.approval && void onSign(review.approval.id)} variant="primary">
            {isBusy ? (
              <>
                <HugeiconsIcon className="animate-spin" color="currentColor" icon={Clock01Icon} size={16} strokeWidth={1.8} />
                {status === "preparing" ? t("review.preparingShort") : status === "signing" ? t("review.approvingOrder") : t("review.confirming")}
              </>
            ) : confirmed ? (
              <>
                <HugeiconsIcon color="currentColor" icon={CheckmarkCircle01Icon} size={16} strokeWidth={1.8} />
                {t("review.orderOpened")}
              </>
            ) : (
              <>
                <HugeiconsIcon color="currentColor" icon={Wallet02Icon} size={16} strokeWidth={1.8} />
                {review.loading ? t("review.preparingOrder") : status === 'submitted' ? t("review.submittedConfirming") : t("review.confirmLimit")}
              </>
            )}
          </Button>

          <p className="text-center text-[11px] leading-4 text-muted">
            <HugeiconsIcon className="mr-1 inline" color="currentColor" icon={AlertCircleIcon} size={12} strokeWidth={1.8} />
            {t("review.triggerNote")}
          </p>
        </div>
      )}
    </Modal>
  );
}
