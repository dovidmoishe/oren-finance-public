'use client';

import { Add01Icon, Cancel01Icon, HistoryIcon, ArrowExpand01Icon, ArrowShrink01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore, usePortfolioStore, useStockStore } from '@/store';
import type { BasketResponse, LimitOrderProposal, QuoteResponse } from '@/types';
import { useWalletModal } from '@/components/auth/wallet-modal-context';
import { OrenLogo, type OrenLogoState } from '@/components/brand/oren-logo';
import { Button, cn } from '@/components/ui';
import { AgentActionReview } from './agent-action-review';
import {
  AgentComposer,
  AgentConversationThread,
  ConversationHistory,
} from './agent-conversation';
import { contextLabelKey, pageContext, promptSuggestions } from './agent-utils';
import { AgentWorkspace, latestAssistantArtifacts } from './agent-workspace';
import { useT } from "@/i18n/i18n";

function Icon({ icon, size = 18, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

function ExpandIcon({ size = 17 }: { size?: number }) {
  return (
    <HugeiconsIcon icon={ArrowExpand01Icon} size={size} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="shrink-0" />
  );
}

function CollapseIcon({ size = 17 }: { size?: number }) {
  return (
    <HugeiconsIcon icon={ArrowShrink01Icon} size={size} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="shrink-0" />
  );
}

export function AgentPanel() {
  const pathname = usePathname();
  const t = useT();
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const selectedStock = useStockStore((state) => state.selected);
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);
  const walletAddress = publicKey?.toBase58();
  const panelOpen = useAgentStore((state) => state.panelOpen);
  const expanded = useAgentStore((state) => state.expanded);
  const hydrated = useAgentStore((state) => state.hydrated);
  const threadId = useAgentStore((state) => state.threadId);
  const messages = useAgentStore((state) => state.messages);
  const recentThreads = useAgentStore((state) => state.recentThreads);
  const isLoadingHistory = useAgentStore((state) => state.isLoadingHistory);
  const isSending = useAgentStore((state) => state.isSending);
  const error = useAgentStore((state) => state.error);
  const initialize = useAgentStore((state) => state.initialize);
  const setPanelOpen = useAgentStore((state) => state.setPanelOpen);
  const setExpanded = useAgentStore((state) => state.setExpanded);
  const newChat = useAgentStore((state) => state.newChat);
  const loadThread = useAgentStore((state) => state.loadThread);
  const sendMessage = useAgentStore((state) => state.sendMessage);
  const stop = useAgentStore((state) => state.stop);
  const retry = useAgentStore((state) => state.retry);
  const [composer, setComposer] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [reviewQuote, setReviewQuote] = useState<QuoteResponse>();
  const [reviewBasket, setReviewBasket] = useState<BasketResponse>();
  const [reviewLimitOrder, setReviewLimitOrder] = useState<LimitOrderProposal>();
  const [successFlash, setSuccessFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasSendingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reviewOriginRef = useRef<HTMLElement | null>(null);
  const shouldFollowRef = useRef(true);
  const context = useMemo(() => pageContext(pathname), [pathname]);
  const prompts = useMemo(
    () => promptSuggestions(context, selectedStock?.ticker),
    [context, selectedStock?.ticker],
  );
  const railArtifacts = useMemo(() => latestAssistantArtifacts(messages), [messages]);
  const logoState = useMemo((): OrenLogoState => {
    if (successFlash) return 'success';
    if (error) return 'alert';
    if (!isSending) return 'idle';

    const lastMessage = messages.at(-1);
    const hasRunningTool = lastMessage?.activities?.some((activity) => activity.status === 'running');
    return hasRunningTool ? 'processing' : 'thinking';
  }, [error, isSending, messages, successFlash]);

  useEffect(() => {
    if (wasSendingRef.current && !isSending && !error) {
      setSuccessFlash(true);
      const timer = window.setTimeout(() => setSuccessFlash(false), 720);
      wasSendingRef.current = isSending;
      return () => window.clearTimeout(timer);
    }
    wasSendingRef.current = isSending;
  }, [error, isSending]);

  const collapseToSidecar = useCallback(() => {
    setExpanded(false);
  }, [setExpanded]);

  const closePanel = useCallback(() => {
    setShowHistory(false);
    setPanelOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById('oren-agent-launcher')?.focus();
    });
  }, [setPanelOpen]);

  useEffect(() => {
    void initialize(walletAddress);
  }, [initialize, walletAddress]);

  useEffect(() => {
    if (!walletAddress || portfolio?.wallet === walletAddress) return;
    void loadPortfolio(walletAddress);
  }, [loadPortfolio, portfolio?.wallet, walletAddress]);

  useEffect(() => {
    if (!panelOpen || typeof window === 'undefined') return;
    const isMobileSidecar = !expanded && window.innerWidth < 640;
    const isExpandedOverlay = expanded && window.innerWidth >= 1024;
    if (!isMobileSidecar && !isExpandedOverlay) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [expanded, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || reviewQuote || reviewBasket || reviewLimitOrder) return;
      if (showHistory) {
        setShowHistory(false);
        return;
      }
      if (expanded) {
        collapseToSidecar();
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    closePanel,
    collapseToSidecar,
    expanded,
    panelOpen,
    reviewBasket,
    reviewLimitOrder,
    reviewQuote,
    showHistory,
  ]);

  useEffect(() => {
    if (!panelOpen || !hydrated) return;
    window.requestAnimationFrame(() => {
      const target = connected
        ? composerRef.current
        : panelRef.current?.querySelector<HTMLElement>('button');
      target?.focus();
    });
  }, [connected, hydrated, panelOpen]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [composer]);

  useEffect(() => {
    if (shouldFollowRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isSending]);

  const submit = async (value = composer) => {
    if (!walletAddress || !value.trim()) return;
    setComposer('');
    shouldFollowRef.current = true;
    await sendMessage(value, walletAddress, context);
  };

  const openQuoteReview = (quote: QuoteResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewQuote(quote);
  };

  const openBasketReview = (basket: BasketResponse) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewBasket(basket);
  };

  const openLimitOrderReview = (proposal: LimitOrderProposal) => {
    reviewOriginRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReviewLimitOrder(proposal);
  };

  const closeReview = () => {
    setReviewQuote(undefined);
    setReviewBasket(undefined);
    setReviewLimitOrder(undefined);
    window.requestAnimationFrame(() => reviewOriginRef.current?.focus());
  };

  const handleBackdropClick = () => {
    if (expanded) {
      collapseToSidecar();
      return;
    }
    closePanel();
  };

  const hasReviewOpen = Boolean(reviewQuote || reviewBasket || reviewLimitOrder);
  return (
    <>
      <div
        aria-hidden
        className={cn(
          'fixed inset-0 top-[var(--app-nav-height,4.5rem)] z-30 bg-black/20 backdrop-blur-[2px] transition-opacity',
          panelOpen && !expanded ? 'opacity-100 2xl:hidden' : 'pointer-events-none opacity-0',
        )}
        onClick={handleBackdropClick}
      />

      <div
        aria-hidden
        className={cn(
          'fixed inset-0 top-[var(--app-nav-height,4.5rem)] z-30 hidden bg-black/20 backdrop-blur-[2px] transition-opacity lg:block',
          panelOpen && expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={handleBackdropClick}
      />

      <aside
        aria-label={t("agent.copilotLabel")}
        aria-busy={isSending}
        aria-hidden={!panelOpen}
        className={cn(
          't-panel-slide fixed z-40 flex min-h-0 flex-col overflow-hidden border border-border bg-panel shadow-[0_28px_90px_rgba(23,23,23,0.18)]',
          expanded
            ? 't-agent-expanded inset-x-2 bottom-2 top-[calc(var(--app-nav-height,4.5rem)+0.5rem)] rounded-[28px] lg:inset-x-4 lg:bottom-4 lg:top-[calc(var(--app-nav-height,4.5rem)+1rem)]'
            : 'inset-x-2 bottom-2 top-[calc(var(--app-nav-height,4.5rem)+0.5rem)] rounded-[28px] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-[calc(var(--app-nav-height,4.5rem)+1rem)] sm:w-[380px] 2xl:right-5',
          !expanded && hasReviewOpen ? 'opacity-40' : '',
        )}
        data-expanded={expanded && panelOpen && hydrated}
        data-open={panelOpen && hydrated}
        inert={!panelOpen}
        ref={panelRef}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-visible rounded-[15px] bg-foreground">
              <OrenLogo size={30} state={logoState} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-display font-semibold">Oren</h2>
                {isSending ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" /> : null}
                {expanded ? (
                  <span className="hidden rounded-full bg-panel-subtle px-2.5 py-1 text-[10px] font-semibold text-muted lg:inline">
                    {t(...contextLabelKey(context, selectedStock?.ticker))}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-muted">
                {isSending ? t("agent.working") : t("agent.tagline")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              aria-label={t("agent.recent")}
              aria-expanded={showHistory}
              onClick={() => setShowHistory((value) => !value)}
              size="icon"
              variant="ghost"
            >
              <Icon icon={HistoryIcon} size={17} />
            </Button>
            <Button
              aria-label={t("agent.newConversation")}
              disabled={isSending}
              onClick={() => {
                newChat();
                setShowHistory(false);
              }}
              size="icon"
              variant="ghost"
            >
              <Icon icon={Add01Icon} size={18} />
            </Button>
            {expanded ? (
              <Button
                aria-label={t("agent.collapse")}
                className="hidden lg:inline-flex"
                onClick={collapseToSidecar}
                size="icon"
                variant="ghost"
              >
                <CollapseIcon />
              </Button>
            ) : (
              <Button
                aria-label={t("agent.expand")}
                className="hidden lg:inline-flex"
                onClick={() => setExpanded(true)}
                size="icon"
                variant="ghost"
              >
                <ExpandIcon />
              </Button>
            )}
            <Button aria-label={t("agent.close")} onClick={closePanel} size="icon" variant="ghost">
              <Icon icon={Cancel01Icon} size={18} />
            </Button>
          </div>
        </header>

        {showHistory ? (
          <ConversationHistory
            activeThreadId={threadId}
            disabled={isSending}
            onSelect={(id) => {
              void loadThread(id);
              setShowHistory(false);
            }}
            recentThreads={recentThreads}
          />
        ) : null}

        {expanded ? (
          <AgentWorkspace
            composer={composer}
            composerRef={composerRef}
            connected={connected}
            context={context}
            error={error}
            isLoadingHistory={isLoadingHistory}
            isSending={isSending}
            messages={messages}
            onComposerChange={setComposer}
            onConnect={() => setVisible(true)}
            onNavigate={collapseToSidecar}
            onPrompt={(prompt) => void submit(prompt)}
            onRetry={() => void retry()}
            onReviewBasket={openBasketReview}
            onReviewLimitOrder={openLimitOrderReview}
            onReviewQuote={openQuoteReview}
            onStop={stop}
            onSubmit={() => void submit()}
            prompts={prompts}
            railArtifacts={railArtifacts}
            scrollRef={scrollRef}
            shouldFollowRef={shouldFollowRef}
            ticker={selectedStock?.ticker}
          />
        ) : (
          <>
            <AgentConversationThread
              connected={connected}
              error={error}
              isLoadingHistory={isLoadingHistory}
              messages={messages}
              onConnect={() => setVisible(true)}
              onPrompt={(prompt) => void submit(prompt)}
              onRetry={() => void retry()}
              onReviewBasket={openBasketReview}
              onReviewLimitOrder={openLimitOrderReview}
              onReviewQuote={openQuoteReview}
              prompts={prompts}
              scrollRef={scrollRef}
              shouldFollowRef={shouldFollowRef}
            />
            <AgentComposer
              composer={composer}
              composerRef={composerRef}
              connected={connected}
              isSending={isSending}
              onComposerChange={setComposer}
              onStop={stop}
              onSubmit={() => void submit()}
            />
          </>
        )}
      </aside>

      <div aria-live="polite" className="sr-only">
        {!isSending && messages.at(-1)?.role === 'assistant' ? t("agent.complete") : ''}
      </div>

      <AgentActionReview
        basket={reviewBasket}
        limitOrder={reviewLimitOrder}
        onClose={closeReview}
        quote={reviewQuote}
      />
    </>
  );
}
