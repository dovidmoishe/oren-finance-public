"use client";
import { Tick02Icon, Copy01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';


import { useEffect, useState } from "react";

const MINT = "57vAaMsnAJXkvULtAz7fsi6gRn3bHRJFJsJV1okNpump";

export function TokenAddress() {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(MINT);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return <div className="mt-[22px] relative max-w-full">
    <div className="token-mint-chip">
      <span className="text-[10px] text-[#8a857b] tracking-[.06em]">Token address</span>
      <a href={`https://solscan.io/token/${MINT}`} target="_blank" rel="noopener noreferrer" title={MINT} aria-label={`View official Oren mint ${MINT} on Solscan`}>
        <span className="at-most-1100:hidden">{MINT}</span><span className="hidden at-most-1100:inline" aria-hidden="true">57vAaMsn…1okNpump</span>
      </a>
      <button type="button" onClick={copyAddress} aria-label={status === "copied" ? "Address copied" : "Copy token address"} title="Copy token address">
        <HugeiconsIcon icon={status === "copied" ? Tick02Icon : Copy01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" />
      </button>
    </div>
    <span className="absolute top-full left-0 mt-[4px] text-[11px] text-[#73578d]" role="status">{status === "error" ? "Couldn’t copy. Open the address on Solscan to copy it." : ""}</span>
  </div>;
}
