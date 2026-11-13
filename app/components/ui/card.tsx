import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn("oren-card border border-border bg-panel shadow-[0_18px_60px_rgba(23,23,23,0.04)]", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("oren-card-header border-b border-border", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("oren-card-content", className)} {...props} />;
}
