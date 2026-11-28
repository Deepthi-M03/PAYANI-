import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCheck, Inbox as InboxIcon, Mail, MessageCircle, Monitor, Smartphone, TrainFront } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card, Panel } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { EmptyState, PageHeader, QueryState, Select, Skeleton, Toggle, errorText } from "../../design-system/ui";
import { api, post, put } from "../../lib/api";
import { dateTime, time } from "../../lib/format";
import type { JourneyData } from "../../lib/types";

interface Inbox { unread: number; items: { id: string; title: string; body: string; link: string | null; read: boolean; at: string }[] }
interface Channel { channel: string; enabled: boolean; language: string; quiet_start: number | null; quiet_end: number | null }
interface Prefs { channels: Channel[]; whatsapp_consent: boolean; whatsapp_mode: string; push_configured: boolean; email_configured: boolean }

const CHANNEL_LABEL: Record<string, [string, string]> = {
  in_app: ["In-app", "Shown in this inbox."],
  email: ["Email", "Sent to your account email when the server has email configured."],
  webpush: ["Browser notifications", "Best effort. Not a guaranteed alarm: browsers may delay or drop them."],
  whatsapp: ["WhatsApp", "Dry run only in v1: messages are prepared and logged, never sent."],
};

const hhmm = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

function urlB64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PulsePage() {
  const qc = useQueryClient();
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api<Inbox>("/api/v1/notifications"), refetchInterval: 60_000 });
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => api<Prefs>("/api/v1/notification-preferences") });
  const save = useMutation({ mutationFn: (c: Channel[]) => put<Prefs>("/api/v1/notification-preferences", c), onSuccess: (d) => qc.setQueryData(["prefs"], d) });
  const consent = useMutation({
    mutationFn: (granted: boolean) => post("/api/v1/consents", { purpose: "whatsapp", granted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
  });
  const readAll = useMutation({ mutationFn: () => post("/api/v1/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }) });
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const enablePush = useMutation({
    mutationFn: async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser does not support push notifications.");
      const key = await api<{ configured: boolean; public_key: string | null }>("/api/v1/push/public-key");
      if (!key.configured || !key.public_key) throw new Error("Push is not configured on this server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications were not allowed. You can change this in your browser settings.");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key.public_key) });
      const json = sub.toJSON();
      await post("/api/v1/devices/webpush", { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
    },
    onSuccess: () => { setPushMsg("Browser notifications are on for this device."); qc.invalidateQueries({ queryKey: ["prefs"] }); },
    onError: (e) => setPushMsg(e instanceof Error ? e.message : errorText(e)),
  });

  const CH_ICON = { in_app: Monitor, email: Mail, webpush: Smartphone, whatsapp: MessageCircle } as Record<string, typeof Monitor>;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Pulse" title="Pulse" intro="Journey reminders and alerts. Change reminder times on each booking." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel title="Inbox" icon={<InboxIcon className="size-4" />} description={inbox.data?.unread ? `${inbox.data.unread} unread` : "All caught up"} bodyClassName=""
               actions={Boolean(inbox.data?.unread) && <Button variant="ghost" size="sm" icon={<CheckCheck aria-hidden className="size-4" />} loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}>
          <QueryState query={inbox} skeleton={<div className="p-5"><Skeleton rows={3} /></div>}>
            {(d) => d.items.length === 0 ? <div className="p-5"><EmptyState icon={BellRing} title="No notifications yet" body="Reminders arrive here before each confirmed journey." /></div> : (
              <ul className="divide-y divide-line">
                {d.items.map((n, i) => (
                  <li key={n.id} className={`flex gap-4 px-5 py-4 transition-colors sm:px-6 motion-safe:animate-[rise_320ms_var(--ease-ui)_both] ${n.read ? "" : "bg-info-tint/40"}`} style={{ animationDelay: `${i * 50}ms` }}>
                    <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${n.read ? "bg-mist text-muted" : "bg-navy text-white"}`}><BellRing aria-hidden className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold">{!n.read && <span className="sr-only">Unread: </span>}{n.title}</p>
                        <p className="font-mono text-xs text-muted">{dateTime(n.at)}</p>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{n.body}</p>
                      {n.link && <Link to={n.link} className="mt-1 inline-block text-sm font-semibold text-signal hover:underline">Open</Link>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Panel>

        <Panel title="Channels" description="Where Pulse may reach you.">
          <QueryState query={prefs} skeleton={<Skeleton rows={3} />}>
            {(p) => {
              const update = (ch: string, patch: Partial<Channel>) =>
                save.mutate(p.channels.map((c) => (c.channel === ch ? { ...c, ...patch } : c)));
              const email = p.channels.find((c) => c.channel === "email");
              return (
                <div className="divide-y divide-line">
                  {p.channels.map((c) => {
                    const [label, desc] = CHANNEL_LABEL[c.channel] ?? [c.channel, ""];
                    const blocked = c.channel === "whatsapp" && !p.whatsapp_consent;
                    const Icon = CH_ICON[c.channel] ?? Monitor;
                    return (
                      <div key={c.channel} className="flex gap-3">
                        <Icon aria-hidden className="mt-4 size-4 shrink-0 text-steel" />
                        <div className="flex-1"><Toggle label={label} description={desc} checked={c.enabled} disabled={save.isPending || blocked} onChange={(v) => update(c.channel, { enabled: v })} /></div>
                      </div>
                    );
                  })}
                  <Toggle label="I agree to receive WhatsApp messages" checked={p.whatsapp_consent} disabled={consent.isPending}
                          description="You can withdraw at any time. This preview never sends real messages." onChange={(v) => consent.mutate(v)} />
                  <div className="py-4">
                    <p className="text-sm font-medium">Quiet hours</p>
                    <p className="text-sm text-muted">Email and browser only. Reminders 2 hours or less before departure still arrive.</p>
                    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const st = String(f.get("start") || ""), en = String(f.get("end") || "");
                      const q = st && en ? { quiet_start: toMin(st), quiet_end: toMin(en) } : { quiet_start: null, quiet_end: null };
                      save.mutate(p.channels.map((c) => (c.channel === "email" || c.channel === "webpush" ? { ...c, ...q } : c)));
                    }}>
                      <label className="flex flex-col gap-1 text-xs text-muted">From<input name="start" type="time" defaultValue={hhmm(email?.quiet_start ?? null)} className="min-h-10 rounded-md border border-steel/70 bg-surface px-2 text-sm text-ink" /></label>
                      <label className="flex flex-col gap-1 text-xs text-muted">To<input name="end" type="time" defaultValue={hhmm(email?.quiet_end ?? null)} className="min-h-10 rounded-md border border-steel/70 bg-surface px-2 text-sm text-ink" /></label>
                      <Button type="submit" variant="secondary" size="sm" loading={save.isPending}>Save</Button>
                    </form>
                  </div>
                  <div className="py-4">
                    <Select label="Notification language" value={email?.language ?? "en"}
                            onChange={(e) => save.mutate(p.channels.map((c) => ({ ...c, language: e.target.value })))}>
                      <option value="en">English</option>
                      <option value="ta">தமிழ் (Tamil, English until translated)</option>
                      <option value="hi">हिन्दी (Hindi, English until translated)</option>
                    </Select>
                  </div>
                  <div className="pt-4">
                    <Button variant="secondary" size="sm" icon={<BellRing aria-hidden className="size-4" />} loading={enablePush.isPending} onClick={() => enablePush.mutate()}>
                      Enable browser notifications
                    </Button>
                    {pushMsg && <p className="mt-2 text-sm text-muted" role="status">{pushMsg}</p>}
                  </div>
                  {save.isError && <Alert tone="error" title={errorText(save.error)} />}
                </div>
              );
            }}
          </QueryState>
        </Panel>
      </div>
    </div>
  );
}

interface TrainStatus {
  train: { number: string; name: string }; date: string;
  stops: { seq: number; code: string; name: string; scheduled_arrival: string | null; scheduled_departure: string | null; distance_km: number | null; passed_if_on_time: boolean }[];
  schedule?: JourneyData & { running_days_known?: boolean };
  estimated: { phase: string; position: { after: string; next: string | null } | null; note: string };
  live: { available: boolean; note: string };
}

export function TrainStatusPage() {
  const { number = "" } = useParams();
  const [params] = useSearchParams();
  const date = params.get("date") ?? "";
  const q = useQuery({ queryKey: ["train", number, date], queryFn: () => api<TrainStatus>(`/api/v1/trains/${number}/status?date=${date}`), refetchInterval: 120_000 });
  return (
    <QueryState query={q} skeleton={<Skeleton rows={4} />}>
      {(t) => (
        <div className="flex flex-col gap-6">
          <PageHeader eyebrow="Pulse · Train schedule" title={<span className="flex items-center gap-3"><span className="rounded bg-navy px-2 py-1 font-mono text-xl text-white">{t.train.number}</span>{t.train.name}</span>} intro={`Timetable for trains starting ${t.date}.`} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <ConfidenceBadge level={t.schedule?.confidence === "scheduled" ? "scheduled" : "simulated"} asOf={t.schedule?.as_of} />
              <p className="mt-3 text-sm text-muted">
                {t.schedule?.confidence === "scheduled"
                  ? `Times below come from ${t.schedule.source_name ?? "an imported timetable"}, published ${t.schedule.as_of}.`
                  : "Times below come from PAYANI's simulated preview timetable, not a real service."}
                {t.schedule?.running_days_known === false && " Days of operation are not in the source."}
              </p>
              {t.schedule?.outdated && t.schedule.warning && <p className="mt-2 text-xs font-medium text-warning">{t.schedule.warning}</p>}
            </Card>
            <Card className="p-5"><ConfidenceBadge level="estimated" /><p className="mt-3 text-sm text-muted">
              {t.estimated.phase === "running" && t.estimated.position ? `If on time: between ${t.estimated.position.after} and ${t.estimated.position.next ?? "destination"}.`
                : t.estimated.phase === "not_started" ? "Not started yet (by timetable)." : "Journey complete (by timetable)."} {t.estimated.note}</p></Card>
            <Card className="p-5"><ConfidenceBadge level="verified" /><p className="mt-3 text-sm text-muted">{t.live.note}</p></Card>
          </div>
          <Panel title="Stops" icon={<TrainFront className="size-4" />}>
            <ol className="relative ml-2 border-l-2 border-line">
              {t.stops.map((s, i) => (
                <li key={s.seq} className="relative grid gap-1 pb-6 pl-7 last:pb-0 sm:grid-cols-[1fr_auto] motion-safe:animate-[rise_320ms_var(--ease-ui)_both]" style={{ animationDelay: `${i * 45}ms` }}>
                  <span aria-hidden className={`absolute -left-[9px] top-1 size-4 rounded-full border-[3px] ${s.passed_if_on_time ? "border-primary bg-primary" : i === 0 || i === t.stops.length - 1 ? "border-navy bg-surface" : "border-steel bg-surface"}`} />
                  <div><p className="font-semibold">{s.name} <span className="font-mono text-xs text-muted">{s.code}</span></p>{s.distance_km !== null && <p className="text-xs text-muted">{s.distance_km} km</p>}</div>
                  <p className="font-mono text-sm tabular text-ink sm:text-right">
                    {s.scheduled_arrival && <span>arr {time(s.scheduled_arrival)}</span>}{s.scheduled_arrival && s.scheduled_departure && <span className="text-steel"> · </span>}
                    {s.scheduled_departure && <span>dep {time(s.scheduled_departure)}</span>}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      )}
    </QueryState>
  );
}
