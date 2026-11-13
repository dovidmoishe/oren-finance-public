import { TradingCalendar } from "@/components/calendar";
import { AppShell } from "@/components/shell";

export default function CalendarPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-[1540px] pb-20">
        <TradingCalendar />
      </div>
    </AppShell>
  );
}
