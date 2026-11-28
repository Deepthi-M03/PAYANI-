/**
 * Which engine draws PAYANI's interactive map.
 *
 * Default and fallback: MapLibre GL JS with OpenFreeMap tiles (free, no key, no billing).
 *
 * Google Maps (optional, OFF by default). Setting VITE_MAP_PROVIDER=google together with
 * VITE_GOOGLE_MAPS_API_KEY only records the intent: no Google Maps JavaScript renderer is
 * shipped yet, so the app keeps using MapLibre and never loads Google's paid Maps JavaScript
 * API on its own. Turning Google on needs a Google Cloud billing account (see
 * docs/timetable-data.md, "Google Maps"), the owner's approval, and a renderer added behind
 * `RailMap` that uses the same props. A browser key is visible to users by design, so it must
 * be restricted to the site's domain in Google Cloud. Never put a server key here.
 *
 * "Open in Google Maps" links (lib/googleMaps.ts) are separate: they need no key and are always on.
 */
export type MapProvider = "maplibre" | "google";

export interface MapProviderConfig {
  requested: MapProvider;
  active: MapProvider;
  reason: string;
}

export function mapProviderConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): MapProviderConfig {
  const requested: MapProvider = env.VITE_MAP_PROVIDER === "google" ? "google" : "maplibre";
  if (requested === "maplibre") return { requested, active: "maplibre", reason: "Default free map (MapLibre + OpenFreeMap)." };
  if (!env.VITE_GOOGLE_MAPS_API_KEY) return { requested, active: "maplibre", reason: "Google Maps requested but no VITE_GOOGLE_MAPS_API_KEY is set; using MapLibre." };
  return { requested, active: "maplibre", reason: "Google Maps renderer not installed in this build; using MapLibre. See docs/timetable-data.md." };
}
