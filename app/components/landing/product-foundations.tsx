"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { stockLogos } from "./stock-logos";
import { useLandingReveal } from "./use-landing-reveal";

const integrations: { name: string; src?: string; href: string; wordmark?: boolean }[] = [
  { name: "Solana", src: "/integrations/solana.svg", href: "https://solana.com" },
  { name: "tokens.xyz", src: "/integrations/tokens.svg", href: "https://tokens.xyz" },
  { name: "Titan", src: "/integrations/titan.svg", href: "https://titan.exchange" },
  { name: "Jupiter", src: "/integrations/jupiter.svg", href: "https://jup.ag" },
  { name: "OpenAI", href: "https://openai.com" },
  { name: "Privy", src: "/integrations/privy.svg", href: "https://privy.io" },
  { name: "Alchemy", src: "/integrations/alchemy.svg", href: "https://alchemy.com" },
];

function MarketOrbit() {
  return <svg viewBox="0 0 320 260" fill="none" aria-hidden>
    <defs><radialGradient id="market-orbit-haze"><stop stopColor="var(--art-lavender)" stopOpacity=".55" /><stop offset="1" stopColor="#f9f9f7" stopOpacity="0" /></radialGradient><clipPath id="orbit-nvidia"><circle cx="160" cy="111" r="10" /></clipPath><linearGradient id="market-paper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" /><stop offset="1" stopColor="#f2ede6" /></linearGradient></defs>
    <circle cx="160" cy="125" r="112" fill="url(#market-orbit-haze)" />
    <circle cx="160" cy="125" r="94" stroke="var(--art-stroke)" strokeWidth=".8" />
    <circle cx="160" cy="125" r="65" stroke="var(--art-stroke)" strokeWidth=".7" strokeDasharray="2 5" opacity=".6" />
    <ellipse cx="160" cy="125" rx="111" ry="43" stroke="var(--art-stroke)" strokeWidth=".7" transform="rotate(-25 160 125)" />
    <circle cx="160" cy="125" r="94" stroke="#baa8c5" strokeWidth="1.3" strokeDasharray="24 567" strokeLinecap="round" className="foundations-animated foundations-radar-sweep" />
    <g className="foundations-animated foundations-signal-card">
      <rect x="126" y="88" width="68" height="80" rx="17" fill="url(#market-paper)" stroke="#cec4d5" strokeWidth=".8" />
      <path d="M139 90h41" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <image href={stockLogos.NVDA} x="150" y="101" width="20" height="20" clipPath="url(#orbit-nvidia)" />
      <text x="160" y="138" textAnchor="middle" fill="var(--art-ink)" fontSize="9" fontWeight="500">NVDA</text>
      <path d="m139 155 8-7 7 3 10-10 8 3 9-7" stroke="#a895b6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    {[
      { x: 52, y: 54, label: "MSFT", logo: stockLogos.MSFT },
      { x: 236, y: 78, label: "AAPL", logo: stockLogos.AAPL },
      { x: 196, y: 196, label: "TSLA", logo: stockLogos.TSLA },
    ].map((stock, index) => <g key={stock.label} transform={`translate(${stock.x} ${stock.y})`}><g className="foundations-animated foundations-orbit-stock" style={{ "--index": index } as CSSProperties}><defs><clipPath id={`orbit-${stock.label}`}><circle cx="18" cy="18" r="9" /></clipPath></defs><circle cx="18" cy="18" r="18" fill="#fdfcf9" stroke="var(--art-stroke)" strokeWidth=".8" /><image href={stock.logo} x="9" y="9" width="18" height="18" clipPath={`url(#orbit-${stock.label})`} /></g></g>)}
  </svg>;
}

function AgentConstellation() {
  return <div className="foundations-agent-artwork" aria-hidden>
    <svg viewBox="0 0 320 260" fill="none">
      <defs><radialGradient id="agent-quiet-haze"><stop stopColor="#e5dcea" stopOpacity=".65" /><stop offset="1" stopColor="#f9f9f7" stopOpacity="0" /></radialGradient></defs>
      <circle cx="160" cy="126" r="100" fill="url(#agent-quiet-haze)" />
      {["M160 126C110 125 119 68 66 68", "M160 126c52 0 37-65 93-65", "M160 126c-43 0-43 68-94 68", "M160 126c49 0 36 66 95 66"].map((path, index) => <path key={path} d={path} stroke="#cbbfd2" strokeWidth=".9" strokeDasharray="2 7" className="foundations-animated foundations-thought-route" style={{ "--index": index } as CSSProperties} />)}
      {[
        { x: 46, y: 49, name: "News", path: "M11 11h16v18H11Z M15 15h8M15 19h8M15 23h5" },
        { x: 236, y: 42, name: "Signals", path: "m9 26 6-7 6 3 8-11M9 30h20" },
        { x: 44, y: 175, name: "Portfolio", path: "M10 27v-7h4v7M18 27V12h4v15M26 27V17h4v10" },
        { x: 236, y: 174, name: "Trade", path: "M10 14h19l-5-5M29 25H10l5 5" },
      ].map((node, index) => <g key={node.name} transform={`translate(${node.x} ${node.y})`}><g className="foundations-animated foundations-thought-node" style={{ "--index": index } as CSSProperties}><rect width="38" height="38" rx="11" fill="#fdfcf9" stroke="var(--art-stroke)" strokeWidth=".8" /><path d={node.path} stroke="#b2a1bf" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></g></g>)}
      <circle cx="160" cy="126" r="45" fill="#faf8fc" stroke="#e0d7e5" strokeWidth=".7" />
      <circle cx="160" cy="126" r="52" stroke="#d9cbdf" strokeWidth=".7" className="foundations-animated foundations-agent-pulse" />
    </svg>
    <div className="foundations-agent-mascot"><OrenLogo size={76} className="h-full w-full" /></div>
  </div>;
}

function PortfolioBalance() {
  return <svg viewBox="0 0 320 260" fill="none" aria-hidden>
    <ellipse cx="160" cy="228" rx="85" ry="11" fill="#e8e3d9" opacity=".32" />
    <path d="M160 219V43c0-9 13-9 13 0" stroke="#bfb3a5" strokeWidth="1.2" strokeLinecap="round" />
    <ellipse cx="160" cy="220" rx="32" ry="6" fill="var(--art-mist)" stroke="var(--art-stroke)" strokeWidth=".7" />
    <g className="foundations-animated foundations-balance-beam">
      <path d="M74 83q86-23 172 0" stroke="#baa8c5" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="160" cy="71" r="3" fill="#ece4f0" stroke="#c8b8d1" strokeWidth=".7" />
      {[
        { x: 75, y: 140, radius: 26, percent: 35, logo: stockLogos.MSFT, size: 20, anchor: 83 },
        { x: 160, y: 171, radius: 33, percent: 45, logo: stockLogos.NVDA, size: 24, anchor: 73 },
        { x: 245, y: 132, radius: 22, percent: 20, logo: stockLogos.AAPL, size: 18, anchor: 83 },
      ].map((weight) => <g key={weight.percent}>
        <defs><clipPath id={`allocation-logo-${weight.percent}`}><circle cx={weight.x} cy={weight.y} r={weight.size / 2} /></clipPath></defs>
        <path d={`M${weight.x} ${weight.anchor}v${weight.y - weight.radius - weight.anchor}`} stroke="var(--art-stroke)" strokeWidth=".9" />
        <circle cx={weight.x} cy={weight.y} r={weight.radius} fill="#fdfcf9" stroke="var(--art-stroke)" strokeWidth=".7" />
        <circle cx={weight.x} cy={weight.y} r={weight.radius - 5} fill="var(--art-mist)" />
        <circle cx={weight.x} cy={weight.y} r={weight.radius - 5} stroke="#bdaccb" strokeWidth="1.1" pathLength="100" strokeDasharray={`${weight.percent} ${100 - weight.percent}`} transform={`rotate(-90 ${weight.x} ${weight.y})`} />
        <image href={weight.logo} x={weight.x - weight.size / 2} y={weight.y - weight.size / 2} width={weight.size} height={weight.size} clipPath={`url(#allocation-logo-${weight.percent})`} />
      </g>)}
    </g>
  </svg>;
}

const features = [
  { label: "01 / MARKETS", title: "See the market clearly.", copy: "Charts, signals, and news for the stocks you follow.", Illustration: MarketOrbit },
  { label: "02 / AGENT", title: "An agent that knows your portfolio.", copy: "Ask questions, explore ideas, and build a stock mix.", Illustration: AgentConstellation },
  { label: "03 / PORTFOLIO", title: "Keep the whole picture in view.", copy: "Your holdings, allocation, and activity in one place.", Illustration: PortfolioBalance },
];

export function ProductFoundations() {
  const root = useRef<HTMLElement>(null);
  useLandingReveal(root);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let visible = false;
    const sync = () => { node.dataset.animate = String(visible && !document.hidden); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .08 });
    observer.observe(node);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  return <section className="foundations-section reveal-group" ref={root} data-animate="false" aria-labelledby="foundations-heading" id="features">
    <div className="foundations-integrations reveal-rise" data-reveal="ready" aria-label="Oren integrations">
      <p className="mb-[25px] text-center text-[10px] uppercase tracking-[.16em] text-[#949087] at-most-640:mb-[18px] at-most-640:text-[9px]">Powered by</p>
      <div className="foundations-marquee">
        <div className="foundations-track foundations-animated">
          {[0, 1].map((copy) => <ul className="foundations-logo-group" key={copy} aria-hidden={copy === 1 ? true : undefined} inert={copy === 1 ? true : undefined}>
            {integrations.map((integration) => <li key={integration.name}>
              <a href={integration.href} aria-label={integration.name} className="foundations-logo" target="_blank" rel="noreferrer">
                {integration.src && <Image src={integration.src} alt={integration.wordmark ? integration.name : ""} width={integration.wordmark ? 140 : 28} height={28} className={integration.wordmark ? `foundations-wordmark ${integration.name === "Privy" ? "foundations-privy" : ""}` : "w-[25px] h-[25px] object-contain [filter:grayscale(1)] at-most-640:w-[23px] at-most-640:h-[23px]"} unoptimized />}
                {!integration.wordmark && <span className={integration.name === "OpenAI" ? "foundations-openai" : undefined}>{integration.name}</span>}
              </a>
            </li>)}
          </ul>)}
        </div>
      </div>
    </div>

    <h2 id="foundations-heading" className="foundations-statement reveal-focus" data-reveal="ready">Built for tokenized stocks.{" "}<span>Markets, an AI agent, and your portfolio. Working together in one terminal.</span></h2>
    <div className="grid grid-cols-[repeat(3,_minmax(0,1fr))] mt-[75px] at-most-1023:mt-[56px] at-most-640:grid-cols-[1fr] at-most-640:mt-[42px]">
      {features.map(({ label, title, copy, Illustration }, index) => <article className="foundations-feature reveal-rise" data-reveal="ready" style={{ "--reveal-delay": `${index * 100}ms` } as CSSProperties} key={label}>
        <p className="[font-family:monospace] text-[9px] tracking-[.05em] text-[#aaa397]">{label}</p>
        <div className="foundations-illustration"><Illustration /></div>
        <h3 className="reveal-focus" data-reveal="ready">{title}</h3>
        <p className="foundations-feature-copy reveal-focus" data-reveal="ready" style={{ "--reveal-delay": "100ms" } as CSSProperties}>{copy}</p>
      </article>)}
    </div>
  </section>;
}
