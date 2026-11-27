import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { EmptyState, PageHeader, QueryState, Select, Toggle, errorText } from "../../design-system/ui";
import { api, post, put } from "../../lib/api";
import { dateTime, time } from "../../lib/format";

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pulse" intro="Journey reminders and alerts. Change reminder times on each booking." />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Inbox {inbox.data?.unread ? `(${inbox.data.unread} new)` : ""}</h2>
            {Boolean(inbox.data?.unread) && <Button variant="ghost" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}
          </div>
          <QueryState query={inbox}>
            {(d) => d.items.length === 0 ? <div className="mt-4"><EmptyState title="No notifications yet" body="Reminders arrive here before each confirmed journey." /></div> : (
              <ul className="mt-3 divide-y divide-line">
                {d.items.map((n) => (
                  <li key={n.id} className={`py-3 ${n.read ? "opacity-70" : ""}`}>
                    <p className="font-semibold">{!n.read && <span className="mr-2 inline-block size-2 rounded-full bg-primary" aria-label="Unread" />}{n.title}</p>
                    <p className="text-sm text-ink/80">{n.body}</p>
                    <p className="text-xs text-muted">{dateTime(n.at)}{n.link && <> · <Link to={n.link} className="font-semibold text-primary underline">Open</Link></>}</p>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>

        <Card>
          <h2 className="font-semibold">Channels</h2>
          <QueryState query={prefs}>
            {(p) => {
              const update = (ch: string, patch: Partial<Channel>) =>
                save.mutate(p.channels.map((c) => (c.channel === ch ? { ...c, ...patch } : c)));
              const email = p.channels.find((c) => c.channel === "email");
              return (
                <div className="divide-y divide-line">
                  {p.channels.map((c) => {
                    const [label, desc] = CHANNEL_LABEL[c.channel] ?? [c.channel, ""];
                    const blocked = c.channel === "whatsapp" && !p.whatsapp_consent;
                    return <Toggle key={c.channel} label={label} description={desc} checked={c.enabled} disabled={save.isPending || blocked}
                                   onChange={(v) => update(c.channel, { enabled: v })} />;
                  })}
                  <div className="py-3">
                    <Toggle label="I agree to receive WhatsApp messages" checked={p.whatsapp_consent} disabled={consent.isPending}
                            description="You can withdraw at any time. v1 never sends real messages." onChange={(v) => consent.mutate(v)} />
                  </div>
                  <div className="py-3">
                    <p className="font-medium">Quiet hours (email and browser)</p>
                    <p className="text-sm text-ink/70">Reminders 2 hours or less before departure still arrive.</p>
                    <form className="mt-2 flex items-end gap-2" onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const s = String(f.get("start") || ""), en = String(f.get("end") || "");
                      const q = s && en ? { quiet_start: toMin(s), quiet_end: toMin(en) } : { quiet_start: null, quiet_end: null };
                      save.mutate(p.channels.map((c) => (c.channel === "email" || c.channel === "webpush" ? { ...c, ...q } : c)));
                    }}>
                      <label className="flex flex-col text-xs">From<input name="start" type="time" defaultValue={hhmm(email?.quiet_start ?? null)} className="min-h-10 rounded-md border border-steel bg-surface px-2" /></label>
                      <label className="flex flex-col text-xs">To<input name="end" type="time" defaultValue={hhmm(email?.quiet_end ?? null)} className="min-h-10 rounded-md border border-steel bg-surface px-2" /></label>
                      <Button type="submit" variant="secondary" loading={save.isPending}>Save</Button>
                    </form>
                  </div>
                  <div className="py-3">
                    <Select label="Notification language" value={email?.language ?? "en"}
                            onChange={(e) => save.mutate(p.channels.map((c) => ({ ...c, language: e.target.value })))}>
                      <option value="en">English</option>
                      <option value="ta">தமிழ் (Tamil, falls back to English until translated)</option>
                      <option value="hi">हिन्दी (Hindi, falls back to English until translated)</option>
                    </Select>
                  </div>
                  <div className="py-3">
                    <Button variant="secondary" icon={<BellRing aria-hidden className="size-4" />} loading={enablePush.isPending} onClick={() => enablePush.mutate()}>
                      Enable browser notifications on this device
                    </Button>
                    {pushMsg && <p className="mt-2 text-sm" role="status">{pushMsg}</p>}
                  </div>
                  {save.isError && <Alert tone="error" title={errorText(save.error)} />}
                </div>
              );
            }}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}

interface TrainStatus {
  train: { number: string; name: string }; date: string;
  stops: { seq: number; code: string; name: string; scheduled_arrival: string | null; scheduled_departure: string | null; distance_km: number; passed_if_on_time: boolean }[];
  estimated: { phase: string; position: { after: string; next: string | null } | null; note: string };
  live: { available: boolean; note: string };
}

export function TrainStatusPage() {
  const { number = "" } = useParams();
  const [params] = useSearchParams();
  const date = params.get("date") ?? "";
  const q = useQuery({ queryKey: ["train", number, date], queryFn: () => api<TrainStatus>(`/api/v1/trains/${number}/status?date=${date}`), refetchInterval: 120_000 });
  return (
    <QueryState query={q}>
      {(t) => (
        <div className="flex flex-col gap-6">
          <PageHeader title={`Train ${t.train.number}`} intro={t.train.name} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><ConfidenceBadge level="scheduled" /><p className="mt-2 text-sm">Timetable for trains starting {t.date}.</p></Card>
            <Card><ConfidenceBadge level="estimated" /><p className="mt-2 text-sm">
              {t.estimated.phase === "running" && t.estimated.position ? `If on time: between ${t.estimated.position.after} and ${t.estimated.position.next ?? "destination"}.`
                : t.estimated.phase === "not_started" ? "Not started yet (by timetable)." : "Journey complete (by timetable)."} {t.estimated.note}</p></Card>
            <Card><ConfidenceBadge level="verified" /><p className="mt-2 text-sm">{t.live.note}</p></Card>
          </div>
          <Card>
            <ol className="relative border-l-2 border-steel/60 pl-6">
              {t.stops.map((s) => (
                <li key={s.seq} className="relative pb-5 last:pb-0">
                  <span aria-hidden className={`absolute -left-[31px] top-1 size-3.5 rounded-full border-2 ${s.passed_if_on_time ? "border-primary bg-primary" : "border-steel bg-surface"}`} />
                  <p className="font-semibold">{s.name} <span className="font-mono text-sm text-muted">{s.code}</span></p>
                  <p className="text-sm text-ink/75">
                    {s.scheduled_arrival && `arr ${time(s.scheduled_arrival)}`}{s.scheduled_arrival && s.scheduled_departure && " · "}
                    {s.scheduled_departure && `dep ${time(s.scheduled_departure)}`} · {s.distance_km} km
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
