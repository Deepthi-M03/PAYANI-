import { useQuery } from "@tanstack/react-query";
import { ReceiptIndianRupee, Search, Ticket } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { LinkButton } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { EmptyState, PageHeader, QueryState, Skeleton, StatusBadge } from "../../design-system/ui";
import { api } from "../../lib/api";
import { dateTime, rupees } from "../../lib/format";
import type { Booking } from "../../lib/types";

interface RefundRow { id: string; booking_id: string; pnr: string | null; route: string; amount_paise: number; status: string;
  timeline: { status: string; note: string; at: string }[] }

const FILTERS = [["all", "All"], ["upcoming", "Upcoming"], ["action", "Needs action"], ["past", "Past and cancelled"]] as const;

export function BookingsPage() {
  const q = useQuery({ queryKey: ["bookings"], queryFn: () => api<Booking[]>("/api/v1/bookings") });
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const test = (f: (typeof FILTERS)[number][0], b: Booking) => {
    const future = new Date(b.departure_at).getTime() > Date.now();
    if (f === "upcoming") return b.status === "CONFIRMED" && future;
    if (f === "action") return b.status === "SEARCHED";
    if (f === "past") return !future || ["CANCELLED", "REFUNDED", "REFUND_PENDING", "FAILED"].includes(b.status);
    return true;
  };
  const match = (b: Booking) => test(filter, b);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Book · Bookings" title="Bookings" intro="Your sandbox bookings, newest journey first."
                  actions={<LinkButton to="/app/search" icon={<Search aria-hidden className="size-4" />}>New search</LinkButton>} />
      <QueryState query={q} skeleton={<Skeleton rows={4} />}>
        {(rows) => rows.length === 0 ? (
          <EmptyState icon={Ticket} title="No bookings yet" body="Search for a journey to create your first sandbox booking." action={<LinkButton to="/app/search" size="sm">Find a journey</LinkButton>} />
        ) : (
          <>
            <div role="group" aria-label="Filter bookings" className="flex flex-wrap gap-2">
              {FILTERS.map(([v, l]) => (
                <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${filter === v ? "border-navy bg-navy text-white" : "border-line bg-surface text-muted hover:text-ink"}`}>
                  {l} <span className="ml-1 font-mono text-xs opacity-70">{rows.filter((b) => test(v, b)).length}</span>
                </button>
              ))}
            </div>
            <ul className="grid gap-3">
              {rows.filter(match).map((b, i) => {
                const first = b.journey.legs[0], last = b.journey.legs[b.journey.legs.length - 1];
                return (
                  <li key={b.id} className="motion-safe:animate-[rise_360ms_var(--ease-ui)_both]" style={{ animationDelay: `${i * 50}ms` }}>
                    <Link to={`/app/bookings/${b.id}`} className="group grid gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)] transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5 hover:border-primary/50 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                      <div className="flex size-12 flex-col items-center justify-center rounded-md bg-navy text-white">
                        <span className="font-mono text-lg font-medium leading-none">{new Date(b.departure_at).toLocaleDateString("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" })}</span>
                        <span className="mt-0.5 text-[10px] uppercase text-white/70">{new Date(b.departure_at).toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" })}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{first?.from_name ?? b.from} → {last?.to_name ?? b.to}</p>
                        <p className="text-sm text-muted">{dateTime(b.departure_at)} · {b.passengers.length} traveller{b.passengers.length > 1 ? "s" : ""} · {b.travel_class}{b.pnr && <> · <span className="font-mono">{b.pnr}</span></>}</p>
                      </div>
                      <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1.5">
                        <StatusBadge status={b.status} />
                        <span className="font-mono text-sm font-medium">{rupees(b.total_paise)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </QueryState>
    </div>
  );
}

export function RefundsPage() {
  const q = useQuery({ queryKey: ["refunds"], queryFn: () => api<RefundRow[]>("/api/v1/refunds") });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Book · Refunds" title="Refunds" intro="Sandbox refunds settle about two minutes after they start. No real money moves." />
      <QueryState query={q} skeleton={<Skeleton rows={2} />}>
        {(rows) => rows.length === 0 ? <EmptyState icon={ReceiptIndianRupee} title="No refunds" body="Refunds appear here after a cancellation or a failed booking." /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((r) => (
              <Panel key={r.id} title={<Link to={`/app/bookings/${r.booking_id}`} className="hover:text-signal">{r.route} <span className="font-mono text-sm font-normal text-muted">{r.pnr ?? ""}</span></Link>}
                     actions={<span className="rounded bg-success-tint px-2 py-0.5 text-xs font-semibold text-success">{r.status}</span>}>
                <p className="font-mono text-2xl font-medium">{rupees(r.amount_paise)}</p>
                <ol className="mt-4 flex flex-col gap-3 border-l border-line pl-4 text-sm">
                  {r.timeline.map((t, i) => <li key={i} className="relative"><span aria-hidden className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-success" /><span className="font-medium">{t.note}</span><span className="block text-xs text-muted">{dateTime(t.at)}</span></li>)}
                </ol>
              </Panel>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
