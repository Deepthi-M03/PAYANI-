import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { TextField } from "../../design-system/TextField";
import { EmptyState, PageHeader, SandboxNote, Select, errorText } from "../../design-system/ui";
import { post } from "../../lib/api";
import { duration, todayIso } from "../../lib/format";
import type { Freshness, Journey } from "../../lib/types";
import { JourneyCard } from "./JourneyCard";
import { StationField } from "./StationField";

interface SearchResponse {
  results: Journey[];
  freshness: Freshness;
}

export function SearchPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [date, setDate] = useState(params.get("date") ?? todayIso(14));
  const [preference, setPreference] = useState("balanced");
  const [compare, setCompare] = useState<string[]>([]);
  const groupId = params.get("group");
  const search = useMutation({
    mutationFn: () => post<SearchResponse>("/api/v1/journeys/search", { from_code: from, to_code: to, date, preference }),
  });
  const ready = from && to && date;
  const chosen = search.data?.results.filter((j) => compare.includes(j.id)) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Find a journey" intro="Direct trains and connections with up to two changes, ranked and explained." />
      {groupId && <SandboxNote>Planning one booking from your group. The travellers you chose will be filled in on the next step.</SandboxNote>}
      <Card>
        <form
          className="grid gap-4 md:grid-cols-[1fr_1fr_11rem_12rem_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setCompare([]);
            if (ready) search.mutate();
          }}
        >
          <StationField label="From" value={from} onChange={setFrom} />
          <StationField label="To" value={to} onChange={setTo} />
          <TextField label="Date" type="date" value={date} min={todayIso()} max={todayIso(120)} onChange={(e) => setDate(e.target.value)} />
          <Select label="Prefer" value={preference} onChange={(e) => setPreference(e.target.value)}>
            <option value="balanced">Balanced</option>
            <option value="fastest">Fastest</option>
            <option value="fewest_changes">Fewest changes</option>
            <option value="earliest_arrival">Earliest arrival</option>
          </Select>
          <Button type="submit" loading={search.isPending} disabled={!ready} icon={<Search aria-hidden className="size-4" />}>
            Search
          </Button>
        </form>
        {!ready && <p className="mt-3 text-xs text-ink/70">Pick both stations from the suggestions to search.</p>}
      </Card>

      {search.isError && <Alert tone="error" title={errorText(search.error)} />}

      {search.data && (
        <section aria-live="polite" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {search.data.results.length} option{search.data.results.length === 1 ? "" : "s"}
            </h2>
            <p className="text-xs text-ink/70">
              Synthetic timetable as of {search.data.freshness.as_of}. Availability is not shown: no authorised provider is connected.
            </p>
          </div>
          {search.data.results.length === 0 ? (
            <EmptyState title="No route with up to two changes" body="Try another date or nearby stations. PAYANI's synthetic network covers 35 major stations." />
          ) : (
            search.data.results.map((j) => (
              <JourneyCard
                key={j.id}
                j={j}
                actions={
                  <>
                    <Button onClick={() => navigate(`/app/book?journey=${encodeURIComponent(j.id)}&date=${date}${groupId ? `&group=${groupId}&members=${params.get("members") ?? ""}` : ""}`)}>
                      Select
                    </Button>
                    <Button
                      variant="secondary"
                      aria-pressed={compare.includes(j.id)}
                      onClick={() => setCompare((c) => (c.includes(j.id) ? c.filter((x) => x !== j.id) : [...c.slice(-2), j.id]))}
                    >
                      {compare.includes(j.id) ? "Remove from comparison" : "Compare"}
                    </Button>
                  </>
                }
              />
            ))
          )}
        </section>
      )}

      {chosen.length >= 2 && (
        <section aria-labelledby="compare-title" className="sticky bottom-4 z-10">
          <Card className="shadow-xl">
            <h2 id="compare-title" className="font-semibold">Comparison</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink/70">
                    <th scope="col" className="py-1 pr-4">Option</th>
                    <th scope="col" className="py-1 pr-4">Duration</th>
                    <th scope="col" className="py-1 pr-4">Changes</th>
                    <th scope="col" className="py-1 pr-4">Waiting</th>
                    <th scope="col" className="py-1 pr-4">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((j, i) => (
                    <tr key={j.id} className="border-t border-line">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">#{i + 1} · {j.legs.map((l) => l.train_number).join(" + ")}</th>
                      <td className="py-2 pr-4">{duration(j.duration_min)}</td>
                      <td className="py-2 pr-4">{j.transfers}</td>
                      <td className="py-2 pr-4">{duration(j.total_wait_min)}</td>
                      <td className="py-2 pr-4">{j.distance_km} km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
