'use client';

import { financialExecutionEnabled } from "@/services/environment";
import { Button, Modal, Toast } from '@/components/ui';
import { useApprovalReview } from '@/hooks/use-approval-review';
import type { TradeFlowStatus } from '@/hooks/use-quote-execution';
import { useT } from "@/i18n/i18n";
export function CancelOrderReviewModal({ orderKey, status, error, onClose, onConfirm }: {
  orderKey: string; status: TradeFlowStatus; error?: string; onClose: () => void; onConfirm: (id: string) => Promise<void>;
}) {
  const t = useT();
  const review = useApprovalReview('cancel', orderKey, true);
  const busy = ['signing', 'preparing', 'confirming', 'submitted'].includes(status);
  return <Modal open title={t("review.cancelTitle")} onClose={busy ? () => undefined : onClose}>
    <p className="text-sm">{t("review.cancelBody")}</p>
    <p className="my-3 break-all font-mono text-xs text-muted">{orderKey}</p>
    <p className="mb-4 text-sm">{t("review.feeLine", { fee: review.approval ? `${Number(review.approval.feeLamports) / 1e9} SOL` : t("review.preparing") })}</p>
    {review.error || error ? <Toast tone="error" title={t("review.cancellationUpdate")} description={review.error || error} /> : null}
    <Button className="mt-4 w-full" disabled={!financialExecutionEnabled || !review.approval || review.approval.status !== 'prepared' || review.expired || busy || status === 'confirmed'} onClick={() => review.approval && void onConfirm(review.approval.id)}>
      {status === 'confirmed' ? t("review.cancelled") : busy ? t("review.confirmingCancel") : t("review.confirmCancel")}
    </Button>
  </Modal>;
}
