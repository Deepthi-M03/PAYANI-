import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, ChartLine, FlaskConical, GitBranch, Route as RouteIcon } from "lucide-react";
import { useState } from "react";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { Panel } from "../../design-system/Card";
import { ConfidenceBadge } from "../../design-system/ConfidenceBadge";
import { PageHeader, QueryState, Select, Skeleton, Stat, errorText } from "../../design-system/ui";
import { api } from "../../lib/api";
import { todayIso } from "../../lib/format";

interface Forecast { route: string; date: string; demand_index: number; typical: number; interval_80: [number, number]; level: string }
interface ModelCard { name: string; version: string; data: string; target: string; leakage_rule: string; limitations: string[]; training_window?: [string, string]; features?: string[];
  evaluation: { method: string; cutoffs: string[]; mean_by_model: Record<string, { mae: number; rmse: number; mase: number }> } }

const LEVEL: Record<string, [string, string]> = {
  high: ["Busier than usual", "text-warning"], normal: ["Typical demand", "text-ink"], low: ["Quieter than usual", "text-success"],
};
const MODEL_NAME: Record<string, string> = { hist_gradient_boosting: "Gradient boosting (used)", ridge: "Ridge regression", seasonal_naive: "Seasonal naive (baseline)" };

/** Forecast on a scale: the 80% interval as a band, the forecast as a marker, typical as a dashed tick. */
function ForecastScale({ f }: { f: Forecast }) {
  const lo = Math.min(f.interval_80[0], f.typical) * 0.85, hi = Math.max(f.interval_80[1], f.typical) * 1.12;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <figure className="mt-6" aria-label={`Forecast ${f.demand_index}, 80% range ${f.interval_80[0]} to ${f.interval_80[1]}, typical ${f.typical}`}>
      <div className="relative h-16">
        <div className="absolute inset-x-0 top-7 h-2 rounded-full bg-mist" />
        <div className="absolute top-6 h-4 rounded-full bg-signal/20 ring-1 ring-signal/40 motion-safe:animate-[fade-in_600ms_var(--ease-ui)]" style={{ left: x(f.interval_80[0]), width: `calc(${x(f.interval_80[1])} - ${x(f.interval_80[0])})` }} />
        <div className="absolute top-3 h-10 border-l-2 border-dashed border-steel" style={{ left: x(f.typical) }}><span className="absolute -top-3 left-1 whitespace-nowrap text-[11px] text-muted">typical {f.typical}</span></div>
        <div className="absolute top-4 -ml-[9px] size-[18px] rounded-full border-[3px] border-white bg-primary shadow-[var(--shadow-raised)] transition-[left] duration-700 ease-[var(--ease-ui)]" style={{ left: x(f.demand_index) }} />
      </div>
      <div className="relative h-5 font-mono text-[11px] text-muted">{ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>{t.toFixed(0)}</span>)}</div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" />Forecast {f.demand_index}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-signal/20 ring-1 ring-signal/40" />80% range {f.interval_80[0]}–{f.interval_80[1]}</span>
        <span>Demand index in synthetic units</span>
      </figcaption>
    </figure>
  );
}

export function IntelligencePage() {
  const routes = useQuery({ queryKey: ["fc-routes"], queryFn: () => api<{ route: string; from: string; to: string }[]>("/api/v1/intelligence/routes") });
  const card = useQuery({ queryKey: ["model-card"], queryFn: () => api<ModelCard>("/api/v1/intelligence/model-card"), staleTime: Infinity });
  const [route, setRoute] = useState("MAS-SBC");
  const [date, setDate] = useState(todayIso(14));
  const fc = useMutation({ mutationFn: () => api<Forecast>(`/api/v1/intelligence/forecast?route=${route}&date=${date}`) });
  const ev = card.data?.evaluation.mean_by_model;
  const used = ev?.hist_gradient_boosting, base = ev?.seasonal_naive;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Intelligence" title="Intelligence" intro="How PAYANI ranks journeys, plans group bookings and estimates demand, with the evidence behind each number." />
      <Alert tone="info" title="Trained on synthetic data">PAYANI has no real railway booking data. Forecasts show what the model learned from a documented synthetic generator: a demonstration of method, not a prediction of real crowds.</Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Model error (MAE)" icon={ChartLine} value={used ? used.mae.toFixed(1) : "—"} hint="Mean absolute error, rolling-origin test" />
        <Stat label="Versus baseline (MASE)" icon={GitBranch} value={used ? used.mase.toFixed(2) : "—"} tone="success" hint="Below 1 beats seasonal naive" />
        <Stat label="Baseline error (MAE)" icon={FlaskConical} value={base ? base.mae.toFixed(1) : "—"} hint="Seasonal naive, same test" />
        <Stat label="Test windows" icon={BrainCircuit} value={card.data?.evaluation.cutoffs.length ?? "—"} hint={card.data?.evaluation.method} />
      </div>

      <Panel title="Demand forecast" icon={<ChartLine className="size-4" />} description="Relative demand on a route and date, with an 80% interval." actions={<ConfidenceBadge level="simulated" />}>
        <form className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); fc.mutate(); }}>
          <Select label="Route" value={route} onChange={(e) => setRoute(e.target.value)}>
            {(routes.data ?? []).map((r) => <option key={r.route} value={r.route}>{r.from} → {r.to}</option>)}
          </Select>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fc-date" className="text-sm font-medium">Date</label>
            <input id="fc-date" type="date" value={date} min={todayIso()} max={todayIso(90)} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-md border border-steel/70 bg-surface px-3 text-base focus:border-primary" />
          </div>
          <Button type="submit" loading={fc.isPending}>Forecast</Button>
        </form>
        {fc.isPending && <p className="mt-3 text-sm text-muted">The first forecast trains the model, which takes a few seconds.</p>}
        {fc.isError && <div className="mt-4"><Alert tone="error" title={errorText(fc.error)} /></div>}
        {fc.data && (
          <div className="mt-6 border-t border-line pt-6 motion-safe:animate-[rise_400ms_var(--ease-ui)]">
            <p className={`text-2xl font-semibold ${LEVEL[fc.data.level]?.[1] ?? ""}`}>{LEVEL[fc.data.level]?.[0] ?? fc.data.level}</p>
            <ForecastScale f={fc.data} />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Model performance" description="Mean over the rolling-origin test windows. Lower is better." bodyClassName="">
          <QueryState query={card} skeleton={<div className="p-6"><Skeleton rows={2} /></div>}>
            {(c) => {
              const rows = Object.entries(c.evaluation.mean_by_model);
              const worst = Math.max(...rows.map(([, m]) => m.mae));
              return (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th scope="col">Model</th><th scope="col">MAE</th><th scope="col" className="num">RMSE</th><th scope="col" className="num">MASE</th></tr></thead>
                    <tbody>{rows.map(([name, m]) => (
                      <tr key={name}>
                        <th scope="row" className="font-medium">{MODEL_NAME[name] ?? name.replaceAll("_", " ")}</th>
                        <td className="w-[38%]"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-mist"><div className={`h-full rounded-full ${name === "hist_gradient_boosting" ? "bg-primary" : "bg-steel/60"}`} style={{ width: `${(m.mae / worst) * 100}%` }} /></div><span className="w-12 text-right font-mono text-xs">{m.mae.toFixed(2)}</span></div></td>
                        <td className="num">{m.rmse.toFixed(2)}</td>
                        <td className="num">{m.mase.toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              );
            }}
          </QueryState>
        </Panel>

        <Panel title="Model card" description={card.data ? `${card.data.name} v${card.data.version}` : undefined}>
          <QueryState query={card} skeleton={<Skeleton rows={2} />}>
            {(c) => (
              <dl className="grid gap-4 text-sm">
                <div><dt className="font-medium">Data</dt><dd className="mt-0.5 text-muted">{c.data}</dd></div>
                <div><dt className="font-medium">Target</dt><dd className="mt-0.5 text-muted">{c.target}</dd></div>
                <div><dt className="font-medium">Leakage rule</dt><dd className="mt-0.5 text-muted">{c.leakage_rule}</dd></div>
                <div><dt className="font-medium">Limitations</dt><dd><ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul></dd></div>
              </dl>
            )}
          </QueryState>
        </Panel>
      </div>

      <Panel title="How journeys are ranked" icon={<RouteIcon className="size-4" />}>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[["Find every option", "All direct and connecting journeys with up to two changes, allowing at least 30 minutes for each change."],
            ["Remove dominated options", "Anything that leaves earlier, arrives later and changes more often than another option is dropped (Pareto filtering)."],
            ["Order by your preference", "Balanced, fastest, fewest changes or earliest arrival, with the measured reasons listed on each result."],
            ["Check against an oracle", "An independent Dijkstra search on a time-expanded graph verifies the earliest arrival in automated tests."]].map(([t, b], i) => (
            <li key={t} className="flex flex-col gap-2 border-t-2 border-navy pt-3">
              <span className="font-mono text-xs text-saffron-text">0{i + 1}</span>
              <p className="font-semibold">{t}</p>
              <p className="text-sm leading-relaxed text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
