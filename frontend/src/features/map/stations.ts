import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export interface MapStation { code: string; name: string; state: string | null; lat: number; lon: number; google_maps_url?: string }
export interface StationMap {
  stations: MapStation[];
  links?: [string, string][];
  position_note: string;
  links_note?: string | null;
  source: string;
  /** Requested stations that the source has no position for (they cannot be drawn). */
  missing_positions?: string[];
}

/** Major terminals whose names are always labelled. */
export const HUBS = new Set(["NDLS", "CSMT", "HWH", "MAS", "SC", "ADI"]);

/**
 * Stations to draw, with approximate positions. For the simulated catalogue: every station.
 * For an imported national timetable: the busiest stations plus `include` (the stations of the
 * journey on screen). The catalogue changes rarely, so cache it; keep the previous answer while
 * a new `include` loads so the map never blanks.
 */
export function useStationMap(include: string[] = []) {
  const key = [...new Set(include.filter(Boolean))].sort().join(",");
  return useQuery({
    queryKey: ["station-map", key],
    queryFn: () => api<StationMap>(`/api/v1/stations/map${key ? `?include=${encodeURIComponent(key)}` : ""}`),
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** A route to draw: an ordered list of station codes per leg. Drawn as straight schematic segments. */
export interface MapRoute { id: string; legs: { from: string; to: string }[]; label?: string }

/** Station codes where a passenger changes train. */
export function transferCodes(route: MapRoute | undefined): string[] {
  if (!route) return [];
  return route.legs.slice(0, -1).map((l) => l.to);
}
