"use client";
import { Cancel01Icon, Tick02Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";
import { useFunding } from "@/hooks/use-funding";
import { useT } from "@/i18n/i18n";

export function DepositModal() {
  const auth = useOrenAuth();
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!auth.depositOpen || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [auth.depositOpen]);
  return <dialog aria-labelledby="deposit-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-2xl sm:p-6" onCancel={auth.closeDeposit} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) auth.closeDeposit();
  }} ref={dialog}>
    <div className="flex items-center justify-between gap-4"><h2 className="font-display text-xl font-semibold" id="deposit-title">{t("deposit.title")}</h2><button aria-label={t("deposit.close")} className="grid h-8 w-8 place-items-center rounded-full text-xl text-muted hover:bg-background" onClick={auth.closeDeposit} type="button"><HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></button></div>
    {auth.depositOpen && <div className="mt-5">
      {!auth.authenticated ? <div><p className="text-sm text-muted">{t("deposit.signInPrompt")}</p><Button className="mt-4" onClick={() => { auth.closeDeposit(); auth.open(); }}>{t("deposit.signIn")}</Button></div>
        : !auth.address ? <div role="status"><p className="text-sm text-muted">{auth.error ? t("deposit.walletMoment") : t("deposit.preparingWallet")}</p>{auth.error && <><p className="mt-2 text-sm text-red-700" role="alert">{auth.error}</p><Button className="mt-4" disabled={auth.busy} onClick={() => void auth.createWallet()}>{t("deposit.retryWallet")}</Button></>}</div>
        : <DepositAddress key={auth.address} wallet={auth.address} getAccessToken={auth.getAccessToken} />}
    </div>}
  </dialog>;
}

function DepositAddress({ wallet, getAccessToken }: { wallet: string; getAccessToken: () => Promise<string | null> }) {
  // Funding events only live for this open modal. Balances/reconnection controls are intentionally absent.
  const { received } = useFunding(wallet, getAccessToken);
  const t = useT();
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(wallet, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then((value) => {
      if (!cancelled) setQr(value);
    }).catch(() => { /* The selectable address remains available. */ });
    return () => { cancelled = true; };
  }, [wallet]);
  return <>
    <p className="text-sm leading-6 text-muted">{t("deposit.intro")}</p>
    <div className="mx-auto my-4 flex h-48 w-48 items-center justify-center rounded-2xl border border-border bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr ? <img alt={t("deposit.qrAlt")} className="h-44 w-44" height={176} width={176} src={qr} /> : <span className="text-sm text-muted">{t("deposit.preparingQr")}</span>}
    </div>
    <p className="text-xs font-semibold text-muted">{t("deposit.addressLabel")}</p>
    <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-background p-3">
    <code className="min-w-0 flex-1 select-all break-all text-xs leading-5">{wallet}</code>
    <Button aria-label={copied ? t("deposit.copied") : t("deposit.copy")} className="h-9 w-9 shrink-0" size="icon" variant="ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(wallet); setCopied(true); setCopyError(false); }
      catch { setCopyError(true); }
    }}>
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={18} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />
    </Button>
    </div>
    <span aria-live="polite" className="sr-only">{copied ? t("deposit.copied") : ""}</span>
    {copyError && <p className="mt-2 text-xs text-muted" role="status">{t("deposit.copyManually")}</p>}
    <p className="mt-4 text-xs leading-5 text-muted">{t("deposit.warning")}</p>
    {received && <p className="mt-4 text-sm font-medium text-emerald-700" role="status">{t("deposit.received")}</p>}
  </>;
}
