import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-panel)] ${className}`} {...rest} />;
}

/** A card with a header row: title, optional description and actions, separated by a rule. */
export function Panel({ title, description, actions, icon, children, className = "", bodyClassName = "p-5 sm:p-6", id }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ReactNode; children?: ReactNode;
  className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <section aria-labelledby={id} className={`overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-panel)] ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-ivory text-primary">{icon}</span>}
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
