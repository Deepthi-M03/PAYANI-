import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "inverse";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)] hover:bg-primary-hover active:bg-primary-active disabled:bg-primary/55",
  secondary: "bg-surface text-ink border border-steel/70 hover:border-primary hover:bg-ivory disabled:opacity-60",
  ghost: "bg-transparent text-ink hover:bg-mist disabled:opacity-60",
  danger: "bg-error text-white hover:bg-[#a51f1f] disabled:opacity-60",
  inverse: "bg-white text-navy hover:bg-mist disabled:opacity-60",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-5 text-sm gap-2",
  lg: "min-h-12 px-6 text-base gap-2",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra = "") =>
  `inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-ui)] active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0 ${variants[variant]} ${sizes[size]} ${extra}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading = false, icon, disabled, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)} {...rest}>
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** A router link that looks like a button (navigation, not an action). */
export function LinkButton({ variant = "primary", size = "md", icon, className = "", children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
