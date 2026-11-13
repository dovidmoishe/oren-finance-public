"use client";

import { useEffect, type RefObject } from "react";

/** Reveal each block once without tying rendering to the scroll position. */
export function useLandingReveal<T extends HTMLElement>(root: RefObject<T | null>) {
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const targets = [...node.querySelectorAll<HTMLElement>("[data-reveal]")];
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          target.dataset.reveal = "shown";
          observer.unobserve(target);
        } else if (entry.boundingClientRect.bottom < 0) {
          target.dataset.reveal = "immediate";
          observer.unobserve(target);
        }
      }
    }, { rootMargin: "0px 0px -36px 0px", threshold: 0 });

    const finish = () => {
      observer.disconnect();
      targets.forEach((target) => { target.dataset.reveal = "immediate"; });
    };
    if (media.matches) finish();
    else for (const target of targets) {
      // Keep restored anchors and already-visible content readable during hydration.
      if (target.getBoundingClientRect().top < window.innerHeight) target.dataset.reveal = "immediate";
      else { target.dataset.reveal = "pending"; observer.observe(target); }
    }

    const onMotionChange = () => { if (media.matches) finish(); };
    const onFocus = (event: FocusEvent) => {
      for (const target of targets) if (event.target instanceof Node && target.contains(event.target)) {
        target.dataset.reveal = "immediate";
        observer.unobserve(target);
      }
    };
    media.addEventListener("change", onMotionChange);
    node.addEventListener("focusin", onFocus);
    return () => { observer.disconnect(); media.removeEventListener("change", onMotionChange); node.removeEventListener("focusin", onFocus); };
  }, [root]);
}
