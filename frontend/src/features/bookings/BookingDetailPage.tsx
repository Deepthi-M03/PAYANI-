import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ExternalLink, TrainFront } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { PageHeader, QueryState, SandboxNote, Select, StatusBadge, Toggle, errorText } from "../../design-system/ui";
import { api, download, newIdempotencyKey, post, put } from "../../lib/api";
import { dateTime, rupees } from "../../lib/format";
import type { Booking } from "../../lib/types";
import { JourneyCard } from "../book/JourneyCard";

interface Reminders { reminders: { kind: string; offset_minutes: number; enabled: boolean; fire_at: string | null; status: string }[]; note: string }
interface Handoff { url: string; note: string; steps: string[]; passengers: string[]; warning: string }

const OFFSETS = [
  [1440, "24 hours before"], [360, "6 hours before"], [120, "2 hours before"],
  [60, "1 hour before"], [30, "30 minutes before"], [0, "At departure"],
] as const;

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <p className="font-semibold">Scheduled departure time has passed.</p>;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <p aria-live="off" className="font-mono text-4xl font-medium tabular">
      {d > 0 && `${d}d `}{h}h {m}m <span className="block font-sans text-sm text-ink/70">until scheduled departure</span>
    </p>
  );
}

export function BookingDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const booking = useQuery({ queryKey: ["booking", id], queryFn: () => api<Booking>(`/api/v1/bookings/${id}`) });
  const payKey = useRef(newIdempotencyKey());
  const [simulate, setSimulate] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const refresh = (b: Booking) => qc.setQueryData(["booking", id], b);

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
    <QueryState query={booking}>
      {(b) => (
        <div className="flex flex-col gap-6">
          <PageHeader
            title={`${b.from} → ${b.to}`}
            intro={<>Booking {b.pnr ? <span className="font-mono font-semibold">{b.pnr}</span> : "draft"} · <StatusBadge status={b.status} /></>}
            actions={<Link to="/app/bookings" className="rounded-full px-4 py-2.5 text-sm font-semibold hover:bg-mist">All bookings</Link>}
          />
          <SandboxNote />
          {b.status === "FAILED" && <Alert tone="error" title="The booking could not be confirmed.">{b.failure_reason} Any payment has been refunded automatically.</Alert>}

          <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
            <div className="flex flex-col gap-6">
              <JourneyCard j={b.journey} />
              <Card>
                <h2 className="font-semibold">Passengers</h2>
                <ul className="mt-3 divide-y divide-line">
                  {b.passengers.map((p) => (
                    <li key={p.id} className="flex justify-between py-2 text-sm">
                      <span>{p.name}</span>
                      <span className="text-ink/75">{p.status}{p.coach ? ` · ${p.coach}/${p.berth}` : p.berth ? ` · ${p.berth}` : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink/70">Seats are allocated by the provider. Separate bookings may not be seated together.</p>
              </Card>
              <Card>
                <h2 className="font-semibold">Timeline</h2>
                <ol className="mt-3 space-y-3 border-l-2 border-steel/50 pl-4 text-sm">
                  {b.events.map((e, i) => (
                    <li key={i}><StatusBadge status={e.to} /> <span className="text-ink/70">{dateTime(e.at)} · {e.actor}</span>
                      {e.note && <span className="block text-ink/80">{e.note}</span>}</li>
                  ))}
                </ol>
              </Card>
              {b.status === "CONFIRMED" && <ReminderEditor bookingId={b.id} />}
            </div>

            <aside className="flex flex-col gap-4">
              {b.status === "CONFIRMED" && <Card><Countdown to={b.departure_at} /></Card>}
              <Card>
                <h2 className="font-semibold">Price</h2>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between"><dt>Simulated fare ({b.passengers.length} × {b.travel_class})</dt><dd>{rupees(b.fare_paise)}</dd></div>
                  <div className="flex justify-between"><dt>PAYANI service charge</dt><dd>{rupees(b.service_charge_paise)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total</dt><dd>{rupees(b.total_paise)}</dd></div>
                </dl>
                {b.status === "SEARCHED" && (
                  <div className="mt-4 flex flex-col gap-3">
                    <Select label="Sandbox outcome (for testing)" value={simulate} onChange={(e) => setSimulate(e.target.value)}>
                      <option value="">Normal: confirm</option>
                      <option value="waitlist">Some passengers waitlisted</option>
                      <option value="fail">Provider rejects booking</option>
                      <option value="payment_fail">Payment declined</option>
                    </Select>
                    <Button loading={pay.isPending} onClick={() => pay.mutate()}>Pay {rupees(b.total_paise)} (sandbox)</Button>
                    {pay.isError && <Alert tone="error" title={errorText(pay.error)} />}
                  </div>
                )}
                {b.payments.map((p) => <p key={p.id} className="mt-3 text-xs text-ink/70">Payment {p.reference}: {p.status} ({p.mode})</p>)}
              </Card>

              {b.refunds.length > 0 && (
                <Card>
                  <h2 className="font-semibold">Refund</h2>
                  {b.refunds.map((r) => (
                    <div key={r.id} className="mt-2 text-sm">
                      <p>{rupees(r.amount_paise)} · <span className="font-semibold">{r.status}</span></p>
                      <ol className="mt-2 space-y-1 text-xs text-ink/75">{r.timeline.map((t, i) => <li key={i}>{dateTime(t.at)}: {t.note}</li>)}</ol>
                    </div>
                  ))}
                </Card>
              )}

              <Card className="flex flex-col gap-3">
                <h2 className="font-semibold">Actions</h2>
                {b.journey.legs.map((l) => (
                  <Link key={l.train_number} to={`/app/trains/${l.train_number}?date=${l.train_origin_date}`}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline underline-offset-4">
                    <TrainFront aria-hidden className="size-4" /> Train {l.train_number} schedule
                  </Link>
                ))}
                <Button variant="secondary" icon={<CalendarPlus aria-hidden className="size-4" />} loading={ics.isPending} onClick={() => ics.mutate()}>
                  Add to calendar (.ics with alarm)
                </Button>
                <Button variant="secondary" icon={<ExternalLink aria-hidden className="size-4" />} loading={handoff.isPending} onClick={() => handoff.mutate()}>
                  Book on official IRCTC
                </Button>
                {handoff.data && (
                  <div className="rounded-md bg-ivory p-3 text-sm">
                    <p>{handoff.data.note}</p>
                    <ol className="mt-2 list-decimal pl-5">{handoff.data.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                    <p className="mt-2 text-warning">{handoff.data.warning}</p>
                    <a href={handoff.data.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-semibold text-primary underline">Open IRCTC (new tab)</a>
                  </div>
                )}
                {b.allowed_actions.includes("request_cancellation") && (
                  confirmCancel ? (
                    <div role="alertdialog" aria-labelledby="cancel-q" className="rounded-md bg-error-tint p-3 text-sm">
                      <p id="cancel-q" className="font-semibold text-error">Cancel this sandbox booking? A full sandbox refund starts automatically.</p>
                      <div className="mt-3 flex gap-2">
                        <Button loading={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel</Button>
                        <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep booking</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>
                  )
                )}
                {cancel.isError && <Alert tone="error" title={errorText(cancel.error)} />}
              </Card>
            </aside>
          </div>
        </div>
      )}
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
    <Card>
      <h2 className="font-semibold">Reminders</h2>
      <QueryState query={q}>
        {(d) => {
          const enabled = new Set(d.reminders.filter((r) => r.kind === "departure" && r.enabled).map((r) => r.offset_minutes));
          const arrival = d.reminders.some((r) => r.kind === "arrival" && r.enabled);
          const set = (offsets: number[], arrival_alert = arrival) => save.mutate({ offsets, arrival_alert });
          return (
            <div className="divide-y divide-line">
              {OFFSETS.map(([off, label]) => (
                <Toggle key={off} label={label} checked={enabled.has(off)} disabled={save.isPending}
                        onChange={(on) => set(on ? [...enabled, off] : [...enabled].filter((x) => x !== off))} />
              ))}
              <Toggle label="Arrival alert (30 min before scheduled arrival)" checked={arrival} disabled={save.isPending}
                      description="Based on the timetable, not live tracking." onChange={(on) => set([...enabled], on)} />
              <p className="pt-3 text-xs text-ink/70">{d.note}</p>
              {save.isError && <Alert tone="error" title={errorText(save.error)} />}
            </div>
          );
        }}
      </QueryState>
    </Card>
  );
}
