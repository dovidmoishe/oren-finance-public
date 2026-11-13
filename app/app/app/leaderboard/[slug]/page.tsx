import { AppShell } from "@/components/shell";
import { TraderProfile } from "@/components/social";

export default async function TraderProfilePage({ params }: PageProps<"/app/leaderboard/[slug]">) {
  const { slug } = await params;

  return (
    <AppShell>
      <TraderProfile slug={slug} />
    </AppShell>
  );
}
