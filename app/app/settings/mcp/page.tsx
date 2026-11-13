import { redirect } from "next/navigation";
import { mcpEnrollmentLinks } from "@/services/mcp-enrollment-flow";

export default async function McpConnectionsPage({ searchParams }: {
  searchParams: Promise<{ connection?: string | string[] }>;
}) {
  const { connection } = await searchParams;
  redirect(mcpEnrollmentLinks(connection).settings);
}
