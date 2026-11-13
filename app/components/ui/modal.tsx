"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "./button";
import { cn } from "./utils";
import { useT } from "@/i18n/i18n";

interface ModalProps {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  side?: "center" | "right";
}

export function Modal({ open, title, children, onClose, side = "center" }: ModalProps) {
  const t = useT();
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/25 p-4 backdrop-blur-sm">
      <div
        className={cn(
          "relative max-h-full overflow-auto rounded-lg border border-border bg-panel shadow-xl",
          side === "right" ? "ml-auto h-full w-full max-w-md" : "m-auto w-full max-w-lg",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <Button aria-label={t("common.close")} onClick={onClose} size="icon" variant="ghost">
            <HugeiconsIcon color="currentColor" icon={Cancel01Icon} size={18} strokeWidth={1.8} />
          </Button>
        </div>
        <div className="p-[var(--app-card-padding,1.25rem)]">{children}</div>
      </div>
    </div>
  );
}
