import { McpConnect } from './mcp-connect';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string }>;
}) {
  const { uid } = await searchParams;
  return <McpConnect uid={uid ?? ''} />;
}
