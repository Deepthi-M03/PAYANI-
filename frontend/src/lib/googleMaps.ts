/**
 * "Open in Google Maps" handoff links (Google Maps URLs:
 * https://developers.google.com/maps/documentation/urls/get-started).
 *
 * Plain links that open Google Maps in a new tab. No API key, no Google API call from
 * PAYANI, no cost. PAYANI's own map remains MapLibre + OpenFreeMap.
 */
export interface Place { name?: string | null; lat?: number | null; lon?: number | null }

const BASE = "https://www.google.com/maps";

function query(p: Place): string {
  if (typeof p.lat === "number" && typeof p.lon === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
    return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  }
  const name = p.name?.trim();
  if (!name) throw new Error("A place needs a name or coordinates.");
  return /station/i.test(name) ? name : `${name} railway station`;
}

/** Search link for a station: coordinates when known, otherwise "<name> railway station". */
export function placeUrl(p: Place): string {
  return `${BASE}/search/?${new URLSearchParams({ api: "1", query: query(p) }).toString()}`;
}

export type TravelMode = "transit" | "driving" | "walking" | "bicycling";

/** Directions between two places. Google chooses the route; PAYANI only passes the two ends. */
export function directionsUrl(origin: Place, destination: Place, travelmode: TravelMode = "transit"): string {
  return `${BASE}/dir/?${new URLSearchParams({ api: "1", origin: query(origin), destination: query(destination), travelmode }).toString()}`;
}

/** Link attributes for opening Google Maps in a new tab without leaking the PAYANI URL. */
export const externalLink = { target: "_blank", rel: "noopener noreferrer" } as const;
