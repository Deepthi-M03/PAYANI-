/**
 * Public landing page (Express Navy). Static composition with one purposeful motion: the
 * route line draws once on load, and not at all under prefers-reduced-motion. Native scroll,
 * no scroll effects. The search form hands off to the real search page with its query.
 */
import { BellRing, Brain, Lock, Route, ShieldCheck, Ticket, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "../../design-system/Button";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { useAuth } from "../../features/auth/AuthContext";
import { StationField } from "../../features/book/StationField";
import { todayIso } from "../../lib/format";

const CAPABILITIES = [
  { icon: Route, title: "Book", body: "Direct trains and connections with up to two changes, ranked by time, changes and waiting, with the reasons stated." },
  { icon: Users, title: "Group planning", body: "Add everyone once. PAYANI splits the party into quota-valid bookings and explains every split." },
  { icon: BellRing, title: "Pulse", body: "Reminders before chart time, departure and arrival, delivered in the app or by email." },
  { icon: Brain, title: "Intelligence", body: "Demand forecasts and route comparisons, each labelled with how the numbers were produced." },
] as const;

const STEPS = [
  ["Add your travellers", "Names, age bands and families. Children stay with a guardian when a group has to split."],
  ["Get a valid booking plan", "Parties larger than a booking allows are split into the fewest bookings, keeping families together where possible."],
  ["Book on IRCTC", "PAYANI prepares each booking and hands you the exact details for the official IRCTC site or app."],
] as const;

const DATA_LEVELS = [
  ["scheduled", "From a published timetable. Not a promise the train is running on time."],
  ["estimated", "Calculated by PAYANI, such as an expected platform. Shown with its basis."],
  ["verified", "Confirmed by an authorised live source. Shown only when such a source is connected."],
  ["simulated", "Synthetic demonstration data used while real data licences are pending."],
] as const;

function RouteSchematic() {
  return (
    <figure className="m-0">
      <svg viewBox="0 0 640 120" role="img" aria-labelledby="route-title" className="h-auto w-full">
        <title id="route-title">Schematic route from Chennai Central to KSR Bengaluru via Jolarpettai</title>
        <path d="M24 70 H616" stroke="var(--color-line)" strokeWidth="6" strokeLinecap="round" fill="none" />
        <path
          d="M24 70 H616"
          stroke="var(--color-primary)"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          pathLength={1}
          className="[stroke-dasharray:1] motion-safe:animate-[route-draw_1.6s_cubic-bezier(0.2,0,0,1)_0.2s_both]"
        />
        {[
          [24, "Chennai Central", "MAS"],
          [330, "Jolarpettai", "JTJ"],
          [616, "KSR Bengaluru", "SBC"],
        ].map(([x, name, code]) => (
          <g key={code as string}>
            <circle cx={x as number} cy={70} r={10} fill="var(--color-surface)" stroke="var(--color-navy)" strokeWidth={4} />
            <text x={x as number} y={36} textAnchor={x === 24 ? "start" : x === 616 ? "end" : "middle"} className="fill-ink text-[15px] font-semibold">
              {name as string}
            </text>
            <text x={x as number} y={108} textAnchor={x === 24 ? "start" : x === 616 ? "end" : "middle"} className="fill-muted font-mono text-[13px]">
              {code as string}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">Schematic line, not track geometry.</figcaption>
    </figure>
  );
}

function HeroSearch() {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(todayIso(14));
  const ready = from && to && from !== to && date;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    navigate(`/app/search?${new URLSearchParams({ from, to, date }).toString()}`);
  };
  return (
    <form onSubmit={submit} aria-label="Search trains" className="grid gap-4 rounded-md bg-surface p-5 text-ink shadow-[0_24px_48px_rgba(5,14,28,0.28)] sm:p-6 md:grid-cols-[1fr_1fr_11rem_auto] md:items-end">
      <StationField label="From" value={from} onChange={setFrom} />
      <StationField label="To" value={to} onChange={setTo} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="hero-date" className="text-sm font-medium">Date</label>
        <input id="hero-date" type="date" value={date} min={todayIso(0)} max={todayIso(120)} onChange={(e) => setDate(e.target.value)}
               className="min-h-12 rounded-md border border-steel bg-surface px-3.5 text-base focus:border-primary" />
      </div>
      <Button type="submit" disabled={!ready} className="min-h-12 px-6">Search trains</Button>
      {from && to && from === to && <p className="text-sm text-error md:col-span-4">Choose two different stations.</p>}
    </form>
  );
}

export default function LandingPage() {
  const { status } = useAuth();
  return (
    <>
      <section className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-14 pt-14 sm:pt-20">
          <p className="font-mono text-sm text-[#F2A43A]">Group rail planning for India</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
            Plan, compare and book rail journeys for the whole group.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-white/80">
            Direct trains and connections ranked with clear reasons. Large parties split into valid bookings automatically.
          </p>
          <div className="mt-4"><HeroSearch /></div>
          <p className="text-sm text-white/75">
            Preview: timetables are synthetic demonstration data and bookings are sandbox only. Tickets are issued on IRCTC.
          </p>
        </div>
      </section>

      <section aria-label="PAYANI trainset" className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <img src="/img/trainset-elevation.svg" alt="Side view of a modern electric trainset in PAYANI navy, white and steel"
               width={1600} height={250} className="h-auto w-full" />
          <RouteSchematic />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">What PAYANI does</h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-3 bg-surface p-6">
              <Icon aria-hidden className="size-6 text-primary" strokeWidth={1.75} />
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">How group booking works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex flex-col gap-2 border-t-2 border-navy pt-4">
                <span className="font-mono text-sm text-saffron-text">Step {i + 1}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">Every time says where it came from</h2>
          <dl className="mt-6 divide-y divide-line border-y border-line">
            {DATA_LEVELS.map(([level, text]) => (
              <div key={level} className="grid gap-2 py-4 sm:grid-cols-[10rem_1fr]">
                <dt><ConfidenceBadge level={level} /></dt>
                <dd className="text-sm leading-relaxed text-muted">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">Privacy and safety</h2>
          <ul className="mt-6 flex flex-col gap-4 text-sm leading-relaxed text-muted">
            <li className="flex gap-3"><Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />Passwords are hashed with Argon2id. Sessions use short-lived tokens and a secure, http-only cookie.</li>
            <li className="flex gap-3"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />Contact details are shared with another traveller only when both people agree.</li>
            <li className="flex gap-3"><Ticket aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />PAYANI never signs in to IRCTC for you, and ticket resale is not allowed anywhere on the platform.</li>
          </ul>
        </div>
      </section>

      <section className="bg-primary text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center">
          <h2 className="text-2xl font-semibold">Plan your next group journey.</h2>
          {status === "authenticated" ? (
            <Link to="/app" className="rounded bg-white px-6 py-3 font-semibold text-navy hover:bg-mist">Open dashboard</Link>
          ) : (
            <Link to="/register" className="rounded bg-white px-6 py-3 font-semibold text-navy hover:bg-mist">Create a free account</Link>
          )}
        </div>
      </section>
    </>
  );
}
