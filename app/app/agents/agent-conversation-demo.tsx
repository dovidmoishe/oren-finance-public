'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { OrenLogo } from '@/components/brand/oren-logo';

export function AgentConversationDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let started = false;
    const motionChange = () => {
      setReduced(media.matches);
      if (media.matches) { setBeat(4); setPlaying(false); }
    };
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      setReduced(media.matches);
      if (entry.isIntersecting && !started && !media.matches) {
        started = true;
        setBeat(0);
        setPlaying(true);
      }
    }, { threshold: 0.3 });
    if (root.current) observer.observe(root.current);
    media.addEventListener('change', motionChange);
    return () => { observer.disconnect(); media.removeEventListener('change', motionChange); };
  }, []);

  useEffect(() => {
    if (!playing || !visible || reduced || beat === 4) return;
    const timer = window.setTimeout(() => setBeat(value => value + 1), [400, 1600, 2600, 1900][beat]);
    return () => window.clearTimeout(timer);
  }, [beat, playing, visible, reduced]);

  const reveal = (shown: boolean) => `t-stagger${shown ? ' is-shown' : ''}`;
  return <div ref={root} className="agents-conversation">
    <div className="agents-conversation-bar">
      <span className="agents-conversation-identity"><OrenLogo size={25} /><strong>Oren</strong><span>Example conversation</span></span>
      {!reduced && <button type="button" className="agents-demo-control" onClick={() => {
        if (beat === 4) { setBeat(0); setPlaying(true); }
        else setPlaying(value => !value);
      }}><HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true" />{beat === 4 ? 'Replay' : playing ? 'Pause' : 'Play'}</button>}
    </div>
    <div className="agents-transcript" aria-hidden="true">
      <div className={reveal(beat >= 1)}><div className={`t-stagger-line agents-user-message`}>Buy $5 of NVIDIA.</div></div>
      <div className="agents-reply-slot">
        {beat === 1 && <span className="agents-thinking">Checking your limits<span>…</span></span>}
        <div className={reveal(beat >= 2)}><div className={`t-stagger-line agents-demo-reply`}>
          <p>Bought <strong>$5 of NVIDIA.</strong></p>
          <div className="agents-trade-receipt"><span>0.024 NVDA</span><span>$45 left today</span></div>
        </div></div>
      </div>
      <div className={reveal(beat >= 3)}><div className={`t-stagger-line agents-user-message`}>Sell all my Tesla.</div></div>
      <div className="agents-reply-slot">
        {beat === 3 && <span className="agents-thinking">Preparing your review<span>…</span></span>}
        <div className={reveal(beat >= 4)}><div className={`t-stagger-line agents-demo-reply`}>
          <p>That’s <strong>$82.10</strong>, above your limit.</p>
        </div></div>
      </div>
    </div>
    <p className="agents-screen-reader-only">Example: You ask to buy $5 of NVIDIA. Oren buys 0.024 NVDA within your $25 per-trade limit, leaving $45 today. You ask to sell all your Tesla. The $82.10 trade exceeds your limit. Prices and amounts are illustrative.</p>
    <div className="agents-conversation-footer"><span className="[width:5px] [height:5px] [border-radius:50%] [background:#81916e]" />Your wallet. Your limits. Your call.</div>
  </div>;
}
