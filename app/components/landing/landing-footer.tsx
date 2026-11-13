
import { NewTwitterIcon, ArrowUpRight01Icon, TelegramIcon, ArrowUp02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from "next/link";
import Image from "next/image";
import { OrenLogo } from "@/components/brand/oren-logo";

const groups = [
  { title: "Product", links: [
    { label: "Overview", href: "/#product" },
    { label: "Stock mix", href: "/#stock-mix" },
    { label: "How it works", href: "/#how-it-works" },
  ] },
  { title: "Terminal", links: [
    { label: "Markets", href: "/app/markets" },
    { label: "Portfolio", href: "/app/portfolio" },
    { label: "Activity", href: "/app/activity" },
  ] },
  { title: "Resources", links: [
    { label: "Connect your agent", href: "/agents" },
    { label: "Roadmap", href: "/roadmap" },
    { label: "Changelog", href: "/changelog" },
    { label: "Token", href: "/token" },
    { label: "Integrations", href: "/#features" },
    { label: "FAQ", href: "/#faq" },
    { label: "Launch Oren", href: "/app" },
  ] },
];

const socialLinkClass = "mt-[13px] inline-flex min-h-[40px] items-center gap-[9px] text-[11px] text-[#756b5d] [&>span:first-child]:text-[16px] [&>span:first-child]:text-[#4f473c]";
const navigationLinkClass = "inline-flex min-h-[36px] items-center text-[12px] leading-[1.5] at-most-700:min-h-[40px] at-most-700:text-[11px]";

export function LandingFooter() {
  return <footer className="bg-[#f9f9f7] text-[#847a6d] [&_a:hover]:text-[#28241e] [&_a:focus-visible]:rounded-[3px] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[5px] [&_a:focus-visible]:outline-[#ab96c0]" id="footer">
    <div className="max-w-[1280px] [margin:0_auto] [padding:64px_48px_26px] at-most-1023:[padding:52px_32px_24px] at-most-700:[padding:44px_20px_24px]">
      <div className="grid grid-cols-[1fr_1.55fr] gap-[80px] [padding:43px_0_40px] [border-top:1px_solid_#e7e3da] at-most-1023:gap-[45px] at-most-1023:grid-cols-[.85fr_1.5fr] at-most-700:grid-cols-[1fr] at-most-700:gap-[32px] at-most-700:[padding:30px_0]">
        <div>
          <Link href="/" className="inline-flex min-h-[36px] w-fit items-center gap-[10px] text-[15px] font-semibold tracking-[.16em] text-[#3c382f] at-most-700:text-[14px]" aria-label="Oren home"><span className="flex" aria-hidden="true"><OrenLogo size={30} /></span><span>OREN</span></Link>
          <p className="mt-[16px] max-w-[245px] text-pretty text-[13px] leading-[1.8] at-most-700:mt-[12px] at-most-700:text-[12px]">AI-powered trading for tokenized stocks on Solana.</p>
          <div className="flex flex-wrap gap-x-[24px]">
            <a className={socialLinkClass} href="https://x.com/orenfinance_" target="_blank" rel="noopener noreferrer" aria-label="Follow Oren on X (opens in a new tab)"><span aria-hidden="true"><HugeiconsIcon icon={NewTwitterIcon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span> Follow on X <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
            <a className={socialLinkClass} href="https://t.me/orendotfinance" target="_blank" rel="noopener noreferrer" aria-label="Join Oren on Telegram (opens in a new tab)"><HugeiconsIcon icon={TelegramIcon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> Telegram <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
          </div>
        </div>
        <nav className="grid grid-cols-3 gap-[42px] at-most-1023:gap-[24px] at-most-700:gap-[18px]" aria-label="Footer navigation">
          {groups.map(group => <div key={group.title}>
            <h3 className="text-[12px] font-medium leading-[1.6] text-[#4f473c] at-most-700:text-[11px]">{group.title}</h3>
            <ul className="mt-[13px] list-none p-0 at-most-700:mt-[10px]">{group.links.map(link => <li key={link.label}>
              {link.href.startsWith("#") ? <a className={navigationLinkClass} href={link.href}>{link.label}</a> : <Link className={navigationLinkClass} href={link.href}>{link.label}</Link>}
            </li>)}</ul>
          </div>)}
        </nav>
      </div>
      <div className="flex items-center justify-between gap-[24px] [border-top:1px_solid_#e7e3da] pt-[18px] text-[11px] leading-[1.6] text-[#9b9081] at-most-700:block at-most-700:text-[10px] at-most-700:pt-[20px]">
        <p>© {new Date().getFullYear()} Oren</p>
        <div className="flex items-center gap-[36px] at-most-700:justify-between at-most-700:gap-[20px] at-most-700:mt-[12px]">
          <span className="inline-flex items-center gap-[7px] whitespace-nowrap">Built on <Image className="h-[12px] w-[15px] flex-none object-contain" src="/integrations/solana.svg" alt="" width={15} height={12} /><span>Solana</span></span>
          <a href="#top" className="inline-flex items-center justify-center gap-[9px] min-h-[36px] text-[#7d7263] at-most-700:min-h-[40px]">Back to top <HugeiconsIcon icon={ArrowUp02Icon} size={14} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></a>
        </div>
      </div>
    </div>
  </footer>;
}
