import { AlertTriangle, ArrowRight, ExternalLink, MapPinned, Repeat2 } from "lucide-react";
import type { ReactNode } from "react";

import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { dayShift, day, duration, time } from "../../lib/format";
import { directionsUrl, externalLink } from "../../lib/googleMaps";
import type { Journey } from "../../lib/types";

/** Proportional bar of a journey: train legs as solid segments, waits as gaps with the station code. */
export function LegBar({ j }: { j: Journey }) {
  const start = new Date(j.departure).getTime();
  const total = new Date(j.arrival).getTime() - start || 1;
  return (
    <div className="relative h-2 w-full rounded-full bg-mist" aria-hidden>
      {j.legs.map((l, i) => {
        const a = (new Date(l.departure).getTime() - start) / total, b = (new Date(l.arrival).getTime() - start) / total;
        return <span key={i} className="absolute inset-y-0 rounded-full bg-primary" style={{ left: `${a * 100}%`, width: `${Math.max(2, (b - a) * 100)}%` }} />;
      })}
      {j.legs.slice(0, -1).map((l, i) => {
        const x = (new Date(l.arrival).getTime() - start) / total;
        return <span key={`t${i}`} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-signal bg-white" style={{ left: `${x * 100}%` }} />;
      })}
    </div>
  );
}

const warnCodes = new Set(["tight_connection", "long_wait"]);

/** Result card. Times read like a departure board; names are always spelled out next to codes. */
export function JourneyCard({ j, actions, compact = false, selected = false, onSelect }: {
  j: Journey; actions?: ReactNode; compact?: boolean; selected?: boolean; onSelect?: () => void;
}) {
  const shift = dayShift(j.departure, j.arrival);
  const first = j.legs[0], last = j.legs[j.legs.length - 1];
  return (
    <article
      className={`group relative rounded-[var(--radius-card)] border bg-surface shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] ${
        selected ? "border-primary ring-2 ring-primary/15" : "border-line hover:border-steel/60"}`}
    >
      {selected && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r bg-saffron" />}
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-1 sm:gap-x-4">
            <p className="font-mono text-[1.6rem] font-medium leading-none tabular sm:text-[1.9rem]">{time(j.departure)}</p>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="h-px flex-1 bg-line" /><span className="whitespace-nowrap">{duration(j.duration_min)}</span><span className="h-px flex-1 bg-line" />
              <ArrowRight aria-hidden className="size-3.5 text-steel" />
            </div>
            <p className="font-mono text-[1.6rem] font-medium leading-none tabular sm:text-[1.9rem]">
              {time(j.arrival)}{shift > 0 && <sup className="ml-0.5 font-sans text-xs font-semibold text-warning">+{shift}</sup>}
            </p>
            <p className="text-sm leading-snug text-muted"><span className="font-mono text-xs font-medium text-ink">{first?.from}</span> {first?.from_name}</p>
            <p className="text-center text-xs text-muted">{day(j.departure)}</p>
            <p className="text-right text-sm leading-snug text-muted"><span className="font-mono text-xs font-medium text-ink">{last?.to}</span> {last?.to_name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium"><Repeat2 aria-hidden className="size-4 text-steel" />
              {j.transfers === 0 ? "Direct" : `${j.transfers} change${j.transfers > 1 ? "s" : ""}`}</span>
            <ConfidenceBadge level={j.data.confidence} asOf={j.data.as_of} />
          </div>
        </div>

        <LegBar j={j} />

        {j.warnings && j.warnings.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="About this data">
            {j.warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" /><span>{w.text}</span>
              </li>
            ))}
          </ul>
        )}

        {!compact && (
          <ol className="grid gap-2 text-sm">
            {j.legs.map((l, i) => (
              <li key={`${l.train_number}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="rounded bg-navy px-1.5 py-0.5 font-mono text-xs font-medium text-white">{l.train_number}</span>
                <span className="font-medium">{l.train_name}</span>
                <span className="text-muted">{l.from} {time(l.departure)} → {l.to} {time(l.arrival)} · {duration(l.duration_min)}{l.distance_km !== null && ` · ${l.distance_km} km`}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ul className="flex flex-wrap gap-1.5" aria-label="Why this option">
            {j.reasons.map((r) => (
              <li key={r.code + (r.station ?? "")} className={`rounded px-2 py-1 text-xs font-medium ${warnCodes.has(r.code) ? "bg-warning-tint text-warning" : "bg-ivory text-muted"}`}>
                {r.text}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {onSelect && (
              <button type="button" onClick={onSelect} aria-pressed={selected}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-signal hover:bg-info-tint">
                <MapPinned aria-hidden className="size-4" />{selected ? "Shown on map" : "Show on map"}
              </button>
            )}
            {!compact && first && last && (
              <a href={directionsUrl({ name: first.from_name }, { name: last.to_name })} {...externalLink}
                 className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-muted hover:bg-ivory hover:text-ink"
                 aria-label={`Open ${first.from_name} to ${last.to_name} in Google Maps (opens in a new tab)`}>
                <ExternalLink aria-hidden className="size-4" />Google Maps
              </a>
            )}
            {actions}
          </div>
        </div>
      </div>
    </article>
  );
}
