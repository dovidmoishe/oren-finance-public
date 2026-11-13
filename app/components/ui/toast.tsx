"use client";

import { CancelCircleIcon, CheckmarkCircle01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "./utils";

type ToastTone = "info" | "success" | "error";

const icons: Record<ToastTone, IconSvgElement> = {
  info: InformationCircleIcon,
  success: CheckmarkCircle01Icon,
  error: CancelCircleIcon,
};

const tones: Record<ToastTone, string> = {
  info: "border-border bg-panel text-foreground",
  success: "border-green-200 bg-green-50 text-green-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

export function Toast({
  title,
  description,
  tone = "info",
}: {
  title: string;
  description?: string;
  tone?: ToastTone;
}) {
  return (
    <div className={cn("rounded-lg border p-4 text-sm shadow-sm", tones[tone])}>
      <div className="flex gap-3">
        <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={icons[tone]} size={16} strokeWidth={1.8} />
        <div>
          <p className="font-medium">{title}</p>
          {description ? <p className="mt-1 opacity-75">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}
