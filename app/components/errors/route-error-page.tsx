"use client";

import { ArrowLeft01Icon, RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { OrenLogo } from "@/components/brand/oren-logo";
import { Button } from "@/components/ui";

interface RouteErrorPageProps {
  reset?: () => void;
  title?: string;
  description?: string;
}

export function RouteErrorPage({
  reset,
  title = "We lost the trail for a moment.",
  description = "Oren couldn’t finish loading this page. If you were submitting a trade, check your wallet activity before trying again.",
}: RouteErrorPageProps) {
  return (
    <main className="min-h-screen bg-[#faf9f5] p-3 text-foreground sm:p-5">
      <section className="relative mx-auto grid min-h-[calc(100vh-24px)] max-w-[1540px] overflow-hidden rounded-[30px] border border-black/8 bg-[#f7f2e8] shadow-[0_24px_80px_rgba(54,43,28,0.08)] sm:min-h-[calc(100vh-40px)] lg:grid-cols-[minmax(420px,0.78fr)_minmax(520px,1.22fr)]">
        <div className="relative z-10 flex flex-col p-7 sm:p-10 lg:p-14 xl:p-20">
          <Link className="inline-flex w-fit items-center gap-2" href="/">
            <OrenLogo className="h-9 w-9" size={36} />
            <span className="font-display text-xl font-semibold">Oren</span>
          </Link>

          <div className="my-auto max-w-xl py-16">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#8c725c]">Temporary detour</p>
            <h1 className="mt-5 text-pretty font-display text-[clamp(3rem,6vw,6.6rem)] font-semibold leading-[0.88] tracking-[-0.065em]">
              {title}
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-[#6e665d] sm:text-lg">{description}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              {reset ? (
                <Button className="h-12 rounded-full px-6" onClick={reset} variant="primary">
                  <HugeiconsIcon color="currentColor" icon={RefreshCwIcon} size={17} strokeWidth={1.8} />
                  Try again
                </Button>
              ) : null}
              <Button className="h-12 rounded-full px-6" href="/app" variant="secondary">
                <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={17} strokeWidth={1.8} />
                Back to dashboard
              </Button>
            </div>
          </div>

          <p className="text-xs leading-5 text-[#8d857b]">Oren proposes. Your wallet approves. A page error does not tell us whether a transaction was submitted.</p>
        </div>

        <div className="relative min-h-[42vh] overflow-hidden border-t border-black/8 lg:min-h-0 lg:border-l lg:border-t-0">
          {/* This intentionally bypasses Next image optimization because the
              production VPS cannot load sharp's x64-v2 binary. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="A sunrise path pausing at a quiet break before continuing toward the mountains"
            className="absolute inset-0 h-full w-full object-cover object-center lg:object-[58%_center]"
            src="/oren-error-landscape.png"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#f7f2e8]/30 via-transparent to-[#f7f2e8]/15 lg:bg-gradient-to-r lg:from-[#f7f2e8]/55 lg:via-transparent lg:to-transparent" />
        </div>
      </section>
    </main>
  );
}
