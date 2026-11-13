"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function LandingHeader({ children }: { children: ReactNode }) {
  const top = useRef<HTMLSpanElement>(null);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!top.current || !header.current) return;
    const node = header.current;
    const observer = new IntersectionObserver(([entry]) => {
      node.dataset.scrolled = String(!entry.isIntersecting);
    });
    observer.observe(top.current);
    return () => observer.disconnect();
  }, []);

  return <>
    <span ref={top} aria-hidden className="absolute top-0 left-0 w-[1px] h-[8px] pointer-events-none" />
    <header ref={header} className="landing-navigation" data-scrolled="false">{children}</header>
  </>;
}
