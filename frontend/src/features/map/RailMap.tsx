/**
 * Interactive railway map.
 *
 * Primary: MapLibre GL JS with OpenFreeMap vector tiles (free, no key). Public pages may add the
 * OpenRailwayMap overlay, which shows real track geometry from OpenStreetMap; its terms only
 * allow public, registration-free use, so signed-in pages do not load it.
 * Fallback: a simplified projected map (no WebGL, or tiles unreachable) with the same controls.
 *
 * Honesty rules: journey lines are straight schematic segments between stops and are labelled
 * so; station positions are approximate; nothing here shows live train positions. The moving
 * indicator travels the selected journey once, as an illustration of the route order.
 */
import { ExternalLink, Layers, LocateFixed, MapPin, Minus, Plus, TrainFront, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";

import { INDIA_BOX, along, bounds, easeInOut, partial, project, routeLine, tween, type LngLat } from "./geo";
import { HUBS, transferCodes, useStationMap, type MapRoute, type MapStation } from "./stations";
import { externalLink, placeUrl } from "../../lib/googleMaps";
import { prefersReducedMotion } from "../../motion/reveal";

const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ?? "https://tiles.openfreemap.org/styles/positron";
const ORM_TILES = ["a", "b", "c"].map((s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`);
const ORM_ATTRIBUTION = 'Railway layer: <a href="https://www.openrailwaymap.org/" target="_blank" rel="noopener">OpenRailwayMap</a> (CC-BY-SA 2.0)';

type Role = "from" | "to" | "transfer" | "none";
export interface RailMapProps {
  from?: string;
  to?: string;
  onPick?: (code: string, role: "from" | "to") => void;
  routes?: MapRoute[];
  activeRouteId?: string;
  onSelectRoute?: (id: string) => void;
  publicContext?: boolean;
  className?: string;
  label?: string;
}

export function RailMap(props: RailMapProps) {
  const wanted = useMemo(() => [props.from ?? "", props.to ?? "", ...(props.routes ?? []).flatMap((r) => r.legs.flatMap((l) => [l.from, l.to]))],
    [props.from, props.to, props.routes]);
  const stations = useStationMap(wanted);
  const [engine, setEngine] = useState<"loading" | "gl" | "fallback">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [railLayer, setRailLayer] = useState(Boolean(props.publicContext));
  const list = stations.data?.stations ?? [];
  const byCode = useMemo(() => new Map<string, MapStation>(list.map((s): [string, MapStation] => [s.code, s])), [list]);
  const active = props.routes?.find((r) => r.id === props.activeRouteId) ?? props.routes?.[0];
  const transfers = useMemo(() => transferCodes(active), [active]);
  const roleOf = useCallback((code: string): Role => code === props.from ? "from" : code === props.to ? "to" : transfers.includes(code) ? "transfer" : "none", [props.from, props.to, transfers]);
  const sel = selected ? byCode.get(selected) : undefined;

  const overlay = (
    <>
      <Legend hasRoute={Boolean(active)} hasLinks={(stations.data?.links?.length ?? 0) > 0} />
      {(stations.data?.missing_positions?.length ?? 0) > 0 && (
        <p className="pointer-events-none absolute right-3 top-3 z-10 max-w-[14rem] rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-muted shadow-[var(--shadow-panel)]">
          No position in the source for {stations.data?.missing_positions?.join(", ")}, so the route line is incomplete.
        </p>
      )}
      {sel && (
        <StationCard s={sel} role={roleOf(sel.code)} note={stations.data?.position_note} onClose={() => setSelected(null)}
                     onPick={props.onPick ? (role) => { props.onPick?.(sel.code, role); setSelected(null); } : undefined} />
      )}
      {props.publicContext && engine === "gl" && (
        <button type="button" onClick={() => setRailLayer((v) => !v)} aria-pressed={railLayer}
                className="absolute right-3 top-[92px] z-10 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-[var(--shadow-panel)] hover:bg-ivory">
          <Layers aria-hidden className="size-3.5" /> Railway lines {railLayer ? "on" : "off"}
        </button>
      )}
    </>
  );

  return (
    <div className={`relative isolate overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#e9edf1] ${props.className ?? "h-[480px]"}`}
         role="region" aria-label={props.label ?? "Railway map"}>
      {stations.isPending ? <div className="skeleton absolute inset-0 rounded-none" /> : stations.isError ? (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">The map could not load station data. Search still works without it.</p>
      ) : engine !== "fallback" ? (
        <GLMap {...props} links={stations.data?.links ?? []} stations={list} byCode={byCode} active={active} roleOf={roleOf} railLayer={railLayer && Boolean(props.publicContext)}
               selected={selected} onSelect={setSelected} onEngine={setEngine} />
      ) : (
        <SimpleMap {...props} links={stations.data?.links ?? []} stations={list} byCode={byCode} active={active} roleOf={roleOf} selected={selected} onSelect={setSelected} />
      )}
      {stations.isSuccess && overlay}
    </div>
  );
}

function Legend({ hasRoute, hasLinks }: { hasRoute: boolean; hasLinks: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface/95 px-3 py-2 text-[11px] text-muted shadow-[var(--shadow-panel)]">
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-navy bg-white" />From</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-saffron" />To</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 border-2 border-signal bg-white" />Change</span>
      {hasLinks && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-navy/40" />Network links (schematic)</span>}
      {hasRoute && <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-signal" />Schematic route, not track geometry</span>}
    </div>
  );
}

function StationCard({ s, role, note, onClose, onPick }: { s: MapStation; role: Role; note?: string; onClose: () => void; onPick?: (r: "from" | "to") => void }) {
  return (
    <div className="absolute left-3 top-3 z-20 w-[min(18rem,calc(100%-1.5rem))] rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-raised)] motion-safe:animate-[rise_220ms_var(--ease-ui)]" role="dialog" aria-label={`${s.name} station`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-saffron-text">{s.code}</p>
          <p className="text-base font-semibold leading-snug">{s.name}</p>
          {s.state && <p className="text-sm text-muted">{s.state}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close station details" className="grid size-8 place-items-center rounded-md text-muted hover:bg-mist"><X aria-hidden className="size-4" /></button>
      </div>
      <p className="mt-2 text-xs text-muted">{role === "from" ? "Your origin. " : role === "to" ? "Your destination. " : role === "transfer" ? "You change trains here. " : ""}{note ?? "Approximate position."}</p>
      <a href={s.google_maps_url ?? placeUrl({ name: s.name, lat: s.lat, lon: s.lon })} {...externalLink}
         className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-signal hover:underline">
        <ExternalLink aria-hidden className="size-3.5" />Open in Google Maps
      </a>
      {onPick && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onPick("from")} className="rounded-md border border-steel/60 px-2 py-2 text-sm font-semibold hover:border-primary hover:bg-ivory">Set as From</button>
          <button type="button" onClick={() => onPick("to")} className="rounded-md bg-primary px-2 py-2 text-sm font-semibold text-white hover:bg-primary-hover">Set as To</button>
        </div>
      )}
    </div>
  );
}

function endpoints(from: string | undefined, to: string | undefined, byCode: Map<string, MapStation>): LngLat[] {
  return [from, to].flatMap((c) => { const s = c ? byCode.get(c) : undefined; return s ? [[s.lon, s.lat] as LngLat] : []; });
}

type Inner = RailMapProps & { links: [string, string][]; stations: MapStation[]; byCode: Map<string, MapStation>; active?: MapRoute; roleOf: (c: string) => Role; selected: string | null; onSelect: (c: string | null) => void };

function markerEl(code: string, role: Role, isSelected: boolean) {
  return `rm-station rm-${role}${isSelected ? " rm-selected" : ""}${HUBS.has(code) ? " rm-hub" : ""}`;
}

/* ------------------------------------------------------------------ MapLibre */

function GLMap(p: Inner & { railLayer: boolean; onEngine: (e: "gl" | "fallback") => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef(new Map<string, { m: import("maplibre-gl").Marker; el: HTMLButtonElement }>());
  const train = useRef<import("maplibre-gl").Marker | null>(null);
  const [ready, setReady] = useState(false);
  const { onEngine } = p;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    (async () => {
      try {
        const mod = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        const lib = (mod as unknown as { default?: typeof import("maplibre-gl") }).default ?? mod;
        if (cancelled || !box.current || !lib?.Map) throw new Error("MapLibre unavailable");
        const probe = document.createElement("canvas");
        if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error("WebGL unavailable");
        libRef.current = lib;
        const map = new lib.Map({
          container: box.current, style: STYLE_URL, bounds: [INDIA_BOX[0], INDIA_BOX[1]], fitBoundsOptions: { padding: 24 },
          minZoom: 3.2, maxZoom: 12, maxBounds: [[55, -2], [110, 42]], cooperativeGestures: true, attributionControl: { compact: true },
          dragRotate: false, pitchWithRotate: false, touchPitch: false,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new lib.ScaleControl({ unit: "metric" }), "bottom-right");
        mapRef.current = map;
        timer = window.setTimeout(() => { if (!map.loaded()) { map.remove(); mapRef.current = null; onEngine("fallback"); } }, 12_000);
        map.on("load", () => {
          window.clearTimeout(timer);
          map.addSource("orm", { type: "raster", tiles: ORM_TILES, tileSize: 256, maxzoom: 19, attribution: ORM_ATTRIBUTION });
          map.addLayer({ id: "orm", type: "raster", source: "orm", paint: { "raster-opacity": 0.55 }, layout: { visibility: "none" } });
          map.addSource("network", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "network", type: "line", source: "network", paint: { "line-color": "#0B1F3A", "line-width": 1.2, "line-opacity": 0.28 } });
          map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "route-alt", type: "line", source: "routes", filter: ["==", ["get", "active"], false],
            paint: { "line-color": "#6B7480", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.7 }, layout: { "line-cap": "round" } });
          map.addLayer({ id: "route-casing", type: "line", source: "routes", filter: ["==", ["get", "active"], true],
            paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
          map.addLayer({ id: "route-active", type: "line", source: "routes", filter: ["==", ["get", "active"], true],
            paint: { "line-color": "#2357B5", "line-width": 4, "line-dasharray": [2.2, 1.4] }, layout: { "line-cap": "round", "line-join": "round" } });
          map.on("click", "route-alt", (e) => { const id = e.features?.[0]?.properties?.id; if (id) p.onSelectRoute?.(String(id)); });
          setReady(true);
          onEngine("gl");
        });
      } catch {
        if (!cancelled) onEngine("fallback");
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timer); mapRef.current?.remove(); mapRef.current = null; markers.current.clear(); };
  }, [onEngine]);

  // Railway overlay visibility (public pages only).
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.getLayer("orm")) map.setLayoutProperty("orm", "visibility", p.railLayer ? "visible" : "none");
  }, [ready, p.railLayer]);

  // Schematic network links between stations served by the timetable.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("network") as import("maplibre-gl").GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: p.links.flatMap(([a, b]) => {
      const s1 = p.byCode.get(a), s2 = p.byCode.get(b);
      return s1 && s2 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [[s1.lon, s1.lat], [s2.lon, s2.lat]] } }] : [];
    }) });
  }, [ready, p.links, p.byCode]);

  // Station markers: real buttons, so keyboard and screen-reader users can pick stations.
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib) return;
    for (const s of p.stations) {
      let rec = markers.current.get(s.code);
      if (!rec) {
        const el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", `${s.name} (${s.code})`);
        el.innerHTML = `<span class="rm-dot"></span><span class="rm-label">${s.name.replace(/[&<>]/g, "")}</span>`;
        el.addEventListener("click", (ev) => { ev.stopPropagation(); p.onSelect(s.code); });
        rec = { m: new lib.Marker({ element: el, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(map), el };
        markers.current.set(s.code, rec);
      }
      rec.el.className = markerEl(s.code, p.roleOf(s.code), p.selected === s.code);
    }
  }, [ready, p.stations, p.roleOf, p.selected, p.onSelect]);

  // Routes: draw the active one on, then send the indicator along it once; fly the camera to fit.
  const routeKey = (p.routes ?? []).map((r) => r.id).join(",") + "|" + (p.active?.id ?? "") + "|" + (p.from ?? "") + (p.to ?? "");
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!ready || !map || !lib) return;
    const src = map.getSource("routes") as import("maplibre-gl").GeoJSONSource | undefined;
    const all = (p.routes ?? []).map((r) => ({ r, line: routeLine(r, p.byCode) })).filter((x) => x.line.length > 1);
    const act = all.find((x) => x.r.id === p.active?.id);
    const feature = (id: string, coords: LngLat[], active: boolean) => ({ type: "Feature" as const, properties: { id, active }, geometry: { type: "LineString" as const, coordinates: coords } });
    const others = all.filter((x) => x !== act).map((x) => feature(x.r.id, x.line, false));
    train.current?.remove(); train.current = null;
    const focus: LngLat[] = act ? act.line : endpoints(p.from, p.to, p.byCode);
    if (focus.length >= 2) {
      const reduce = prefersReducedMotion();
      map.fitBounds(bounds(focus), { padding: { top: 70, bottom: 70, left: 60, right: 70 }, maxZoom: 7.5, duration: reduce ? 0 : 1200, essential: false });
    } else if (focus.length === 1) {
      map.easeTo({ center: focus[0], zoom: Math.max(map.getZoom(), 5), duration: 800 });
    }
    if (!act) { src?.setData({ type: "FeatureCollection", features: others }); return; }
    const el = document.createElement("div");
    el.className = "rm-train";
    el.innerHTML = '<span class="rm-train-pulse"></span><span class="rm-train-dot"></span>';
    el.setAttribute("aria-hidden", "true");
    let cancelRun = () => {};
    const cancelDraw = tween(1100, (t) => {
      src?.setData({ type: "FeatureCollection", features: [...others, feature(act.r.id, partial(act.line, easeInOut(t)), true)] });
    }, () => {
      train.current = new lib.Marker({ element: el }).setLngLat(act.line[0]!).addTo(map);
      cancelRun = tween(2600, (t) => train.current?.setLngLat(along(act.line, easeInOut(t))));
    });
    return () => { cancelDraw(); cancelRun(); };
  }, [ready, routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={box} className="absolute inset-0" />
      {!ready && <div className="skeleton pointer-events-none absolute inset-0 rounded-none" aria-hidden />}
    </>
  );
}

/* ------------------------------------------------------------------ simplified fallback */

function SimpleMap(p: Inner) {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [trainAt, setTrainAt] = useState<LngLat | null>(null);
  const [drawT, setDrawT] = useState(1);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view); viewRef.current = view;

  const pos = useCallback((ll: LngLat) => project(ll, INDIA_BOX), []);
  const all = (p.routes ?? []).map((r) => ({ r, line: routeLine(r, p.byCode) })).filter((x) => x.line.length > 1);
  const act = all.find((x) => x.r.id === p.active?.id);

  const flyTo = useCallback((target: { k: number; x: number; y: number }) => {
    const from = viewRef.current;
    return tween(900, (t) => { const e = easeInOut(t); setView({ k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e }); });
  }, []);

  const routeKey = (p.routes ?? []).map((r) => r.id).join(",") + "|" + (p.active?.id ?? "") + "|" + (p.from ?? "") + (p.to ?? "");
  useEffect(() => {
    setTrainAt(null);
    const focus: LngLat[] = act ? act.line : endpoints(p.from, p.to, p.byCode);
    let cancelFly = () => {};
    if (focus.length >= 2) {
      const [[w, s], [e, n]] = bounds(focus);
      const a = pos([w, n]), b = pos([e, s]);
      const span = Math.max(b[0] - a[0], b[1] - a[1], 0.08);
      const k = Math.min(4, 0.62 / span);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      cancelFly = flyTo({ k, x: 0.5 - cx * k, y: 0.5 - cy * k });
    }
    if (!act) { setDrawT(1); return cancelFly; }
    let cancelRun = () => {};
    const cancelDraw = tween(1100, (t) => setDrawT(easeInOut(t)), () => {
      cancelRun = tween(2600, (t) => setTrainAt(along(act.line, easeInOut(t))));
    });
    return () => { cancelFly(); cancelDraw(); cancelRun(); };
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number) => {
    const v = viewRef.current; const k = Math.min(6, Math.max(1, v.k * f));
    setView({ k, x: 0.5 - ((0.5 - v.x) / v.k) * k, y: 0.5 - ((0.5 - v.y) / v.k) * k });
  };
  const onDown = (e: RPointerEvent) => { if ((e.target as HTMLElement).closest("button")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current, r = wrap.current?.getBoundingClientRect();
    if (!d || !r) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) / r.width, y: d.vy + (e.clientY - d.y) / r.height }));
  };
  const toScreen = (ll: LngLat) => { const [x, y] = pos(ll); return [view.x + x * view.k, view.y + y * view.k] as const; };
  const pathOf = (line: LngLat[]) => line.map((ll, i) => { const [x, y] = toScreen(ll); return `${i ? "L" : "M"}${(x * 1000).toFixed(1)} ${(y * 1000).toFixed(1)}`; }).join(" ");

  return (
    <div ref={wrap} className="absolute inset-0 touch-none select-none bg-[linear-gradient(180deg,#eef1f4,#e4e9ee)]" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
        {[10, 15, 20, 25, 30].map((lat) => { const [, y] = toScreen([80, lat]); return <g key={lat}><line x1="0" x2="1000" y1={y * 1000} y2={y * 1000} stroke="#cfd6de" strokeWidth="1" vectorEffect="non-scaling-stroke" /></g>; })}
        {[70, 75, 80, 85, 90, 95].map((lon) => { const [x] = toScreen([lon, 20]); return <line key={lon} y1="0" y2="1000" x1={x * 1000} x2={x * 1000} stroke="#cfd6de" strokeWidth="1" vectorEffect="non-scaling-stroke" />; })}
        {p.links.map(([a, b]) => {
          const s1 = p.byCode.get(a), s2 = p.byCode.get(b);
          if (!s1 || !s2) return null;
          const [x1, y1] = toScreen([s1.lon, s1.lat]), [x2, y2] = toScreen([s2.lon, s2.lat]);
          return <line key={a + b} x1={x1 * 1000} y1={y1 * 1000} x2={x2 * 1000} y2={y2 * 1000} stroke="#0B1F3A" strokeOpacity="0.22" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />;
        })}
        {all.filter((x) => x !== act).map((x) => (
          <path key={x.r.id} d={pathOf(x.line)} fill="none" stroke="#6B7480" strokeWidth="2" strokeDasharray="5 5" opacity="0.75" vectorEffect="non-scaling-stroke" />
        ))}
        {act && <>
          <path d={pathOf(partial(act.line, drawT))} fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={pathOf(partial(act.line, drawT))} fill="none" stroke="#2357B5" strokeWidth="4" strokeDasharray="9 6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>}
      </svg>
      {[10, 15, 20, 25, 30].map((lat) => { const [, y] = toScreen([80, lat]); return y > 0.02 && y < 0.98 ? <span key={lat} className="pointer-events-none absolute right-2 font-mono text-[10px] text-steel" style={{ top: `${y * 100}%` }}>{lat}°N</span> : null; })}
      {p.stations.map((s) => {
        const [x, y] = toScreen([s.lon, s.lat]);
        if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
        return (
          <button key={s.code} type="button" aria-label={`${s.name} (${s.code})`} onClick={() => p.onSelect(s.code)}
                  className={markerEl(s.code, p.roleOf(s.code), p.selected === s.code) + " absolute -translate-x-1/2 -translate-y-1/2"} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
            <span className="rm-dot" /><span className="rm-label">{s.name}</span>
          </button>
        );
      })}
      {trainAt && (() => { const [x, y] = toScreen(trainAt); return <span aria-hidden className="rm-train absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}><span className="rm-train-pulse" /><span className="rm-train-dot" /></span>; })()}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-md border border-line bg-surface shadow-[var(--shadow-panel)]">
        <MapBtn label="Zoom in" onClick={() => zoom(1.5)}><Plus aria-hidden className="size-4" /></MapBtn>
        <MapBtn label="Zoom out" onClick={() => zoom(1 / 1.5)}><Minus aria-hidden className="size-4" /></MapBtn>
        <MapBtn label="Show all of India" onClick={() => flyTo({ k: 1, x: 0, y: 0 })}><LocateFixed aria-hidden className="size-4" /></MapBtn>
      </div>
      <p className="pointer-events-none absolute left-3 top-3 z-0 hidden items-center gap-1 rounded bg-surface/90 px-2 py-1 text-[10px] text-muted sm:flex">
        <MapPin aria-hidden className="size-3" /> Simplified map: base map unavailable
      </p>
    </div>
  );
}

function MapBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-9 place-items-center border-b border-line text-ink last:border-b-0 hover:bg-ivory">{children}</button>;
}

export function MapRouteHint() {
  return <p className="flex items-center gap-1.5 text-xs text-muted"><TrainFront aria-hidden className="size-3.5" /> Select a journey to trace its stops on the map.</p>;
}
