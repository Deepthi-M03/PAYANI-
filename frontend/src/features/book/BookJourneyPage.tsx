import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { PageHeader, QueryState, SandboxNote, Select, errorText } from "../../design-system/ui";
import { api, newIdempotencyKey, post } from "../../lib/api";
import { AGE_BANDS, CLASSES } from "../../lib/format";
import type { Booking, Group, Journey } from "../../lib/types";
import { useAuth } from "../auth/AuthContext";
import { JourneyCard } from "./JourneyCard";

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
      <PageHeader title="Book this journey" intro="Bookings in PAYANI v1 run through a sandbox provider. You can also hand off to the official IRCTC site afterwards." />
      <QueryState query={journey}>{(j) => <JourneyCard j={j} />}</QueryState>

      <Card>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Quota" value={quota} onChange={(e) => setQuota(e.target.value)}>
              {(policies.data ?? []).map((p) => (
                <option key={p.quota} value={p.quota}>{p.label} (up to {p.max_passengers_per_pnr} per booking)</option>
              ))}
            </Select>
            <Select label="Class" value={travelClass} onChange={(e) => setTravelClass(e.target.value)}>
              {classes.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-semibold">Passengers ({passengers.length}/{cap})</legend>
            {passengers.map((p, i) => (
              <div key={i} className="grid gap-3 rounded-md bg-ivory/60 p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
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
              </div>
            ))}
            {passengers.length < cap ? (
              <Button variant="secondary" icon={<Plus aria-hidden className="size-4" />} className="self-start"
                      onClick={() => setPax([...passengers, { name: "", age_band: "adult_18_59" }])}>
                Add passenger
              </Button>
            ) : (
              <p className="text-sm text-ink/75">
                This quota allows {cap} passengers per booking. For larger groups use a <a className="font-semibold text-primary underline" href="/app/groups">group plan</a>.
              </p>
            )}
            {passengers.every((p) => p.age_band === "child_5_11" || p.age_band === "teen_12_17") && (
              <Alert tone="warning" title="Add at least one adult passenger." />
            )}
          </fieldset>

          <SandboxNote>
            Price shown on the next step is a simulated fare. PAYANI adds no service charge in v1.
          </SandboxNote>
          {create.isError && <Alert tone="error" title={errorText(create.error)} />}
          <Button type="submit" loading={create.isPending} disabled={invalid} className="self-start">
            Continue to review
          </Button>
        </form>
      </Card>
    </div>
  );
}
