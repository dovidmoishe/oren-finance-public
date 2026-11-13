import { AppShell } from '@/components/shell';
import { BrowserTradeReview } from './trade-review';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><BrowserTradeReview intentId={id} /></AppShell>;
}
