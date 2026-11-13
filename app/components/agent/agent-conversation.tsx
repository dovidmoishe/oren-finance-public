'use client';

import {
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Loading03Icon,
  SparklesIcon,
  Wallet02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import type { RefObject } from 'react';
import type {
  AgentArtifactDensity,
  AgentDisplayMessage,
  AgentRecentThread,
  AgentToolActivity,
  BasketResponse,
  LimitOrderProposal,
  QuoteResponse,
} from '@/types';
import { Button, cn, formatDate } from '@/components/ui';
import { useOrenAuth } from '@/components/auth/auth-context';
import { AgentArtifacts } from './agent-artifacts';
import { AgentMessageBody } from './agent-message-body';
import { toolLabel } from './agent-utils';
import { AgentComposerView } from './agent-composer-view';
import { useI18n, useT } from "@/i18n/i18n";

function Icon({ icon, size = 18, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon className={className} color="currentColor" icon={icon} size={size} strokeWidth={1.8} />;
}

export function AgentMessage({
  message,
  artifactDensity = 'inline',
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: {
  message: AgentDisplayMessage;
  artifactDensity?: AgentArtifactDensity;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-[20px] rounded-br-[7px] bg-foreground px-4 py-3 text-sm leading-6 text-white">
          {message.content}
          {message.interrupted ? <p className="mt-2 text-[10px] text-white/55">{t("agent.interrupted")}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <article>
      {message.activities?.length ? <ToolTrace activities={message.activities} /> : null}
      {message.content ? (
        <AgentMessageBody content={message.content} />
      ) : message.streaming ? (
        <span className="t-shimmer text-sm" data-text={t("agent.thinking")}>
          {t("agent.thinking")}
        </span>
      ) : null}
      {!message.streaming && !message.interrupted && message.artifacts?.length ? (
        <AgentArtifacts
          artifacts={message.artifacts}
          density={artifactDensity}
          onNavigate={onNavigate}
          onReviewBasket={onReviewBasket}
          onReviewLimitOrder={onReviewLimitOrder}
          onReviewQuote={onReviewQuote}
        />
      ) : null}
      {message.interrupted && message.content ? (
        <p className="mt-2 text-xs text-muted">{t("agent.stopped")}</p>
      ) : null}
    </article>
  );
}

function ToolTrace({ activities }: { activities: AgentToolActivity[] }) {
  const running = activities.some((activity) => activity.status === 'running');
  return (
    <details className="mb-3 rounded-[15px] border border-border bg-panel-subtle px-3 py-2" open={running}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted">
        <Icon
          className={running ? 'animate-spin' : ''}
          icon={running ? Loading03Icon : CheckmarkCircle01Icon}
          size={13}
        />
        {running
          ? toolLabel(activities.find((item) => item.status === 'running')!.toolName)
          : `${activities.length} source${activities.length === 1 ? '' : 's'} checked`}
      </summary>
      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        {activities.map((activity) => (
          <div
            className={cn(
              'flex items-start gap-2 text-[11px]',
              activity.status === 'failed' ? 'text-negative' : 'text-muted',
            )}
            key={activity.callId}
          >
            <Icon
              className={activity.status === 'running' ? 'animate-spin' : ''}
              icon={
                activity.status === 'failed'
                  ? CancelCircleIcon
                  : activity.status === 'running'
                    ? Loading03Icon
                    : CheckmarkCircle01Icon
              }
              size={12}
            />
            <span>
              {toolLabel(activity.toolName)}
              {activity.error ? ` — ${activity.error}` : ''}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function EmptyConversation({
  prompts,
  onPrompt,
}: {
  prompts: string[];
  onPrompt: (prompt: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-full flex-col justify-center py-8">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-accent-pink-soft">
        <Icon icon={SparklesIcon} size={21} />
      </div>
      <h3 className="mt-5 font-display text-2xl font-semibold">{t("agent.emptyTitle")}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
        {t("agent.emptyBody")}
      </p>
      <div className="mt-6 grid gap-2">
        {prompts.map((prompt) => (
          <button
            className="rounded-[17px] border border-border bg-panel px-4 py-3 text-left text-sm font-medium transition-colors hover:border-border-strong hover:bg-panel-subtle"
            key={prompt}
            onClick={() => onPrompt(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  const auth = useOrenAuth();
  const t = useT();
  return (
    <div className="flex h-full flex-col justify-center rounded-[24px] bg-accent-pink-soft p-6">
      <div className="grid h-12 w-12 place-items-center rounded-[18px] bg-white">
        <Icon icon={Wallet02Icon} size={20} />
      </div>
      <h3 className="mt-5 font-display text-2xl font-semibold">{t("agent.disconnectedTitle")}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        {auth.authenticated ? auth.error || t("agent.preparingWallet") : t("agent.signInBody")}
      </p>
      {(!auth.authenticated || auth.error) && <Button className="mt-6 h-11 rounded-[15px]" onClick={auth.authenticated ? () => void auth.createWallet() : onConnect} variant="primary">
        <Icon icon={Wallet02Icon} size={16} />
        {auth.authenticated ? t("agent.retryWallet") : t("agent.signIn")}
      </Button>}
    </div>
  );
}

export function ConversationHistory({
  recentThreads,
  activeThreadId,
  disabled,
  onSelect,
}: {
  recentThreads: AgentRecentThread[];
  activeThreadId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const { locale, timeZone, t } = useI18n();
  return (
    <div className="absolute inset-x-3 top-[70px] z-10 max-h-[55%] overflow-y-auto rounded-[22px] border border-border bg-panel p-2 shadow-[0_22px_60px_rgba(23,23,23,0.16)]">
      <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {t("agent.recent")}
      </p>
      {recentThreads.length ? (
        recentThreads.map((thread) => (
          <button
            className={cn(
              'w-full rounded-[15px] px-3 py-2.5 text-left hover:bg-panel-subtle',
              thread.id === activeThreadId && 'bg-panel-subtle',
            )}
            disabled={disabled}
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            type="button"
          >
            <p className="truncate text-sm font-medium">{thread.title}</p>
            <p className="mt-0.5 text-[10px] text-muted">{formatDate(thread.updatedAt, locale, timeZone, t("common.notUpdated"))}</p>
          </button>
        ))
      ) : (
        <p className="px-3 py-5 text-sm text-muted">{t("agent.noRecent")}</p>
      )}
    </div>
  );
}

export function AgentConversationThread({
  connected,
  isLoadingHistory,
  messages,
  prompts,
  error,
  artifactDensity = 'inline',
  scrollRef,
  shouldFollowRef,
  onPrompt,
  onRetry,
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
  onConnect,
}: {
  connected: boolean;
  isLoadingHistory: boolean;
  messages: AgentDisplayMessage[];
  prompts: string[];
  error?: string;
  artifactDensity?: AgentArtifactDensity;
  scrollRef: RefObject<HTMLDivElement | null>;
  shouldFollowRef: RefObject<boolean>;
  onPrompt: (prompt: string) => void;
  onRetry: () => void;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
  onConnect: () => void;
}) {
  const t = useT();
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5"
      onScroll={(event) => {
        const node = event.currentTarget;
        shouldFollowRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
      }}
      ref={scrollRef}
    >
      {!connected ? (
        <DisconnectedState onConnect={onConnect} />
      ) : isLoadingHistory ? (
        <div className="grid h-full place-items-center text-sm text-muted">
          <span className="t-shimmer" data-text={t("agent.restoring")}>
            {t("agent.restoring")}
          </span>
        </div>
      ) : messages.length === 0 ? (
        <EmptyConversation onPrompt={onPrompt} prompts={prompts} />
      ) : (
        <div className="space-y-6">
          {messages.map((message) => (
            <AgentMessage
              artifactDensity={artifactDensity}
              key={message.id}
              message={message}
              onNavigate={onNavigate}
              onReviewBasket={onReviewBasket}
              onReviewLimitOrder={onReviewLimitOrder}
              onReviewQuote={onReviewQuote}
            />
          ))}
          {error ? (
            <div className="rounded-[18px] border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 shrink-0" icon={CancelCircleIcon} size={14} />
                <span className="flex-1">{error}</span>
                <button
                  className="font-semibold underline underline-offset-2"
                  onClick={() => void onRetry()}
                  type="button"
                >
                  {t("agent.retry")}
                </button>
              </div>
            </div>
          ) : null}
          {messages.some((message) => message.role === 'assistant' && message.content) ? (
            <p className="pt-2 text-[11px] leading-4 text-muted">
              {t("agent.disclaimer")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AgentComposer(props: Omit<Parameters<typeof AgentComposerView>[0], 'placeholder'>) {
  const auth = useOrenAuth();
  const t = useT();
  const placeholder = props.connected
    ? t("agent.placeholder")
    : auth.authenticated ? t("agent.placeholderPreparing") : t("agent.placeholderSignIn");
  return <AgentComposerView {...props} placeholder={placeholder} />;
}
