import "@testing-library/jest-dom/vitest";
import "../i18n";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetWakeForTests, wakeConfig } from "../lib/wake";

const defaultWakeConfig = { ...wakeConfig };

// jsdom may not provide matchMedia.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetWakeForTests();
  Object.assign(wakeConfig, defaultWakeConfig);
  vi.restoreAllMocks();
});
