import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Card } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { TextField } from "../../design-system/TextField";
import { PageHeader, QueryState, Select, errorText } from "../../design-system/ui";
import { api } from "../../lib/api";
import { todayIso } from "../../lib/format";

interface Forecast { route: string; date: string; demand_index: number; typical: number; interval_80: [number, number]; level: string }
interface ModelCard { name: string; version: string; data: string; target: string; leakage_rule: string; limitations: string[];
  evaluation: { method: string; cutoffs: string[]; mean_by_model: Record<string, { mae: number; rmse: number; mase: number }> } }

const LEVEL = { high: "Busier than usual", normal: "Typical demand", low: "Quieter than usual" } as Record<string, string>;

export function IntelligencePage() {
  const routes = useQuery({ queryKey: ["fc-routes"], queryFn: () => api<{ route: string; from: string; to: string }[]>("/api/v1/intelligence/routes") });
  const card = useQuery({ queryKey: ["model-card"], queryFn: () => api<ModelCard>("/api/v1/intelligence/model-card"), staleTime: Infinity });
  const [route, setRoute] = useState("MAS-SBC");
  const [date, setDate] = useState(todayIso(14));
  const fc = useMutation({ mutationFn: () => api<Forecast>(`/api/v1/intelligence/forecast?route=${route}&date=${date}`) });
  const max = fc.data ? Math.max(fc.data.interval_80[1], fc.data.typical) * 1.15 : 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Intelligence" intro="How PAYANI ranks journeys, plans group bookings and estimates demand, with the evidence behind it." />
      <Alert tone="info" title="Trained on synthetic data">PAYANI has no real railway booking data. The forecast shows what the model learned from a documented synthetic generator, so treat it as a demonstration of method, not a prediction of real crowds.</Alert>

      <Card>
        <h2 className="font-semibold">Demand forecast</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); fc.mutate(); }}>
          <Select label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
            {(routes.data ?? []).map((r) => <option key={r.route} value={r.route}>{r.from} → {r.to}</option>)}
          </Select>
          <TextField label="Date" type="date" value={date} min={todayIso()} max={todayIso(90)} onChange={(e) => setDate(e.target.value)} />
          <Button type="submit" loading={fc.isPending}>Forecast</Button>
        </form>
        {fc.isPending && <p className="mt-3 text-sm text-ink/70">The first forecast trains the model, which takes a few seconds.</p>}
        {fc.isError && <div className="mt-4"><Alert tone="error" title={errorText(fc.error)} /></div>}
        {fc.data && (
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-3xl">{LEVEL[fc.data.level]}</p>
              <ConfidenceBadge level="simulated" />
            </div>
            <figure className="mt-4" aria-label={`Forecast ${fc.data.demand_index}, 80% range ${fc.data.interval_80[0]} to ${fc.data.interval_80[1]}, typical ${fc.data.typical}`}>
              <div className="relative h-10 rounded-full bg-mist">
                <div className="absolute inset-y-2 rounded-full bg-steel/50" style={{ left: `${(fc.data.interval_80[0] / max) * 100}%`, width: `${((fc.data.interval_80[1] - fc.data.interval_80[0]) / max) * 100}%` }} />
                <div className="absolute inset-y-0 w-1 rounded bg-primary" style={{ left: `${(fc.data.demand_index / max) * 100}%` }} />
                <div className="absolute inset-y-0 w-0.5 border-l-2 border-dashed border-ink/60" style={{ left: `${(fc.data.typical / max) * 100}%` }} />
              </div>
              <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink/75">
                <span><span className="mr-1 inline-block size-2 rounded bg-primary" />Forecast {fc.data.demand_index}</span>
                <span><span className="mr-1 inline-block size-2 rounded bg-steel/50" />80% range {fc.data.interval_80[0]}–{fc.data.interval_80[1]}</span>
                <span>┆ Typical for this route {fc.data.typical}</span>
              </figcaption>
            </figure>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Model card</h2>
        <QueryState query={card}>
          {(c) => (
            <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
              <div className="space-y-2">
                <p><strong>Model:</strong> {c.name} v{c.version}</p>
                <p><strong>Data:</strong> {c.data}</p>
                <p><strong>Target:</strong> {c.target}</p>
                <p><strong>Leakage rule:</strong> {c.leakage_rule}</p>
                <ul className="list-disc pl-5">{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
              <div>
                <p className="mb-2"><strong>Evaluation:</strong> {c.evaluation.method}</p>
                <table className="w-full">
                  <thead><tr className="text-left text-ink/70"><th scope="col">Model</th><th scope="col">MAE</th><th scope="col">RMSE</th><th scope="col">MASE</th></tr></thead>
                  <tbody>
                    {Object.entries(c.evaluation.mean_by_model).map(([name, m]) => (
                      <tr key={name} className="border-t border-line"><th scope="row" className="py-1 text-left font-medium">{name.replaceAll("_", " ")}</th><td>{m.mae}</td><td>{m.rmse}</td><td>{m.mase}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ink/70">Lower is better. MASE below 1 means better than the seasonal-naive baseline.</p>
              </div>
            </div>
          )}
        </QueryState>
      </Card>

      <Card>
        <h2 className="font-semibold">How journeys are ranked</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>Every direct and connecting option with up to two changes is found, with at least 30 minutes for each change.</li>
          <li>Options that leave earlier, arrive later and change more often than another option are removed (Pareto filtering).</li>
          <li>The rest are ordered by your preference, and each one lists the measured reasons it is shown.</li>
          <li>An independent Dijkstra search on a time-expanded graph checks the earliest possible arrival in automated tests.</li>
          <li>Group plans use the fewest possible bookings, then keep families together, and never promise adjacent seats.</li>
        </ul>
      </Card>
    </div>
  );
}
