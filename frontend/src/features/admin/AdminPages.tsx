import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, QueryState, Select, Stat, StatusBadge, Toggle, errorText } from "../../design-system/ui";
import { api, post, put } from "../../lib/api";
import { dateTime, rupees } from "../../lib/format";
import { useAuth } from "../auth/AuthContext";

const TABS = [
  ["", "Overview", "analytics.read"], ["users", "Users", "user.read_all"], ["bookings", "Bookings", "booking.read_all"],
  ["notifications", "Notifications", "analytics.read"], ["moderation", "Moderation", "moderation.manage"],
  ["audit", "Audit log", "audit.read"], ["config", "Configuration", "admin.access"],
] as const;

export function AdminLayout() {
  const { can } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Administration" intro="Sandbox platform monitoring. Every change here is recorded in the audit log." />
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1 rounded-full bg-surface p-1">
        {TABS.filter(([, , perm]) => can(perm)).map(([path, label]) => (
          <NavLink key={path} end to={`/app/admin${path ? `/${path}` : ""}`}
                   className={({ isActive }) => `rounded-full px-4 py-2 text-sm font-semibold ${isActive ? "bg-ink text-surface" : "hover:bg-mist"}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

interface Overview { users: number; bookings_by_status: Record<string, number>; payments_by_status: Record<string, number>;
  refunds_by_status: Record<string, number>; outbox_by_status: Record<string, number>; jobs_by_status: Record<string, number>;
  open_reports: number; held_posts: number; catalog: { status: string; as_of?: string; trains: number } }
interface Analytics { searches_per_day: { day: string; count: number }[]; top_routes: { route: string; count: number }[];
  searches: number; confirmed_bookings: number; search_p95_ms: number; note: string }

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

export function AdminOverviewPage() {
  const o = useQuery({ queryKey: ["admin-overview"], queryFn: () => api<Overview>("/api/v1/admin/overview") });
  const a = useQuery({ queryKey: ["admin-analytics"], queryFn: () => api<Analytics>("/api/v1/admin/analytics") });
  const providers = useQuery({ queryKey: ["admin-providers"], queryFn: () => api<{ capability: string; provider: string; mode: string; status: string }[]>("/api/v1/admin/providers") });
  return (
    <div className="flex flex-col gap-6">
      <QueryState query={o}>
        {(d) => (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Users" value={d.users} />
            <Stat label="Bookings" value={sum(d.bookings_by_status)} hint={`${d.bookings_by_status.CONFIRMED ?? 0} confirmed`} />
            <Stat label="Reminder queue" value={d.outbox_by_status.pending ?? 0} hint={`${d.outbox_by_status.dead ?? 0} dead-lettered`} />
            <Stat label="Moderation" value={d.held_posts + d.open_reports} hint={`${d.held_posts} held · ${d.open_reports} reports`} />
          </div>
        )}
      </QueryState>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Searches, last 30 days</h2>
          <QueryState query={a}>
            {(d) => d.searches_per_day.length === 0 ? <p className="mt-2 text-sm">No searches yet.</p> : (
              <>
                <div className="mt-4 flex h-32 items-end gap-1" role="img" aria-label={`${d.searches} searches; ${d.confirmed_bookings} confirmed bookings; p95 search ${d.search_p95_ms} ms`}>
                  {d.searches_per_day.map((x) => {
                    const max = Math.max(...d.searches_per_day.map((y) => y.count));
                    return <div key={x.day} title={`${x.day}: ${x.count}`} className="flex-1 rounded-t bg-steel" style={{ height: `${(x.count / max) * 100}%` }} />;
                  })}
                </div>
                <p className="mt-3 text-sm">{d.searches} searches · {d.confirmed_bookings} sandbox bookings · p95 search {d.search_p95_ms} ms</p>
                <ol className="mt-2 text-sm text-ink/80">{d.top_routes.map((r) => <li key={r.route}>{r.route}: {r.count}</li>)}</ol>
              </>
            )}
          </QueryState>
        </Card>
        <Card>
          <h2 className="font-semibold">Providers and data freshness</h2>
          <QueryState query={providers}>
            {(rows) => (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-ink/70"><th scope="col">Capability</th><th scope="col">Mode</th><th scope="col">Status</th></tr></thead>
                <tbody>{rows.map((p) => <tr key={p.capability} className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium">{p.capability}</th><td>{p.mode}</td><td>{p.status}</td></tr>)}</tbody>
              </table>
            )}
          </QueryState>
        </Card>
      </div>
    </div>
  );
}

interface AdminUser { id: string; email: string; display_name: string; status: string; roles: string[]; created_at: string }

export function AdminUsersTab() {
  const qc = useQueryClient();
  const { can, user: me } = useAuth();
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/api/v1/admin/users") });
  const status = useMutation({ mutationFn: (v: { id: string; status: string }) => put(`/api/v1/admin/users/${v.id}/status`, { status: v.status }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  const roles = useMutation({ mutationFn: (v: { id: string; roles: string[] }) => put(`/api/v1/admin/users/${v.id}/roles`, { roles: v.roles }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  return (
    <QueryState query={q}>
      {(rows) => (
        <Card className="overflow-x-auto">
          {(status.isError || roles.isError) && <Alert tone="error" title={errorText(status.error ?? roles.error)} />}
          <table className="w-full text-left text-sm">
            <thead><tr className="text-ink/70"><th scope="col" className="py-2">Name</th><th scope="col">Email</th><th scope="col">Roles</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-line align-middle">
                  <td className="py-2">{u.display_name}</td><td>{u.email}</td>
                  <td>
                    {can("role.grant") && u.id !== me?.id ? (
                      <select aria-label={`Role for ${u.display_name}`} value={u.roles.includes("super_admin") ? "super_admin" : u.roles.includes("admin") ? "admin" : "passenger"}
                              onChange={(e) => roles.mutate({ id: u.id, roles: e.target.value === "super_admin" ? ["passenger", "admin", "super_admin"] : e.target.value === "admin" ? ["passenger", "admin"] : ["passenger"] })}
                              className="min-h-10 rounded-md border border-steel bg-surface px-2 py-1">
                        <option value="passenger">Passenger</option><option value="admin">Administrator</option><option value="super_admin">Super Administrator</option>
                      </select>
                    ) : u.roles.join(", ")}
                  </td>
                  <td>{u.status}</td>
                  <td>{can("user.manage") && u.id !== me?.id && (
                    <Button variant="ghost" onClick={() => status.mutate({ id: u.id, status: u.status === "active" ? "disabled" : "active" })}>
                      {u.status === "active" ? "Disable" : "Enable"}
                    </Button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </QueryState>
  );
}

interface AdminBooking { id: string; user: string; status: string; pnr: string | null; route: string; journey_date: string; passengers: number; total_paise: number }
interface Payments { payments: { id: string; reference: string; amount_paise: number; status: string; at: string }[]; refunds: { id: string; amount_paise: number; status: string; at: string }[] }

export function AdminBookingsTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const q = useQuery({ queryKey: ["admin-bookings", statusFilter], queryFn: () => api<AdminBooking[]>(`/api/v1/admin/bookings${statusFilter ? `?status=${statusFilter}` : ""}`) });
  const pays = useQuery({ queryKey: ["admin-payments"], queryFn: () => api<Payments>("/api/v1/admin/payments") });
  return (
    <div className="flex flex-col gap-6">
      <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-60">
        <option value="">All</option>{["SEARCHED", "CONFIRMED", "FAILED", "REFUND_PENDING", "REFUNDED"].map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <QueryState query={q}>
        {(rows) => rows.length === 0 ? <EmptyState title="No bookings" /> : (
          <Card className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr className="text-ink/70"><th scope="col" className="py-2">Route</th><th scope="col">Date</th><th scope="col">User</th><th scope="col">Pax</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map((b) => <tr key={b.id} className="border-t border-line"><td className="py-2">{b.route} {b.pnr}</td><td>{b.journey_date}</td><td>{b.user}</td><td>{b.passengers}</td><td>{rupees(b.total_paise)}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody>
          </table></Card>
        )}
      </QueryState>
      <QueryState query={pays}>
        {(p) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><h2 className="font-semibold">Sandbox payments</h2><ul className="mt-2 text-sm">{p.payments.map((x) => <li key={x.id}>{x.reference} · {rupees(x.amount_paise)} · {x.status}</li>)}</ul></Card>
            <Card><h2 className="font-semibold">Refunds</h2><ul className="mt-2 text-sm">{p.refunds.map((x) => <li key={x.id}>{dateTime(x.at)} · {rupees(x.amount_paise)} · {x.status}</li>)}</ul></Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

interface AdminNotifications { outbox: { id: string; channel: string; template: string; status: string; attempts: number; last_error: string | null }[];
  deliveries: { outbox_id: string; provider: string; status: string; error: string | null; at: string }[]; dead_jobs: { id: string; kind: string; error: string | null }[] }

export function AdminNotificationsTab() {
  const q = useQuery({ queryKey: ["admin-notifications"], queryFn: () => api<AdminNotifications>("/api/v1/admin/notifications") });
  return (
    <QueryState query={q}>
      {(d) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-x-auto"><h2 className="font-semibold">Outbox</h2>
            <table className="mt-2 w-full text-left text-sm"><thead><tr className="text-ink/70"><th scope="col">Channel</th><th scope="col">Template</th><th scope="col">Status</th><th scope="col">Tries</th></tr></thead>
              <tbody>{d.outbox.map((o) => <tr key={o.id} className="border-t border-line" title={o.last_error ?? ""}><td className="py-1">{o.channel}</td><td>{o.template}</td><td>{o.status}</td><td>{o.attempts}</td></tr>)}</tbody></table>
          </Card>
          <Card><h2 className="font-semibold">Recent deliveries</h2>
            <ul className="mt-2 text-sm">{d.deliveries.map((x, i) => <li key={i}>{dateTime(x.at)} · {x.provider} · {x.status}{x.error ? ` · ${x.error}` : ""}</li>)}</ul>
            {d.dead_jobs.length > 0 && <Alert tone="error" title={`${d.dead_jobs.length} dead-lettered job(s)`} />}
          </Card>
        </div>
      )}
    </QueryState>
  );
}

interface Moderation { held_posts: { id: string; body: string; reason: string | null; at: string }[]; reports: { id: string; reason: string; details: string | null; post_body: string | null; at: string }[] }

export function AdminModerationTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-moderation"], queryFn: () => api<Moderation>("/api/v1/admin/moderation") });
  const done = () => qc.invalidateQueries({ queryKey: ["admin-moderation"] });
  const postAct = useMutation({ mutationFn: (v: { id: string; action: string }) => post(`/api/v1/admin/moderation/posts/${v.id}`, { action: v.action }), onSuccess: done });
  const reportAct = useMutation({ mutationFn: (v: { id: string; action: string; remove_post: boolean }) => post(`/api/v1/admin/moderation/reports/${v.id}`, v), onSuccess: done });
  return (
    <QueryState query={q}>
      {(d) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><h2 className="font-semibold">Held posts</h2>
            {d.held_posts.length === 0 ? <p className="mt-2 text-sm">Queue is empty.</p> : d.held_posts.map((p) => (
              <div key={p.id} className="mt-3 rounded-md bg-ivory p-3 text-sm"><p>{p.body}</p><p className="text-xs text-warning">{p.reason}</p>
                <div className="mt-2 flex gap-2"><Button onClick={() => postAct.mutate({ id: p.id, action: "approve" })}>Approve</Button><Button variant="ghost" onClick={() => postAct.mutate({ id: p.id, action: "remove" })}>Remove</Button></div></div>
            ))}
          </Card>
          <Card><h2 className="font-semibold">Reports</h2>
            {d.reports.length === 0 ? <p className="mt-2 text-sm">No open reports.</p> : d.reports.map((r) => (
              <div key={r.id} className="mt-3 rounded-md bg-ivory p-3 text-sm"><p className="font-semibold">{r.reason}</p>{r.post_body && <p>“{r.post_body}”</p>}
                <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => reportAct.mutate({ id: r.id, action: "resolve", remove_post: true })}>Remove post</Button>
                  <Button variant="ghost" onClick={() => reportAct.mutate({ id: r.id, action: "dismiss", remove_post: false })}>Dismiss</Button></div></div>
            ))}
          </Card>
          {(postAct.isError || reportAct.isError) && <Alert tone="error" title={errorText(postAct.error ?? reportAct.error)} />}
        </div>
      )}
    </QueryState>
  );
}

interface AuditEntry { id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; created_at: string }

export function AdminAuditTab() {
  const q = useQuery({ queryKey: ["admin-audit"], queryFn: () => api<AuditEntry[]>("/api/v1/admin/audit-logs") });
  return (
    <QueryState query={q}>
      {(rows) => rows.length === 0 ? <EmptyState title="No audit entries yet" /> : (
        <Card className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="text-ink/70"><th scope="col" className="py-2">When</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Change</th></tr></thead>
          <tbody>{rows.map((e) => <tr key={e.id} className="border-t border-line align-top"><td className="py-2 whitespace-nowrap">{dateTime(e.created_at)}</td><td>{e.action}</td><td>{e.entity_type} {e.entity_id?.slice(0, 8)}</td>
            <td><code className="text-xs">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</code></td></tr>)}</tbody>
        </table></Card>
      )}
    </QueryState>
  );
}

export function AdminConfigTab() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<Record<string, unknown>>("/api/v1/admin/settings") });
  const charges = useQuery({ queryKey: ["admin-charges"], queryFn: () => api<{ id: string; kind: string; value: number; effective_from: string; note: string | null }[]>("/api/v1/admin/service-charges") });
  const setSetting = useMutation({ mutationFn: (v: { key: string; value: unknown }) => put(`/api/v1/admin/settings/${v.key}`, { value: v.value }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-settings"] }) });
  const resync = useMutation({ mutationFn: () => post("/api/v1/admin/providers/catalog/resync") });
  const [charge, setCharge] = useState({ kind: "flat", value: 0, note: "" });
  const addCharge = useMutation({ mutationFn: () => post("/api/v1/admin/service-charges", charge), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-charges"] }) });
  const superAdmin = can("system_settings.manage");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="font-semibold">Settings</h2>
        {!superAdmin && <p className="mt-1 text-sm text-ink/70">Read-only: changes need a Super Administrator.</p>}
        <QueryState query={settings}>
          {(s) => (
            <div className="divide-y divide-line">
              <Toggle label="Journey communities enabled" checked={Boolean(s.community_enabled)} disabled={!superAdmin || setSetting.isPending}
                      onChange={(v) => setSetting.mutate({ key: "community_enabled", value: v })} />
              <p className="py-3 text-sm">WhatsApp mode: <strong>{String(s.whatsapp_mode)}</strong>. Live messaging requires the owner's separate approval.</p>
              <p className="py-3 text-sm">Default reminders (minutes before departure): {JSON.stringify(s.default_reminder_offsets)}</p>
            </div>
          )}
        </QueryState>
        {can("provider.manage") && (
          <div className="mt-3">
            <Button variant="secondary" loading={resync.isPending} onClick={() => resync.mutate()}>Re-load synthetic timetable</Button>
            {resync.isSuccess && <p role="status" className="mt-2 text-sm">Timetable reloaded.</p>}
          </div>
        )}
        {(setSetting.isError || resync.isError) && <Alert tone="error" title={errorText(setSetting.error ?? resync.error)} />}
      </Card>
      <Card>
        <h2 className="font-semibold">Service charge</h2>
        <p className="mt-1 text-sm">v1 charges passengers nothing. Values saved here are recorded for a future release and are not applied.</p>
        <QueryState query={charges}>
          {(rows) => <ul className="mt-2 text-sm">{rows.map((r) => <li key={r.id}>{dateTime(r.effective_from)} · {r.kind} {r.value} · {r.note}</li>)}</ul>}
        </QueryState>
        {can("service_charge.manage") && (
          <form className="mt-3 grid gap-2 sm:grid-cols-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); addCharge.mutate(); }}>
            <Select label="Kind" value={charge.kind} onChange={(e) => setCharge({ ...charge, kind: e.target.value })}><option value="flat">Flat (paise)</option><option value="percent">Percent</option></Select>
            <TextField label="Value" type="number" min={0} value={charge.value} onChange={(e) => setCharge({ ...charge, value: Number(e.target.value) })} />
            <TextField label="Reason" value={charge.note} onChange={(e) => setCharge({ ...charge, note: e.target.value })} />
            <Button type="submit" loading={addCharge.isPending} disabled={charge.note.trim().length < 3} className="sm:col-span-3">Record for future release</Button>
          </form>
        )}
        {addCharge.isError && <Alert tone="error" title={errorText(addCharge.error)} />}
      </Card>
    </div>
  );
}
