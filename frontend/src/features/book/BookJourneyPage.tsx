import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Plus, Trash2, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { PageHeader, QueryState, SandboxNote, Select, Skeleton, errorText } from "../../design-system/ui";
import { api, newIdempotencyKey, post } from "../../lib/api";
import { AGE_BANDS, CLASSES } from "../../lib/format";
import type { Booking, Group, Journey } from "../../lib/types";
import { useAuth } from "../auth/AuthContext";
import { JourneyCard } from "./JourneyCard";

const IRCTC_URL = "https://www.irctc.co.in/nget/train-search";

interface Policy { quota: string; label: string; max_passengers_per_pnr: number; note: string | null; verified_at: string }
interface Pax { name: string; age_band: string; group_member_id?: string }

export function BookJourneyPage() {
  const [params] = useSearchParams();
  const journeyId = params.get("journey") ?? "";
  const date = params.get("date") ?? "";
  const groupId = params.get("group");
  const memberIds = params.get("members")?.split(",").filter(Boolean) ?? [];
  const { user } = useAuth();
  const navigate = useNavigate();
  const key = useRef(newIdempotencyKey());

  const journey = useQuery({
    queryKey: ["journey", journeyId, date],
    queryFn: () => api<Journey>(`/api/v1/journeys/${encodeURIComponent(journeyId)}?date=${date}`),
    enabled: Boolean(journeyId && date),
  });
  const policies = useQuery({ queryKey: ["policies"], queryFn: () => api<Policy[]>("/api/v1/booking-policies") });
  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api<Group>(`/api/v1/groups/${groupId}`),
    enabled: Boolean(groupId),
  });

  const [quota, setQuota] = useState("GN");
  const [travelClass, setTravelClass] = useState("3A");
  const [pax, setPax] = useState<Pax[] | null>(null);
  const passengers: Pax[] =
    pax ??
    (group.data && memberIds.length
      ? group.data.members.filter((m) => memberIds.includes(m.id)).map((m) => ({
          name: m.name, age_band: m.is_minor ? "child_5_11" : "adult_18_59", group_member_id: m.id,
        }))
      : [{ name: user?.display_name ?? "", age_band: "adult_18_59" }]);
  const cap = policies.data?.find((p) => p.quota === quota)?.max_passengers_per_pnr ?? 6;
  const classes = journey.data ? CLASSES.filter((c) => journey.data.legs.every((l) => l.classes.includes(c.value))) : CLASSES;
  // Imported timetables do not always list classes or distances; the sandbox cannot price those journeys.
  const blocked = !journey.data ? null
    : journey.data.legs.some((l) => l.classes.length === 0) ? "The source timetable does not list travel classes for this train."
    : journey.data.distance_km === null ? "The source timetable has no distance for this journey, so the sandbox cannot price it."
    : null;

  const create = useMutation({
    mutationFn: () =>
      post<Booking>("/api/v1/bookings", {
        journey_id: journeyId, date, travel_class: travelClass, quota,
        passengers: passengers.map((p) => ({ name: p.name.trim(), age_band: p.age_band, group_member_id: p.group_member_id })),
        group_id: groupId ?? undefined,
      }, key.current),
    onSuccess: (b) => navigate(`/app/bookings/${b.id}`),
  });

  const update = (i: number, patch: Partial<Pax>) => setPax(passengers.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const invalid = passengers.some((p) => !p.name.trim()) || passengers.length > cap ||
    passengers.every((p) => p.age_band === "child_5_11" || p.age_band === "teen_12_17");

  if (!journeyId || !date) return <Alert tone="warning" title="Choose a journey from search first." />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Book · New booking" title="Book this journey" intro="Bookings in this preview run through a sandbox provider. You can hand off to the official IRCTC site afterwards." />
      <Steps current={1} />
      <QueryState query={journey} skeleton={<Skeleton rows={1} />}>{(j) => <JourneyCard j={j} />}</QueryState>

      <form noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" onSubmit={(e) => { e.preventDefault(); if (!invalid) create.mutate(); }}>
        <Panel title={`Travellers (${passengers.length} of ${cap})`} icon={<UserRound className="size-4" />}
               description={groupId ? "Filled in from your group plan. You can still edit names and ages." : "Names exactly as on photo ID. At least one adult per booking."}>
          <ol className="flex flex-col gap-3">
            {passengers.map((p, i) => (
              <li key={i} className="grid gap-3 rounded-md border border-line bg-ivory/60 p-3 sm:grid-cols-[2rem_1fr_13rem_auto] sm:items-end motion-safe:animate-[rise_280ms_var(--ease-ui)_both]">
                <span className="hidden size-8 place-items-center self-center rounded-full bg-navy font-mono text-xs text-white sm:grid">{i + 1}</span>
                <TextField label={`Passenger ${i + 1} name`} value={p.name} maxLength={80}
                           error={!p.name.trim() && create.isError ? "Enter a name." : undefined}
                           onChange={(e) => update(i, { name: e.target.value })} />
                <Select label="Age" value={p.age_band} onChange={(e) => update(i, { age_band: e.target.value })}>
                  {AGE_BANDS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </Select>
                <Button variant="ghost" aria-label={`Remove passenger ${i + 1}`} disabled={passengers.length === 1}
                        onClick={() => setPax(passengers.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            {passengers.length < cap ? (
              <Button variant="secondary" size="sm" icon={<Plus aria-hidden className="size-4" />}
                      onClick={() => setPax([...passengers, { name: "", age_band: "adult_18_59" }])}>
                Add passenger
              </Button>
            ) : (
              <p className="text-sm text-muted">
                This quota allows {cap} passengers per booking. For larger groups use a <a className="font-semibold text-signal underline" href="/app/groups">group plan</a>.
              </p>
            )}
          </div>
          {passengers.every((p) => p.age_band === "child_5_11" || p.age_band === "teen_12_17") && (
            <div className="mt-4"><Alert tone="warning" title="Add at least one adult passenger." /></div>
          )}
        </Panel>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Panel title="Ticket options">
            <div className="flex flex-col gap-4">
              <Select label="Quota" value={quota} onChange={(e) => setQuota(e.target.value)}>
                {(policies.data ?? []).map((p) => (
                  <option key={p.quota} value={p.quota}>{p.label} (up to {p.max_passengers_per_pnr})</option>
                ))}
              </Select>
              <Select label="Class" value={travelClass} onChange={(e) => setTravelClass(e.target.value)}>
                {classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <SandboxNote>The price on the next step is a simulated fare. PAYANI adds no service charge.</SandboxNote>
              {blocked && (
                <Alert tone="warning" title="Sandbox booking isn't available for this journey">
                  {blocked}{" "}
                  <a href={IRCTC_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-signal underline">
                    Book on the official IRCTC website<ExternalLink aria-hidden className="size-3" />
                  </a>
                </Alert>
              )}
              {create.isError && <Alert tone="error" title={errorText(create.error)} />}
              <Button type="submit" size="lg" loading={create.isPending} disabled={invalid || Boolean(blocked)}>Continue to review</Button>
            </div>
          </Panel>
        </aside>
      </form>
    </div>
  );
}

/** Booking progress: choose a train, add travellers, pay in the sandbox. */
export function Steps({ current }: { current: 0 | 1 | 2 }) {
  const steps = ["Choose a train", "Travellers", "Review and pay"];
  return (
    <ol aria-label="Booking steps" className="grid grid-cols-3 gap-2">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className="flex flex-col gap-2">
          <span className={`h-1 rounded-full ${i < current ? "bg-primary" : i === current ? "bg-saffron" : "bg-line"}`} />
          <span className={`flex items-center gap-1.5 text-xs font-medium sm:text-sm ${i <= current ? "text-ink" : "text-muted"}`}>
            {i < current && <Check aria-hidden className="size-3.5 text-primary" />}{s}
          </span>
        </li>
      ))}
    </ol>
  );
}
