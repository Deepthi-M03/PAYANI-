import { describe, expect, it } from "vitest";

import { directionsUrl, placeUrl } from "./googleMaps";

describe("Google Maps handoff links", () => {
  it("uses coordinates when known and needs no API key", () => {
    const url = new URL(placeUrl({ name: "Chennai Central", lat: 13.0827, lon: 80.2707 }));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("13.08270,80.27070");
    expect(url.toString().toLowerCase()).not.toContain("key=");
  });

  it("falls back to the station name", () => {
    expect(new URL(placeUrl({ name: "Itarsi Junction", lat: null })).searchParams.get("query")).toBe("Itarsi Junction railway station");
    expect(new URL(placeUrl({ name: "Howrah Station" })).searchParams.get("query")).toBe("Howrah Station");
    expect(() => placeUrl({})).toThrow();
  });

  it("builds transit directions between two stations", () => {
    const url = new URL(directionsUrl({ name: "New Delhi", lat: 28.64, lon: 77.22 }, { name: "Agra Cantt" }));
    expect(url.pathname).toBe("/maps/dir/");
    expect(url.searchParams.get("origin")).toBe("28.64000,77.22000");
    expect(url.searchParams.get("destination")).toBe("Agra Cantt railway station");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });
});
