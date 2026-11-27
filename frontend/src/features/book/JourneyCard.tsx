import { ArrowRight, Clock3, Repeat2 } from "lucide-react";
import type { ReactNode } from "react";

import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { dayShift, day, duration, time } from "../../lib/format";
import type { Journey } from "../../lib/types";

export function JourneyCard({ j, actions, compact = false }: { j: Journey; actions?: ReactNode; compact?: boolean }) {
  const shift = dayShift(j.departure, j.arrival);
  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-display text-3xl">{time(j.departure)}</p>
            <p className="text-xs text-ink/70">{day(j.departure)} · {j.legs[0]?.from}</p>
          </div>
          <ArrowRight aria-hidden className="size-5 text-steel" />
          <div>
            <p className="font-display text-3xl">
              {time(j.arrival)}
              {shift > 0 && <sup className="ml-1 text-sm font-sans text-warning">+{shift}</sup>}
            </p>
            <p className="text-xs text-ink/70">{day(j.arrival)} · {j.legs[j.legs.length - 1]?.to}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden className="size-4" />{duration(j.duration_min)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Repeat2 aria-hidden className="size-4" />
            {j.transfers === 0 ? "Direct" : `${j.transfers} change${j.transfers > 1 ? "s" : ""}`}
          </span>
          <ConfidenceBadge level={j.data.confidence} asOf={j.data.as_of} />
        </div>
      </div>

      {!compact && (
        <ol className="mt-5 space-y-2 border-l-2 border-steel/50 pl-4 text-sm">
          {j.legs.map((l, i) => (
            <li key={`${l.train_number}-${i}`}>
              <span className="font-semibold">{l.train_number}</span> {l.train_name}
              <span className="block text-ink/75">
                {l.from_name} {time(l.departure)} → {l.to_name} {time(l.arrival)} · {duration(l.duration_min)} · {l.distance_km} km
              </span>
            </li>
          ))}
        </ol>
      )}

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Why this option">
        {j.reasons.map((r) => (
          <li key={r.code + (r.station ?? "")} className={`rounded-full px-3 py-1 text-xs font-medium ${
            r.code === "tight_connection" || r.code === "long_wait" ? "bg-warning-tint text-warning" : "bg-mist text-ink"
          }`}>
            {r.text}
          </li>
        ))}
      </ul>
      {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
