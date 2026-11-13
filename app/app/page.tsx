
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { landingHeroClasses } from "@/components/landing/landing-hero-classes";
import { HugeiconsIcon } from '@hugeicons/react';
import Link from "next/link";
import { AgentClientLinks } from "./agents/agent-clients";
import { LaunchArrow } from "@/components/landing/launch-arrow";
import { OrenLogo } from "@/components/brand/oren-logo";
import { ButtonLink } from "@/components/ui";
import { ProductIntroduction } from "@/components/landing/product-introduction";
import { ProductFoundations } from "@/components/landing/product-foundations";
import { LandingHeader } from "@/components/landing/landing-header";
import { StockMix } from "@/components/landing/stock-mix";
import { TradingSteps } from "@/components/landing/trading-steps";
import { LandingFaqCta } from "@/components/landing/landing-faq-cta";
import { LandingFooter } from "@/components/landing/landing-footer";


export default function Home() {
  return (
    <div id="top" className="relative min-h-screen overflow-x-clip bg-[#f9f9f7] text-[#111110]">
      <div aria-hidden className="landing-backdrop" />
      <LandingHeader>
        <nav aria-label="Main navigation" className="agents-nav">
          <Link aria-label="Oren home" className="flex items-center gap-2.5" href="/">
            <OrenLogo className="h-7 w-7" size={28} />
            <span className="text-[15px] font-semibold tracking-[0.16em]">OREN</span>
          </Link>
          <div className="agents-nav-links">
            <Link className="transition-colors hover:text-[#111110]" href="/app/markets">Markets</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/agents">Agents</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/token">Token</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/roadmap">Roadmap</Link>
            <Link className="transition-colors hover:text-[#111110]" href="/changelog">Changelog</Link>
          </div>
          <div className="agents-nav-right">
            <AgentClientLinks />
          <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">
            Launch App <LaunchArrow />
          </ButtonLink>
          </div>
        </nav>
      </LandingHeader>

      <main><section aria-labelledby="hero-heading" className="relative max-w-[1280px] [margin:0_auto] [padding:0_48px] at-most-1023:[padding:0_32px] at-most-767:[padding:0_20px]">
        <div className="grid grid-cols-[1.08fr_1fr] items-center gap-[24px] min-h-[360px] [padding:12px_0_24px] at-most-1023:min-h-[375px] at-most-1023:grid-cols-[1.15fr_1fr] at-most-1023:gap-[12px] at-most-767:flex at-most-767:flex-col at-most-767:items-stretch at-most-767:gap-0 at-most-767:[padding:26px_0_0]">
          <div className="relative z-[2] [padding:18px_0] at-most-767:p-0">
            <h1 className="landing-headline" id="hero-heading">
              Trade tokenized stocks.{" "}<span>With an AI agent.</span>
            </h1>
            <p className="landing-description">Research markets, build a portfolio, and review every trade on Solana.</p>
            <div className="flex items-center flex-wrap gap-[24px] mt-[25px] at-most-767:mt-[22px] at-most-767:gap-[20px]">
              <ButtonLink className="h-12 rounded-full px-5 text-[14px] font-medium" href="/app" id="launch-oren-cta" variant="primary">
                Launch Oren <LaunchArrow />
              </ButtonLink>
              <Link className="landing-market-link" href="/app/markets">Explore markets <span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></Link>
            </div>
          </div>
          <div className="relative grid place-items-center isolate min-w-0 h-[320px] at-most-1023:h-[330px] at-most-767:h-[235px] at-most-767:mt-[5px]">
            <div aria-hidden className={landingHeroClasses.aura} />
            <div aria-hidden className={landingHeroClasses.ground} />
            <div className="relative w-[250px] h-[250px] mt-[-14px] [filter:drop-shadow(0_20px_25px_rgb(95_75_125_/_.12))] at-most-1023:w-[215px] at-most-1023:h-[215px] at-most-767:w-[170px] at-most-767:h-[170px] at-most-767:mt-[-8px]"><OrenLogo attentionTargetId="launch-oren-cta" className="w-full! h-full!" interactive size={260} /></div>
          </div>
        </div>
        <ProductIntroduction />
      </section>
      <ProductFoundations />
      <StockMix />
      <TradingSteps />
      <LandingFaqCta />
      </main>
      <LandingFooter />
    </div>
  );
}
