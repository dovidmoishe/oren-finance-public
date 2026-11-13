import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export type ButtonVariant = "white" | "black" | "blue" | "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

type SharedButtonProps = {
  children: ReactNode;
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

type ButtonLinkProps = SharedButtonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedButtonProps | "href"> & {
    href: string;
  };

type ButtonActionProps = SharedButtonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedButtonProps> & {
    href?: undefined;
  };

export type ButtonProps = ButtonLinkProps | ButtonActionProps;

const baseClasses =
  "group relative inline-flex items-center justify-center overflow-hidden rounded-[12px] font-semibold transition-[background-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  white: "border border-border bg-white text-foreground shadow-sm hover:border-border-strong hover:bg-panel-subtle",
  black: "bg-foreground text-white shadow-[0_10px_24px_rgba(23,23,23,0.12)] hover:bg-black/85",
  blue: "bg-sky-600 text-white shadow-[0_10px_24px_rgba(2,132,199,0.24)] hover:bg-sky-700",
  primary: "bg-foreground text-white shadow-[0_10px_24px_rgba(23,23,23,0.12)] hover:bg-black/85",
  secondary: "border border-border bg-panel text-foreground shadow-sm hover:border-border-strong hover:bg-panel-subtle",
  ghost: "text-muted hover:bg-panel-subtle hover:text-foreground",
  danger: "bg-negative text-white shadow-sm hover:bg-red-500",
};

const sheenClasses: Record<ButtonVariant, string> = {
  white: "via-sky-200/95",
  black: "via-white/60",
  blue: "via-white/55",
  primary: "via-white/60",
  secondary: "via-sky-200/95",
  ghost: "via-slate-200/70",
  danger: "via-white/55",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "oren-btn-sm px-3 text-xs",
  md: "oren-btn-md px-4 text-sm",
  lg: "oren-btn-lg px-8 text-base",
  icon: "oren-btn-icon",
};

function getButtonClasses(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
}

function getButtonContent(children: ReactNode, variant: ButtonVariant) {
  return (
    <>
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 -left-[130%] z-0 w-[86%] -skew-x-12 bg-gradient-to-r from-transparent to-transparent opacity-0 transition-[left,opacity] duration-700 ease-out group-hover:left-[138%] group-hover:opacity-100 group-focus-visible:left-[138%] group-focus-visible:opacity-100 motion-reduce:hidden",
          sheenClasses[variant],
        )}
      />
    </>
  );
}

export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { children, className, href, size = "md", variant = "secondary", ...anchorProps } = props;
    return (
      <Link className={getButtonClasses(variant, size, className)} href={href} {...anchorProps}>
        {getButtonContent(children, variant)}
      </Link>
    );
  }

  const { children, className, size = "md", type = "button", variant = "secondary", ...buttonProps } = props;
  return (
    <button className={getButtonClasses(variant, size, className)} type={type} {...buttonProps}>
      {getButtonContent(children, variant)}
    </button>
  );
}

export function ButtonLink(props: ButtonLinkProps) {
  return <Button {...props} />;
}
