import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { Card } from "../../design-system/Card";
import { EmptyState, PageHeader, QueryState, StatusBadge } from "../../design-system/ui";
import { api } from "../../lib/api";
import { dateTime, rupees } from "../../lib/format";
import type { Booking } from "../../lib/types";

interface RefundRow { id: string; booking_id: string; pnr: string | null; route: string; amount_paise: number; status: string;
  timeline: { status: string; note: string; at: string }[] }

export function BookingsPage() {
  const q = useQuery({ queryKey: ["bookings"], queryFn: () => api<Booking[]>("/api/v1/bookings") });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bookings" intro="Your sandbox bookings, newest journey first."
                  actions={<Link to="/app/search" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover">New search</Link>} />
      <QueryState query={q}>
        {(rows) => rows.length === 0 ? (
          <EmptyState title="No bookings yet" body="Search for a journey to create your first sandbox booking."
                      action={<Link to="/app/search" className="font-semibold text-primary underline">Find a journey</Link>} />
        ) : (
          <ul className="grid gap-3">
            {rows.map((b) => (
              <li key={b.id}>
                <Link to={`/app/bookings/${b.id}`} className="block rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-primary">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-2xl">{b.from} → {b.to}</p>
                      <p className="text-sm text-ink/75">{dateTime(b.departure_at)} · {b.passengers.length} passenger{b.passengers.length > 1 ? "s" : ""} · {b.travel_class}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{rupees(b.total_paise)}</span>
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

export function RefundsPage() {
  const q = useQuery({ queryKey: ["refunds"], queryFn: () => api<RefundRow[]>("/api/v1/refunds") });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Refunds" intro="Sandbox refunds settle about two minutes after they start. No real money moves." />
      <QueryState query={q}>
        {(rows) => rows.length === 0 ? <EmptyState title="No refunds" body="Refunds appear here after a cancellation or a failed booking." /> : (
          <ul className="grid gap-3">
            {rows.map((r) => (
              <li key={r.id}><Card>
                <div className="flex flex-wrap justify-between gap-2">
                  <Link to={`/app/bookings/${r.booking_id}`} className="font-semibold text-primary underline">{r.route} {r.pnr ?? ""}</Link>
                  <span className="text-sm">{rupees(r.amount_paise)} · <strong>{r.status}</strong></span>
                </div>
                <ol className="mt-3 space-y-1 text-sm text-ink/80">{r.timeline.map((t, i) => <li key={i}>{dateTime(t.at)}: {t.note}</li>)}</ol>
              </Card></li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
