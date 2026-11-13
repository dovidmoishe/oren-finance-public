"use client";
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import Image from "next/image";
import { useRef, type CSSProperties } from "react";
import { StockLogo } from "@/components/stock/stock-logo";
import { useLandingReveal } from "./use-landing-reveal";

const steps = [
  { number: "01", title: "Research your stocks.", copy: "Explore charts, signals, and news with Oren.", asset: "pick-stocks", alt: "Painted meadow paths winding toward lilac mountains" },
  { number: "02", title: "Review the details.", copy: "Check the amount, route, and estimated fees.", asset: "review-trade", alt: "A quiet painted lakeside lookout overlooking the mountains" },
  { number: "03", title: "You approve.", copy: "Confirm each trade when everything looks right.", asset: "approve-trade", alt: "A painted stone bridge leading through a sunlit meadow" },
];

export function TradingSteps() {
  const root = useRef<HTMLElement>(null);
  useLandingReveal(root);

  return <section ref={root} className="reveal-group mx-auto max-w-[1280px] scroll-mt-[96px] px-[48px] pb-[110px] pt-[28px] at-most-1023:px-[32px] at-most-1023:pb-[85px] at-most-1023:pt-[20px] at-most-700:px-[20px] at-most-700:pb-[65px] at-most-700:pt-[18px]" id="how-it-works" aria-labelledby="trading-steps-heading">
    <div className="mb-[35px] flex items-end justify-between gap-[30px] at-most-700:mb-[27px] at-most-700:block">
      <div><p className="mb-[16px] [font:10px_monospace] text-[#969083] uppercase tracking-[.1em] at-most-700:text-[9px] at-most-700:mb-[13px]">How it works</p><h2 className="reveal-focus scroll-mt-[96px] text-[clamp(30px,3vw,39px)] font-medium leading-[1.15] tracking-[-.045em] at-most-700:text-[31px]" data-reveal="ready" id="trading-steps-heading">Trade in three steps.</h2></div>
      <p className="reveal-focus text-[13px] leading-[1.7] text-[#898174] at-most-700:mt-[16px] at-most-700:text-[12px]" data-reveal="ready" style={{ "--reveal-delay": "120ms" } as CSSProperties}>Oren helps you get there.<br />You make the call.</p>
    </div>

    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-[18px] at-most-1023:gap-[12px] at-most-700:grid-cols-[1fr] at-most-700:gap-[16px]">
      {steps.map((step, index) => <article key={step.number} className="reveal-rise group/step relative flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-[#e7e1d7] bg-[#f6f4ed] at-most-700:rounded-[18px]" data-reveal="ready" style={{ "--reveal-delay": `${index * 100}ms` } as CSSProperties}>
        <span className="absolute left-[22px] top-[20px] z-1 tracking-[.04em] text-[#6e6357] [font:10px_monospace] at-most-1023:left-[20px]">{step.number}<span className="text-[#928578]" aria-hidden> / 03</span></span>
        <div className="relative h-[270px] overflow-hidden at-most-1023:h-[220px] at-most-700:h-[240px]">
          <Image src={`/landing/trading-steps/${step.asset}-v2.webp`} alt={step.alt} fill unoptimized sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1023px) 30vw, 390px" className="block object-cover object-center [mask-image:linear-gradient(to_bottom,#000_0%,#000_76%,transparent_100%)] [transform:scale(1.015)] [transition:transform_600ms_var(--panel-ease)] motion-safe:group-hover/step:[transform:scale(1.045)] motion-reduce:[transform:none] motion-reduce:[transition:none]" />
          {index === 0 && <span className="absolute bottom-0 left-[26px] flex items-center gap-[5px] rounded-[25px] border border-[#ded7cb] bg-[#fffcf7] px-[9px] py-[6px] shadow-[0_5px_14px_rgb(74_61_38/.06)] at-most-1023:left-[20px] at-most-700:left-[24px] [&_img]:outline-2 [&_img]:outline-[#fffcf7]" aria-label="NVIDIA, Apple and Microsoft"><StockLogo ticker="NVDA" size={24} /><StockLogo ticker="AAPL" size={24} /><StockLogo ticker="MSFT" size={24} /></span>}
        </div>
        <div className="mt-auto px-[26px] pb-[28px] pt-[23px] at-most-1023:px-[20px] at-most-1023:pb-[24px] at-most-1023:pt-[18px] at-most-700:px-[24px] at-most-700:pb-[27px] at-most-700:pt-[20px]">
          <h3 className="text-[18px] font-medium leading-[1.4] tracking-[-.025em] text-[#4d453b] at-most-1023:text-[16px] at-most-700:text-[19px]">{step.title}</h3>
          <p className="mt-[9px] max-w-[270px] text-pretty text-[12px] leading-[1.8] text-[#817567] at-most-1023:text-[11px] at-most-700:max-w-[290px] at-most-700:text-[13px]">{step.copy}</p>
        </div>
      </article>)}
    </div>
    <a className="mx-auto mt-[28px] flex w-fit items-center justify-center gap-[9px] py-[8px] text-[12px] text-[#817568] [&:hover]:text-[#342e26] focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-[6px] focus-visible:outline-[#a28eba]" href="#stock-mix">Try it with Stock mix <span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></a>
  </section>;
}
