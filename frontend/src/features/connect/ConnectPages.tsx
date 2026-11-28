import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, LogOut, MessagesSquare, Send, ShieldBan, ShieldCheck, TrainFront, UserRoundPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, QueryState, Select, Skeleton, Toggle, errorText } from "../../design-system/ui";
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
      <PageHeader eyebrow="Connect" title="Connect" intro="Coordinate with people on the same train. Opt-in, private by default, and never a place to buy or sell tickets." />
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-panel)]">
        <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-muted"><span className="font-semibold text-ink">House rules.</span> Tickets are not transferable, so selling, buying or paying for tickets is not allowed. Phone numbers and payment IDs are held for review. Contact details are shared only when both people agree.</p>
      </div>
      <QueryState query={q} skeleton={<Skeleton rows={3} />}>
        {(o) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Your choices" icon={<ShieldCheck className="size-4" />} bodyClassName="px-5 sm:px-6">
              <Toggle label="Take part in journey communities" checked={o.consents.community_discovery} disabled={consent.isPending}
                      description="Other members see only the nickname you choose."
                      onChange={(v) => consent.mutate({ purpose: "community_discovery", granted: v })} />
              <Toggle label="Allow contact-sharing requests" checked={o.consents.contact_share} disabled={consent.isPending}
                      description="Your email is shared only if you accept a specific request."
                      onChange={(v) => consent.mutate({ purpose: "contact_share", granted: v })} />
            </Panel>

            <Panel title="Your communities" icon={<MessagesSquare className="size-4" />} bodyClassName="px-5 py-2 sm:px-6">
              {o.joined.length === 0 ? <p className="py-4 text-sm text-muted">You haven't joined any yet.</p> : (
                <ul className="divide-y divide-line">
                  {o.joined.map((c) => (
                    <li key={c.id}><Link to={`/app/connect/${c.id}`} className="group flex items-center gap-3 py-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-navy text-white"><TrainFront aria-hidden className="size-5" /></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold group-hover:text-signal">{c.title}</span>
                        <span className="block text-xs text-muted">as {c.alias}{c.notify_cancellations ? " · cancellation alerts on" : ""}</span></span>
                    </Link></li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Trains you can join" icon={<Users className="size-4" />} className="lg:col-span-2">
              {!o.consents.community_discovery ? <p className="text-sm text-muted">Turn on community participation above to join.</p>
                : o.eligible.length === 0 ? <div><EmptyState title="Nothing to join" body="Communities open for trains on your confirmed bookings." action={<Link to="/app/search" className="font-semibold text-primary underline">Find a journey</Link>} /></div> : (
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Nickname shown to others" value={alias} minLength={2} maxLength={40} onChange={(e) => setAlias(e.target.value)} />
                      <Toggle label="Tell me if someone on this train cancels" checked={notify} onChange={setNotify} description="Seats may or may not be released; PAYANI cannot guarantee a berth." />
                    </div>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {o.eligible.map((t) => (
                        <li key={t.train_number + t.journey_date} className="flex items-center justify-between gap-3 rounded-md border border-line bg-ivory/70 p-3">
                          <span className="flex items-center gap-2"><span className="rounded bg-navy px-1.5 py-0.5 font-mono text-xs text-white">{t.train_number}</span><span className="text-sm">{t.journey_date}</span></span>
                          <Button disabled={alias.trim().length < 2} loading={join.isPending && join.variables?.train_number === t.train_number} onClick={() => join.mutate(t)}>Join</Button>
                        </li>
                      ))}
                    </ul>
                    {join.isError && <Alert tone="error" title={errorText(join.error)} />}
                  </div>
                )}
            </Panel>

            <Panel title="Contact requests" icon={<UserRoundPlus className="size-4" />} className="lg:col-span-2" bodyClassName="px-5 py-2 sm:px-6">
              <QueryState query={reqs} skeleton={<Skeleton rows={1} />}>
                {(rows) => rows.length === 0 ? <p className="py-4 text-sm text-muted">No requests.</p> : (
                  <ul className="divide-y divide-line">
                    {rows.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                        <span>{r.direction === "incoming" ? `${r.other_alias} wants to share contact details` : `You asked ${r.other_alias}`} · <strong>{r.status}</strong>
                          {r.shared_email && <> · <a className="text-primary underline" href={`mailto:${r.shared_email}`}>{r.shared_email}</a></>}</span>
                        {r.direction === "incoming" && r.status === "pending" && (
                          <span className="flex gap-2">
                            <Button size="sm" onClick={() => respond.mutate({ id: r.id, accept: true })}>Accept</Button>
                            <Button size="sm" variant="ghost" onClick={() => respond.mutate({ id: r.id, accept: false })}>Decline</Button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </QueryState>
              {respond.isError && <Alert tone="error" title={errorText(respond.error)} />}
            </Panel>
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
      <PageHeader eyebrow="Connect · Community" title="Journey community" intro="Only people booked on this train can read and post here."
                  actions={<Button variant="secondary" size="sm" icon={<LogOut aria-hidden className="size-4" />} loading={leave.isPending} onClick={() => leave.mutate()}>Leave</Button>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Posts" className="flex flex-col gap-3">
          <QueryState query={posts} skeleton={<Skeleton rows={3} />}>
            {(rows) => rows.length === 0 ? <EmptyState icon={MessagesSquare} title="No posts yet" body="Be the first to say hello." /> : (
              <ul className="flex flex-col gap-3">
                {rows.map((p, i) => (
                  <li key={p.id} className={`rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-panel)] motion-safe:animate-[rise_320ms_var(--ease-ui)_both] ${p.kind === "system" ? "border-info/30 bg-info-tint" : p.mine ? "border-primary/30 bg-surface" : "border-line bg-surface"}`} style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="flex items-center gap-3">
                      <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${p.kind === "system" ? "bg-info text-white" : "bg-navy text-white"}`}>{p.author.slice(0, 1)}</span>
                      <p className="text-sm"><span className="font-semibold">{p.author}</span>{p.kind === "tip" && <span className="ml-2 rounded bg-saffron/15 px-1.5 py-0.5 text-xs font-semibold text-saffron-text">Tip</span>}
                        <span className="block text-xs text-muted">{dateTime(p.at)}{p.status === "held" && " · held for review (only you can see it)"}</span></p>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-relaxed">{p.body}</p>
                    {p.author_id && (
                      <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-2">
                        <Button variant="ghost" size="sm" icon={<UserRoundPlus aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "contact", post: p })}>Request contact</Button>
                        <Button variant="ghost" size="sm" icon={<Flag aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "report", post: p })}>Report</Button>
                        <Button variant="ghost" size="sm" icon={<ShieldBan aria-hidden className="size-4" />} onClick={() => act.mutate({ type: "block", post: p })}>Block</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </section>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Panel title="Write a post">
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) create.mutate(); }}>
              <label htmlFor="post-body" className="text-sm font-medium">Share a tip or coordinate</label>
              <textarea id="post-body" value={body} maxLength={1000} rows={4} onChange={(e) => setBody(e.target.value)}
                        className="rounded-md border border-steel/70 bg-surface p-3 text-sm focus:border-primary" placeholder="e.g. Meeting near coach B2 for the group photo" />
              <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="post">Message</option><option value="tip">Travel tip</option></Select>
              <Button type="submit" loading={create.isPending} disabled={!body.trim()} icon={<Send aria-hidden className="size-4" />}>Post</Button>
            </form>
            {notice && <p role="status" className="mt-3 text-sm text-muted">{notice}</p>}
            {(create.isError || act.isError) && <div className="mt-3"><Alert tone="error" title={errorText(create.error ?? act.error)} /></div>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
