import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui';
import { RoadmapExplorer } from './roadmap-explorer';

export const metadata: Metadata = {
  title: 'Roadmap — Oren',
  description: 'What comes next for Oren. Explore MCP, developer SDKs, $OREN membership and fundamentals-focused crypto research.',
  alternates: { canonical: '/roadmap' },
  openGraph: { title: 'Roadmap — Oren', description: 'A little further ahead. Explore what we’re building at Oren.', url: '/roadmap', type: 'website' },
};

export default function RoadmapPage() {
  return <div className="roadmap-page" id="top">
    <div aria-hidden="true" className="landing-backdrop" />
    <LandingHeader><nav className="relative max-w-[1280px] h-[76px] [padding:0_48px] m-auto flex justify-between items-center gap-[20px] at-most-1050:pl-[32px] at-most-1050:pr-[32px] at-most-700:pl-[20px] at-most-700:pr-[20px]" aria-label="Main navigation">
      <Link className="flex items-center gap-[10px] text-[15px] font-semibold tracking-[.16em] at-most-700:text-[12px]" href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className="roadmap-nav-links"><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/agents">Agents</Link><Link href="/token">Token</Link><Link href="/roadmap" aria-current="page">Roadmap</Link><Link href="/changelog">Changelog</Link></div>
      <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} /></ButtonLink>
    </nav></LandingHeader>
    <main className="relative max-w-[1280px] m-auto [padding:0_48px] at-most-1050:pl-[32px] at-most-1050:pr-[32px] at-most-700:pl-[20px] at-most-700:pr-[20px]">
      <RoadmapExplorer />
    </main>
    <LandingFooter />
  </div>;
}
