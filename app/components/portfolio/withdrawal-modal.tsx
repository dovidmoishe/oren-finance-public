'use client';

import { useEffect, useRef, useState } from 'react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button } from '@/components/ui';
import { stockLogos } from '@/components/stock/stock-logo-assets';
import { useFunding } from '@/hooks/use-funding';
import { usePortfolioRefresh } from '@/hooks/use-portfolio-refresh';
import { ApiError } from '@/services/api-client';
import { approveServerTrade, forgetApproval, getServerApproval, type TradeApproval } from '@/services/approval-service';
import { financialExecutionEnabled } from '@/services/environment';
import { getWithdrawalStocks, prepareWithdrawal, recoverWithdrawal, solCost, type WithdrawalStock } from '@/services/withdrawal-service';
import { walletSessionIsCurrent } from '@/services/wallet-session';
import { MessageKeyError, useShownMessage, useT, shownFromUnknown, shownKey, type ShownMessage } from "@/i18n/i18n";

// Read in event handlers only; kept outside the component for the purity lint.
const currentTime = () => Date.now();

function AssetLogo({ symbol, src }: { symbol: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const url = src?.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${src.slice(7)}` : src;
  return <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-[10px] font-semibold">
    {url && !failed ? /* eslint-disable-next-line @next/next/no-img-element */
      <img src={url} alt="" width={24} height={24} className="h-6 w-6 object-contain" onError={() => setFailed(true)} /> : symbol.slice(0, 2)}
  </span>;
}

export function WithdrawalModal({ onClose }: { onClose: () => void }) {
  const auth = useOrenAuth();
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby="transfer-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-2xl sm:p-6" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
      <div className="flex items-center justify-between gap-4"><h2 id="transfer-title" className="font-display text-xl font-semibold">{t("transfer.title")}</h2><button aria-label={t("transfer.close")} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-background" type="button" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /></button></div>
      <p className="mt-2 text-sm leading-6 text-muted">{t("transfer.intro")}</p>
      {!financialExecutionEnabled ? <p className="mt-6 text-sm" role="status">{t("transfer.disabledPreview")}</p>
        : !auth.ready ? <p className="mt-6 text-sm" role="status">{t("transfer.loadingAccount")}</p>
        : !auth.authenticated ? <Button className="mt-6" onClick={auth.open}>{t("transfer.signIn")}</Button>
        : !auth.address ? <p className="mt-6 text-sm" role="status">{t("transfer.walletPreparing")}</p>
        : <WithdrawalForm key={auth.address} wallet={auth.address} />}
  </dialog>;
}

function WithdrawalForm({ wallet }: { wallet: string }) {
  const { getAccessToken, authorizeTrade } = useOrenAuth();
  const t = useT();
  const { snapshot, error: balanceError } = useFunding(wallet, getAccessToken);
  const refresh = usePortfolioRefresh();
  const [asset, setAsset] = useState<string>('USDC');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [approval, setApproval] = useState<TradeApproval>();
  const [stage, setStage] = useState<'loading' | 'recovery-error' | 'edit' | 'review' | 'pending' | 'confirmed' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownMessage>();
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lock = useRef(false);
  const mounted = useRef(true);
  const requestId = useRef<string | undefined>(undefined);
  const [stocks, setStocks] = useState<WithdrawalStock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(true);
  const [stocksError, setStocksError] = useState<ShownMessage>();
  const [stocksRevision, setStocksRevision] = useState(0);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const errorText = useShownMessage(error);
  const stocksErrorText = useShownMessage(stocksError);
  const stock = stocks.find(item => item.mint === asset);
  const symbol = stock?.symbol ?? asset;
  const logo = stock ? stockLogos[stock.ticker.toUpperCase() as keyof typeof stockLogos] ?? stock.logoUrl : asset === 'USDC' ? '/usdc.svg' : '/integrations/solana.svg';
  useEffect(() => {
    let active = true;
    const current = walletSessionIsCurrent();
    void getAccessToken().then(token => getWithdrawalStocks(wallet, token)).then(result => {
      if (!active || !current()) return;
      setStocks(result.stocks); setStocksLoading(false);
      setStocksError(result.incomplete ? shownKey("transfer.stocksIncomplete") : undefined);
    }).catch(() => {
      if (active && current()) { setStocksLoading(false); setStocksError(shownKey("transfer.stocksFailed")); }
    });
    return () => { active = false; };
  }, [wallet, getAccessToken, stocksRevision]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const current = walletSessionIsCurrent();
    void getAccessToken().then(token => recoverWithdrawal(wallet, token)).then(pending => {
      if (!active || !current()) return;
      if (pending) { setApproval(pending); setStage('pending'); }
      else setStage('edit');
    }).catch(() => {
      if (active && current()) { setStage('recovery-error'); setError(shownKey("transfer.recoveryFailed")); }
    });
    return () => { active = false; };
  }, [wallet, getAccessToken, recoveryRevision]);
  useEffect(() => {
    if (stage !== 'review') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  async function acceptStatus(result: TradeApproval) {
    if (result.kind !== 'withdrawal' || result.wallet !== wallet) throw new MessageKeyError("transfer.walletMismatch");
    setApproval(result);
    if (result.status === 'confirmed' || result.status === 'failed') {
      forgetApproval(result.id);
      setStage(result.status);
      if (result.status === 'confirmed') {
        setStocksLoading(true); setStocksRevision(value => value + 1);
        void refresh().catch(() => { /* Confirmation remains valid if the portfolio refresh is unavailable. */ });
      }
    } else setStage('pending');
  }

  // Poll only the existing approval. A lost response must never create a new transfer.
  useEffect(() => {
    if (stage !== 'pending' || !approval?.id) return;
    let stopped = false;
    const current = walletSessionIsCurrent();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const token = await getAccessToken();
        if (stopped || !current()) return;
        const result = await getServerApproval(approval!.id, token);
        if (stopped || !current()) return;
        if (result.status === 'confirmed' || result.status === 'failed') {
          await acceptStatus(result); return;
        }
        setApproval(result);
      } catch { /* Keep the pending state when confirmation is unavailable. */ }
      if (!stopped && current() && ++attempts < 30) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { stopped = true; clearTimeout(timer); };
    // State changes above deliberately do not restart the polling budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, approval?.id, getAccessToken]);

  function edited() { requestId.current = undefined; setError(undefined); }
  async function prepare(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    const currentSession = walletSessionIsCurrent();
    const current = () => mounted.current && currentSession();
    try {
      requestId.current ??= crypto.randomUUID();
      const token = await getAccessToken();
      if (!current()) return;
      if (asset !== 'USDC' && asset !== 'SOL' && !stock) throw new MessageKeyError("transfer.chooseStock");
      const kind = stock ? 'STOCK' : asset as 'USDC' | 'SOL';
      const result = await prepareWithdrawal({ wallet, recipient: recipient.trim(), amount: amount.trim(), asset: kind, ...(stock ? { mint: stock.mint } : {}), requestId: requestId.current }, token);
      if (!current()) return;
      if (result.wallet !== wallet || result.kind !== 'withdrawal' || result.details.asset !== kind || result.details.mint !== stock?.mint || result.details.recipient !== recipient.trim()) throw new MessageKeyError("transfer.reviewMismatch");
      setApproval(result); setChecked(false); setNow(currentTime());
      if (result.status === 'prepared') setStage('review');
      else await acceptStatus(result);
    } catch (cause) { if (current()) setError(shownFromUnknown(cause, "transfer.prepareFailed")); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }

  async function submit(checkOnly = false, retrySame = false) {
    if (!approval || lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    const currentSession = walletSessionIsCurrent();
    const current = () => mounted.current && currentSession();
    let submissionStarted = false;
    try {
      const token = await getAccessToken();
      if (!current()) return;
      if (checkOnly) {
        let result = await getServerApproval(approval.id, token);
        if (!current()) return;
        if (retrySame && result.status === 'signed') {
          submissionStarted = true;
          result = await approveServerTrade(approval.id, token, wallet);
        }
        if (current()) await acceptStatus(result);
        return;
      }
      if (!checked || Date.parse(approval.expiresAt) <= Date.now()) throw new MessageKeyError("transfer.reviewFresh");
      const signature = await authorizeTrade(approval.id, token);
      if (!current()) return;
      submissionStarted = true;
      const result = await approveServerTrade(approval.id, token, wallet, signature);
      if (current()) await acceptStatus(result);
    } catch (cause) {
      if (!current()) return;
      const rejected = !submissionStarted || cause instanceof ApiError && ([400, 401, 403, 404].includes(cause.status) || (cause.details as { code?: string })?.code === 'PRIVY_SIGNING_FAILED');
      if (submissionStarted && !rejected) {
        setStage('pending'); setError(shownKey("transfer.uncertain"));
      } else {
        if (submissionStarted) forgetApproval(approval.id);
        setError(shownFromUnknown(cause, "transfer.approveFailed"));
      }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }

  const expired = approval ? Date.parse(approval.expiresAt) <= now : false;
  const inputClass = 'w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-offset-2';
  return <div className="mt-6">
    {stage === 'loading' ? <p className="text-sm text-muted" role="status">{t("transfer.checkingPending")}</p> : stage === 'recovery-error' ? <Button className="w-full" onClick={() => { setStage('loading'); setError(undefined); setRecoveryRevision(value => value + 1); }}>{t("transfer.checkPending")}</Button> : stage === 'edit' ? <form onSubmit={event => void prepare(event)} className="space-y-5">
      <label className="block text-sm font-medium">{t("transfer.asset")}<span className="relative mt-2 block"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center"><AssetLogo key={asset} symbol={symbol} src={logo} /></span><select className={`${inputClass} mt-0 pl-12`} disabled={busy} value={asset} onChange={event => { edited(); setAsset(event.target.value); setAmount(''); }}><optgroup label={t("transfer.usdcSol")}><option value="USDC">USDC</option><option value="SOL">SOL</option></optgroup>{stocks.length > 0 ? <optgroup label={t("transfer.yourStocks")}>{stocks.map(item => <option key={item.mint} value={item.mint}>{item.symbol}</option>)}</optgroup> : null}</select></span></label>
      <p className="text-xs text-muted" role="status">{stock ? t("transfer.available", { amount: stock.balance, symbol: stock.symbol }) : snapshot ? t("transfer.available", { amount: asset === 'USDC' ? snapshot.usdc : snapshot.sol, symbol: asset }) : balanceError || t("transfer.loadingBalance")}</p>
      {stocksLoading ? <p className="text-xs text-muted" role="status">{t("transfer.loadingStocks")}</p> : stocksErrorText ? <div className="text-xs text-muted" role="status"><p>{stocksErrorText}</p><button type="button" className="mt-1 underline" disabled={busy} onClick={() => { setStocksLoading(true); setStocksRevision(value => value + 1); }}>{t("transfer.retryStocks")}</button></div> : stocks.length === 0 ? <p className="text-xs text-muted">{t("transfer.noStocks")}</p> : null}
      <label className="block text-sm font-medium">{t("transfer.receivingWallet")}<input className={`${inputClass} mt-2`} disabled={busy} required autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={32} maxLength={44} placeholder={t("transfer.walletPlaceholder")} value={recipient} onChange={event => { edited(); setRecipient(event.target.value); }} /></label>
      <label className="block text-sm font-medium">{t("transfer.amount")}<span className="relative mt-2 block"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center"><AssetLogo key={asset} symbol={symbol} src={logo} /></span><input className={`${inputClass} mt-0 pl-12 pr-20`} disabled={busy} required inputMode="decimal" autoComplete="off" maxLength={30} placeholder="0.00" value={amount} onChange={event => { edited(); setAmount(event.target.value); }} /><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex max-w-16 items-center truncate text-xs text-muted">{symbol}</span></span></label>
      {stock ? <p className="text-xs leading-5 text-muted">{t("transfer.stockNote", { symbol: stock.symbol })}</p> : null}
      <p className="text-xs leading-5 text-muted">{t(asset !== 'SOL' ? "transfer.feeNoteAccount" : "transfer.feeNote", { symbol })}</p>
      <Button className="w-full" variant="primary" disabled={busy} type="submit">{busy ? t("transfer.preparing") : t("transfer.review")}</Button>
    </form> : approval ? <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-xs text-muted">{stage === 'confirmed' ? t("transfer.sent") : t("transfer.youSend")}</p><p className="mt-1 text-2xl font-semibold">{approval.details.amount} {approval.details.symbol ?? approval.details.asset}</p>
        {approval.details.requestedAmount && approval.details.requestedAmount !== approval.details.amount ? <p className="mt-2 text-xs leading-5 text-muted">{t("transfer.rounded", { requested: approval.details.requestedAmount })}</p> : null}
        <dl className="mt-4 space-y-3 text-sm">
          {approval.details.mint ? <><div><dt className="text-muted">{t("transfer.stockToken")}{approval.details.issuer ? ` · ${approval.details.issuer}` : ''}</dt><dd className="mt-1 text-sm">{approval.details.name}</dd><dd className="mt-1 select-all break-all font-mono text-xs leading-5">{approval.details.mint}</dd></div></> : null}
          <div><dt className="text-muted">{t("transfer.to")}</dt><dd className="mt-1 select-all break-all font-mono text-xs leading-5">{approval.details.recipient}</dd></div>
          <div><dt className="text-muted">{t("transfer.from")}</dt><dd className="mt-1 break-all font-mono text-xs leading-5">{wallet}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("transfer.network")}</dt><dd>Solana</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("transfer.networkFee")}</dt><dd>{solCost(approval.feeLamports)} SOL</dd></div>
          {approval.details.rentLamports !== '0' && approval.details.rentLamports ? <div className="flex justify-between gap-3"><dt className="text-muted">{t("transfer.accountCost")}</dt><dd>{solCost(approval.details.rentLamports)} SOL</dd></div> : null}
        </dl>
      </div>
      {stage === 'review' ? <>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />{t("transfer.confirmCheck")}</label>
        {expired ? <p role="status" className="text-sm text-muted">{t("transfer.expired")}</p> : null}
        <Button className="w-full" variant="primary" disabled={busy || !checked || expired} onClick={() => void submit()}>{busy ? t("transfer.approving") : t("transfer.confirm")}</Button>
        <Button className="w-full" disabled={busy} onClick={() => { requestId.current = undefined; setApproval(undefined); setStage('edit'); setError(undefined); }}>{t("transfer.edit")}</Button>
      </> : <>
        <p role="status" className="text-sm leading-6">{stage === 'confirmed' ? t("transfer.confirmed") : stage === 'failed' ? t("transfer.failed") : approval.status === 'prepared' ? t("transfer.processing") : t("transfer.awaiting")}</p>
        {approval.signature ? <a className="block text-sm underline" target="_blank" rel="noopener noreferrer" href={`https://solscan.io/tx/${encodeURIComponent(approval.signature)}`}>{t("transfer.viewTx")}</a> : null}
        {stage === 'pending' ? <>
          <Button className="w-full" disabled={busy} onClick={() => void submit(true)}>{busy ? t("transfer.checking") : t("transfer.checkStatus")}</Button>
          {approval.status === 'signed' ? <Button className="w-full" disabled={busy} onClick={() => void submit(true, true)}>{t("transfer.retrySame")}</Button> : null}
        </> : <Button className="w-full" onClick={() => { requestId.current = undefined; setApproval(undefined); setAmount(''); setChecked(false); setError(undefined); setStage('edit'); }}>{t("transfer.newTransfer")}</Button>}
      </>}
    </div> : null}
    {errorText ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{errorText}</p> : null}
  </div>;
}
