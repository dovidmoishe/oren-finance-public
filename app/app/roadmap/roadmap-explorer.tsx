'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowRight02Icon, CheckmarkCircle02Icon, CodeIcon, Search01Icon, Wallet01Icon } from '@hugeicons/core-free-icons';
import { OrenLogo } from '@/components/brand/oren-logo';

const windows = [
  { id: 'november', label: 'This month', date: 'November 2026' },
  { id: 'december', label: 'Up next', date: 'December 2026' },
] as const;
type WindowId = typeof windows[number]['id'];

const milestones = [
  { id: 'mcp', window: 'november', title: 'MCP server', description: 'Oren in your AI client.', status: 'In progress', art: 'connect', details: ['Research, portfolio context and trading in compatible AI clients.', 'Scoped connections and explicitly authorized trades.'], note: 'Public rollout after final acceptance checks.' },
  { id: 'sdk', window: 'november', title: 'Developer SDKs', description: 'Privy wallets. Your rules.', status: 'Planned', art: 'code', details: ['Define your own specifications and extend Oren’s guardrails.', 'Connect users’ Privy wallets for authorized signing inside your MCP client.'], note: 'Explicit, revocable user permissions.' },
  { id: 'usage', window: 'november', title: 'Product insights', description: 'Learn from how you use Oren.', status: 'Planned', art: 'insights', details: ['Find what’s useful and where people get stuck.', 'Shape membership benefits around real usage.'], note: 'Better experiences, informed by you.' },
  { id: 'membership', window: 'november', title: '$OREN membership', description: 'More for holders.', status: 'Planned', art: 'membership', details: ['Holding-based tiers with useful features and usage allowances.', 'Benefits and holding requirements published before activation.'], note: 'Packages follow the usage research.' },
  { id: 'withdrawals', window: 'november', title: 'Wallet withdrawals', description: 'Send cash and supported stocks.', status: 'In review', art: 'wallet', details: ['Choose your asset, amount and destination.', 'Review, sign and follow the onchain receipt.'], note: 'In review ahead of release.' },
  { id: 'crypto', window: 'december', title: 'Crypto research', description: 'Fundamentals beyond stocks.', status: 'Exploring', art: 'research', details: ['Agent research on a curated set of non-meme assets.', 'Utility, adoption, tokenomics, liquidity and risks.'], note: 'Research first. Coverage is being evaluated.' },
] as const;
type Milestone = typeof milestones[number];

const artClasses = {
  connect: "roadmap-connect",
  code: "roadmap-code",
  insights: "roadmap-insights",
  membership: "roadmap-membership",
  wallet: "roadmap-wallet",
  research: "roadmap-research",
};

function MilestoneArt({ kind }: { kind: Milestone['art'] }) {
  return <div className={`roadmap-card-art ${artClasses[kind]}`} aria-hidden="true">
    {kind === 'connect' && <div className="roadmap-connection-art"><span>AI CLIENT</span><i /><div><OrenLogo size={38} /></div><i /><span>YOUR WORLD</span></div>}
    {kind === 'code' && <div className="roadmap-code-window"><div><i /><i /><i /><span>oren / sdk</span></div><p><em>await</em> oren.connect();</p><div className="roadmap-code-lines"><i /><i /><i /></div></div>}
    {kind === 'insights' && <div className="roadmap-insight-art"><div>{[25, 42, 32, 59, 48, 76, 91].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></div>}
    {kind === 'membership' && <div className="roadmap-member-cards"><div /><div /><div><OrenLogo size={30} /><span>$OREN</span><b>MEMBER</b></div></div>}
    {kind === 'wallet' && <div className="roadmap-wallet-art"><div><HugeiconsIcon icon={Wallet01Icon} size={34} /></div><HugeiconsIcon icon={ArrowRight02Icon} size={24} /><div><HugeiconsIcon icon={CheckmarkCircle02Icon} size={34} /></div></div>}
    {kind === 'research' && <div className="roadmap-research-art"><span>UTILITY</span><span>ADOPTION</span><div><HugeiconsIcon icon={Search01Icon} size={36} /></div><span>TOKENOMICS</span><span>RISKS</span></div>}
  </div>;
}

function MilestoneCard({ item }: { item: Milestone }) {
  const [open, setOpen] = useState(false);
  return <article className="roadmap-card accordion" data-open={open}>
    <div className="roadmap-art-frame"><MilestoneArt kind={item.art} /><span className="roadmap-status" data-status={item.status}><i />{item.status}</span></div>
    <div className="roadmap-card-content">
      <h3><button type="button" className="roadmap-disclosure" aria-expanded={open} aria-controls={`${item.id}-details`} onClick={() => setOpen(!open)}><span>{item.title}</span><span className="accordion-chevron"><HugeiconsIcon icon={ArrowDown01Icon} size={17} /></span></button></h3><p>{item.description}</p>
      <div className="accordion-panel" id={`${item.id}-details`} inert={!open} aria-hidden={!open}><div className="accordion-content"><div className="roadmap-details"><ul>{item.details.map(detail => <li key={detail}>{detail}</li>)}</ul><p>{item.note}</p></div></div></div>
    </div>
  </article>;
}

export function RoadmapExplorer() {
  const [selected, setSelected] = useState<WindowId>('november');
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const initialized = useRef(false);
  const current = windows.find(window => window.id === selected)!;
  const visible = milestones.filter(item => item.window === selected);

  useEffect(() => {
    const movePill = (animate: boolean) => {
      const active = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active || !pill.current) return;
      const node = pill.current;
      const previous = node.style.transition;
      if (!animate) node.style.transition = 'none';
      node.style.transform = `translateX(${active.offsetLeft}px)`;
      node.style.width = `${active.offsetWidth}px`;
      if (!animate) { void node.offsetWidth; node.style.transition = previous; }
    };
    movePill(initialized.current);
    initialized.current = true;
    const observer = new ResizeObserver(() => movePill(false));
    if (bar.current) observer.observe(bar.current);
    return () => observer.disconnect();
  }, [selected]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % windows.length;
    else if (event.key === 'ArrowLeft') next = (index + windows.length - 1) % windows.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = windows.length - 1;
    else return;
    event.preventDefault();
    setSelected(windows[next].id);
    bar.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <>
    <section className="roadmap-hero" aria-labelledby="roadmap-heading">
      <div className="roadmap-hero-copy"><h1 id="roadmap-heading">A little further<br /><span>ahead.</span></h1><p>What we’re building next.</p><a className="roadmap-hero-link" href="#roadmap">Explore <HugeiconsIcon icon={ArrowDown01Icon} size={18} /></a></div>
      <div className="roadmap-hero-art" aria-label="MCP connections and crypto research">
        <div className="absolute top-[51%] left-[50%] w-[94%] h-[190px] [border:1px_solid_#b4a8be60] rounded-[50%] [transform:translate(-50%,_-50%)_rotate(-28deg)] at-most-700:h-[155px]" aria-hidden="true" /><div className="roadmap-orbit-inner" aria-hidden="true" />
        <div className="roadmap-hero-core" aria-hidden="true"><OrenLogo size={95} /></div>
        <button type="button" className="roadmap-hero-node roadmap-node-one" onClick={() => { setSelected('november'); document.getElementById('roadmap')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><HugeiconsIcon icon={CodeIcon} size={20} /><span>MCP<small>THIS MONTH</small></span></button>
        <button type="button" className="roadmap-hero-node roadmap-node-three" onClick={() => { setSelected('december'); document.getElementById('roadmap')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><HugeiconsIcon icon={Search01Icon} size={20} /><span>Crypto research<small>UP NEXT</small></span></button>
      </div>
    </section>

    <section id="roadmap" className="scroll-mt-[100px] [padding:30px_0_20px] [border-top:1px_solid_#ddd9d0] at-most-700:pt-[24px]" aria-labelledby="explore-heading">
      <div className="roadmap-toolbar"><h2 id="explore-heading">Roadmap</h2><span className="text-[#7c756a] text-[11px] at-most-700:text-[10px] at-most-360:text-[9px]">Updated Nov 3, 2026</span></div>
      <div className="roadmap-timeline">
        <div ref={bar} className="relative inline-flex items-center gap-[3px] rounded-[48px] bg-[#f1f1f1] p-[3px]" role="tablist" aria-label="Roadmap timeframe">
          <span ref={pill} className="pointer-events-none absolute left-0 top-[3px] z-0 h-[40px] w-0 rounded-[48px] bg-white [transform:translateX(0)] [transition:transform_250ms_var(--panel-ease),width_250ms_var(--panel-ease)] will-change-[transform,width] motion-reduce:[transition:none]" aria-hidden="true" />
          {windows.map((window, index) => (
            <button
              key={window.id}
              id={`tab-${window.id}`}
              type="button"
              className="relative z-1 h-[40px] cursor-pointer appearance-none rounded-[48px] bg-transparent px-[18px] py-[4px] text-[12px]! text-[rgba(15,15,15,.8)] [border:0] [transition:color_250ms_var(--panel-ease)] aria-selected:text-[#0f0f0f] [&:not([aria-selected=true]):hover]:text-[#0f0f0f] motion-reduce:[transition:none] at-most-360:px-[14px] at-most-360:text-[11px]!"
              role="tab"
              aria-selected={selected === window.id}
              aria-controls="roadmap-panel"
              tabIndex={selected === window.id ? 0 : -1}
              onClick={() => setSelected(window.id)}
              onKeyDown={event => navigateTabs(event, index)}
            >
              {window.label}
            </button>
          ))}
        </div>
      </div>
      <div id="roadmap-panel" role="tabpanel" aria-labelledby={`tab-${selected}`} tabIndex={0}>
        <div key={selected} className="animate-[roadmap-panel-in_300ms_cubic-bezier(.22,1,.36,1)_both]">
          <div className="roadmap-phase-heading"><h2>{current.date}</h2></div>
          <div className="roadmap-cards">{visible.map(item => <MilestoneCard key={item.id} item={item} />)}</div>
        </div>
      </div>
      <p className="text-[10px] leading-[1.8] text-[#948a7c] mt-[32px]">Target windows. Plans may evolve.</p>
    </section>

    <section className="roadmap-ongoing" aria-labelledby="ongoing-heading"><div className="grid place-items-center shrink-0 w-[72px] h-[72px] bg-[#fffdf994] [border:1px_solid_#fff] rounded-[22px] [box-shadow:0_8px_18px_#6a5d4c06] at-most-700:w-[56px] at-most-700:h-[56px] at-most-700:rounded-[18px]"><OrenLogo size={48} /></div><div><h2 id="ongoing-heading">Always getting better.</h2><p>Your feedback shapes every release.</p></div><div className="roadmap-closing-links"><Link href="/changelog">See updates <HugeiconsIcon icon={ArrowRight02Icon} size={17} /></Link><a href="https://t.me/orendotfinance" target="_blank" rel="noopener noreferrer">Share feedback <HugeiconsIcon icon={ArrowRight02Icon} size={17} /><span className="sr-only"> (opens in a new tab)</span></a></div></section>
  </>;
}
