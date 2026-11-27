import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, QueryState, Select, errorText } from "../../design-system/ui";
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
      <PageHeader title="Groups" intro="Plan one trip for everyone: add travellers, invite people with accounts, and split into valid bookings." />
      <Card>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
          <TextField label="New group name" placeholder="e.g. Varanasi wedding" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button type="submit" loading={create.isPending} disabled={!name.trim()} icon={<Users aria-hidden className="size-4" />}>Create group</Button>
        </form>
        {create.isError && <div className="mt-3"><Alert tone="error" title={errorText(create.error)} /></div>}
      </Card>
      <QueryState query={q}>
        {(groups) => groups.length === 0 ? <EmptyState title="No groups yet" body="Create a group to start planning together." /> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link to={`/app/groups/${g.id}`} className="block rounded-[var(--radius-card)] border border-line bg-surface p-5 hover:border-primary">
                  <p className="font-display text-2xl">{g.name}</p>
                  <p className="text-sm text-ink/75">{g.members.length} traveller{g.members.length === 1 ? "" : "s"} · {g.is_owner ? "You organise" : "Member"}</p>
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
    <QueryState query={q}>
      {(g) => (
        <div className="flex flex-col gap-6">
          <PageHeader title={g.name} intro={`${g.members.length} travellers`} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Travellers</h2>
              <ul className="mt-3 divide-y divide-line">
                {g.members.map((x) => (
                  <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{x.name} <span className="text-muted">· {x.family}{x.is_minor ? " · minor" : ""}{x.role === "owner" ? " · organiser" : ""}{x.linked_account ? " · has account" : ""}</span></span>
                    {g.is_owner && x.role !== "owner" && (
                      <Button variant="ghost" aria-label={`Remove ${x.name}`} onClick={() => remove.mutate(x.id)}><Trash2 aria-hidden className="size-4" /></Button>
                    )}
                  </li>
                ))}
              </ul>
              {g.is_owner && (
                <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (m.name.trim()) add.mutate(); }}>
                  <TextField label="Name" value={m.name} maxLength={80} onChange={(e) => setM({ ...m, name: e.target.value })} />
                  <TextField label="Family / sub-group" hint="Families are kept on the same booking when possible." value={m.family} maxLength={80} onChange={(e) => setM({ ...m, family: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.is_minor} onChange={(e) => setM({ ...m, is_minor: e.target.checked })} className="size-4 accent-primary" /> Under 18</label>
                  <Button type="submit" loading={add.isPending} disabled={!m.name.trim()} icon={<UserPlus aria-hidden className="size-4" />}>Add traveller</Button>
                </form>
              )}
              {(add.isError || remove.isError) && <div className="mt-3"><Alert tone="error" title={errorText(add.error ?? remove.error)} /></div>}
            </Card>

            <div className="flex flex-col gap-6">
              {g.is_owner && (
                <Card>
                  <h2 className="font-semibold">Invite people with PAYANI accounts</h2>
                  <p className="mt-1 text-sm text-ink/75">Anyone with the link can join this group for 7 days. Share it only with your travellers.</p>
                  <Button variant="secondary" className="mt-3" loading={invite.isPending} onClick={() => { setCopied(false); invite.mutate(); }}>Create invitation link</Button>
                  {invite.data && (
                    <div className="mt-3 flex items-center gap-2 rounded-md bg-ivory p-2 text-sm">
                      <code className="flex-1 truncate">{window.location.origin}{invite.data.path}</code>
                      <Button variant="ghost" aria-label="Copy link" icon={<Copy aria-hidden className="size-4" />}
                              onClick={async () => { await navigator.clipboard.writeText(window.location.origin + invite.data!.path); setCopied(true); }}>
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                </Card>
              )}
              <Card>
                <div className="flex items-end justify-between gap-3">
                  <h2 className="font-semibold">Booking plan</h2>
                  <Select label="Quota" value={quota} onChange={(e) => setQuota(e.target.value)} className="w-40">
                    <option value="GN">General</option><option value="TQ">Tatkal</option>
                  </Select>
                </div>
                <QueryState query={plan}>
                  {(p) => (
                    <div className="mt-3 flex flex-col gap-3 text-sm">
                      {p.explanation.map((e) => <p key={e}>{e}</p>)}
                      {p.warnings.map((w) => <Alert key={w} tone="warning" title={w} />)}
                      <p className="text-xs text-muted">Limit of {p.cap} per booking from {p.cap_source.note ?? "a recorded source"} (checked {p.cap_source.verified_at}).</p>
                      <ol className="grid gap-3">
                        {p.batches.map((batch, i) => (
                          <li key={i} className="rounded-md bg-ivory p-3">
                            <p className="font-semibold">Booking {i + 1} · {batch.length} traveller{batch.length > 1 ? "s" : ""}</p>
                            <p className="text-ink/80">{batch.map((t) => t.name + (t.is_minor ? " (minor)" : "")).join(", ")}</p>
                            {g.is_owner && (
                              <Link to={`/app/search?group=${g.id}&members=${batch.map((t) => t.member_id).join(",")}`}
                                    className="mt-2 inline-block font-semibold text-primary underline">Find a train for this booking</Link>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </QueryState>
              </Card>
              {g.is_owner && (
                <Button variant="ghost" className="self-start" loading={removeGroup.isPending}
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
      <PageHeader title="Join a group" intro="You've been invited to plan a trip together on PAYANI." />
      <Button loading={accept.isPending} onClick={() => accept.mutate()}>Join group</Button>
      {accept.isError && <Alert tone="error" title={errorText(accept.error)} />}
    </div>
  );
}
