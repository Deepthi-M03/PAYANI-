import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, ExternalLink } from "lucide-react";

import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { api } from "../../lib/api";
import type { Freshness } from "../../lib/types";

/** What the timetable behind search results is. Cached: it only changes after an admin import. */
export function useTimetableStatus() {
  return useQuery({ queryKey: ["timetable-status"], queryFn: () => api<Freshness>("/api/v1/timetable/status"), staleTime: 5 * 60_000 });
}

export function longDate(iso?: string | null): string {
  if (!iso) return "unknown date";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Source, label and age of the timetable, shown above search results. Historical datasets get a
 * prominent warning: they are never presented as the current schedule.
 */
export function DatasetNotice({ f, compact = false }: { f: Freshness | undefined; compact?: boolean }) {
  if (!f) return null;
  const scheduled = f.label === "scheduled";
  return (
    <div className="flex flex-col gap-2" data-testid="dataset-notice">
      {scheduled && f.outdated && f.warning && (
        <div role="status" className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning-tint px-4 py-3 text-sm text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p><strong className="font-semibold">Outdated timetable.</strong> <span className="text-ink/90">{f.warning}</span></p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
        <ConfidenceBadge level={scheduled ? "scheduled" : "simulated"} />
        {scheduled ? (
          <>
            <span className="inline-flex items-center gap-1"><Database aria-hidden className="size-3.5" />
              {f.source_url ? (
                <a href={f.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-signal underline-offset-2 hover:underline">
                  {f.source_name}<ExternalLink aria-hidden className="size-3" />
                </a>
              ) : f.source_name}
            </span>
            <span>Published {longDate(f.published_on)}</span>
            <span>Imported {longDate(f.imported_at)}</span>
            {!compact && f.licence && <span>Licence: {f.licence}</span>}
          </>
        ) : (
          <span>{f.warning ?? "Simulated timetable: trains and times are invented for this preview."}</span>
        )}
      </div>
      {!compact && (
        <p className="text-xs text-muted">
          {scheduled && f.running_days_known === false && "Days of operation are not in this dataset, so a train may not run on your date. "}
          Seat availability and live running status are not shown: no authorised provider is connected. Book real tickets on IRCTC.
        </p>
      )}
    </div>
  );
}
