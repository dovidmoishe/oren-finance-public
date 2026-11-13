"use client";

import { useEffect, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { mcpApiOrigin } from "@/services/mcp-api-origin";
import { TradeGrant } from "./trade-grant";
import { useI18n } from "@/i18n/i18n";
import { formatDate } from "@/components/ui";

type Connection = {
  grantId: string;
  clientId: string;
  wallet: string;
  scopes: string;
  createdAt: string;
};

export function McpConnections({ connectionUid }: { connectionUid?: string }) {
  const auth = useOrenAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const apiOrigin = mcpApiOrigin();
  const { authenticated, ready, getAccessToken, open } = auth;
  const { locale, timeZone, t } = useI18n();

  useEffect(() => {
    if (!ready || !authenticated || !apiOrigin) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Sign in again to manage connections.");
        const response = await fetch(`${apiOrigin}/oauth/connections`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unable to load connections.");
        const rows = (await response.json()) as Connection[];
        if (!cancelled) setConnections(rows);
      } catch (cause) {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load connections.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, apiOrigin, getAccessToken]);

  async function revoke(grantId: string) {
    if (!apiOrigin) return;
    setBusy(grantId);
    setError(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to revoke this connection.");
      const response = await fetch(
        `${apiOrigin}/oauth/connections/${encodeURIComponent(grantId)}/revoke`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok)
        throw new Error("Unable to revoke this connection. Try again.");
      setConnections((current) =>
        current.filter((item) => item.grantId !== grantId),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to revoke this connection.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-16 text-foreground">
      <h1 className="text-3xl font-semibold">Agent connections</h1>
      <p className="mt-3 text-muted">
        Review and revoke access you gave to agent clients.
      </p>
      {!authenticated && (
        <button
          className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white"
          onClick={open}
          type="button"
        >
          Sign in with email code
        </button>
      )}
      {error && (
        <p className="mt-5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {authenticated && connections.length === 0 && !error && (
        <p className="mt-8 text-muted">No active agent connections.</p>
      )}
      <ul className="mt-8 space-y-4">
        {connections.map((connection) => (
          <li
            className="rounded-2xl border border-border bg-panel p-5"
            key={connection.grantId}
          >
            <p className="break-all font-medium">{connection.clientId}</p>
            <p className="mt-2 break-all text-sm text-muted">
              Wallet: {connection.wallet}
            </p>
            <p className="mt-1 text-sm text-muted">
              Connected {formatDate(connection.createdAt, locale, timeZone, t("common.notUpdated"))}
            </p>
            <p className="mt-2 text-sm">
              {connection.scopes.includes("oren.trade.execute")
                ? "Executes trades within your active limits"
                : connection.scopes.includes("oren.trade.prepare")
                  ? "Read and prepare buys and sells for browser review"
                  : "Read access only"}
            </p>
            <button
              className="mt-4 rounded-xl border border-border px-4 py-2 disabled:opacity-50"
              disabled={busy === connection.grantId}
              onClick={() => void revoke(connection.grantId)}
              type="button"
            >
              {busy === connection.grantId ? "Revoking…" : "Revoke access"}
            </button>
          </li>
        ))}
      </ul>
      {connectionUid && <p className="mt-6 text-sm">Set your trading limits below. Once permission is active, continue your pending agent connection.</p>}
      <TradeGrant connectionUid={connectionUid} />
    </main>
  );
}
