"use client";

import {
  Home01Icon,
  MarketAnalysisIcon,
  RankingIcon,
  SafeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrenLogo } from "@/components/brand/oren-logo";
import { AccountMenu } from "./account-menu";
import { LanguageMenu } from "@/components/language/language-menu";
import { useT, type MessageKey } from "@/i18n/i18n";
import { PendingApprovalNotice } from "@/components/trading/pending-approval-notice";
import { Button, cn } from "@/components/ui";
import { useAgentStore } from "@/store";

// Neither is part of the first paint: the agent panel starts hidden until its
// store hydrates, and the deposit dialog (with its QR encoder) opens on request.
const AgentPanel = dynamic(() => import("@/components/agent/agent-panel").then((mod) => mod.AgentPanel), { ssr: false });
const DepositModal = dynamic(() => import("@/components/portfolio/deposit-dashboard").then((mod) => mod.DepositModal), { ssr: false });

const navItems: Array<{ href: string; label: MessageKey; icon: IconSvgElement }> = [
  { href: "/app", label: "nav.dashboard", icon: Home01Icon },
  { href: "/app/markets", label: "nav.market", icon: MarketAnalysisIcon },
  { href: "/app/leaderboard", label: "nav.leaderboard", icon: RankingIcon },
  { href: "/app/vault", label: "nav.vault", icon: SafeIcon },
];

function Icon({ icon, className, size = 18 }: { icon: IconSvgElement; className?: string; size?: number }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const agentOpen = useAgentStore((state) => state.panelOpen && state.hydrated);
  const agentExpanded = useAgentStore((state) => state.expanded);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const reserveSidecarGutter = agentOpen && !agentExpanded;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto grid min-h-[var(--app-nav-height,4.5rem)] max-w-[1540px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2" href="/app">
            <OrenLogo className="h-7 w-7" size={28} />
            <span className="font-display text-lg font-semibold">Oren</span>
          </Link>
          <nav className="flex items-stretch justify-start gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:justify-center sm:gap-8">
            {navItems.map((item) => {
              const active =
                item.href === "/app"
                  ? pathname === "/app"
                  : item.href === "/app/markets"
                    ? pathname === "/app/markets" || pathname.startsWith("/app/stocks/")
                    : pathname.startsWith(item.href);

              return (
                <Link
                  className={cn(
                    "relative inline-flex min-h-[var(--app-nav-height,4.5rem)] shrink-0 items-center gap-1.5 px-1 text-sm font-semibold text-muted transition-colors",
                    active ? "text-foreground" : "hover:text-foreground",
                  )}
                  href={item.href}
                  key={item.href}
                >
                  <Icon className="hidden sm:block" icon={item.icon} size={14} />
                  {t(item.label)}
                  {active ? <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-full bg-foreground" /> : null}
                </Link>
              );
            })}
          </nav>
          <div aria-label={t("nav.yourAccount")} className="flex items-center gap-2 justify-self-end">
            <LanguageMenu />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className={cn("min-w-0 px-4 py-5 [transition:padding-right_var(--panel-open-dur)_var(--panel-ease)] motion-reduce:transition-none sm:px-6", reserveSidecarGutter && "2xl:pr-[416px]")}>
        <PendingApprovalNotice />
        {children}
      </main>
      <AgentPanel />
      <DepositModal />
      {!agentOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[100] px-4 sm:px-6">
          <div className="mx-auto flex max-w-[1540px] justify-end">
            <Button
              aria-label={t("nav.openOren")}
              className="pointer-events-auto h-12 w-12 overflow-visible rounded-[20px] bg-foreground text-white shadow-[0_18px_50px_rgba(23,23,23,0.24)] transition-[background-color,transform] hover:scale-[1.04] hover:bg-black/85"
              id="oren-agent-launcher"
              onClick={() => setPanelOpen(true)}
              size="icon"
              variant="primary"
            >
              <OrenLogo size={38} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
