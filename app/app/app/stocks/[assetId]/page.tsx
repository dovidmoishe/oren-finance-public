import { AppShell } from "@/components/shell";
import { StockDetail } from "@/components/stock";

export default async function StockPage({ params }: PageProps<"/app/stocks/[assetId]">) {
  const { assetId } = await params;

  return (
    <AppShell>
      <StockDetail assetId={assetId} />
    </AppShell>
  );
}
