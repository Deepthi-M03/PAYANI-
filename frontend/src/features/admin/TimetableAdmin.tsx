import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Database, ExternalLink, FileUp, History, ShieldCheck, TrainFront } from "lucide-react";
import { useState } from "react";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card, Panel } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { TextField } from "../../design-system/TextField";
import { EmptyState, KeyValues, QueryState, Select, Skeleton, Stat, errorText } from "../../design-system/ui";
import { api, post } from "../../lib/api";
import { dateTime } from "../../lib/format";
import type { Freshness } from "../../lib/types";
import { useAuth } from "../auth/AuthContext";
import { DatasetNotice, longDate } from "../book/DatasetNotice";

export interface TimetableSource {
  key: string; name: string; url: string; format: string; official: boolean; licence: string | null;
  licence_url: string | null; published_on: string | null; published_note: string; files: string[]; needs_metadata: boolean;
}

interface IssueGroup { severity: "error" | "warning"; code: string; count: number; samples: { train: string | null; message: string }[] }

export interface TimetableImport {
  id: string; status: string; source_key: string; source_name: string; source_url: string; licence: string;
  licence_url: string | null; official: boolean; published_on: string; published_note: string | null;
  retrieved_on: string | null; file_name: string; file_sha256: string; counts: Record<string, number>; error: string | null;
  errors: number; warnings: number; started_at: string | null; finished_at: string | null; activated_at: string | null;
  freshness: string; outdated: boolean; warning: string | null;
  report?: { by_code?: IssueGroup[]; note?: string; rows_read?: number };
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-success-tint text-success", unchanged: "bg-info-tint text-info", superseded: "bg-mist text-muted",
  withdrawn: "bg-mist text-muted", rejected: "bg-error-tint text-error", failed: "bg-error-tint text-error",
  validating: "bg-warning-tint text-warning",
};

function ImportStatus({ status }: { status: string }) {
  return <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_TONE[status] ?? "bg-mist text-muted"}`}>{status}</span>;
}

/** Upload the file as the raw request body, with the metadata in the query string. */
async function uploadDataset(file: File, params: Record<string, string>): Promise<TimetableImport> {
  const qs = new URLSearchParams({ ...params, file_name: file.name }).toString();
  return api<TimetableImport>(`/api/v1/admin/timetable/imports?${qs}`, {
    method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" },
  });
}

export function AdminTimetableTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canImport = can("provider.manage");
  const imports = useQuery({ queryKey: ["admin-timetable"], queryFn: () => api<{ current: Freshness; imports: TimetableImport[] }>("/api/v1/admin/timetable/imports") });
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-timetable"] });
    void qc.invalidateQueries({ queryKey: ["timetable-status"] });
  };
  const withdraw = useMutation({ mutationFn: () => post<Freshness>("/api/v1/admin/timetable/withdraw"), onSuccess: refresh });

  return (
    <div className="flex flex-col gap-6">
      <QueryState query={imports} skeleton={<Skeleton rows={4} />}>
        {(d) => (
          <>
            <Panel title="Timetable in use" icon={<Database aria-hidden className="size-4" />}
                   description="What journey search, the map and train pages are built from right now."
                   actions={canImport && d.current.label === "scheduled" ? (
                     <Button size="sm" variant="secondary" loading={withdraw.isPending}
                             onClick={() => { if (window.confirm("Stop using the imported timetable? Search goes back to the simulated catalogue. Import history is kept.")) withdraw.mutate(); }}>
                       Withdraw import
                     </Button>
                   ) : undefined}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Trains" value={d.current.trains.toLocaleString("en-IN")} icon={TrainFront} />
                <Stat label="Data label" value={<ConfidenceBadge level={d.current.label === "scheduled" ? "scheduled" : "simulated"} />} />
                <Stat label="Published" value={longDate(d.current.published_on)} tone={d.current.outdated ? "warning" : "default"}
                      hint={d.current.age_days !== undefined ? `${d.current.age_days.toLocaleString("en-IN")} days old` : undefined} />
              </div>
              <div className="mt-4"><DatasetNotice f={d.current} /></div>
              {withdraw.isError && <div className="mt-3"><Alert tone="error" title="Could not withdraw">{errorText(withdraw.error)}</Alert></div>}
            </Panel>

            {canImport ? <ImportForm onDone={(r) => { setSelected(r.id); refresh(); }} />
              : <Alert tone="info" title="Read-only">Importing or withdrawing a timetable needs the super admin role (permission provider.manage).</Alert>}

            <Panel title="Import history" icon={<History aria-hidden className="size-4" />}
                   description="Every attempt is kept, including rejected and failed ones, with its source and licence." bodyClassName="p-0">
              {d.imports.length === 0 ? (
                <div className="p-6"><EmptyState icon={History} title="No imports yet" body="Search uses the simulated catalogue until a verified dataset is imported." /></div>
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th scope="col">Started</th><th scope="col">Source</th><th scope="col">Status</th>
                      <th scope="col" className="hidden md:table-cell">Published</th><th scope="col" className="text-right">Trains</th>
                      <th scope="col" className="hidden sm:table-cell text-right">Issues</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
                    <tbody>
                      {d.imports.map((r) => (
                        <tr key={r.id} className={selected === r.id ? "bg-mist/60" : ""}>
                          <td className="whitespace-nowrap">{r.started_at ? dateTime(r.started_at) : "â€”"}</td>
                          <td><span className="font-medium">{r.source_key}</span><span className="block max-w-56 truncate text-xs text-muted">{r.file_name}</span></td>
                          <td><ImportStatus status={r.status} /></td>
                          <td className="hidden md:table-cell whitespace-nowrap">{longDate(r.published_on)}{r.outdated && <AlertTriangle aria-label="Outdated" className="ml-1 inline size-3.5 text-warning" />}</td>
                          <td className="text-right tabular-nums">{(r.counts.trains ?? 0).toLocaleString("en-IN")}</td>
                          <td className="hidden sm:table-cell text-right tabular-nums text-xs">{r.errors} errors Â· {r.warnings} warnings</td>
                          <td><Button size="sm" variant="ghost" onClick={() => setSelected(selected === r.id ? null : r.id)}>{selected === r.id ? "Hide" : "Report"}</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            {selected && <ImportReport id={selected} />}
          </>
        )}
      </QueryState>
    </div>
  );
}

function ImportForm({ onDone }: { onDone: (r: TimetableImport) => void }) {
  const sources = useQuery({ queryKey: ["admin-timetable-sources"], queryFn: () => api<TimetableSource[]>("/api/v1/admin/timetable/sources") });
  const [sourceKey, setSourceKey] = useState("datameet-railways");
  const [file, setFile] = useState<File | null>(null);
  const [publishedOn, setPublishedOn] = useState("");
  const [licence, setLicence] = useState("");
  const [retrievedOn, setRetrievedOn] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const run = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a file first.");
      const params: Record<string, string> = { source: sourceKey, licence_confirmed: String(confirmed) };
      if (publishedOn) params.published_on = publishedOn;
      if (licence.trim()) params.licence = licence.trim();
      if (retrievedOn) params.retrieved_on = retrievedOn;
      return uploadDataset(file, params);
    },
    onSuccess: onDone,
  });
  const src = sources.data?.find((s) => s.key === sourceKey);
  const needs = src?.needs_metadata ?? false;
  const ready = !!file && confirmed && (!needs || (publishedOn !== "" && (licence.trim() !== "" || !!src?.licence)));

  return (
    <Panel title="Import a verified dataset" icon={<FileUp aria-hidden className="size-4" />}
           description="The file is validated in full before anything changes. A rejected or failed import leaves the current timetable in use.">
      {sources.isLoading ? <Skeleton rows={2} /> : sources.isError ? <Alert tone="error" title="Could not load sources">{errorText(sources.error)}</Alert> : (
        <form className="grid grid-cols-1 gap-5 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <div className="flex min-w-0 flex-col gap-4">
            <Select label="Source" value={sourceKey} onChange={(e) => { setSourceKey(e.target.value); run.reset(); }}>
              {sources.data?.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </Select>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Dataset file
              <input type="file" accept={src?.format === "ogd-csv" ? ".csv" : ".zip"} required
                     onChange={(e) => { setFile(e.target.files?.[0] ?? null); run.reset(); }}
                     className="w-full min-w-0 rounded-md border border-line bg-white px-3 py-2 text-sm font-normal file:mr-3 file:rounded-sm file:border-0 file:bg-mist file:px-3 file:py-1.5 file:text-sm file:font-medium" />
              <span className="text-xs font-normal text-muted">
                {src?.format === "ogd-csv" ? "One .csv file downloaded from data.gov.in." : "A .zip holding stations.json, trains.json and schedules.json."} Up to 200 MB; use the command line for larger files.
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Publication date" type="date" value={publishedOn} onChange={(e) => setPublishedOn(e.target.value)}
                         required={needs} hint={needs ? "Required: the date shown on the source page." : src?.published_on ? `Leave empty to use ${longDate(src.published_on)}.` : undefined} />
              <TextField label="Downloaded on" type="date" value={retrievedOn} onChange={(e) => setRetrievedOn(e.target.value)} hint="Optional, for provenance." />
            </div>
            <TextField label="Licence" value={licence} onChange={(e) => setLicence(e.target.value)} required={needs && !src?.licence}
                       placeholder={src?.licence ?? "As shown on the download page"} hint={src?.licence ? "Leave empty to use the licence shown." : "Required: copy it from the source page."} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {src && (
              <Card className="break-words bg-surface p-4 text-sm">
                <KeyValues items={[
                  ["Publisher", <span key="p">{src.official ? "Official (Government of India)" : "Community dataset, not official"}</span>],
                  ["Source", <a key="u" href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-signal hover:underline">{src.url.replace(/^https?:\/\//, "")}<ExternalLink aria-hidden className="size-3" /></a>],
                  ["Licence", src.licence ?? "Check on the source page"],
                  ["Published", src.published_on ? longDate(src.published_on) : "Check on the source page"],
                ]} />
                <p className="mt-3 text-xs text-muted">{src.published_note}</p>
              </Card>
            )}
            <div className="flex items-start gap-3 rounded-md border border-line p-3 text-sm">
              <input aria-label="Confirm timetable data licence" id="timetable-licence-confirmation" type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span><span className="inline-flex items-center gap-1 font-medium"><ShieldCheck aria-hidden className="size-4 text-success" />I checked the licence and publication date</span>
                <span className="block text-xs text-muted">PAYANI only imports data you are allowed to reuse. The data will be labelled Scheduled, with its source and age, and never as live.</span></span>
            </div>
            <Button type="submit" disabled={!ready} loading={run.isPending} icon={<FileUp aria-hidden className="size-4" />}>Validate and import</Button>
            {run.isError && <Alert tone="error" title="Import not accepted">{errorText(run.error)}</Alert>}
            {run.data && <ResultAlert r={run.data} />}
          </div>
        </form>
      )}
    </Panel>
  );
}

function ResultAlert({ r }: { r: TimetableImport }) {
  if (r.status === "active") return <Alert tone="success" title="Imported and in use">{(r.counts.trains ?? 0).toLocaleString("en-IN")} trains, {(r.counts.stops ?? 0).toLocaleString("en-IN")} stops. {r.warnings} warnings, {r.counts.trains_rejected ?? 0} trains rejected. See the report below.</Alert>;
  if (r.status === "unchanged") return <Alert tone="info" title="Already imported">This exact file is the active timetable. Nothing was changed.</Alert>;
  return <Alert tone="error" title={r.status === "failed" ? "Import failed" : "Dataset rejected"}>{r.error} The previous timetable is still in use.</Alert>;
}

function ImportReport({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["admin-timetable-import", id], queryFn: () => api<TimetableImport>(`/api/v1/admin/timetable/imports/${id}`) });
  return (
    <Panel title="Import report" description="Validation results and provenance for the selected import.">
      <QueryState query={q} skeleton={<Skeleton rows={3} />}>
        {(r) => (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <KeyValues items={[
                ["Status", <ImportStatus key="s" status={r.status} />], ["Source", r.source_name], ["Licence", r.licence],
                ["Published", `${longDate(r.published_on)}${r.outdated ? " (outdated)" : ""}`], ["Downloaded", r.retrieved_on ? longDate(r.retrieved_on) : "Not recorded"],
                ["Imported", r.activated_at ? dateTime(r.activated_at) : r.finished_at ? dateTime(r.finished_at) : "â€”"],
                ["File", r.file_name], ["Fingerprint", <code key="h" className="break-all font-mono text-xs">{r.file_sha256}</code>],
              ]} />
              <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3">
                {Object.entries(r.counts).map(([k, v]) => (
                  <div key={k} className="rounded-md bg-surface p-3"><p className="text-xs capitalize text-muted">{k.replace(/_/g, " ")}</p><p className="font-mono text-lg tabular-nums">{v.toLocaleString("en-IN")}</p></div>
                ))}
              </div>
            </div>
            {r.error && <Alert tone="error" title="Reason">{r.error}</Alert>}
            {r.report?.note && <Alert tone="info" title="Note">{r.report.note}</Alert>}
            {r.report?.by_code && r.report.by_code.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="data-table">
                  <thead><tr><th scope="col">Check</th><th scope="col">Severity</th><th scope="col" className="text-right">Count</th><th scope="col" className="hidden sm:table-cell">Examples</th></tr></thead>
                  <tbody>
                    {r.report.by_code.map((g) => (
                      <tr key={`${g.severity}-${g.code}`}>
                        <td className="font-mono text-xs">{g.code}</td>
                        <td><span className={g.severity === "error" ? "text-error" : "text-warning"}>{g.severity}</span></td>
                        <td className="text-right tabular-nums">{g.count.toLocaleString("en-IN")}</td>
                        <td className="hidden sm:table-cell text-xs text-muted">{g.samples.slice(0, 3).map((s) => `${s.train ? `${s.train}: ` : ""}${s.message}`).join(" Â· ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !r.error && <p className="text-sm text-muted">No validation issues were recorded.</p>}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
