import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, ShieldBan, UserRoundPlus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, QueryState, Select, Toggle, errorText } from "../../design-system/ui";
import { api, post } from "../../lib/api";
import { dateTime } from "../../lib/format";
import { useAuth } from "../auth/AuthContext";

interface Overview {
  consents: { community_discovery: boolean; contact_share: boolean };
  joined: { id: string; title: string; train_number: string; journey_date: string; alias: string; notify_cancellations: boolean }[];
  eligible: { train_number: string; journey_date: string }[];
}
interface Post { id: string; kind: string; body: string; status: string; mine: boolean; author: string; author_id: string | null; moderation_reason: string | null; at: string }
interface ContactReq { id: string; direction: string; status: string; other_alias: string; shared_email: string | null }

export function ConnectPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["connect"], queryFn: () => api<Overview>("/api/v1/connect/overview") });
  const reqs = useQuery({ queryKey: ["contact-requests"], queryFn: () => api<ContactReq[]>("/api/v1/connect/contact-requests") });
  const consent = useMutation({
    mutationFn: (b: { purpose: string; granted: boolean }) => post("/api/v1/consents", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connect"] }),
  });
  const [alias, setAlias] = useState(user?.display_name.split(" ")[0] ?? "");
  const [notify, setNotify] = useState(true);
  const join = useMutation({
    mutationFn: (t: { train_number: string; journey_date: string }) => post("/api/v1/connect/communities", { ...t, alias, notify_cancellations: notify }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connect"] }),
  });
  const respond = useMutation({
    mutationFn: (b: { id: string; accept: boolean }) => post(`/api/v1/connect/contact-requests/${b.id}/respond`, { accept: b.accept }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contact-requests"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connect" intro="Coordinate with people on the same train. Opt-in, private by default, and never a place to buy or sell tickets." />
      <Alert tone="info" title="House rules">Tickets are not transferable, so PAYANI does not allow selling, buying or paying for tickets here. Phone numbers and payment IDs are held for review. Contact details are shared only when both people agree.</Alert>
      <QueryState query={q}>
        {(o) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Your choices</h2>
              <Toggle label="Take part in journey communities" checked={o.consents.community_discovery} disabled={consent.isPending}
                      description="Other members see only the nickname you choose."
                      onChange={(v) => consent.mutate({ purpose: "community_discovery", granted: v })} />
              <Toggle label="Allow contact-sharing requests" checked={o.consents.contact_share} disabled={consent.isPending}
                      description="Your email is shared only if you accept a specific request."
                      onChange={(v) => consent.mutate({ purpose: "contact_share", granted: v })} />
            </Card>

            <Card>
              <h2 className="font-semibold">Your communities</h2>
              {o.joined.length === 0 ? <p className="mt-2 text-sm text-ink/75">You haven't joined any yet.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {o.joined.map((c) => (
                    <li key={c.id} className="py-2"><Link to={`/app/connect/${c.id}`} className="font-semibold text-primary underline">{c.title}</Link>
                      <span className="block text-xs text-ink/70">as {c.alias}{c.notify_cancellations ? " · cancellation alerts on" : ""}</span></li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <h2 className="font-semibold">Trains you can join</h2>
              {!o.consents.community_discovery ? <p className="mt-2 text-sm">Turn on community participation above to join.</p>
                : o.eligible.length === 0 ? <div className="mt-3"><EmptyState title="Nothing to join" body="Communities open for trains on your confirmed bookings." action={<Link to="/app/search" className="font-semibold text-primary underline">Find a journey</Link>} /></div> : (
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Nickname shown to others" value={alias} minLength={2} maxLength={40} onChange={(e) => setAlias(e.target.value)} />
                      <Toggle label="Tell me if someone on this train cancels" checked={notify} onChange={setNotify} description="Seats may or may not be released; PAYANI cannot guarantee a berth." />
                    </div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {o.eligible.map((t) => (
                        <li key={t.train_number + t.journey_date} className="flex items-center justify-between rounded-md bg-ivory p-3">
                          <span>Train {t.train_number} · {t.journey_date}</span>
                          <Button disabled={alias.trim().length < 2} loading={join.isPending && join.variables?.train_number === t.train_number} onClick={() => join.mutate(t)}>Join</Button>
                        </li>
                      ))}
                    </ul>
                    {join.isError && <Alert tone="error" title={errorText(join.error)} />}
                  </div>
                )}
            </Card>

            <Card className="lg:col-span-2">
              <h2 className="font-semibold">Contact requests</h2>
              <QueryState query={reqs}>
                {(rows) => rows.length === 0 ? <p className="mt-2 text-sm text-ink/75">None.</p> : (
                  <ul className="mt-2 divide-y divide-line">
                    {rows.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>{r.direction === "incoming" ? `${r.other_alias} wants to share contact details` : `You asked ${r.other_alias}`} · <strong>{r.status}</strong>
                          {r.shared_email && <> · <a className="text-primary underline" href={`mailto:${r.shared_email}`}>{r.shared_email}</a></>}</span>
                        {r.direction === "incoming" && r.status === "pending" && (
                          <span className="flex gap-2">
                            <Button onClick={() => respond.mutate({ id: r.id, accept: true })}>Accept</Button>
                            <Button variant="ghost" onClick={() => respond.mutate({ id: r.id, accept: false })}>Decline</Button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </QueryState>
              {respond.isError && <Alert tone="error" title={errorText(respond.error)} />}
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function CommunityPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const posts = useQuery({ queryKey: ["posts", id], queryFn: () => api<Post[]>(`/api/v1/connect/communities/${id}/posts`), refetchInterval: 30_000 });
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("post");
  const [notice, setNotice] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ status: string; moderation_reason: string | null }>(`/api/v1/connect/communities/${id}/posts`, { body, kind }),
    onSuccess: (r) => { setBody(""); setNotice(r.status === "held" ? `Held for review: ${r.moderation_reason}` : null); qc.invalidateQueries({ queryKey: ["posts", id] }); },
  });
  const act = useMutation({
    mutationFn: (a: { type: "report" | "block" | "contact"; post: Post }) =>
      a.type === "report" ? post("/api/v1/connect/reports", { post_id: a.post.id, reason: "other" })
        : a.type === "block" ? post(`/api/v1/connect/blocks/${a.post.author_id}`)
          : post("/api/v1/connect/contact-requests", { recipient_id: a.post.author_id, community_id: id }),
    onSuccess: (_, a) => {
      setNotice(a.type === "report" ? "Thanks. A moderator will review it." : a.type === "block" ? "Blocked. You won't see each other's posts." : "Request sent. Nothing is shared unless they accept.");
      qc.invalidateQueries({ queryKey: ["posts", id] });
    },
  });
  const leave = useMutation({ mutationFn: () => api(`/api/v1/connect/communities/${id}/membership`, { method: "DELETE" }), onSuccess: () => window.history.back() });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Journey community" actions={<Button variant="ghost" loading={leave.isPending} onClick={() => leave.mutate()}>Leave</Button>} />
      <Card>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) create.mutate(); }}>
          <label htmlFor="post-body" className="font-medium">Share a tip or coordinate</label>
          <textarea id="post-body" value={body} maxLength={1000} rows={3} onChange={(e) => setBody(e.target.value)}
                    className="rounded-md border border-steel bg-surface p-3" placeholder="e.g. Meeting near coach B2 for the group photo" />
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className="w-40"><option value="post">Message</option><option value="tip">Travel tip</option></Select>
            <Button type="submit" loading={create.isPending} disabled={!body.trim()}>Post</Button>
          </div>
        </form>
        {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
        {(create.isError || act.isError) && <div className="mt-3"><Alert tone="error" title={errorText(create.error ?? act.error)} /></div>}
      </Card>
      <QueryState query={posts}>
        {(rows) => rows.length === 0 ? <EmptyState title="No posts yet" body="Be the first to say hello." /> : (
          <ul className="flex flex-col gap-3">
            {rows.map((p) => (
              <li key={p.id} className={`rounded-[var(--radius-card)] border p-4 ${p.kind === "system" ? "border-info/40 bg-info-tint" : "border-line bg-surface"}`}>
                <p className="text-xs font-semibold text-ink/70">{p.author}{p.kind === "tip" ? " · tip" : ""} · {dateTime(p.at)}{p.status === "held" && " · held for review (only you can see it)"}</p>
                <p className="mt-1 whitespace-pre-wrap">{p.body}</p>
                {p.author_id && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button variant="ghost" icon={<UserRoundPlus aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "contact", post: p })}>Request contact</Button>
                    <Button variant="ghost" icon={<Flag aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "report", post: p })}>Report</Button>
                    <Button variant="ghost" icon={<ShieldBan aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "block", post: p })}>Block</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
