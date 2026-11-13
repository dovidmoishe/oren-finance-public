"use client";
import { Cursor01Icon, Search01Icon, ArrowUpRight01Icon, ArrowRight02Icon, Tick02Icon, ArrowUp02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { OrenLogo } from "@/components/brand/oren-logo";
import { stockLogos } from "./stock-logos";

const walkthroughPositiveClass = "text-[#3f865c]";

const walkthroughMutedClass = "text-[11px] text-[#84837b]";

const STEP_MS = 1200;
const SCENE_MS = 6000;
const DURATION = STEP_MS * 4;
const stocks = [
  { symbol: "NVDA", name: "NVIDIA", price: "$186.42", change: "+3.28%", logo: stockLogos.NVDA },
  { symbol: "AAPL", name: "Apple", price: "$268.75", change: "+1.46%", logo: stockLogos.AAPL },
  { symbol: "MSFT", name: "Microsoft", price: "$528.36", change: "+2.17%", logo: stockLogos.MSFT },
  { symbol: "TSLA", name: "Tesla", price: "$324.85", change: "−0.84%", logo: stockLogos.TSLA },
];
// Fixed illustrative observations: consolidation, a selloff, then recovery.
// Keep these deterministic; this public demo does not represent a live feed.
const chartPrices = [
  169.8, 170.4, 169.9, 171.2, 170.8, 170.6, 171.1, 170.2, 169.7, 170.3,
  171.5, 172.1, 171.7, 172.4, 173.8, 173.1, 173.5, 172.7, 173.2, 172.9,
  172.6, 173.1, 172.8, 171.6, 170.9, 171.4, 170.3, 168.7, 169.2, 168.4,
  169.6, 170.1, 169.5, 170.4, 171.8, 171.3, 172.5, 173.6, 173.2, 174.8,
  175.2, 174.6, 175.7, 176.1, 175.3, 175.8, 175.5, 176.3, 175.9, 175.6,
  176.2, 176.8, 176.4, 177.9, 179.3, 178.6, 180.2, 179.7, 180.8, 181.4,
  180.6, 181.1, 179.8, 180.4, 179.5, 178.2, 178.8, 177.6, 178.5, 179.2,
  178.7, 179.6, 180.3, 179.9, 180.7, 181.2, 180.8, 181.5, 182.6, 182.1,
  183.4, 184.7, 184.1, 185.2, 184.5, 183.8, 184.3, 183.6, 182.9, 183.5,
  182.7, 181.8, 182.4, 181.1, 180.5, 181.3, 182.2, 183.7, 183.1, 184.6,
  185.4, 184.8, 185.7, 186.1, 185.5, 186.42,
];
const chartY = (price: number) => 195 - (price - 168) / 20 * 180;
const chart = chartPrices.map((price, i) => `${i ? "L" : "M"}${(i / (chartPrices.length - 1) * 500).toFixed(2)} ${chartY(price).toFixed(2)}`).join(" ");

function StockMark({ stock }: { stock: typeof stocks[number] }) {
  return <span className="w-[30px] h-[30px] rounded-[50%] shrink-0 grid place-items-center font-semibold text-[12px] at-most-640:w-[26px] at-most-640:h-[26px] at-most-640:text-[10px]"><Image alt={`${stock.name} logo`} src={stock.logo} width={30} height={30} className="h-full w-full rounded-full object-cover" /></span>;
}

function DemoCursor({ clicking }: { clicking: boolean }) {
  return <span aria-hidden className="walkthrough-cursor" data-clicking={clicking}><HugeiconsIcon icon={Cursor01Icon} size={23} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>;
}

function PriceChart({ progress }: { progress: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="flex gap-[12px] mt-[20px]">
      <svg aria-label="Illustrative NVIDIA 30-day price chart, ending at 186 dollars and 42 cents" className="block w-full min-w-0 h-[160px] overflow-visible at-most-640:h-[120px]" viewBox="0 0 500 210" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#dcd5f5" stopOpacity=".38" /><stop offset="1" stopColor="#dcd5f5" stopOpacity="0" /></linearGradient>
          <clipPath id={`${id}-reveal`}><rect x="0" y="0" width={500 * progress} height="210" /></clipPath>
        </defs>
        {[188, 182, 176, 170].map((price) => <path key={price} d={`M0 ${chartY(price)}H500`} stroke="#eeede9" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />)}
        <g clipPath={`url(#${id}-reveal)`}>
          <path d={`${chart} L500 210 H0 Z`} fill={`url(#${id}-fill)`} />
          <path d={chart} fill="none" stroke="#68615f" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div aria-hidden className="walkthrough-price-axis">{[188, 182, 176, 170].map((price) => <span key={price} style={{ top: `${chartY(price) / 210 * 100}%` }}>${price}</span>)}</div>
    </div>
  );
}

export function ProductWalkthrough() {
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const step = Math.min(3, Math.floor(elapsed / STEP_MS));
  // Scale all reveals together so a pace change keeps each scene complete.
  const local = (elapsed - step * STEP_MS) / STEP_MS * SCENE_MS;
  const ended = elapsed >= DURATION;
  const running = playing && visible && foreground && !ended;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => { if (media.matches) { setPlaying(false); setElapsed(DURATION); } };
    const visibilityChanged = () => setForeground(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      setForeground(!document.hidden);
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        setPlaying(!media.matches);
        if (media.matches) setElapsed(DURATION);
      }
    }, { threshold: .2 });
    if (root.current) observer.observe(root.current);
    media.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { observer.disconnect(); media.removeEventListener("change", motionChanged); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, []);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed((value) => (value + delta) % DURATION);
    }, 60);
    return () => window.clearInterval(timer);
  }, [running]);

  function selectStep(index: number) { setElapsed(index * STEP_MS); setPlaying(true); }

  return (
    <div className="walkthrough-walkthrough" ref={root} data-playing={running} data-step={step}>
      <div className="p-[10px] [border:1px_solid_#e5e3df] rounded-[24px] bg-[#efeeea] [box-shadow:0_24px_80px_-32px_rgb(40_35_55_/_.16)] at-most-640:p-[5px] at-most-640:rounded-[18px]"><div className="overflow-hidden [border:1px_solid_#e5e3df] rounded-[16px] bg-white at-most-640:rounded-[12px]">
        <header className="h-[64px] [padding:0_24px] flex items-center justify-between gap-[16px] [border-bottom:1px_solid_#eeede9] at-most-640:[padding:0_14px] at-most-640:h-[52px]">
          <span className="flex items-center gap-[9px] font-semibold text-[15px]"><OrenLogo size={25} className="h-[25px] w-[25px]" /> Oren</span>
          <div className="flex gap-[30px] text-[12px] text-[#8a8982] at-most-900:gap-[18px] at-most-640:hidden" aria-hidden><span>Dashboard</span><span className="text-[#232320]">Market</span><span>Portfolio</span></div>
          <span className="walkthrough-demo-label"><span /> Product demo</span>
        </header>
        <div className="grid grid-cols-[minmax(0,_1fr)_310px] h-[600px] [contain:layout] at-most-900:grid-cols-[minmax(0,1fr)_270px] at-most-640:flex at-most-640:flex-col at-most-640:h-[480px]">
          <div className="walkthrough-market-area">
            {step === 0 ? (
              <div className="walkthrough-scene" key="markets">
                <div className="walkthrough-section-heading"><div><span className={walkthroughMutedClass}>Explore</span><h3>Market</h3></div><span className="walkthrough-search"><HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /> <span>Search stocks</span></span></div>
                <div className="walkthrough-highlights">
                  <div><span>Trending</span><strong><Image alt="NVIDIA logo" src={stockLogos.NVDA} width={24} height={24} className="rounded-full" />NVDA</strong><small>NVIDIA <b>+3.28%</b></small></div>
                  <div><span>Oren Opportunity</span><strong><Image alt="Microsoft logo" src={stockLogos.MSFT} width={24} height={24} className="rounded-full" />MSFT</strong><small>Microsoft <b>82 / 100</b></small></div>
                </div>
                <div className="walkthrough-table-head"><span>Stock</span><span>Price</span><span>Today</span></div>
                {stocks.map((stock, i) => (
                  <button disabled={i !== 0} className={`walkthrough-stock-row walkthrough-action-target ${i === 0 && local > 2400 ? "walkthrough-highlight-row" : ""}`} key={stock.symbol} onClick={() => selectStep(1)} aria-label={i === 0 ? "Explore NVIDIA in the demo" : `${stock.name} sample stock`}>
                    <span className="walkthrough-stock-name"><StockMark stock={stock} /><span><strong>{stock.name}</strong><small>{stock.symbol}</small></span></span>
                    <span>{stock.price}</span><span className={i === 3 ? "walkthrough-negative" : walkthroughPositiveClass}>{stock.change}</span>
                    {i === 0 && running && local > 2800 && <DemoCursor clicking={local > 5000} />}
                  </button>
                ))}
                <span className="flex justify-between [margin:18px_10px_0] text-[11px] text-[#8b8982]">Select NVIDIA to explore it <span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></span>
              </div>
            ) : (
              <div className="walkthrough-scene" key="stock">
                <div className="walkthrough-stock-heading"><StockMark stock={stocks[0]} /><div><h3>NVIDIA</h3><span className={walkthroughMutedClass}>NVDA · Tokenized stock</span></div><span className="ml-auto text-[10px] [padding:5px_9px] rounded-[5px] bg-[#f7f6f2] text-[#86847e]">Technology</span></div>
                <div className="walkthrough-price"><strong>$186.42</strong><span className={walkthroughPositiveClass}>+3.28% <span className={walkthroughMutedClass}>today</span></span></div>
                <PriceChart progress={step === 1 ? Math.min(1, .35 + local / 2200) : 1} />
                <div className="flex justify-between pr-[42px] text-[9px] text-[#a4a198] mt-[5px]"><span>Oct 1</span><span>Oct 15</span><span>Oct 30</span></div>
                <div className="flex gap-[17px] items-center text-[10px] text-[#848179] mt-[14px]"><span>24H</span><span>7D</span><span className="bg-[#f1f0eb] [padding:5px_9px] rounded-[5px] text-[#232320]">30D</span><span>90D</span><span>1Y</span></div>
                <div className="walkthrough-outlook"><div><span>Market outlook</span><span className="text-[10px] text-[#6f6860] bg-[#eeeadf] [padding:2px_6px] rounded-[4px]">84 / 100</span></div><p>Positive momentum. Moderate volatility.</p><div className="walkthrough-metrics"><span>7D momentum<strong className={walkthroughPositiveClass}>+6.84%</strong></span><span>30D volatility<strong>3.12%</strong></span><span>Trend<strong>Uptrend</strong></span></div></div>
              </div>
            )}
          </div>
          <aside className="walkthrough-agent-area">
            <div className="walkthrough-agent-header"><OrenLogo size={26} className="h-[26px] w-[26px]" state={running && step === 2 && local < 2200 ? "thinking" : "idle"} /><strong>{step === 3 ? "Trade review" : "Oren Agent"}</strong><span><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></div>
            {step < 2 ? (
              <div className="walkthrough-agent-welcome walkthrough-scene" key="welcome">
                <OrenLogo size={48} className="h-12 w-12" /><h4>What&apos;s on your mind?</h4><p>Ask about a stock or your portfolio.</p>
                <button className="walkthrough-action-target" onClick={() => selectStep(2)}>What&apos;s happening with NVIDIA? <span><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>{step === 1 && running && local > 2800 && <DemoCursor clicking={local > 5000} />}</button>
              </div>
            ) : step === 2 ? (
              <div className="walkthrough-conversation walkthrough-scene" key="conversation">
                <p className="bg-[#eeece6] [border-radius:12px_12px_3px_12px] ml-[15px] p-[12px] text-[12px] leading-[1.6]">What&apos;s happening with NVIDIA?</p>
                <div className="walkthrough-answer"><span className="text-[#878173] text-[10px]">Oren</span><p>{"NVIDIA is up 3.28% today. Momentum is positive, with moderate volatility over the past month.".slice(0, Math.floor(local / 20) + 1)}</p></div>
                {local > 2300 && <div className="walkthrough-insight-card walkthrough-scene"><span>Portfolio context</span><p>NVIDIA is 18% of your holdings.</p><small>A $100 buy would bring it to 20%.</small></div>}
                {local > 3600 && <button className="walkthrough-primary-button walkthrough-action-target" onClick={() => selectStep(3)}>Review a $100 buy <span><HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>{running && local > 4200 && <DemoCursor clicking={local > 5400} />}</button>}
              </div>
            ) : (
              <div className="walkthrough-review walkthrough-scene" key="review">
                <span className="flex items-center gap-[7px] text-[11px] text-[#918b80]"><Image alt="NVIDIA logo" src={stockLogos.NVDA} width={22} height={22} className="rounded-full" />Buy NVIDIA</span><strong className="walkthrough-trade-amount">$100<span>USDC</span></strong>
                <dl><div><dt>You receive</dt><dd>≈ 0.5364 NVDA</dd></div><div><dt>Price</dt><dd>$186.42</dd></div><div><dt>Network</dt><dd>Solana</dd></div><div><dt>Estimated fee</dt><dd>$0.01</dd></div></dl>
                <div className="walkthrough-review-notice"><span aria-hidden><HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span> You review every trade before it moves.</div>
                <div className="flex justify-between [padding:12px_14px] rounded-[9px] bg-[#252521] text-white text-[11px]">Approve trade <span aria-hidden><HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></div>
                <p className="text-[9px] text-[#999185] mt-[12px] text-center">Sample trade · No funds will move</p>
              </div>
            )}
            {step < 3 && <div className="walkthrough-composer"><span>Ask Oren…</span><button aria-label="Show the Ask Oren demo step" onClick={() => selectStep(2)}><HugeiconsIcon icon={ArrowUp02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></button></div>}
          </aside>
        </div>
      </div></div>
    </div>
  );
}
