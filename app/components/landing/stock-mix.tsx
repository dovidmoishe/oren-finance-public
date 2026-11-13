"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, RefreshIcon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { AgentComposerView } from "@/components/agent/agent-composer-view";
import { BasketProposal } from "@/components/trading/basket-proposal";
import { BasketReview } from "@/components/trading/basket-review";
import { Button, ButtonLink, formatCurrency } from "@/components/ui";
import type { BasketResponse } from "@/types";
import { applyMixRequest, initialMix, mixAmounts } from "./stock-mix-model";
import { useI18n } from "@/i18n/i18n";
import { useLandingReveal } from "./use-landing-reveal";

const names = { NVDA: "NVIDIA", AAPL: "Apple", MSFT: "Microsoft", TSLA: "Tesla" };
const initialPrompt = "Build a $1,000 mix with NVIDIA, Apple and Microsoft.";
const initialResponse = "Here’s a sample mix: 40% NVIDIA, 35% Apple and 25% Microsoft. You can change it before reviewing each trade.";
const prompts = ["Make it equal", "Add Tesla", "Use $500", "Less NVIDIA"];

export function StockMix() {
  const { locale } = useI18n();
  const root = useRef<HTMLElement>(null);
  useLandingReveal(root);
  const [holdings, setHoldings] = useState(initialMix);
  const [budget, setBudget] = useState(1000);
  const [question, setQuestion] = useState(initialPrompt);
  const [answer, setAnswer] = useState(initialResponse);
  const [composer, setComposer] = useState("");
  const [review, setReview] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const amounts = mixAmounts(holdings, budget);
  const basket: BasketResponse = {
    id: "landing-stock-mix-demo", totalAmountUsd: budget, createdAt: "2026-10-31T00:00:00Z", riskLabel: "Demo",
    allocations: holdings.flatMap((holding, index) => holding.weight > 0 ? [{
      assetId: `demo-${holding.symbol}`, ticker: holding.symbol, name: names[holding.symbol],
      weightPercent: holding.weight, amountUsd: amounts[index],
    }] : []),
  };

  useEffect(() => {
    if (review) {
      reviewRef.current?.focus({ preventScroll: true });
      const bounds = reviewRef.current?.getBoundingClientRect();
      if (bounds && (bounds.top < 96 || bounds.bottom > window.innerHeight)) reviewRef.current?.scrollIntoView({ block: "start" });
    }
  }, [review]);

  function submit(prompt: string) {
    const text = prompt.trim().slice(0, 180);
    if (!text) return;
    const result = applyMixRequest(holdings, budget, text);
    setQuestion(text); setHoldings(result.holdings); setBudget(result.budget);
    setAnswer(result.recognized
      ? `Updated. ${formatCurrency(result.budget, locale)} across ${result.holdings.filter((holding) => holding.weight > 0).length} stocks. Your proposal is ready to review.`
      : "This demo supports a few requests. Try “Make it equal”, “Add Tesla”, “Less NVIDIA”, or an amount from $10 to $10,000.");
    setComposer(""); setReview(false);
  }

  function reset() {
    setHoldings(initialMix); setBudget(1000); setQuestion(initialPrompt); setAnswer(initialResponse); setComposer(""); setReview(false);
  }

  return <section ref={root} className="stock-mix-section reveal-group" id="stock-mix" aria-labelledby="stock-mix-heading">
    <div className="stock-mix-intro">
      <h2 className="reveal-focus" data-reveal="ready" id="stock-mix-heading">Build your stock mix.</h2>
    </div>
    <div className="stock-mix-frame reveal-surface" data-reveal="ready">
      <div className="stock-mix-terminal oren-app">
        <header className="h-[62px] flex items-center justify-between gap-[20px] [padding:0_24px] [border-bottom:1px_solid_var(--border)] at-most-1023:[padding:0_19px] at-most-700:h-[54px] at-most-700:gap-[8px] at-most-700:[padding:0_14px]">
          <span className="flex items-center gap-[8px] font-semibold text-[15px] at-most-700:text-[14px]"><OrenLogo size={26} className="h-[26px] w-[26px]" />Oren</span>
          <span className="text-[#8b8981] text-[11px] at-most-700:hidden">Agent workspace</span>
          <div className="flex items-center gap-[10px] at-most-700:gap-[4px]"><span className="text-[#959087] text-[10px]">Demo</span><Button aria-label="Reset Stock mix demo" onClick={reset} variant="ghost" size="icon"><HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={1.8} /></Button></div>
        </header>
        <div className="grid grid-cols-[minmax(0,_1.12fr)_minmax(0,_1fr)] at-most-700:grid-cols-[1fr]">
          <div className="flex flex-col min-w-0 min-h-[558px] at-most-700:min-h-[460px]">
            <div className="[flex:1] [padding:27px_28px_24px] at-most-1023:[padding:24px_20px] at-most-700:[padding:22px_18px_20px]">
              <p className="mb-[32px] text-[#aaa59a] text-[10px] at-most-700:mb-[23px]">Building your stock mix</p>
              <div className="w-fit max-w-[90%] ml-auto [border-radius:20px_20px_7px_20px] [padding:12px_16px] bg-foreground text-white text-[13px] leading-[1.7] [overflow-wrap:anywhere] at-most-700:max-w-[95%] at-most-700:text-[12px]">{question}</div>
              <div className="stock-mix-response"><span className="stock-mix-agent-identity"><OrenLogo size={25} className="h-[25px] w-[25px]" /><strong>Oren</strong></span><p aria-live="polite"><span key={`${question}:${answer}`} className="reveal-reply">{answer}</span></p><button type="button" className="inline-block [border:1px_solid_var(--border)] bg-panel-subtle rounded-[20px] [padding:4px_9px] text-[10px]! text-muted cursor-pointer" aria-label="View stock mix proposal" onClick={() => reviewRef.current?.scrollIntoView({ block: "start" })}>Stock mix · {basket.allocations.length} stocks <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></button></div>
            </div>
            <div className="stock-mix-suggestions" aria-label="Try a sample request">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => submit(prompt)}>{prompt}<span aria-hidden><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></button>)}</div>
            <AgentComposerView connected isSending={false} composer={composer} composerRef={composerRef} placeholder="Try “Add Tesla” or “Use $500”…" onComposerChange={(value) => setComposer(value.slice(0, 180))} onSubmit={() => submit(composer)} onStop={() => {}} />
          </div>
          <aside className="min-w-0 [border-left:1px_solid_var(--border)] bg-[#fafaf8] [padding:19px_22px_24px] at-most-1023:[padding:18px_16px_22px] at-most-700:[border-left:0] at-most-700:[border-top:1px_solid_var(--border)] at-most-700:[padding:18px_14px_22px]" aria-label="Stock mix working set">
            <div className="stock-mix-working-heading"><h3 ref={reviewRef} tabIndex={review ? -1 : undefined}>{review ? "Review your mix" : "Working set"}</h3>{review ? <Button size="sm" variant="ghost" onClick={() => { setReview(false); composerRef.current?.focus(); }}><HugeiconsIcon icon={ArrowLeft01Icon} size={13} />Back</Button> : <span>1 proposal</span>}</div>
            <div className="stock-mix-result reveal-result" key={`${review}:${budget}:${holdings.map((holding) => `${holding.symbol}-${holding.weight}`).join(",")}`}>
              {review ? <><BasketReview basket={basket} /><ButtonLink href="/app" className="mt-4 h-10 w-full rounded-[12px]" variant="primary">Open Oren <HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></ButtonLink></> : <BasketProposal basket={basket} onReview={() => setReview(true)} />}
            </div>
          </aside>
        </div>
        <footer className="flex justify-between gap-[15px] [padding:13px_24px] [border-top:1px_solid_var(--border)] text-[#9b978c] text-[9px] bg-[#fdfdfb] at-most-700:[padding:12px_15px] at-most-700:text-[8px] at-most-700:flex-wrap at-most-700:gap-[5px]"><span>Interactive demo</span><span>Sample requests and allocations. No funds move.</span></footer>
      </div>
    </div>
  </section>;
}
