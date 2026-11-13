
import { ArrowRight02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { OrenLogo } from '@/components/brand/oren-logo';
import { LandingHeader } from '@/components/landing/landing-header';
import { LandingFooter } from '@/components/landing/landing-footer';
import { ButtonLink } from '@/components/ui/button';
import { previewDrafts } from '@/content/changelog';

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return <div className="changelog-page" id="top">
    <LandingHeader><nav className="relative max-w-[1280px] h-[76px] m-auto [padding:0_48px] flex items-center justify-between gap-[24px] at-most-767:[padding:0_20px] at-most-767:gap-[12px]" aria-label="Main navigation">
      <Link className="inline-flex items-center gap-[10px] text-[15px] font-semibold tracking-[.16em]" href="/" aria-label="Oren home"><OrenLogo size={28} /><span>OREN</span></Link>
      <div className="changelog-nav-links"><Link href="/#product">Product</Link><Link href="/app/markets">Markets</Link><Link href="/token">Token</Link><Link href="/roadmap">Roadmap</Link><Link href="/changelog" aria-current="page">Changelog</Link></div>
      <ButtonLink className="h-10 rounded-full px-4 text-sm font-medium" href="/app" variant="primary">Launch App <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></ButtonLink>
    </nav></LandingHeader>
    <main className="relative max-w-[1184px] m-auto [padding:0_32px_84px] at-most-767:[padding:0_20px_44px]">
      {previewDrafts && <aside className="[border:1px_solid_#cfc2de] bg-[#eee7f5] [padding:14px_18px] rounded-[8px] text-[12px] [margin:20px_0]">Local draft preview. Unpublished entries are visible only in this development server.</aside>}
      {children}
    </main>
    <LandingFooter />
  </div>;
}
