'use client';
import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui';
import { approveServerTrade, forgetApproval, getServerApproval, getPendingServerApprovals, pendingApprovals, type TradeApproval } from '@/services/approval-service';
import { walletSessionIsCurrent } from '@/services/wallet-session';
import { usePortfolioRefresh } from '@/hooks/use-portfolio-refresh';
import { useT } from "@/i18n/i18n";
export function PendingApprovalNotice() {
  const { address, getAccessToken } = useOrenAuth();
  const refreshPortfolio = usePortfolioRefresh();
  const t = useT();
  const [entries, setEntries] = useState<{ id: string; wallet: string }[]>([]);
  const [state, setState] = useState<TradeApproval>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [recovered, setRecovered] = useState<{ id: string; wallet: string }[]>([]);
  useEffect(() => {
    let active = true;
    const current = walletSessionIsCurrent();
    if (address) void getAccessToken().then(token => getPendingServerApprovals(address, token)).then(rows => {
      if (active && current()) setRecovered(rows.map(({ id, wallet }) => ({ id, wallet })));
    }).catch(() => { /* Local recovery remains available when the API is temporarily unavailable. */ });
    return () => { active = false; };
  }, [address, getAccessToken]);
  useEffect(() => {
    const sync = () => setEntries(pendingApprovals().filter(item => item.wallet === address));
    const timer = window.setTimeout(sync, 0);
    window.addEventListener('oren-approvals', sync); window.addEventListener('storage', sync);
    return () => { window.clearTimeout(timer); window.removeEventListener('oren-approvals', sync); window.removeEventListener('storage', sync); };
  }, [address]);
  const first = [...entries, ...recovered].find(item => item.wallet === address);
  async function check(resubmit = false) {
    if (!first || !address || busy) return;
    setBusy(true); setMessage(undefined);
    const current = walletSessionIsCurrent();
    try {
      const token = await getAccessToken();
      if (!current()) return;
      // Only a stored, already-signed transaction may be resubmitted from this notice.
      const existing = await getServerApproval(first.id, token);
      if (!current()) return;
      const result = resubmit && existing.status === 'signed' ? await approveServerTrade(first.id, token, address) : existing;
      if (!current()) return;
      setState(result);
      if (result.status === 'confirmed' || result.status === 'failed' || result.status === 'prepared' && result.kind !== 'withdrawal') {
        forgetApproval(first.id);
        setRecovered(items => items.filter(item => item.id !== first.id));
      }
      if (result.status === 'confirmed') await refreshPortfolio();
      setMessage(result.status === 'confirmed' ? t("review.txConfirmed") : result.status === 'failed' ? t("review.txFailed") : result.status === 'prepared' ? result.kind === 'withdrawal' ? t("review.transferProcessing") : t("review.noApproval") : result.message || t("review.stillWaiting"));
    } catch { if (current()) setMessage(t("review.statusUnavailable")); }
    finally { setBusy(false); }
  }
  if (!first) return null;
  return <div role="status" className="mb-4 rounded-xl border border-border bg-panel-subtle p-3 text-sm">
    <p>{t("review.pendingTx")}</p>
    {message ? <p className="mt-1 text-xs text-muted">{message}</p> : null}
    <Button className="mt-2" size="sm" disabled={busy} onClick={() => void check()}>{t("review.checkTx")}</Button>
    {state?.id === first.id && state.status === 'signed' ? <Button className="ml-2 mt-2" size="sm" disabled={busy} onClick={() => void check(true)}>{t("review.retrySame")}</Button> : null}
  </div>;
}
