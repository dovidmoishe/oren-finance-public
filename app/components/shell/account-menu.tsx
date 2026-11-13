"use client";
import { ArrowDownLeft01Icon, ArrowUpRight01Icon, CustomerSupportIcon, Link01Icon, Logout01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import { useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/i18n";

const WithdrawalModal = dynamic(() => import('@/components/portfolio/withdrawal-modal').then(mod => mod.WithdrawalModal), { ssr: false });
const FeedbackModal = dynamic(() => import('@/components/feedback/feedback-modal').then(mod => mod.FeedbackModal), { ssr: false });

export function AccountMenu() {
  const auth = useOrenAuth();
  const t = useT();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  if (!auth.configured) return <span className="text-xs text-muted">{t("account.signInUnavailable")}</span>;
  if (!auth.ready) return <span className="text-xs text-muted" role="status">{t("account.loading")}</span>;
  if (!auth.authenticated) return <Button onClick={auth.open} size="sm">{t("account.signIn")}</Button>;
  const initial = (auth.email?.[0] || "U").toUpperCase();
  const close = () => menu.current?.hidePopover();
  return <>
    <button aria-label={t("account.openMenu")} className="grid h-[var(--app-control-icon,2.75rem)] w-[var(--app-control-icon,2.75rem)] place-items-center rounded-full bg-[#6860f5] text-base font-semibold text-white outline-offset-4 focus-visible:outline-2" popoverTarget={id} type="button">
      {initial}
    </button>
    <div className="oren-account-menu" id={id} popover="auto" ref={menu}>
      <div className="oren-account-menu-surface w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-border bg-panel p-0 text-foreground shadow-xl">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#6860f5] font-semibold text-white">{initial}</span>
        <div className="min-w-0"><p className="font-semibold">{t("account.yourAccount")}</p><p className="mt-1 truncate text-sm text-muted">{auth.email || t("account.signedIn")}</p></div>
      </div>
      <div aria-label={t("account.actions")} className="p-2">
        <Link className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-background focus-visible:outline-2" href="/app/settings/connections" onClick={close}><HugeiconsIcon icon={Link01Icon} size={20} strokeWidth={1.5} aria-hidden="true" /> {t("account.agentConnections")}</Link>
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-background focus-visible:outline-2" type="button" onClick={() => { close(); setWithdrawOpen(true); }}><HugeiconsIcon icon={ArrowUpRight01Icon} size={20} strokeWidth={1.5} aria-hidden="true" /> {t("account.transfer")}</button>
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-background focus-visible:outline-2" onClick={() => { close(); auth.openDeposit(); }} type="button"><HugeiconsIcon icon={ArrowDownLeft01Icon} size={20} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> {t("account.deposit")}</button>
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-background focus-visible:outline-2" onClick={() => { close(); setFeedbackOpen(true); }} type="button"><HugeiconsIcon icon={CustomerSupportIcon} size={20} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> {t("account.helpFeedback")}</button>
      </div>
      <div className="border-t border-border p-2">
        <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => { close(); setWithdrawOpen(false); void auth.signOut(); }} type="button"><HugeiconsIcon icon={Logout01Icon} size={20} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> {t("account.signOut")}</button>
      </div>
      {auth.error && <p className="px-5 pb-4 text-xs text-red-700" role="alert">{auth.error}</p>}
      </div>
    </div>
    {withdrawOpen && <WithdrawalModal key={auth.address} onClose={() => setWithdrawOpen(false)} />}
    {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
  </>;
}
