import type { UseQueryResult } from "@tanstack/react-query";
import { Inbox, RefreshCw } from "lucide-react";
import { useId, type ComponentType, type ReactNode, type SelectHTMLAttributes } from "react";

import { ApiError } from "../lib/api";
import { STATUS_LABEL } from "../lib/format";
import { Alert } from "./Alert";
import { Button } from "./Button";

/** Page title block. `eyebrow` names the module ("Book", "Pulse") so every screen says where you are. */
export function PageHeader({ eyebrow, title, intro, actions, meta }: {
  eyebrow?: string; title: ReactNode; intro?: ReactNode; actions?: ReactNode; meta?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 font-mono text-xs font-medium text-saffron-text">{eyebrow}</p>}
        <h1 className="font-display text-[1.75rem] leading-tight text-ink sm:text-[2rem]">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-muted">{intro}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, body, action, icon: Icon = Inbox }: { title: string; body?: string; action?: ReactNode; icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-steel/50 bg-surface px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-ivory text-primary"><Icon aria-hidden className="size-6" /></span>
      <p className="text-base font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.problem.detail ? `${err.problem.title} ${err.problem.detail}` : err.problem.title;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

/** Placeholder blocks shaped like the content that is loading. */
export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`flex flex-col gap-3 ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-16" style={{ opacity: 1 - i * 0.18 }} />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Loading, error (with retry) and success states for a query, in one place. */
export function QueryState<T>({ query, children, skeleton }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; skeleton?: ReactNode }) {
  if (query.isPending) return <>{skeleton ?? <Skeleton />}</>;
  if (query.isError)
    return (
      <Alert tone="error" title={errorText(query.error)}>
        <Button variant="secondary" size="sm" className="mt-3" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => query.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  return <>{children(query.data as T)}</>;
}

const statusTone: Record<string, string> = {
  CONFIRMED: "text-success bg-success-tint",
  REFUNDED: "text-success bg-success-tint",
  FAILED: "text-error bg-error-tint",
  CANCELLED: "text-muted bg-mist",
  REFUND_PENDING: "text-warning bg-warning-tint",
  CANCELLATION_REQUESTED: "text-warning bg-warning-tint",
  PENDING_CONFIRMATION: "text-info bg-info-tint",
  SEARCHED: "text-warning bg-warning-tint",
  DRAFT: "text-muted bg-mist",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ${statusTone[status] ?? "bg-mist text-muted"}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Select({ label, children, className = "", hideLabel = false, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-medium text-ink"}>
        {label}
      </label>
      <select id={id} className="min-h-11 rounded-md border border-steel/70 bg-surface px-3 text-base text-ink transition-colors hover:border-steel focus:border-primary" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Toggle({ label, checked, onChange, description, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; description?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--duration-fast)] disabled:opacity-50 ${checked ? "bg-primary" : "bg-steel/45"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-[var(--duration-fast)] ease-[var(--ease-ui)] ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/** A key figure. Numbers are set in Plex Mono so columns of figures line up. */
export function Stat({ label, value, hint, icon: Icon, tone = "default" }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone?: "default" | "warning" | "success";
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted">{label}</p>
        {Icon && <Icon aria-hidden className="size-4 text-steel" />}
      </div>
      <p className={`font-mono text-[1.75rem] font-medium leading-none tabular ${tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink"}`}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SandboxNote({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-info/20 bg-info-tint px-3 py-2 text-xs font-medium text-info">
      <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-current" />
      {children ?? "Sandbox: no real ticket and no real payment."}
    </p>
  );
}

/** Label / value rows for details panels. */
export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
