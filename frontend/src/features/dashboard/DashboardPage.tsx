import { useQuery } from "@tanstack/react-query";
import { BellRing, BrainCircuit, Search, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Card } from "../../design-system/Card";
import { ConfidenceBadge, type Confidence } from "../../design-system/ConfidenceBadge";
import { EmptyState, StatusBadge } from "../../design-system/ui";
import { api } from "../../lib/api";
import { dateTime } from "../../lib/format";
import type { Booking } from "../../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Countdown } from "../bookings/BookingDetailPage";

const LEVELS: Confidence[] = ["simulated", "scheduled", "estimated", "verified"];
const QUICK = [
  { to: "/app/search", icon: Search, title: "Find a journey", body: "Direct and connecting trains, explained." },
  { to: "/app/groups", icon: Users, title: "Plan a group", body: "Split travellers into valid bookings." },
  { to: "/app/pulse", icon: BellRing, title: "Reminders", body: "Inbox, channels and quiet hours." },
  { to: "/app/intelligence", icon: BrainCircuit, title: "Intelligence", body: "Forecasts and how ranking works." },
] as const;

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const bookings = useQuery({ queryKey: ["bookings"], queryFn: () => api<Booking[]>("/api/v1/bookings") });
  if (!user) return null;
  const upcoming = (bookings.data ?? [])
    .filter((b) => b.status === "CONFIRMED" && new Date(b.departure_at).getTime() > Date.now())
    .sort((a, b) => a.departure_at.localeCompare(b.departure_at));
  const next = upcoming[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl">{t("dashboard.greeting", { name: user.display_name })}</h1>
        <p className="mt-2 text-ink/80">Everything for your next journey, in one place.</p>
      </header>

      {next ? (
        <Card className="grid gap-4 bg-mist sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next journey</p>
            <p className="mt-1 font-display text-3xl">{next.from} → {next.to}</p>
            <p className="text-sm text-ink/80">{dateTime(next.departure_at)} · {next.pnr} · <StatusBadge status={next.status} /></p>
            <Link to={`/app/bookings/${next.id}`} className="mt-3 inline-block font-semibold text-primary underline underline-offset-4">Open booking</Link>
          </div>
          <Countdown to={next.departure_at} />
        </Card>
      ) : bookings.isSuccess ? (
        <EmptyState title="No upcoming journeys" body="Search for a train to create a sandbox booking."
                    action={<Link to="/app/search" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white">Find a journey</Link>} />
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map(({ to, icon: Icon, title, body }) => (
          <li key={to}>
            <Link to={to} className="group block h-full rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-primary">
              <Icon aria-hidden className="size-6 text-steel transition-transform duration-[var(--duration-fast)] group-hover:-translate-y-0.5" />
              <p className="mt-3 font-semibold">{title}</p>
              <p className="text-sm text-ink/75">{body}</p>
            </Link>
          </li>
        ))}
      </ul>

      <Card>
        <h2 className="font-semibold">{t("dashboard.dataTitle")}</h2>
        <p className="mt-1 text-sm text-ink/80">{t("dashboard.dataIntro")}</p>
        <ul className="mt-4 flex flex-col gap-3">
          {LEVELS.map((level) => (
            <li key={level} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <ConfidenceBadge level={level} />
              <span className="text-sm text-ink/80">{t(`confidence.${level}.description`)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
