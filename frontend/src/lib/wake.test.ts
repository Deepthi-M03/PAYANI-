import { describe, expect, it, vi } from "vitest";

import { ensureApiAwake, getWakeState, wakeConfig } from "./wake";

const res = (status: number) => new Response(status === 200 ? '{"status":"ok"}' : "gateway", { status });

describe("ensureApiAwake", () => {
  it("returns at once when the API answers, and does not probe again while fresh", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(res(200));
    expect(await ensureApiAwake()).toBe(true);
    expect(await ensureApiAwake()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe("/health/live");
  });

  it("keeps polling through proxy timeouts, shows the banner state, and resolves when the API wakes", async () => {
    vi.useFakeTimers();
    Object.assign(wakeConfig, { pollMs: 1_000, bannerDelayMs: 500, budgetMs: 60_000 });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(res(504))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200));

    const pending = ensureApiAwake();
    await vi.advanceTimersByTimeAsync(600);
    expect(getWakeState()).toBe("waking");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await pending).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(getWakeState()).toBe("idle");
  });

  it("does not show the banner when the API answers quickly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res(200));
    await ensureApiAwake();
    expect(getWakeState()).toBe("idle");
  });

  it("treats a network error as asleep and gives up after the time budget", async () => {
    vi.useFakeTimers();
    Object.assign(wakeConfig, { pollMs: 1_000, budgetMs: 5_000 });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    const pending = ensureApiAwake();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBe(false);
    expect(getWakeState()).toBe("idle");
  });

  it("lets concurrent callers share one wait", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(res(200));
    const results = await Promise.all([ensureApiAwake(), ensureApiAwake(), ensureApiAwake()]);
    expect(results).toEqual([true, true, true]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
