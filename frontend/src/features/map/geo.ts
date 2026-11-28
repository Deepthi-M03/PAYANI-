import type { MapRoute, MapStation } from "./stations";
import { prefersReducedMotion } from "../../motion/reveal";

export type LngLat = [number, number];

/** Coordinates of each leg's straight schematic segment, in order. */
export function routeLine(route: MapRoute, byCode: Map<string, MapStation>): LngLat[] {
  const pts: LngLat[] = [];
  for (const leg of route.legs) {
    const a = byCode.get(leg.from), b = byCode.get(leg.to);
    if (!a || !b) continue;
    if (!pts.length) pts.push([a.lon, a.lat]);
    pts.push([b.lon, b.lat]);
  }
  return pts;
}

/** Point at fraction t (0..1) along a polyline, by length. */
export function along(line: LngLat[], t: number): LngLat {
  if (line.length < 2) return line[0] ?? [78, 22];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(d); total += d;
  }
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < seg.length; i++) {
    const d = seg[i]!;
    if (target <= d || i === seg.length - 1) {
      const a = line[i]!, b = line[i + 1]!, f = d ? target / d : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    target -= d;
  }
  return line[line.length - 1]!;
}

/** The line cut at fraction t, for draw-on animation. */
export function partial(line: LngLat[], t: number): LngLat[] {
  if (t >= 1 || line.length < 2) return line;
  const out: LngLat[] = [line[0]!];
  const end = along(line, t);
  let total = 0;
  const lens = line.slice(1).map((b, i) => { const a = line[i]!; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); total += d; return d; });
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    acc += lens[i]!;
    if (acc / total < t) out.push(line[i + 1]!);
    else break;
  }
  out.push(end);
  return out;
}

export function bounds(points: LngLat[]): [LngLat, LngLat] {
  const lons = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/** Web Mercator projection to 0..1 within a lon/lat box (used by the simplified map). */
export function project([lon, lat]: LngLat, box: [LngLat, LngLat]): [number, number] {
  const merc = (la: number) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
  const [[w, s], [e, n]] = box;
  return [(lon - w) / (e - w), (merc(n) - merc(lat)) / (merc(n) - merc(s))];
}

export const INDIA_BOX: [LngLat, LngLat] = [[67.5, 6.5], [97.5, 35.8]];

export function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Run `step(t)` from 0 to 1 over `ms`, unless the user prefers reduced motion. Returns a cancel fn. */
export function tween(ms: number, step: (t: number) => void, done?: () => void): () => void {
  if (prefersReducedMotion()) { step(1); done?.(); return () => {}; }
  let raf = 0;
  const start = performance.now();
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    step(t);
    if (t < 1) raf = requestAnimationFrame(frame); else done?.();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
