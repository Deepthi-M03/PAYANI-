import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real API (start it first: `docker compose up db api`
 * or see CI). Two projects: normal motion, and reduced motion, so every flow is proven
 * to work with animations off.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "reduced-motion", use: { ...devices["Pixel 7"], reducedMotion: "reduce" } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 60_000 },
});
