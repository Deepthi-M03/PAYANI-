import type { UseQueryResult } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

import { ApiError } from "../lib/api";
import { STATUS_LABEL } from "../lib/format";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { FullPageLoader } from "./FullPageLoader";

export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-3xl leading-tight sm:text-4xl">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-ink/80">{intro}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <Inbox aria-hidden className="size-8 text-steel" />
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-ink/75">{body}</p>}
      {action}
    </div>
  );
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.problem.detail ? `${err.problem.title} ${err.problem.detail}` : err.problem.title;
  return "Something went wrong. Please try again.";
}

/** Loading, error (with retry) and success states for a query, in one place. */
export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <FullPageLoader />;
  if (query.isError)
    return (
      <Alert tone="error" title={errorText(query.error)}>
        <Button variant="secondary" className="mt-3" onClick={() => query.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  return <>{children(query.data as T)}</>;
}

const statusTone: Record<string, string> = {
  CONFIRMED: "bg-success-tint text-success",
  REFUNDED: "bg-success-tint text-success",
  FAILED: "bg-error-tint text-error",
  CANCELLED: "bg-surface text-ink border border-line",
  REFUND_PENDING: "bg-warning-tint text-warning",
  CANCELLATION_REQUESTED: "bg-warning-tint text-warning",
  PENDING_CONFIRMATION: "bg-info-tint text-info",
  SEARCHED: "bg-info-tint text-info",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-sm px-2 py-1 text-xs font-semibold ${statusTone[status] ?? "bg-mist"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Select({ label, children, className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className="min-h-11 rounded-md border border-steel bg-surface px-3 text-base focus:border-primary" {...rest}>
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
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {description && <p className="text-sm text-ink/70">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-[var(--duration-fast)] disabled:opacity-50 ${checked ? "bg-primary" : "bg-line/60"}`}
      >
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-transform duration-[var(--duration-fast)] ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function SandboxNote({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-md bg-info-tint px-3 py-2 text-xs font-medium text-info">
      {children ?? "Sandbox: no real ticket, no real payment, synthetic trains."}
    </p>
  );
}
