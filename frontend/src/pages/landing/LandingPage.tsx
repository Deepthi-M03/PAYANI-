/**
 * Public landing page. Real journey search runs here without an account (the search API is
 * public); results are drawn on the map. Booking needs sign-in. Motion: staggered hero entrance,
 * route draw and journey indicator on the map, scroll reveals, gentle parallax in the scenes.
 * All of it is off under prefers-reduced-motion, and nothing hijacks scrolling.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BellRing, ChartLine, Lock, MessagesSquare, Route, Search, ShieldCheck, Ticket, Users } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button, LinkButton } from "../../design-system/Button";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { LogoMark } from "../../design-system/Logo";
import { errorText } from "../../design-system/ui";
import { useAuth } from "../../features/auth/AuthContext";
import { JourneyCard } from "../../features/book/JourneyCard";
import { StationField } from "../../features/book/StationField";
import { DatasetNotice, longDate, useTimetableStatus } from "../../features/book/DatasetNotice";
import { RailMap } from "../../features/map/RailMap";
import { useStationMap } from "../../features/map/stations";
import { post } from "../../lib/api";
import { todayIso } from "../../lib/format";
import type { Freshness, Journey } from "../../lib/types";
import { Reveal, prefersReducedMotion } from "../../motion/reveal";
import { Scene, type SceneKind } from "./Scenes";

const JOURNEYS: { kind: SceneKind; title: string; from: string; to: string; body: string }[] = [
  { kind: "coast", title: "The western coast", from: "CSMT", to: "MAO", body: "From Mumbai's terminus down to Goa, with the Arabian Sea on one side for much of the way." },
  { kind: "ghats", title: "Through the Ghats", from: "SBC", to: "MAQ", body: "Bengaluru to Mangaluru: the line drops from the Deccan plateau through forested hills to the coast." },
  { kind: "plains", title: "Across the north", from: "HWH", to: "NDLS", body: "Howrah to New Delhi along the Gangetic plain, one of the busiest corridors in the country." },
];

const MODULES = [
  { icon: Route, title: "Book", body: "Direct trains and connections with up to two changes, ranked by what matters to you, each with the reasons stated." },
  { icon: Users, title: "Group planning", body: "Add everyone once. PAYANI splits the party into the fewest valid bookings and keeps families together." },
  { icon: BellRing, title: "Pulse", body: "Reminders before chart time, departure and arrival, in the app or by email, with quiet hours." },
  { icon: MessagesSquare, title: "Connect", body: "Opt-in journey communities for people on the same train. No ticket resale, contact shared only with consent." },
  { icon: ChartLine, title: "Intelligence", body: "Demand forecasts and route comparisons, each labelled with how the numbers were produced." },
  { icon: Ticket, title: "Official handoff", body: "When you're ready, PAYANI gives you the exact details to book on the official IRCTC site or app." },
] as const;

const DATA_LEVELS = [
  ["scheduled", "From a published timetable. Not a promise that the train is on time."],
  ["estimated", "Calculated by PAYANI, such as an expected platform, shown with its basis."],
  ["verified", "Confirmed by an authorised live source. Shown only when one is connected."],
  ["simulated", "Synthetic demonstration data, used while real data licences are pending."],
] as const;

interface SearchResponse { results: Journey[]; freshness: Freshness; search?: { max_transfers: number; note: string | null } }

export default function LandingPage() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const timetable = useTimetableStatus();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const stations = useStationMap([from, to]);
  const [date, setDate] = useState(todayIso(21));
  const [active, setActive] = useState<string | undefined>();
  const [formKey, setFormKey] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const search = useMutation({
    mutationFn: (v: { from: string; to: string; date: string }) => post<SearchResponse>("/api/v1/journeys/search", { from_code: v.from, to_code: v.to, date: v.date, preference: "balanced" }),
    onSuccess: (d) => setActive(d.results[0]?.id),
  });
  const ready = Boolean(from && to && from !== to && date);
  const run = (f = from, t = to) => { if (f && t && f !== t) search.mutate({ from: f, to: t, date }); };
  const submit = (e: FormEvent) => { e.preventDefault(); run(); };
  const nameOf = (c: string) => stations.data?.stations.find((s) => s.code === c)?.name
    ?? search.data?.results.flatMap((j) => j.legs).flatMap((l) => [[l.from, l.from_name], [l.to, l.to_name]]).find(([k]) => k === c)?.[1]
    ?? c;
  const fieldText = (c: string) => (!c ? "" : nameOf(c) === c ? c : `${nameOf(c)} (${c})`);
  const pick = (code: string, role: "from" | "to") => {
    if (role === "from") setFrom(code); else setTo(code);
    setFormKey((k) => k + 1); // re-seed the station fields with the picked names
    search.reset();
  };
  const tryRoute = (f: string, t: string) => {
    setFrom(f); setTo(t); setFormKey((k) => k + 1);
    document.getElementById("planner")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    run(f, t);
  };
  const results = search.data?.results ?? [];
  const book = (j: Journey) => navigate(`/app/book?journey=${encodeURIComponent(j.id)}&date=${date}`);

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section id="planner" className="relative scroll-mt-16 overflow-hidden bg-navy text-white">
        <div aria-hidden className="grid-bg absolute inset-0" />
        <svg aria-hidden viewBox="0 0 1440 600" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] w-full opacity-40">
          <path d="M-20 520 C 320 470 560 560 900 470 S 1300 420 1460 380" fill="none" stroke="#2357B5" strokeWidth="1.5" pathLength={1} className="[stroke-dasharray:1] motion-safe:animate-[route-draw_2.4s_var(--ease-ui)_0.4s_both]" />
          <path d="M-20 560 C 300 520 620 600 960 520 S 1320 470 1460 440" fill="none" stroke="#E8731A" strokeOpacity="0.7" strokeWidth="1.5" pathLength={1} className="[stroke-dasharray:1] motion-safe:animate-[route-draw_2.8s_var(--ease-ui)_0.7s_both]" />
        </svg>
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12 lg:pb-20 lg:pt-16">
          <div className="flex flex-col justify-center gap-6">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-mono text-xs text-[#F2A43A] motion-safe:animate-[rise_600ms_var(--ease-ui)_150ms_both]">
              <span className="size-1.5 rounded-full bg-saffron" /> Rail journeys for groups across India
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-6xl lg:text-[4.1rem]">
              {["Every", "journey", "is", "better"].map((w, i) => (
                <span key={w} className="inline-block motion-safe:animate-[rise_700ms_var(--ease-ui)_both]" style={{ animationDelay: `${250 + i * 70}ms` }}>{w}&nbsp;</span>
              ))}
              <span className="inline-block text-[#9DB7E8] motion-safe:animate-[rise_700ms_var(--ease-ui)_both]" style={{ animationDelay: "560ms" }}>together.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-white/75 motion-safe:animate-[rise_700ms_var(--ease-ui)_650ms_both]">
              Find direct trains and connections across India, plan for the whole group, and get reminded before every departure.
            </p>

            <form key={formKey} onSubmit={submit} aria-label="Search trains"
                  className="grid gap-3 rounded-[10px] bg-surface p-4 text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.55)] sm:grid-cols-2 sm:p-5 motion-safe:animate-[rise_800ms_var(--ease-ui)_750ms_both]">
              <StationField label="From" value={from} initialText={fieldText(from)} onChange={(c) => { setFrom(c); search.reset(); }} />
              <StationField label="To" value={to} initialText={fieldText(to)} onChange={(c) => { setTo(c); search.reset(); }} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="hero-date" className="text-sm font-medium">Travel date</label>
                <input id="hero-date" type="date" value={date} min={todayIso(0)} max={todayIso(120)} onChange={(e) => setDate(e.target.value)}
                       className="min-h-12 rounded-md border border-steel/70 bg-surface px-3.5 text-base focus:border-primary" />
              </div>
              <Button type="submit" size="lg" disabled={!ready} loading={search.isPending} icon={<Search aria-hidden className="size-4" />} className="self-end">
                Search trains
              </Button>
              {from && to && from === to && <p className="text-sm text-error sm:col-span-2">Choose two different stations.</p>}
              <p className="text-xs text-muted sm:col-span-2">Tip: pick stations on the map too. {timetable.data?.label === "scheduled"
                ? `Times come from ${timetable.data.source_name}, published ${longDate(timetable.data.published_on)}${timetable.data.outdated ? " (outdated)" : ""}. Bookings are sandbox only.`
                : "Timetables in this preview are simulated, and bookings are sandbox only."}</p>
            </form>
          </div>

          <div className="relative motion-safe:animate-[fade-in_900ms_var(--ease-ui)_500ms_both]">
            <RailMap publicContext from={from} to={to} onPick={pick} label="India railway network map"
                     routes={results.map((j) => ({ id: j.id, legs: j.legs.map((l) => ({ from: l.from, to: l.to })) }))}
                     activeRouteId={active} onSelectRoute={setActive}
                     className="h-[420px] border-white/10 shadow-[0_30px_60px_-24px_rgba(0,0,0,0.6)] sm:h-[520px] lg:h-full lg:min-h-[600px]" />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ results */}
      {(search.data || search.isError) && (
        <section ref={resultsRef} aria-live="polite" className="border-b border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            {search.isError ? <Alert tone="error" title={errorText(search.error)} /> : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-saffron-text">{nameOf(from)} → {nameOf(to)}</p>
                    <h2 className="mt-1 text-2xl font-semibold">{results.length} option{results.length === 1 ? "" : "s"} found</h2>
                  </div>
                  <p className="max-w-md text-sm text-muted">Sign in to book in the sandbox. Real tickets and seat availability come from IRCTC, never from PAYANI.</p>
                </div>
                <div className="mt-4"><DatasetNotice f={search.data?.freshness} /></div>
                {results.length === 0 ? (
                  <p className="mt-6 rounded-md bg-ivory p-6 text-sm text-muted">No route with {search.data?.search?.max_transfers === 1 ? "one change or fewer" : "up to two changes"} on this date. Try another date or a nearby station.</p>
                ) : (
                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    {results.slice(0, 4).map((j, i) => (
                      <Reveal key={j.id} delay={i * 70}>
                        <JourneyCard j={j} compact selected={j.id === active} onSelect={() => { setActive(j.id); document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" }); }}
                                     actions={<Button size="sm" onClick={() => book(j)} icon={<ArrowRight aria-hidden className="size-4" />}>{status === "authenticated" ? "Book" : "Sign in to book"}</Button>} />
                      </Reveal>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ journeys */}
      <section id="network" className="scroll-mt-16 bg-ivory">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs text-saffron-text">Journeys worth taking</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">The country looks different from a train window.</h2>
            <p className="mt-3 text-muted">Three routes in PAYANI's network. Pick one to see the options on the map.</p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {JOURNEYS.map((j, i) => (
              <Reveal key={j.kind} delay={i * 90} as="article">
                <button type="button" onClick={() => tryRoute(j.from, j.to)}
                        className="group flex h-full w-full flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-left shadow-[var(--shadow-panel)] transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-ui)] hover:-translate-y-1 hover:shadow-[var(--shadow-raised)]">
                  <div className="relative aspect-[4/3] w-full overflow-hidden">
                    <div className="absolute inset-0 transition-transform duration-[900ms] ease-[var(--ease-ui)] group-hover:scale-[1.04]">
                      <Scene kind={j.kind} alt={`Illustration: ${j.title.toLowerCase()}`} />
                    </div>
                    <span className="absolute left-4 top-4 rounded bg-navy/80 px-2 py-1 font-mono text-xs text-white backdrop-blur">{j.from} → {j.to}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-5">
                    <h3 className="text-lg font-semibold">{j.title}</h3>
                    <p className="flex-1 text-sm leading-relaxed text-muted">{j.body}</p>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                      See trains on this route <ArrowRight aria-hidden className="size-4 transition-transform duration-[var(--duration-fast)] group-hover:translate-x-1" />
                    </span>
                  </div>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ groups */}
      <section id="groups" className="scroll-mt-16 border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <p className="font-mono text-xs text-saffron-text">Group booking</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">Eight people. One plan. No arithmetic.</h2>
            <ol className="mt-8 flex flex-col gap-6">
              {[["Add your travellers", "Names, age bands and families. Children always travel with an adult on their booking."],
                ["Get a valid booking plan", "A booking holds up to six people on the general quota. PAYANI uses the fewest bookings and keeps families together."],
                ["Book each on IRCTC", "Every booking comes with the exact train, class and passenger list to enter on the official site."]].map(([t, b], i) => (
                <li key={t} className="grid grid-cols-[2.5rem_1fr] gap-4">
                  <span className="grid size-10 place-items-center rounded-full border border-line bg-ivory font-mono text-sm font-medium text-primary">{i + 1}</span>
                  <div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm leading-relaxed text-muted">{b}</p></div>
                </li>
              ))}
            </ol>
          </Reveal>
          <Reveal delay={120}>
            <figure className="rounded-[12px] border border-line bg-ivory p-5 shadow-[var(--shadow-raised)] sm:p-6">
              <figcaption className="flex items-center justify-between text-sm"><span className="font-semibold">Booking plan</span><span className="rounded bg-mist px-2 py-0.5 text-xs text-muted">Example</span></figcaption>
              <div className="mt-4 grid gap-3">
                {[["Booking 1", ["Priya", "Arjun", "Meena", "Kavin (12)", "Lakshmi", "Suresh"], "Raman and Iyer families"], ["Booking 2", ["Divya", "Rahul"], "Nair family"]].map(([t, names, fam], i) => (
                  <div key={t as string} className="rounded-[8px] border border-line bg-surface p-4 motion-safe:animate-[rise_600ms_var(--ease-ui)_both]" style={{ animationDelay: `${200 + i * 150}ms` }}>
                    <div className="flex items-center justify-between"><p className="font-semibold">{t as string}</p><p className="font-mono text-xs text-muted">{(names as string[]).length} / 6</p></div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{(names as string[]).map((n) => <span key={n} className="rounded bg-ivory px-2 py-1 text-xs">{n}</span>)}</div>
                    <p className="mt-2 text-xs text-muted">{fam as string}</p>
                  </div>
                ))}
              </div>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ modules */}
      <section className="bg-ivory">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="font-mono text-xs text-saffron-text">One platform</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em] sm:text-4xl">Everything between "let's go" and the platform.</h2>
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={(i % 3) * 80} className="group bg-surface p-7 transition-colors duration-[var(--duration-base)] hover:bg-[#fbfbfa]">
                <span className="grid size-11 place-items-center rounded-md bg-navy text-white transition-transform duration-[var(--duration-base)] ease-[var(--ease-ui)] group-hover:-translate-y-0.5">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ trust */}
      <section id="trust" className="scroll-mt-16 border-t border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <Reveal>
            <p className="font-mono text-xs text-saffron-text">Trust and data</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em]">Every time says where it came from.</h2>
            <dl className="mt-8 divide-y divide-line border-y border-line">
              {DATA_LEVELS.map(([level, text]) => (
                <div key={level} className="grid gap-2 py-4 sm:grid-cols-[10rem_1fr]">
                  <dt><ConfidenceBadge level={level} /></dt>
                  <dd className="text-sm leading-relaxed text-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={120} id="privacy" className="scroll-mt-16">
            <p className="font-mono text-xs text-saffron-text">Privacy and safety</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.015em]">Built to be trusted with a family's plans.</h2>
            <ul className="mt-8 flex flex-col gap-5 text-sm leading-relaxed text-muted">
              <li className="flex gap-4"><Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />Passwords are hashed with Argon2id. Sessions use short-lived tokens and a secure, http-only cookie.</li>
              <li className="flex gap-4"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />Contact details are shared with another traveller only when both people agree.</li>
              <li className="flex gap-4"><Ticket aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />PAYANI never signs in to IRCTC for you, and ticket resale is not allowed anywhere on the platform.</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ cta */}
      <section className="relative overflow-hidden bg-primary text-white">
        <div aria-hidden className="grid-bg absolute inset-0" />
        <Reveal className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center">
          <div className="flex items-center gap-5">
            <LogoMark size={56} tone="light" animated />
            <div>
              <h2 className="text-3xl font-semibold tracking-[-0.015em]">Plan your next group journey.</h2>
              <p className="mt-1 text-white/75">Free to use. No service charge.</p>
            </div>
          </div>
          {status === "authenticated"
            ? <LinkButton to="/app" variant="inverse" size="lg">Open dashboard</LinkButton>
            : <div className="flex flex-wrap gap-3"><LinkButton to="/register" variant="inverse" size="lg">Create a free account</LinkButton>
                <Link to="/login" className="inline-flex min-h-12 items-center rounded-md px-5 font-semibold text-white hover:bg-white/10">Sign in</Link></div>}
        </Reveal>
      </section>
    </>
  );
}
