import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, ChartLine, MessagesSquare, Search, TrainFront, Users } from "lucide-react";
import { Link } from "react-router";

import { LinkButton } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { EmptyState, StatusBadge, errorText } from "../../design-system/ui";
import { api } from "../../lib/api";
import { dateTime, day, duration, rupees, time } from "../../lib/format";
import type { Booking, Group } from "../../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Countdown } from "../bookings/BookingDetailPage";

interface Inbox { unread: number; items: { id: string; title: string; body: string; link: string | null; read: boolean; at: string }[] }

const QUICK = [
  { to: "/app/search", icon: Search, title: "Search trains", body: "Direct and connecting, explained" },
  { to: "/app/groups", icon: Users, title: "Plan a group", body: "Split into valid bookings" },
  { to: "/app/connect", icon: MessagesSquare, title: "Journey communities", body: "People on your train" },
  { to: "/app/intelligence", icon: ChartLine, title: "Intelligence", body: "Forecasts and ranking" },
] as const;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Next confirmed journey as a boarding-pass style panel with a live countdown. */
function NextJourney({ b }: { b: Booking }) {
  const j = b.journey;
  const first = j.legs[0], last = j.legs[j.legs.length - 1];
  return (
    <section aria-label="Next journey" className="relative overflow-hidden rounded-[12px] bg-navy text-white shadow-[var(--shadow-raised)]">
      <div aria-hidden className="grid-bg absolute inset-0" />
      <div className="relative grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-[#F2A43A]">Next journey · {day(b.departure_at)}</span>
            <StatusBadge status={b.status} />
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-end gap-4">
            <div>
              <p className="font-mono text-4xl font-medium tabular sm:text-5xl">{time(j.departure)}</p>
              <p className="mt-1 truncate text-sm text-white/75">{first?.from_name}</p>
            </div>
            <div className="mb-3 flex flex-col items-center gap-1.5">
              <span className="text-xs text-white/60">{duration(j.duration_min)} · {j.transfers === 0 ? "direct" : `${j.transfers} change${j.transfers > 1 ? "s" : ""}`}</span>
              <div className="relative h-[3px] w-full rounded bg-white/15">
                <span className="absolute inset-y-0 left-0 rounded bg-saffron motion-safe:animate-[grow_1.2s_var(--ease-ui)_0.2s_both]" style={{ width: "100%" }} />
                <span className="absolute -left-1 -top-[5px] size-3 rounded-full border-2 border-white bg-navy" />
                <span className="absolute -right-1 -top-[5px] size-3 rounded-full bg-saffron" />
              </div>
              <span className="font-mono text-xs text-white/60">{j.legs.map((l) => l.train_number).join(" + ")}</span>
            </div>
            <div className="text-right">
              <p className="font-mono text-4xl font-medium tabular sm:text-5xl">{time(j.arrival)}</p>
              <p className="mt-1 truncate text-sm text-white/75">{last?.to_name}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/75">
            <span>Reference <span className="font-mono text-white">{b.pnr}</span></span>
            <span>{b.passengers.length} traveller{b.passengers.length > 1 ? "s" : ""} · {b.travel_class}</span>
            <span>{rupees(b.total_paise)} (sandbox)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/app/bookings/${b.id}`} variant="inverse" size="sm" icon={<ArrowRight aria-hidden className="size-4" />}>Open booking</LinkButton>
            {first && <LinkButton to={`/app/trains/${first.train_number}?date=${first.train_origin_date}`} variant="ghost" size="sm" className="!text-white hover:!bg-white/10" icon={<TrainFront aria-hidden className="size-4" />}>Train schedule</LinkButton>}
          </div>
        </div>
        <div className="flex items-center lg:border-l lg:border-white/10 lg:pl-8"><Countdown to={b.departure_at} tone="dark" /></div>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const bookings = useQuery({ queryKey: ["bookings"], queryFn: () => api<Booking[]>("/api/v1/bookings") });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api<Inbox>("/api/v1/notifications") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/v1/groups") });
  if (!user) return null;
  const all = bookings.data ?? [];
  const next = all.filter((b) => b.status === "CONFIRMED" && new Date(b.departure_at).getTime() > Date.now())
    .sort((a, b) => a.departure_at.localeCompare(b.departure_at))[0];
  const first = user.display_name.split(" ")[0];
  const notes = inbox.data?.items ?? [];
  const myGroups = groups.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs text-saffron-text">{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date())}</p>
          <h1 className="mt-2 font-display text-[1.75rem] sm:text-[2rem]">{greeting()}, {first}</h1>
          <p className="mt-1 text-muted">Everything for your next journey, in one place.</p>
        </div>
        <LinkButton to="/app/search" icon={<Search aria-hidden className="size-4" />}>Search trains</LinkButton>
      </header>

      {bookings.isPending ? <div className="skeleton h-64 rounded-[12px]" /> : bookings.isError ? (
        <Alert tone="error" title={errorText(bookings.error)}>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => bookings.refetch()}>Try again</Button>
        </Alert>
      ) : next ? <NextJourney b={next} /> : (
        <EmptyState icon={TrainFront} title="No upcoming journeys" body="Search for a train to create a sandbox booking. Your next journey will appear here with a countdown."
                    action={<LinkButton to="/app/search" size="sm">Find a journey</LinkButton>} />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map(({ to, icon: Icon, title, body }) => (
          <li key={to}>
            <Link to={to} className="group flex h-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-panel)] transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5 hover:border-primary/50">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-ivory text-primary transition-colors group-hover:bg-primary group-hover:text-white"><Icon aria-hidden className="size-5" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="block truncate text-xs text-muted">{body}</span></span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Your bookings" description="Sandbox bookings, newest journey first." actions={<Link to="/app/bookings" className="text-sm font-semibold text-signal hover:underline">View all</Link>} bodyClassName="">
          {bookings.isError ? <p className="p-6 text-sm text-error">Bookings could not be loaded.</p> : bookings.isPending ? <div className="p-5"><div className="skeleton h-24" /></div> : all.length === 0 ? <p className="p-6 text-sm text-muted">No bookings yet.</p> : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th scope="col">Route</th><th scope="col" className="hidden sm:table-cell">Departure</th><th scope="col">Status</th><th scope="col" className="num">Total</th></tr></thead>
                <tbody>
                  {all.slice(0, 5).map((b) => (
                    <tr key={b.id}>
                      <th scope="row"><Link to={`/app/bookings/${b.id}`} className="font-semibold hover:text-signal">{b.journey.legs[0]?.from_name ?? b.from} → {b.journey.legs[b.journey.legs.length - 1]?.to_name ?? b.to}</Link></th>
                      <td className="hidden whitespace-nowrap text-muted sm:table-cell">{dateTime(b.departure_at)}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num whitespace-nowrap">{rupees(b.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Pulse" icon={<BellRing className="size-4" />} description={inbox.isError ? "Could not load the inbox" : inbox.data?.unread ? `${inbox.data.unread} unread` : inbox.isSuccess ? "You're up to date" : undefined}
                 actions={<Link to="/app/pulse" className="text-sm font-semibold text-signal hover:underline">Inbox</Link>} bodyClassName="px-5 py-2 sm:px-6">
            {inbox.isError ? <p className="py-4 text-sm text-error">Notifications could not be loaded.</p> : notes.length === 0 ? <p className="py-4 text-sm text-muted">Reminders arrive here before each confirmed journey.</p> : (
              <ul className="divide-y divide-line">
                {notes.slice(0, 3).map((n) => (
                  <li key={n.id} className="flex gap-3 py-3">
                    <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-line" : "bg-saffron"}`} />
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{n.title}</p><p className="line-clamp-2 text-xs text-muted">{n.body}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Groups" icon={<Users className="size-4" />} actions={<Link to="/app/groups" className="text-sm font-semibold text-signal hover:underline">Manage</Link>} bodyClassName="px-5 py-2 sm:px-6">
            {groups.isError ? <p className="py-4 text-sm text-error">Groups could not be loaded.</p> : myGroups.length === 0 ? <p className="py-4 text-sm text-muted">Create a group to plan one trip for everyone.</p> : (
              <ul className="divide-y divide-line">
                {myGroups.slice(0, 3).map((g) => (
                  <li key={g.id}><Link to={`/app/groups/${g.id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-signal">
                    <span className="truncate font-medium">{g.name}</span><span className="shrink-0 font-mono text-xs text-muted">{g.members.length} people</span></Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted"><ConfidenceBadge level="simulated" /> Bookings in this preview are sandbox only. Train times always show their source.</p>
        </div>
      </div>
    </div>
  );
}
