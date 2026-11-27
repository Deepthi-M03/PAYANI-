/**
 * Wake-up handling for hosting that puts the API to sleep when idle (free tiers).
 *
 * A sleeping API takes about a minute to start, but the site's proxy gives up after
 * roughly 26 seconds. Instead of letting the first request fail (and, for the session
 * refresh, look like a sign-out), every API call first confirms the API is awake by
 * polling the cheap /health/live endpoint, with a per-attempt timeout shorter than the
 * proxy's. While that takes longer than a moment, a banner tells the person why.
 *
 * Nothing here fakes data: it only waits for the real API to answer.
 */

export type WakeState = "idle" | "waking";

/** Mutable so tests can shorten the waits. Defaults suit a free-tier cold start. */
export const wakeConfig = {
  /** Abort one health probe before the proxy's own 26 s timeout. */
  attemptTimeoutMs: 25_000,
  /** Pause between probes. */
  pollMs: 3_000,
  /** Stop waiting after this long in total. */
  budgetMs: 120_000,
  /** A successful API response counts as "awake" for this long (the host sleeps after 15 min idle). */
  freshMs: 10 * 60_000,
  /** Only show the banner if waking takes longer than this, so a warm API never flashes it. */
  bannerDelayMs: 1_500,
};

let lastAliveAt = 0;
let inFlight: Promise<boolean> | null = null;
let state: WakeState = "idle";
const listeners = new Set<() => void>();

function setState(next: WakeState) {
  if (state === next) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribeWake(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWakeState(): WakeState {
  return state;
}

/** 502/503/504 are what a proxy returns while the API behind it is starting or unreachable. */
export function isUnavailableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export function markApiAlive(): void {
  lastAliveAt = Date.now();
}

/** Forget that the API was awake, so the next call checks again. */
export function markApiMaybeAsleep(): void {
  lastAliveAt = 0;
}

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wakeConfig.attemptTimeoutMs);
  try {
    const res = await fetch("/health/live", { signal: controller.signal, cache: "no-store" });
    return !isUnavailableStatus(res.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve true once the API answers, or false if it has not within the time budget.
 * Returns immediately when the API answered recently. Concurrent callers share one wait.
 */
export function ensureApiAwake(): Promise<boolean> {
  if (Date.now() - lastAliveAt < wakeConfig.freshMs) return Promise.resolve(true);
  inFlight ??= (async () => {
    const started = Date.now();
    const banner = setTimeout(() => setState("waking"), wakeConfig.bannerDelayMs);
    try {
      for (;;) {
        if (await probe()) {
          markApiAlive();
          return true;
        }
        if (Date.now() - started >= wakeConfig.budgetMs) return false;
        await new Promise((resolve) => setTimeout(resolve, wakeConfig.pollMs));
      }
    } finally {
      clearTimeout(banner);
      setState("idle");
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test helper: back to a cold, idle state. */
export function resetWakeForTests(): void {
  lastAliveAt = 0;
  inFlight = null;
  setState("idle");
}
