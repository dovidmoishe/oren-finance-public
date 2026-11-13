import Link from "next/link";
import { mcpEnrollmentLinks } from "@/services/mcp-enrollment-flow";

export function ConnectionNextStep({ uid }: { uid?: string }) {
  const { connection } = mcpEnrollmentLinks(uid);
  return <div className="mt-5 rounded-2xl border border-border p-5">
    <h3 className="font-medium">Finish connecting your agent</h3>
    <p className="mt-2 text-sm text-muted">Your trading permission is active. Your agent still needs your approval to use it.</p>
    {connection ? <Link className={`trade-grant-primary mt-4 inline-flex`} href={connection}>Continue connection</Link>
      : <p className="mt-3 text-sm">Return to Claude, Cursor or Codex and connect Oren to approve access within these limits.</p>}
  </div>;
}
