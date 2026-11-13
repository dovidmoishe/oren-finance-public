import { VaultDashboard } from "@/components/vault";
import { AppShell } from "@/components/shell";

export default function VaultPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1540px] pb-20">
        <VaultDashboard />
      </div>
    </AppShell>
  );
}
