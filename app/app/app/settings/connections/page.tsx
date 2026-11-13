import type { Metadata } from "next";
import { mcpEnrollmentLinks } from "@/services/mcp-enrollment-flow";
import { AppShell } from "@/components/shell";
import { AgentConnections } from "@/components/settings/agent-connections";

export const metadata: Metadata = { title: "Agent connections | Oren" };

export default async function ConnectionsPage({ searchParams }: {
  searchParams: Promise<{ connection?: string | string[] }>;
}) {
  const { connection } = await searchParams;
  const connectionUid = mcpEnrollmentLinks(connection).connection ? connection as string : undefined;
  return <AppShell><AgentConnections connectionUid={connectionUid} /></AppShell>;
}
