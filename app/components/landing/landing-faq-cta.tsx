"use client";
import { ArrowRight02Icon, ArrowDown01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import Link from "next/link";
import { useId, useRef, useState } from "react";
import { OrenLogo } from "@/components/brand/oren-logo";
import { ButtonLink } from "@/components/ui";
import { useLandingReveal } from "./use-landing-reveal";

const questions = [
  { question: "What is Oren?", answer: "Oren is an AI-powered trading terminal for tokenized stocks on Solana. Research stocks, build a mix, and follow your portfolio in one place." },
  { question: "What can I trade?", answer: "Supported tokenized stocks on Solana. Browse Markets to see the available companies, token details, and current quotes." },
  { question: "What can the AI agent do?", answer: "Ask about a stock, explore market signals, or build a stock mix. Oren helps with research and proposes trades for you to review." },
  { question: "Can Oren trade without my approval?", answer: "No. Oren proposes a trade, then you review the details and approve it before it is submitted. The final call is yours." },
  { question: "Do I need to set up a wallet first?", answer: "No. Sign in with your email and Oren prepares a Solana wallet for your account. You can fund it from the app." },
  { question: "What fees will I pay?", answer: "You can review the quote and estimated network fee before approving a trade. Costs vary with the trade and network conditions." },
];

function Arrow() {
  return <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />;
}

export function LandingFaqCta() {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState<number | null>(0);
  useLandingReveal(root);

  return <div ref={root} className="reveal-group">
    <section className="max-w-[1280px] [margin:0_auto] [padding:12px_48px_100px] grid grid-cols-[.85fr_1.4fr] gap-[100px] scroll-mt-[110px] at-most-1023:[padding:10px_32px_80px] at-most-1023:gap-[52px] at-most-1023:grid-cols-[.8fr_1.4fr] at-most-700:block at-most-700:[padding:12px_20px_65px]" id="faq" aria-labelledby="faq-heading">
      <div className="landing-faq-cta-faq-intro">
        <h2 id="faq-heading" aria-label="A few things to know." className="reveal-focus" data-reveal="ready">A few things{" "}<br />to know.</h2>
        <p className="mt-[20px] text-[13px] text-[#8b8175] leading-[1.7] at-most-700:mt-[13px] at-most-700:text-[12px]">Before you make your first move.</p>
      </div>
      <div className="landing-faq-cta-questions reveal-rise" data-reveal="ready">
        {questions.map((item, index) => {
          const expanded = open === index;
          const questionId = `${id}-question-${index}`;
          const answerId = `${id}-answer-${index}`;
          return <div key={item.question} className="accordion landing-faq-cta-item" data-open={expanded}>
            <h3>
              <button type="button" id={questionId} className="landing-faq-cta-question" aria-expanded={expanded} aria-controls={answerId} onClick={() => setOpen(current => current === index ? null : index)}>
                <span>{item.question}</span>
                <span className="accordion-chevron landing-faq-cta-chevron" aria-hidden="true"><HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span>
              </button>
            </h3>
            <div id={answerId} className="accordion-panel" role="region" aria-labelledby={questionId} aria-hidden={!expanded} inert={!expanded}>
              <div className="accordion-content"><p className="max-w-[515px] [padding:0_32px_23px_0] text-[#85796a] text-[13px] leading-[1.85] text-pretty at-most-700:text-[12px] at-most-700:[padding:0_25px_21px_0]">{item.answer}</p></div>
            </div>
          </div>;
        })}
      </div>
    </section>

    <section className="max-w-[1280px] [margin:0_auto] [padding:0_48px] scroll-mt-[96px] at-most-1023:[padding:0_32px] at-most-700:[padding:0_20px]" id="get-started" aria-labelledby="closing-heading">
      <div className="landing-faq-cta-invitation reveal-surface" data-reveal="ready">
        <div className="landing-faq-cta-landscape" aria-hidden="true" />
        <div className="landing-faq-cta-closing-copy">
          <h2 id="closing-heading" className="reveal-focus" data-reveal="ready">Start with<br />a question.</h2>
          <p className="max-w-[295px] mt-[18px] text-[#85796a] text-[13px] leading-[1.8] text-pretty at-most-700:text-[12px] at-most-700:max-w-[270px]">Research a stock, build a mix, and review your next trade with Oren.</p>
          <div className="flex items-center flex-wrap gap-[21px] mt-[23px] at-most-1023:gap-[16px] at-most-700:gap-[17px]">
            <ButtonLink href="/app" id="closing-launch-cta" variant="primary" className="h-11 rounded-full px-5 text-[13px] font-medium">Launch Oren <Arrow /></ButtonLink>
            <Link href="/app/markets" className="landing-faq-cta-market-link">Explore markets <span aria-hidden="true"><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></Link>
          </div>
        </div>
        <div className="relative grid place-items-center h-[280px] at-most-700:h-[210px]" aria-hidden="true">
          <div className="relative z-[1] w-[170px] h-[170px] [filter:drop-shadow(0_16px_22px_rgb(91_69_119_/_.1))] at-most-700:w-[135px] at-most-700:h-[135px]"><OrenLogo size={170} interactive attentionTargetId="closing-launch-cta" className="w-full! h-full!" /></div>
          <span className="absolute top-[77%] left-[50%] [transform:translateX(-50%)] w-[106px] h-[10px] rounded-[50%] bg-[#766784] opacity-[.15] [filter:blur(8px)] pointer-events-none at-most-700:top-[80%] at-most-700:w-[88px]" />
        </div>
      </div>
    </section>

  </div>;
}
