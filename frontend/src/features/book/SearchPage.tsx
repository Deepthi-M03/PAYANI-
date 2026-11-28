import { useMutation } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, GitCompareArrows, Search, TrainFront } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { EmptyState, PageHeader, SandboxNote, errorText } from "../../design-system/ui";
import { post } from "../../lib/api";
import { duration, todayIso } from "../../lib/format";
import type { Freshness, Journey } from "../../lib/types";
import { RailMap } from "../map/RailMap";
import { useStationMap } from "../map/stations";
import { DatasetNotice, useTimetableStatus } from "./DatasetNotice";
import { JourneyCard } from "./JourneyCard";
import { StationField } from "./StationField";

interface SearchResponse { results: Journey[]; freshness: Freshness; search?: { max_transfers: number; note: string | null } }

const PREFS = [["balanced", "Balanced"], ["fastest", "Fastest"], ["fewest_changes", "Fewest changes"], ["earliest_arrival", "Earliest arrival"]] as const;

export function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useTimetableStatus();
  const changes = status.data?.max_transfers === 1 ? "one change" : "up to two changes";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const stations = useStationMap([from, to]);
  const [date, setDate] = useState(params.get("date") ?? todayIso(14));
  const [preference, setPreference] = useState("balanced");
  const [compare, setCompare] = useState<string[]>([]);
  const [active, setActive] = useState<string | undefined>();
  const [formKey, setFormKey] = useState(0);
  const groupId = params.get("group");
  const nameOf = (c: string) => stations.data?.stations.find((s) => s.code === c)?.name
    ?? search.data?.results.flatMap((j) => j.legs).flatMap((l) => [[l.from, l.from_name], [l.to, l.to_name]]).find(([k]) => k === c)?.[1]
    ?? c;
  const fieldText = (c: string) => (!c ? "" : nameOf(c) === c ? c : `${nameOf(c)} (${c})`);
  const search = useMutation({
    mutationFn: (pref: string) => post<SearchResponse>("/api/v1/journeys/search", { from_code: from, to_code: to, date, preference: pref }),
    onSuccess: (d) => { setActive(d.results[0]?.id); setCompare([]); },
  });
  const ready = Boolean(from && to && from !== to && date);
  // Arriving with a full query (from the landing page or a group plan): search straight away.
  useEffect(() => { if (params.get("from") && params.get("to")) search.mutate(preference); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const results = search.data?.results ?? [];
  const chosen = results.filter((j) => compare.includes(j.id));
  const pick = (code: string, role: "from" | "to") => { if (role === "from") setFrom(code); else setTo(code); setFormKey((k) => k + 1); };
  const swap = () => { setFrom(to); setTo(from); setFormKey((k) => k + 1); };
  const select = (j: Journey) => navigate(`/app/book?journey=${encodeURIComponent(j.id)}&date=${date}${groupId ? `&group=${groupId}&members=${params.get("members") ?? ""}` : ""}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Book · Search" title="Find a journey" intro={`Direct trains and connections with ${changes}, ranked and explained. Pick stations here or on the map.`} />
      {groupId && <SandboxNote>Planning one booking from your group. The travellers you chose will be filled in on the next step.</SandboxNote>}

      <form key={formKey} aria-label="Journey search"
            className="grid gap-3 rounded-[10px] border border-line bg-surface p-4 shadow-[var(--shadow-panel)] sm:p-5 lg:grid-cols-[1fr_auto_1fr_10.5rem_auto] lg:items-end"
            onSubmit={(e) => { e.preventDefault(); if (ready) search.mutate(preference); }}>
        <StationField label="From" value={from} initialText={fieldText(from)} onChange={setFrom} />
        <button type="button" onClick={swap} aria-label="Swap From and To" title="Swap"
                className="hidden size-12 place-items-center self-end rounded-md border border-steel/60 text-ink transition-transform hover:rotate-180 hover:border-primary lg:grid">
          <ArrowLeftRight aria-hidden className="size-4" />
        </button>
        <StationField label="To" value={to} initialText={fieldText(to)} onChange={setTo} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="search-date" className="text-sm font-medium">Date</label>
          <input id="search-date" type="date" value={date} min={todayIso()} max={todayIso(120)} onChange={(e) => setDate(e.target.value)}
                 className="min-h-12 rounded-md border border-steel/70 bg-surface px-3 text-base focus:border-primary" />
        </div>
        <Button type="submit" size="lg" loading={search.isPending} disabled={!ready} icon={<Search aria-hidden className="size-4" />}>Search</Button>
      </form>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <section aria-live="polite" aria-label="Results" className="flex min-w-0 flex-col gap-4">
          {search.isError && <Alert tone="error" title={errorText(search.error)} />}
          {search.isPending && !search.data && Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-40" />)}
          {!search.data && !search.isPending && !search.isError && (
            <>
              <EmptyState icon={TrainFront} title="Where to?" body={status.data?.label === "scheduled"
                ? `Choose two stations and a date. Results come from an imported timetable of ${status.data.trains.toLocaleString("en-IN")} trains.`
                : "Choose two stations and a date. PAYANI's preview network covers 35 major stations with a simulated timetable."} />
              <DatasetNotice f={status.data} compact />
            </>
          )}
          {search.data && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{results.length} option{results.length === 1 ? "" : "s"} <span className="font-normal text-muted">· {nameOf(from)} → {nameOf(to)}</span></h2>
                <div role="group" aria-label="Sort by" className="flex overflow-hidden rounded-md border border-line bg-surface p-0.5">
                  {PREFS.map(([v, l]) => (
                    <button key={v} type="button" aria-pressed={preference === v} onClick={() => { setPreference(v); search.mutate(v); }}
                            className={`rounded px-2.5 py-1.5 text-xs font-semibold transition-colors ${preference === v ? "bg-primary text-white" : "text-muted hover:text-ink"}`}>{l}</button>
                  ))}
                </div>
              </div>
              <DatasetNotice f={search.data.freshness} />
              {search.data.search?.note && <p className="text-xs text-muted">{search.data.search.note}</p>}
              {results.length === 0 ? (
                <EmptyState title={`No route with ${search.data.search?.max_transfers === 1 ? "one change or fewer" : "up to two changes"}`} body="Try another date or a nearby station." />
              ) : results.map((j, i) => (
                <div key={j.id} className="motion-safe:animate-[rise_420ms_var(--ease-ui)_both]" style={{ animationDelay: `${i * 60}ms` }}>
                  <JourneyCard j={j} selected={j.id === active} onSelect={() => setActive(j.id)}
                    actions={<>
                      <Button variant="ghost" size="sm" aria-pressed={compare.includes(j.id)} icon={<GitCompareArrows aria-hidden className="size-4" />}
                              onClick={() => setCompare((c) => (c.includes(j.id) ? c.filter((x) => x !== j.id) : [...c.slice(-2), j.id]))}>
                        {compare.includes(j.id) ? "Comparing" : "Compare"}
                      </Button>
                      <Button size="sm" onClick={() => select(j)} icon={<ArrowRight aria-hidden className="size-4" />}>Select</Button>
                    </>} />
                </div>
              ))}
            </>
          )}
        </section>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <RailMap from={from} to={to} onPick={pick} label="Map of the journey"
                   routes={results.map((j) => ({ id: j.id, legs: j.legs.map((l) => ({ from: l.from, to: l.to })) }))}
                   activeRouteId={active} onSelectRoute={setActive} className="h-[360px] sm:h-[460px] xl:h-[calc(100dvh-8rem)] xl:max-h-[760px]" />
        </aside>
      </div>

      {chosen.length >= 2 && (
        <section aria-labelledby="compare-title" className="sticky bottom-4 z-20 motion-safe:animate-[rise_300ms_var(--ease-ui)]">
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-raised)]">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id="compare-title" className="font-semibold">Comparing {chosen.length} options</h2>
              <Button variant="ghost" size="sm" onClick={() => setCompare([])}>Clear</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th scope="col">Trains</th><th scope="col" className="num">Duration</th><th scope="col" className="num">Changes</th><th scope="col" className="num">Waiting</th><th scope="col" className="num">Distance</th></tr></thead>
                <tbody>
                  {chosen.map((j) => {
                    const best = (k: "duration_min" | "transfers" | "total_wait_min") => Math.min(...chosen.map((c) => c[k])) === j[k] ? "font-semibold text-success" : "";
                    return (
                      <tr key={j.id}>
                        <th scope="row" className="font-mono text-sm">{j.legs.map((l) => l.train_number).join(" + ")}</th>
                        <td className={`num ${best("duration_min")}`}>{duration(j.duration_min)}</td>
                        <td className={`num ${best("transfers")}`}>{j.transfers}</td>
                        <td className={`num ${best("total_wait_min")}`}>{duration(j.total_wait_min)}</td>
                        <td className="num">{j.distance_km === null ? "Not published" : `${j.distance_km} km`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
