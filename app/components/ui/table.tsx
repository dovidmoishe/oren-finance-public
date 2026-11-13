import type { HTMLAttributes, TableHTMLAttributes } from "react";
import { cn } from "./utils";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-panel-subtle/70 text-left text-xs text-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("align-middle", className)} {...props} />;
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("oren-table-cell font-semibold", className)} {...props} />;
}

export function TableCell({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("oren-table-cell", className)} {...props} />;
}
