'use client';

import type { RefObject } from 'react';
import { ArrowUp02Icon, StopCircleIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '@/components/ui';
import { useT } from "@/i18n/i18n";

export function AgentComposerView({
  placeholder,
  connected,
  isSending,
  composer,
  composerRef,
  onComposerChange,
  onSubmit,
  onStop,
}: {
  placeholder: string;
  connected: boolean;
  isSending: boolean;
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const t = useT();
  return (
    <footer className="shrink-0 border-t border-border bg-panel/95 p-3 backdrop-blur">
      <div className="rounded-[20px] border border-border-strong bg-panel-subtle p-2 focus-within:border-foreground">
        <textarea
          aria-label={t("agent.ask")}
          className="max-h-32 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-2"
          disabled={!connected || isSending}
          maxLength={4000}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          ref={composerRef}
          rows={1}
          value={composer}
        />
        <div className="flex items-center justify-between gap-3 px-1 pb-1">
          <p className="text-[10px] text-muted">{t("agent.proposes")}</p>
          {isSending ? (
            <Button
              aria-label={t("agent.stop")}
              className="h-9 w-9 rounded-full"
              onClick={onStop}
              size="icon"
              variant="secondary"
            >
              <HugeiconsIcon color="currentColor" icon={StopCircleIcon} size={16} strokeWidth={1.8} />
            </Button>
          ) : (
            <Button
              aria-label={t("agent.send")}
              className="h-9 w-9 rounded-full"
              disabled={!connected || !composer.trim()}
              onClick={() => onSubmit()}
              size="icon"
              variant="primary"
            >
              <HugeiconsIcon color="currentColor" icon={ArrowUp02Icon} size={16} strokeWidth={1.8} />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
