import { docsLlms } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const index = await docsLlms.index();
  return new Response(index.replaceAll('](/', '](https://docs.oren.finance/'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
