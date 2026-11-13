import { PortfolioDashboard } from "@/components/portfolio";
import { AppShell } from "@/components/shell";

export default function AppHome() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1540px] pb-20">
        <PortfolioDashboard />
      </div>
    </AppShell>
  );
}
