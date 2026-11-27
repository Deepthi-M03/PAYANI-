import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const styles: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-active disabled:bg-primary/60",
  secondary:
    "bg-surface text-ink border border-steel hover:border-primary hover:text-primary disabled:opacity-60",
  ghost: "bg-transparent text-ink hover:bg-mist disabled:opacity-60",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  loading = false,
  icon,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded px-5 text-sm font-semibold transition-colors duration-[var(--duration-fast)] ease-[var(--ease-ui)] disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
