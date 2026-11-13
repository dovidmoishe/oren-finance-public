"use client";

import { Captcha, useLoginWithEmail } from "@privy-io/react-auth";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "@/i18n/i18n";
import { signInErrorKey, type SignInErrorKey } from "./sign-in-error";

/** The enclosing dialog owns visibility; Privy owns OTP delivery and verification. */
export function EmailLogin({ onComplete }: { onComplete: () => void }) {
  const t = useT();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInErrorKey>();
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await sendCode({ email: email.trim() });
      if (!mounted.current) return;
      setStep("code");
      setCode("");
    } catch (cause) {
      if (!mounted.current) return;
      setError(signInErrorKey(cause, "send"));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await loginWithCode({ code: code.trim() });
      if (mounted.current) onComplete();
    } catch (cause) {
      if (!mounted.current) return;
      setError(signInErrorKey(cause, "verify"));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={step === "email" ? requestCode : verifyCode}>
      <Captcha />
      <div>
        <h2 className="text-xl font-semibold">{step === "email" ? t("auth.title") : t("auth.codeTitle")}</h2>
        <p className="mt-1 text-sm text-muted">
          {step === "email" ? t("auth.subtitle") : t("auth.codeSent", { email })}
        </p>
      </div>
      {step === "email" ? (
        <label className="block text-sm font-medium">
          {t("auth.emailLabel")}
          <input
            aria-label={t("auth.emailLabel")}
            autoComplete="email"
            autoFocus
            className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground"
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            required
            type="email"
            value={email}
          />
        </label>
      ) : (
        <label className="block text-sm font-medium">
          {t("auth.codeLabel")}
          <input
            aria-label={t("auth.codeLabel")}
            autoComplete="one-time-code"
            autoFocus
            className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground"
            inputMode="numeric"
            onChange={(event) => setCode(event.target.value)}
            placeholder={t("auth.codePlaceholder")}
            required
            value={code}
          />
        </label>
      )}
      {error ? <p className="text-sm text-red-700" role="alert">{t(error)}</p> : null}
      <button className="w-full rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-white disabled:opacity-50" disabled={busy} type="submit">
        {busy ? t("auth.waiting") : step === "email" ? t("auth.continue") : t("auth.verify")}
      </button>
      {step === "code" ? (
        <div className="flex justify-between text-sm">
          <button disabled={busy} onClick={() => { setStep("email"); setError(undefined); }} type="button">{t("auth.changeEmail")}</button>
          <button disabled={busy} onClick={() => void requestCode()} type="button">{t("auth.resend")}</button>
        </div>
      ) : null}
    </form>
  );
}
