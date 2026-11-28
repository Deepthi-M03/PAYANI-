import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellRing, CalendarPlus, CreditCard, ExternalLink, TrainFront, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { KeyValues, QueryState, Select, Skeleton, StatusBadge, errorText } from "../../design-system/ui";
import { api, download, newIdempotencyKey, post, put } from "../../lib/api";
import { AGE_BANDS, dateTime, day, duration, rupees, time } from "../../lib/format";
import { directionsUrl, externalLink, placeUrl } from "../../lib/googleMaps";
import type { Booking } from "../../lib/types";
import { LegBar } from "../book/JourneyCard";
import { RailMap } from "../map/RailMap";

interface Reminders { reminders: { kind: string; offset_minutes: number; enabled: boolean; fire_at: string | null; status: string }[]; note: string }
interface Handoff { url: string; note: string; steps: string[]; passengers: string[]; warning: string }

const OFFSETS = [
  [1440, "24 hours before"], [360, "6 hours before"], [120, "2 hours before"],
  [60, "1 hour before"], [30, "30 minutes before"], [0, "At departure"],
] as const;
const ageLabel = (v: string) => AGE_BANDS.find((a) => a.value === v)?.label ?? v;

/** Time to scheduled departure as day / hour / minute tiles. Updates every 30 seconds. */
export function Countdown({ to, tone = "light" }: { to: string; tone?: "light" | "dark" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <p className="font-semibold">Scheduled departure time has passed.</p>;
  const parts = [[Math.floor(ms / 86_400_000), "days"], [Math.floor((ms % 86_400_000) / 3_600_000), "hours"], [Math.floor((ms % 3_600_000) / 60_000), "min"]] as const;
  const dark = tone === "dark";
  return (
    <div aria-label={`${parts[0][0]} days ${parts[1][0]} hours ${parts[2][0]} minutes until scheduled departure`} role="timer" className="flex flex-col gap-2">
      <div className="flex gap-2">
        {parts.map(([v, l]) => (
          <div key={l} className={`flex w-[4.5rem] flex-col items-center rounded-md py-2.5 ${dark ? "bg-white/10" : "border border-line bg-ivory"}`}>
            <span className="font-mono text-3xl font-medium leading-none tabular">{String(v).padStart(2, "0")}</span>
            <span className={`mt-1.5 text-[11px] ${dark ? "text-white/60" : "text-muted"}`}>{l}</span>
          </div>
        ))}
      </div>
      <p className={`text-xs ${dark ? "text-white/60" : "text-muted"}`}>until scheduled departure</p>
    </div>
  );
}

export function BookingDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const booking = useQuery({ queryKey: ["booking", id], queryFn: () => api<Booking>(`/api/v1/bookings/${id}`) });
  const payKey = useRef(newIdempotencyKey());
  const [simulate, setSimulate] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = (b: Booking) => { qc.setQueryData(["booking", id], b); void qc.invalidateQueries({ queryKey: ["bookings"] }); };

  const pay = useMutation({
    mutationFn: () => post<Booking>(`/api/v1/bookings/${id}/pay`, { simulate: simulate || null }, payKey.current),
    onSuccess: refresh,
    onError: () => { payKey.current = newIdempotencyKey(); },
  });
  const cancel = useMutation({
    mutationFn: () => post<Booking>(`/api/v1/bookings/${id}/cancel`, {}),
    onSuccess: (b) => { refresh(b); setConfirmCancel(false); },
  });
  const handoff = useMutation({ mutationFn: () => api<Handoff>(`/api/v1/bookings/${id}/handoff`) });
  const ics = useMutation({ mutationFn: () => download(`/api/v1/bookings/${id}/calendar.ics`, `payani-${id}.ics`) });

  return (
    <QueryState query={booking} skeleton={<Skeleton rows={4} />}>
      {(b) => {
        const j = b.journey;
        const first = j.legs[0], last = j.legs[j.legs.length - 1];
        const confirmed = b.status === "CONFIRMED";
        return (
          <div className="flex flex-col gap-6">
            <Link to="/app/bookings" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft aria-hidden className="size-4" /> All bookings</Link>

            {/* Ticket */}
            <section aria-label="Ticket" className="relative overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-raised)] motion-safe:animate-[ticket-in_600ms_var(--ease-ui)_both]">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-navy px-6 py-3 text-white">
                <span className="font-mono text-xs text-white/70">PAYANI sandbox booking Â· not a real ticket</span>
                <StatusBadge status={b.status} />
              </div>
              <span aria-hidden className="pointer-events-none absolute right-6 top-20 rotate-[-12deg] select-none font-mono text-5xl font-medium text-navy/[0.05] sm:text-7xl">SANDBOX</span>
              <div className="grid gap-0 md:grid-cols-[1fr_auto]">
                <div className="flex flex-col gap-5 p-6 sm:p-8">
                  <div className="grid grid-cols-[auto_1fr_auto] items-end gap-4">
                    <div><p className="font-mono text-xs text-muted">{first?.from}</p><p className="font-mono text-4xl font-medium tabular sm:text-5xl">{time(j.departure)}</p><p className="mt-1 text-sm font-medium">{first?.from_name}</p><p className="text-xs text-muted">{day(j.departure)}</p></div>
                    <div className="mb-8 flex flex-col items-center gap-1 text-xs text-muted"><span>{duration(j.duration_min)}</span><span className="h-px w-full bg-line" /><span>{j.transfers === 0 ? "Direct" : `${j.transfers} change${j.transfers > 1 ? "s" : ""}`}</span></div>
                    <div className="text-right"><p className="font-mono text-xs text-muted">{last?.to}</p><p className="font-mono text-4xl font-medium tabular sm:text-5xl">{time(j.arrival)}</p><p className="mt-1 text-sm font-medium">{last?.to_name}</p><p className="text-xs text-muted">{day(j.arrival)}</p></div>
                  </div>
                  <LegBar j={j} />
                  <ol className="grid gap-2 text-sm">
                    {j.legs.map((l, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="rounded bg-navy px-1.5 py-0.5 font-mono text-xs text-white">{l.train_number}</span>
                        <span className="font-medium">{l.train_name}</span>
                        <span className="text-muted">{l.from} {time(l.departure)} â†’ {l.to} {time(l.arrival)}{l.distance_km !== null && ` Â· ${l.distance_km} km`}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="relative flex flex-col justify-between gap-6 border-t border-dashed border-steel/50 bg-ivory p-6 sm:p-8 md:w-72 md:border-l md:border-t-0">
                  <span aria-hidden className="absolute -left-3 -top-3 hidden size-6 rounded-full border border-line bg-ivory md:block" />
                  <KeyValues items={[["Reference", <span key="r" className="font-mono">{b.pnr ?? "Not issued yet"}</span>], ["Class", b.travel_class], ["Quota", b.quota === "TQ" ? "Tatkal" : "General"], ["Travellers", b.passengers.length]]} />
                  <ConfidenceBadge level="simulated" />
                </div>
              </div>
            </section>

            {b.status === "FAILED" && <Alert tone="error" title="The booking could not be confirmed.">{b.failure_reason} Any payment has been refunded automatically.</Alert>}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <Panel title="Passengers" icon={<Users className="size-4" />} description="Seats are allocated by the provider. Separate bookings may not be seated together." bodyClassName="">
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead><tr><th scope="col">Name</th><th scope="col" className="hidden sm:table-cell">Age</th><th scope="col">Status</th><th scope="col">Coach / berth</th></tr></thead>
                      <tbody>{b.passengers.map((p) => (
                        <tr key={p.id}><th scope="row" className="font-medium">{p.name}</th><td className="hidden text-muted sm:table-cell">{ageLabel(p.age_band)}</td><td className="font-mono text-xs">{p.status}</td><td className="font-mono text-xs">{p.coach ? `${p.coach} / ${p.berth}` : p.berth ?? "â€”"}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Panel>

                <Panel title="Route" description="Straight schematic segments between stops, not track geometry.">
                  <RailMap from={b.from} to={b.to} routes={[{ id: b.id, legs: j.legs.map((l) => ({ from: l.from, to: l.to })) }]} activeRouteId={b.id} className="h-[320px]" label="Map of this booking's route" />
                  {first && last && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Open in Google Maps">
                      <a href={placeUrl({ name: first.from_name })} {...externalLink} className="inline-flex items-center gap-1 font-semibold text-signal hover:underline">
                        <ExternalLink aria-hidden className="size-3.5" />{first.from_name} in Google Maps
                      </a>
                      <a href={placeUrl({ name: last.to_name })} {...externalLink} className="inline-flex items-center gap-1 font-semibold text-signal hover:underline">
                        <ExternalLink aria-hidden className="size-3.5" />{last.to_name} in Google Maps
                      </a>
                      <a href={directionsUrl({ name: first.from_name }, { name: last.to_name })} {...externalLink} className="inline-flex items-center gap-1 font-semibold text-signal hover:underline">
                        <ExternalLink aria-hidden className="size-3.5" />Directions
                      </a>
                    </div>
                  )}
                </Panel>

                {confirmed && <ReminderEditor bookingId={b.id} />}

                <Panel title="History" bodyClassName="px-5 py-4 sm:px-6">
                  <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
                    {b.events.map((e, i) => (
                      <li key={i} className="relative">
                        <span aria-hidden className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-surface bg-primary ring-1 ring-line" />
                        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.to} /><span className="text-xs text-muted">{dateTime(e.at)} Â· {e.actor}</span></div>
                        {e.note && <p className="mt-1 text-sm text-muted">{e.note}</p>}
                      </li>
                    ))}
                  </ol>
                </Panel>
              </div>

              <aside className="flex flex-col gap-6">
                {confirmed && <Panel title="Departure"><Countdown to={b.departure_at} /></Panel>}
                <Panel title="Price" icon={<CreditCard className="size-4" />}>
                  <KeyValues items={[[`Simulated fare (${b.passengers.length} Ã— ${b.travel_class})`, rupees(b.fare_paise)], ["PAYANI service charge", rupees(b.service_charge_paise)], [<strong key="t" className="text-ink">Total</strong>, <strong key="v" className="font-mono">{rupees(b.total_paise)}</strong>]]} />
                  {b.status === "SEARCHED" && (
                    <div className="mt-4 flex flex-col gap-3">
                      <Select label="Sandbox outcome (for testing)" value={simulate} onChange={(e) => setSimulate(e.target.value)}>
                        <option value="">Normal: confirm</option>
                        <option value="waitlist">Some passengers waitlisted</option>
                        <option value="fail">Provider rejects booking</option>
                        <option value="payment_fail">Payment declined</option>
                      </Select>
                      <Button size="lg" loading={pay.isPending} onClick={() => pay.mutate()}>Pay {rupees(b.total_paise)} (sandbox)</Button>
                      {pay.isError && <Alert tone="error" title={errorText(pay.error)} />}
                    </div>
                  )}
                  {b.payments.map((p) => <p key={p.id} className="mt-3 text-xs text-muted">Payment <span className="font-mono">{p.reference}</span>: {p.status} ({p.mode})</p>)}
                </Panel>

                {b.refunds.length > 0 && (
                  <Panel title="Refund">
                    {b.refunds.map((r) => (
                      <div key={r.id} className="text-sm">
                        <p className="flex items-center justify-between"><span className="font-mono font-medium">{rupees(r.amount_paise)}</span><span className="rounded bg-success-tint px-2 py-0.5 text-xs font-semibold text-success">{r.status}</span></p>
                        <ol className="mt-3 space-y-1.5 text-xs text-muted">{r.timeline.map((t, i) => <li key={i}>{dateTime(t.at)} Â· {t.note}</li>)}</ol>
                      </div>
                    ))}
                  </Panel>
                )}

                <Panel title="Actions">
                  <div className="flex flex-col gap-2">
                    {j.legs.map((l) => (
                      <Link key={l.train_number} to={`/app/trains/${l.train_number}?date=${l.train_origin_date}`}
                            className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold text-signal hover:bg-info-tint">
                        <TrainFront aria-hidden className="size-4" /> Train {l.train_number} schedule
                      </Link>
                    ))}
                    <Button variant="secondary" icon={<CalendarPlus aria-hidden className="size-4" />} loading={ics.isPending} onClick={() => ics.mutate()}>Add to calendar</Button>
                    <Button variant="secondary" icon={<ExternalLink aria-hidden className="size-4" />} loading={handoff.isPending} onClick={() => handoff.mutate()}>Book on official IRCTC</Button>
                    {handoff.data && (
                      <div className="rounded-md border border-line bg-ivory p-3 text-sm motion-safe:animate-[rise_240ms_var(--ease-ui)]">
                        <p>{handoff.data.note}</p>
                        <ol className="mt-2 list-decimal pl-5">{handoff.data.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                        <p className="mt-2 text-warning">{handoff.data.warning}</p>
                        <a href={handoff.data.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-signal underline">Open IRCTC (new tab)</a>
                      </div>
                    )}
                    {b.allowed_actions.includes("request_cancellation") && (confirmCancel ? (
                      <div role="alertdialog" aria-labelledby="cancel-q" className="rounded-md border border-error/30 bg-error-tint p-3 text-sm">
                        <p id="cancel-q" className="font-semibold text-error">Cancel this sandbox booking? A full sandbox refund starts automatically.</p>
                        <div className="mt-3 flex gap-2">
                          <Button variant="danger" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel</Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(false)}>Keep booking</Button>
                        </div>
                      </div>
                    ) : <Button variant="ghost" className="text-error hover:bg-error-tint" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>)}
                    {cancel.isError && <Alert tone="error" title={errorText(cancel.error)} />}
                  </div>
                </Panel>
              </aside>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

function ReminderEditor({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reminders", bookingId], queryFn: () => api<Reminders>(`/api/v1/bookings/${bookingId}/reminders`) });
  const save = useMutation({
    mutationFn: (body: { offsets: number[]; arrival_alert: boolean }) => put<Reminders>(`/api/v1/bookings/${bookingId}/reminders`, body),
    onSuccess: (d) => qc.setQueryData(["reminders", bookingId], d),
  });
  return (
    <Panel title="Reminders" icon={<BellRing className="size-4" />} description="Pick when Pulse reminds you. Delivered in the app and by email when configured.">
      <QueryState query={q} skeleton={<Skeleton rows={2} />}>
        {(d) => {
          const enabled = new Set(d.reminders.filter((r) => r.kind === "departure" && r.enabled).map((r) => r.offset_minutes));
          const arrival = d.reminders.some((r) => r.kind === "arrival" && r.enabled);
          const set = (offsets: number[], arrival_alert = arrival) => save.mutate({ offsets, arrival_alert });
          return (
            <div className="flex flex-col gap-4">
              <div role="group" aria-label="Departure reminders" className="flex flex-wrap gap-2">
                {OFFSETS.map(([off, label]) => {
                  const on = enabled.has(off);
                  return (
                    <button key={off} type="button" aria-pressed={on} disabled={save.isPending}
                            onClick={() => set(on ? [...enabled].filter((x) => x !== off) : [...enabled, off])}
                            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${on ? "border-primary bg-primary text-white" : "border-steel/50 bg-surface text-ink hover:border-primary"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-start gap-3 text-sm">
                <input aria-label="Arrival alert" id="arrival-alert-confirmation" type="checkbox" checked={arrival} disabled={save.isPending} onChange={(e) => set([...enabled], e.target.checked)} className="mt-0.5 size-4 accent-primary" />
                <span><span className="font-medium">Arrival alert</span> <span className="text-muted">30 minutes before scheduled arrival. Based on the timetable, not live tracking.</span></span>
              </div>
              {d.note && <p className="text-xs text-muted">{d.note}</p>}
              {save.isError && <Alert tone="error" title={errorText(save.error)} />}
            </div>
          );
        }}
      </QueryState>
    </Panel>
  );
}
