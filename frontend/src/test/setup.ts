import "@testing-library/jest-dom/vitest";
import "../i18n";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetWakeForTests, wakeConfig } from "../lib/wake";

const defaultWakeConfig = { ...wakeConfig };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetWakeForTests();
  Object.assign(wakeConfig, defaultWakeConfig);
  vi.restoreAllMocks();
});
