import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, Link2, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button, LinkButton } from "../../design-system/Button";
import { Card, Panel } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, QueryState, Select, Skeleton, errorText } from "../../design-system/ui";
import { api, del, post } from "../../lib/api";
import type { BatchPlan, Group } from "../../lib/types";

export function GroupsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/v1/groups") });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => post<Group>("/api/v1/groups", { name: name.trim() }),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ["groups"] }); navigate(`/app/groups/${g.id}`); },
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Book · Groups" title="Groups" intro="Plan one trip for everyone: add travellers, invite people with accounts, and split into valid bookings." />
      <Card className="p-4 sm:p-5">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <TextField label="New group" placeholder="e.g. Varanasi wedding" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button type="submit" loading={create.isPending} disabled={!name.trim()} icon={<Users aria-hidden className="size-4" />}>Create group</Button>
        </form>
        {create.isError && <div className="mt-3"><Alert tone="error" title={errorText(create.error)} /></div>}
      </Card>
      <QueryState query={q} skeleton={<Skeleton rows={2} />}>
        {(groups) => groups.length === 0 ? <EmptyState icon={Users} title="No groups yet" body="Create a group to start planning together." /> : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g, i) => (
              <li key={g.id} className="motion-safe:animate-[rise_360ms_var(--ease-ui)_both]" style={{ animationDelay: `${i * 60}ms` }}>
                <Link to={`/app/groups/${g.id}`} className="group flex h-full flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)] transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5 hover:border-primary/50">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-base font-semibold leading-snug">{g.name}</p>
                    <span className="shrink-0 rounded bg-ivory px-2 py-0.5 text-xs text-muted">{g.is_owner ? "Organiser" : "Member"}</span>
                  </div>
                  <div className="flex -space-x-2">
                    {g.members.slice(0, 6).map((m) => (
                      <span key={m.id} title={m.name} className="grid size-8 place-items-center rounded-full border-2 border-surface bg-navy text-[11px] font-semibold text-white">{m.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                    ))}
                    {g.members.length > 6 && <span className="grid size-8 place-items-center rounded-full border-2 border-surface bg-mist text-[11px] font-semibold text-muted">+{g.members.length - 6}</span>}
                  </div>
                  <p className="mt-auto flex items-center justify-between text-sm text-muted">
                    <span>{g.members.length} traveller{g.members.length === 1 ? "" : "s"}{g.from && g.to ? ` · ${g.from} → ${g.to}` : ""}</span>
                    <ArrowRight aria-hidden className="size-4 text-steel transition-transform group-hover:translate-x-1" />
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

export function GroupDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["group", id], queryFn: () => api<Group>(`/api/v1/groups/${id}`) });
  const [quota, setQuota] = useState("GN");
  const plan = useQuery({ queryKey: ["plan", id, quota, q.data?.members.length], queryFn: () => api<BatchPlan>(`/api/v1/groups/${id}/batch-plan?quota=${quota}`), enabled: q.isSuccess });
  const [m, setM] = useState({ name: "", family: "", is_minor: false });
  const set = (g: Group) => qc.setQueryData(["group", id], g);
  const add = useMutation({ mutationFn: () => post<Group>(`/api/v1/groups/${id}/members`, m), onSuccess: (g) => { set(g); setM({ name: "", family: m.family, is_minor: false }); } });
  const remove = useMutation({ mutationFn: (mid: string) => del<Group>(`/api/v1/groups/${id}/members/${mid}`), onSuccess: set });
  const invite = useMutation({ mutationFn: () => post<{ path: string; expires_in_days: number }>(`/api/v1/groups/${id}/invitations`) });
  const [copied, setCopied] = useState(false);
  const removeGroup = useMutation({ mutationFn: () => del(`/api/v1/groups/${id}`), onSuccess: () => navigate("/app/groups") });

  return (
    <QueryState query={q} skeleton={<Skeleton rows={3} />}>
      {(g) => (
        <div className="flex flex-col gap-6">
          <PageHeader eyebrow="Book · Group" title={g.name} meta={<><span className="rounded bg-ivory px-2 py-0.5">{g.members.length} travellers</span><span className="rounded bg-ivory px-2 py-0.5">{new Set(g.members.map((m) => m.family || m.id)).size} families</span>{g.members.some((m) => m.is_minor) && <span className="rounded bg-ivory px-2 py-0.5">Includes minors</span>}</>} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Panel title="Travellers" icon={<Users className="size-4" />} bodyClassName="">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th scope="col">Name</th><th scope="col">Family</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{g.members.map((x) => (
                    <tr key={x.id}>
                      <th scope="row" className="font-medium">{x.name}</th>
                      <td className="text-muted">{x.family || "—"}</td>
                      <td className="text-xs text-muted">{[x.is_minor && "Under 18", x.role === "owner" && "Organiser", x.linked_account && "Has account"].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-right">{g.is_owner && x.role !== "owner" && (
                        <Button variant="ghost" size="sm" aria-label={`Remove ${x.name}`} onClick={() => remove.mutate(x.id)}><Trash2 aria-hidden className="size-4" /></Button>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {g.is_owner && (
                <form className="grid gap-3 border-t border-line p-5 sm:grid-cols-2 sm:p-6" onSubmit={(e) => { e.preventDefault(); if (m.name.trim()) add.mutate(); }}>
                  <TextField label="Name" value={m.name} maxLength={80} onChange={(e) => setM({ ...m, name: e.target.value })} />
                  <TextField label="Family or sub-group" hint="Kept on the same booking when possible." value={m.family} maxLength={80} onChange={(e) => setM({ ...m, family: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.is_minor} onChange={(e) => setM({ ...m, is_minor: e.target.checked })} className="size-4 accent-primary" /> Under 18</label>
                  <Button type="submit" loading={add.isPending} disabled={!m.name.trim()} icon={<UserPlus aria-hidden className="size-4" />}>Add traveller</Button>
                </form>
              )}
              {(add.isError || remove.isError) && <div className="p-5 pt-0"><Alert tone="error" title={errorText(add.error ?? remove.error)} /></div>}
            </Panel>

            <div className="flex flex-col gap-6">
              <Panel title="Booking plan" description="The fewest valid bookings, keeping families together."
                     actions={<Select label="Quota" hideLabel value={quota} onChange={(e) => setQuota(e.target.value)} className="w-36"><option value="GN">General</option><option value="TQ">Tatkal</option></Select>}>
                <QueryState query={plan} skeleton={<Skeleton rows={2} />}>
                  {(p) => (
                    <div className="flex flex-col gap-4 text-sm">
                      <div className="flex flex-col gap-1 text-muted">{p.explanation.map((e) => <p key={e}>{e}</p>)}</div>
                      {p.warnings.map((w) => <Alert key={w} tone="warning" title={w} />)}
                      <ol className="grid gap-3">
                        {p.batches.map((batch, i) => (
                          <li key={i} className="rounded-md border border-line bg-ivory/70 p-4 motion-safe:animate-[rise_360ms_var(--ease-ui)_both]" style={{ animationDelay: `${i * 90}ms` }}>
                            <div className="flex items-center justify-between">
                              <p className="font-semibold">Booking {i + 1}</p>
                              <span className="font-mono text-xs text-muted">{batch.length} / {p.cap}</span>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-primary" style={{ width: `${(batch.length / p.cap) * 100}%` }} /></div>
                            <div className="mt-3 flex flex-wrap gap-1.5">{batch.map((t) => <span key={t.member_id} className="rounded bg-surface px-2 py-1 text-xs ring-1 ring-line">{t.name}{t.is_minor ? " (minor)" : ""}</span>)}</div>
                            {g.is_owner && (
                              <LinkButton to={`/app/search?group=${g.id}&members=${batch.map((t) => t.member_id).join(",")}`} variant="secondary" size="sm" className="mt-3" icon={<Search aria-hidden className="size-4" />}>Find a train for this booking</LinkButton>
                            )}
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-muted">Limit of {p.cap} per booking from {p.cap_source.note ?? "a recorded source"} (checked {p.cap_source.verified_at}).</p>
                    </div>
                  )}
                </QueryState>
              </Panel>
              {g.is_owner && (
                <Panel title="Invite people" icon={<Link2 className="size-4" />} description="Anyone with the link can join for 7 days. Share it only with your travellers.">
                  <Button variant="secondary" loading={invite.isPending} onClick={() => { setCopied(false); invite.mutate(); }}>Create invitation link</Button>
                  {invite.data && (
                    <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-ivory p-2 text-sm">
                      <code className="flex-1 truncate font-mono text-xs">{window.location.origin}{invite.data.path}</code>
                      <Button variant="ghost" size="sm" aria-label="Copy link" icon={<Copy aria-hidden className="size-4" />}
                              onClick={async () => { await navigator.clipboard.writeText(window.location.origin + invite.data!.path); setCopied(true); }}>
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                </Panel>
              )}
              {g.is_owner && (
                <Button variant="ghost" className="self-start text-error hover:bg-error-tint" loading={removeGroup.isPending}
                        onClick={() => { if (window.confirm("Delete this group? Bookings already made are kept.")) removeGroup.mutate(); }}>
                  Delete group
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </QueryState>
  );
}

export function InviteAcceptPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const accept = useMutation({ mutationFn: () => post<Group>(`/api/v1/invitations/${token}/accept`), onSuccess: (g) => navigate(`/app/groups/${g.id}`) });
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <PageHeader eyebrow="Book · Groups" title="Join a group" intro="You've been invited to plan a trip together on PAYANI." />
      <Button loading={accept.isPending} onClick={() => accept.mutate()}>Join group</Button>
      {accept.isError && <Alert tone="error" title={errorText(accept.error)} />}
    </div>
  );
}
