import { AlertCircleIcon, InboxIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "./button";
import { cn } from "./utils";
import { T } from "@/i18n/t";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[20px] bg-panel-subtle", className)} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-[24px] border border-dashed border-border bg-panel p-8 text-center shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
      <HugeiconsIcon className="mb-3 text-muted" color="currentColor" icon={InboxIcon} size={24} strokeWidth={1.8} />
      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title?: React.ReactNode;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-[20px] border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <div className="flex gap-3">
        <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={16} strokeWidth={1.8} />
        <div>
          <p className="font-medium">{title ?? <T k="common.somethingWrong" />}</p>
          {description ? <p className="mt-1 text-red-700">{description}</p> : null}
          {onRetry ? (
            <Button className="mt-3" onClick={onRetry} size="sm" variant="secondary">
              <T k="common.retry" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LoadingState({ label }: { label?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={16} strokeWidth={1.8} />
      {label ?? <T k="common.loading" />}
    </div>
  );
}
