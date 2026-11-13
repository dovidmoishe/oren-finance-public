export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', service: 'oren-docs', commitSha: process.env.DOCS_RELEASE_SHA ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
