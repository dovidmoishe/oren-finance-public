"use client";

import { useEffect, useState } from "react";
import { ArrowLeft01Icon, ArrowUpRight01Icon, Link01Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useOrenAuth } from "@/components/auth/auth-context";
import { Button, formatDate } from "@/components/ui";
import { mcpApiOrigin } from "@/services/mcp-api-origin";
import { AgentClientLogo, agentClient } from "@/components/brand/agent-client";
import { TradeGrant } from "@/app/settings/mcp/trade-grant";
import { useI18n, type MessageKey } from "@/i18n/i18n";

type Connection = { clientKind?: string | null; nativeClient?: boolean; grantId: string; clientId: string; wallet: string; scopes: string; createdAt: string };

type Access = "chat" | "browser" | "read";

function accessLevel(scopes: string): Access {
  const permissions = scopes.split(/\s+/);
  if (permissions.includes("oren.trade.execute")) return "chat";
  if (permissions.includes("oren.trade.prepare")) return "browser";
  return "read";
}

const ACCESS_LABEL: Record<Access, MessageKey> = { chat: "connections.chatTrading", browser: "connections.browserReview", read: "connections.readOnly" };
const ACCESS_NOTE: Record<Access, MessageKey> = { chat: "connections.chatTradingNote", browser: "connections.browserReviewNote", read: "connections.readOnlyNote" };

export function AgentConnections({ connectionUid }: { connectionUid?: string } = {}) {
  const auth = useOrenAuth();
  return <ConnectionsContent connectionUid={connectionUid} key={`${auth.ready}:${auth.authenticated}:${auth.email ?? ""}:${auth.address ?? ""}`} />;
}

function ConnectionsContent({ connectionUid }: { connectionUid?: string }) {
  const { authenticated, configured, ready, getAccessToken, open, email } = useOrenAuth();
  const [result, setResult] = useState<{ connections: Connection[]; error?: string; loading: boolean }>({ connections: [], loading: true });
  const [busy, setBusy] = useState<string>();
  const [revokeError, setRevokeError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const apiOrigin = mcpApiOrigin();
  const { locale, timeZone, t } = useI18n();

  useEffect(() => {
    if (!ready || !authenticated || !apiOrigin) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;
        if (!token) throw new Error(t("connections.signInAgain"));
        const response = await fetch(`${apiOrigin}/oauth/connections`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(t("connections.loadFailed"));
        const connections = await response.json() as Connection[];
        if (!controller.signal.aborted) setResult({ connections, loading: false });
      } catch (cause) {
        if (!controller.signal.aborted) setResult({ connections: [], loading: false, error: cause instanceof Error ? cause.message : t("connections.loadFailedShort") });
      }
    })();
    return () => controller.abort();
    // `t` only labels errors; a language change must not refetch connections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, apiOrigin, getAccessToken, attempt]);

  async function revoke(grantId: string) {
    if (!apiOrigin || busy) return;
    setBusy(grantId);
    setRevokeError(undefined);
    setNotice(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error(t("connections.signInRevoke"));
      const response = await fetch(`${apiOrigin}/oauth/connections/${encodeURIComponent(grantId)}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(t("connections.revokeFailed"));
      setResult(current => ({ ...current, connections: current.connections.filter(item => item.grantId !== grantId) }));
      setNotice(t("connections.revoked"));
    } catch (cause) {
      setRevokeError(cause instanceof Error ? cause.message : t("connections.revokeFailedShort"));
    } finally { setBusy(undefined); }
  }

  return (
    <div className="mx-auto max-w-4xl pb-16 pt-3 sm:pt-7">
      <Link href="/app" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"><HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" /> {t("connections.back")}</Link>
      <div className="mb-8 mt-7 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("connections.title")}</h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">{t("connections.intro")}</p>
        </div>
        <Button href="/agents" size="sm">{t("connections.connect")} <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} aria-hidden="true" /></Button>
      </div>
      {!ready ? (
        <div className="rounded-2xl border border-border bg-panel p-8 text-sm text-muted" role="status">{t("connections.loadingAccount")}</div>
      ) : !authenticated ? (
        <section className="rounded-2xl border border-border bg-panel px-6 py-10 sm:px-10">
          <HugeiconsIcon icon={Shield01Icon} size={28} className="text-muted" aria-hidden="true" />
          <h2 className="mt-5 text-xl font-semibold">{t("connections.controlTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{t("connections.controlBody")}</p>
          <Button className="mt-6" variant="primary" onClick={open} disabled={!configured}>{t("connections.signIn")}</Button>
          {!configured && <p className="mt-3 text-sm text-muted">{t("connections.signInUnavailable")}</p>}
        </section>
      ) : (
        <>
          <TradeGrant connectionUid={connectionUid} />
          <section aria-labelledby="connected-apps-heading" className="mt-8 overflow-hidden rounded-2xl border border-border bg-panel">
            <div className="border-b border-border px-5 py-5 sm:px-6">
              <div className="flex items-center gap-2.5"><h2 id="connected-apps-heading" className="text-lg font-semibold">{t("connections.connectedApps")}</h2>{!result.loading && !result.error && apiOrigin && <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">{result.connections.length}</span>}</div>
              <p className="mt-1 text-sm text-muted">{email ? t("connections.connectionsFor", { email }) : t("connections.appsWithAccess")} {t("connections.revokeAnytime")}</p>
            </div>
            {!apiOrigin ? <p className="p-6 text-sm text-muted" role="status">{t("connections.unavailable")}</p> : result.loading ? <p className="p-6 text-sm text-muted" role="status">{t("connections.loading")}</p> : result.error ? (
              <div className="p-6"><p className="text-sm text-red-700" role="alert">{result.error}</p><Button className="mt-4" size="sm" onClick={() => { setResult({ connections: [], loading: true }); setAttempt(current => current + 1); }}>{t("connections.tryAgain")}</Button></div>
            ) : result.connections.length === 0 ? (
              <div className="px-6 py-10 text-center sm:py-14">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-background text-muted"><HugeiconsIcon icon={Link01Icon} size={24} aria-hidden="true" /></span>
                <h3 className="mt-4 text-base font-semibold">{t("connections.firstTitle")}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{t("connections.firstBody")}</p>
                <Button href="/agents" className="mt-5" size="sm">{t("connections.setupGuide")} <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} aria-hidden="true" /></Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {result.connections.map((connection, index) => (
                  <li key={connection.grantId} className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-white"><AgentClientLogo kind={connection.clientKind} size={24} /></span><div className="min-w-0"><h3 className="font-semibold">{agentClient(connection.clientKind)?.name ?? t("connections.connectionN", { n: index + 1 })}</h3><p className="mt-1 text-xs text-muted">{t("connections.connectedOn", { date: formatDate(connection.createdAt, locale, timeZone, t("common.notUpdated")) })}</p></div></div>
                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">{t(ACCESS_LABEL[accessLevel(connection.scopes)])}</span>
                    </div>
                    {connection.nativeClient && <p className="mt-3 text-xs text-muted">{t("connections.localNote")}</p>}
                    <p className="mt-4 text-sm text-muted">{t(ACCESS_NOTE[accessLevel(connection.scopes)])}</p>
                    <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                      <details className="min-w-0 flex-1 text-xs text-muted"><summary className="w-fit cursor-pointer rounded py-2 font-medium focus-visible:outline-2">{t("connections.details")}</summary><dl className="mt-2 grid gap-2 rounded-xl bg-background p-3"><div><dt className="font-medium text-foreground">{t("connections.clientId")}</dt><dd className="mt-1 break-all">{connection.clientId}</dd></div><div><dt className="font-medium text-foreground">{t("connections.grantId")}</dt><dd className="mt-1 break-all">{connection.grantId}</dd></div><div><dt className="font-medium text-foreground">{t("connections.wallet")}</dt><dd className="mt-1 break-all">{connection.wallet}</dd></div><div><dt className="font-medium text-foreground">{t("connections.permissions")}</dt><dd className="mt-1 break-all">{connection.scopes}</dd></div></dl></details>
                      <Button size="sm" disabled={!!busy} aria-label={t("connections.revokeAria", { name: agentClient(connection.clientKind)?.name ?? t("connections.agent"), n: index + 1 })} onClick={() => void revoke(connection.grantId)}>{busy === connection.grantId ? t("connections.revoking") : t("connections.revoke")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {revokeError && <p className="mt-4 text-sm text-red-700" role="alert">{revokeError}</p>}
          {notice && <p className="mt-4 text-sm" role="status">{notice}</p>}
          <p className="mt-5 flex items-start gap-2 px-1 text-xs leading-relaxed text-muted"><HugeiconsIcon icon={Shield01Icon} className="mt-0.5 shrink-0" size={15} aria-hidden="true" />{t("connections.separateNote")}</p>
        </>
      )}
    </div>
  );
}
