'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { Button, formatDate } from '@/components/ui';
import { listFeedback, submitFeedback } from '@/services/feedback-service';
import type { FeedbackKind, FeedbackTicket } from '@/types';
import { FEEDBACK_KIND_LABELS, FEEDBACK_MESSAGE_MAX, FEEDBACK_SUBJECT_MAX, feedbackError, ticketReference } from './feedback-rules';
import { useI18n, useT, type MessageKey } from "@/i18n/i18n";

const KIND_KEYS: Record<FeedbackKind, MessageKey> = { feedback: 'feedback.kindFeedback', bug: 'feedback.kindBug', support: 'feedback.kindSupport' };

// feedbackError mirrors the API in English; show the same check in the reader's language.
const ERROR_KEYS: Record<string, MessageKey> = {
  'Add a short subject.': 'feedback.addSubject',
  [`Keep the subject under ${FEEDBACK_SUBJECT_MAX} characters.`]: 'feedback.subjectTooLong',
  'Tell us a bit more in the message.': 'feedback.addMessage',
  [`Keep the message under ${FEEDBACK_MESSAGE_MAX} characters.`]: 'feedback.messageTooLong',
};

const inputClass = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-offset-2 focus-visible:outline-2';

export function FeedbackModal({ onClose }: { onClose: () => void }) {
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
  return <dialog ref={dialog} aria-labelledby="feedback-title" className="oren-deposit-modal m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-panel p-5 text-foreground shadow-2xl sm:p-6" onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <div className="flex items-center justify-between gap-4"><h2 id="feedback-title" className="font-display text-xl font-semibold">{t("feedback.title")}</h2><button aria-label={t("feedback.close")} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-background" type="button" onClick={onClose}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" /></button></div>
    <p className="mt-2 text-sm leading-6 text-muted">{t("feedback.intro")}</p>
    {!auth.ready ? <p className="mt-6 text-sm" role="status">{t("feedback.loadingAccount")}</p>
      : !auth.authenticated ? <Button className="mt-6" onClick={auth.open}>{t("feedback.signIn")}</Button>
      : !auth.address ? <p className="mt-6 text-sm" role="status">{t("feedback.walletPreparing")}</p>
      : <FeedbackForm key={auth.address} wallet={auth.address} />}
  </dialog>;
}

function FeedbackForm({ wallet }: { wallet: string }) {
  const { getAccessToken } = useOrenAuth();
  const pathname = usePathname();
  const { locale, timeZone, t } = useI18n();
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<FeedbackTicket>();
  const [tickets, setTickets] = useState<FeedbackTicket[]>();

  useEffect(() => {
    let active = true;
    void getAccessToken().then(token => token ? listFeedback(wallet, token) : []).then(result => { if (active) setTickets(result); }).catch(() => { if (active) setTickets([]); });
    return () => { active = false; };
  }, [getAccessToken, wallet]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const problem = feedbackError(subject, message);
    if (problem) { const key = ERROR_KEYS[problem]; setError(key ? t(key, { max: key === 'feedback.subjectTooLong' ? FEEDBACK_SUBJECT_MAX : FEEDBACK_MESSAGE_MAX }) : problem); return; }
    setBusy(true); setError(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("feedback.signInAgain"));
      const ticket = await submitFeedback({ kind, subject: subject.trim(), message: message.trim(), page: pathname || undefined }, wallet, token);
      setSent(ticket);
      setTickets(current => [ticket, ...(current ?? [])]);
      setSubject(''); setMessage('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("feedback.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-6">
    {sent ? <div className="rounded-2xl border border-border bg-background p-4" role="status">
      <p className="text-sm font-semibold">{t("feedback.thanks")}</p>
      <p className="mt-1 text-sm leading-6 text-muted">{t("feedback.reference", { reference: ticketReference(sent.id) })}</p>
      <Button className="mt-4 w-full" onClick={() => setSent(undefined)}>{t("feedback.sendAnother")}</Button>
    </div> : <form className="space-y-4" onSubmit={send} noValidate>
      <fieldset>
        <legend className="text-sm font-medium">{t("feedback.about")}</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.keys(FEEDBACK_KIND_LABELS) as FeedbackKind[]).map(option => <label key={option} className={`cursor-pointer rounded-xl border px-2 py-2 text-center text-xs font-medium ${kind === option ? 'border-foreground bg-background' : 'border-border'}`}>
            <input className="sr-only" type="radio" name="feedback-kind" value={option} checked={kind === option} onChange={() => setKind(option)} />
            {t(KIND_KEYS[option])}
          </label>)}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">{t("feedback.subject")}<input className={`${inputClass} mt-2`} disabled={busy} maxLength={FEEDBACK_SUBJECT_MAX} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label className="block text-sm font-medium">{t("feedback.message")}<textarea className={`${inputClass} mt-2 min-h-32 resize-y`} disabled={busy} maxLength={FEEDBACK_MESSAGE_MAX} value={message} onChange={event => setMessage(event.target.value)} placeholder={kind === 'bug' ? t("feedback.bugPlaceholder") : undefined} /></label>
      <p className="text-xs leading-5 text-muted">{t("feedback.safety")}</p>
      {error ? <p role="alert" className="text-sm leading-6 text-red-700">{error}</p> : null}
      <Button className="w-full" variant="primary" disabled={busy} type="submit">{busy ? t("feedback.sending") : t("feedback.send")}</Button>
    </form>}
    <section className="mt-6 border-t border-border pt-4" aria-labelledby="feedback-history">
      <h3 id="feedback-history" className="text-sm font-semibold">{t("feedback.history")}</h3>
      {tickets === undefined ? <p className="mt-2 text-sm text-muted" role="status">{t("feedback.loading")}</p>
        : tickets.length === 0 ? <p className="mt-2 text-sm text-muted">{t("feedback.nothingSent")}</p>
        : <ul className="mt-2 divide-y divide-border">
          {tickets.map(ticket => <li key={ticket.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0"><p className="truncate font-medium">{ticket.subject}</p><p className="text-xs text-muted">{ticketReference(ticket.id)} · {formatDate(ticket.createdAt, locale, timeZone, t("common.notUpdated"))}</p></div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${ticket.status === 'resolved' ? 'bg-green-50 text-green-800' : 'bg-background text-muted'}`}>{ticket.status === 'resolved' ? t("feedback.resolved") : t("feedback.open")}</span>
          </li>)}
        </ul>}
    </section>
  </div>;
}
