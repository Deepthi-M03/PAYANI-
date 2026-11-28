import { describe, expect, it } from "vitest";

import { mapProviderConfig } from "./provider";

describe("map provider", () => {
  it("defaults to MapLibre", () => {
    expect(mapProviderConfig({}).active).toBe("maplibre");
  });
  it("never activates Google Maps on its own", () => {
    expect(mapProviderConfig({ VITE_MAP_PROVIDER: "google" }).active).toBe("maplibre");
    const withKey = mapProviderConfig({ VITE_MAP_PROVIDER: "google", VITE_GOOGLE_MAPS_API_KEY: "test" });
    expect(withKey.requested).toBe("google");
    expect(withKey.active).toBe("maplibre");
  });
});
