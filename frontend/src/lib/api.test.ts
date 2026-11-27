import { describe, expect, it, vi } from "vitest";

import { api, ApiError, post, refreshSession, setAccessToken } from "./api";
import { wakeConfig } from "./wake";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const proxyTimeout = () => new Response("<html>gateway timeout</html>", { status: 504 });

function route(handlers: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input);
    const handler = handlers[path];
    return handler ? handler() : json(404, { title: "Not found", status: 404, code: "not-found" });
  });
}

describe("api client on a sleeping server", () => {
  it("retries a read once after the server wakes", async () => {
    let calls = 0;
    const spy = route({
      "/health/live": () => json(200, { status: "ok" }),
      "/api/v1/me": () => (++calls === 1 ? proxyTimeout() : json(200, { id: "u1" })),
    });
    expect(await api<{ id: string }>("/api/v1/me")).toEqual({ id: "u1" });
    expect(spy.mock.calls.filter(([u]) => String(u) === "/api/v1/me")).toHaveLength(2);
  });

  it("never repeats a write: a failed POST is reported, not silently resent", async () => {
    const spy = route({
      "/health/live": () => json(200, { status: "ok" }),
      "/api/v1/bookings": () => proxyTimeout(),
    });
    const err = await post("/api/v1/bookings", {}, "key-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problem.code).toBe("unavailable");
    expect(spy.mock.calls.filter(([u]) => String(u) === "/api/v1/bookings")).toHaveLength(1);
  });

  it("waits for the API before sending a write at all", async () => {
    vi.useFakeTimers();
    Object.assign(wakeConfig, { pollMs: 1_000 });
    const order: string[] = [];
    let probes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      order.push(path);
      if (path === "/health/live") return ++probes < 3 ? proxyTimeout() : json(200, { status: "ok" });
      return json(201, { id: "b1" });
    });
    const pending = post<{ id: string }>("/api/v1/bookings", {}, "key-2");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ id: "b1" });
    expect(order).toEqual(["/health/live", "/health/live", "/health/live", "/api/v1/bookings"]);
  });

  it("does not report a signed-out session when the server is unreachable", async () => {
    setAccessToken("still-valid");
    route({ "/health/live": () => json(200, { status: "ok" }), "/api/v1/auth/refresh": () => proxyTimeout() });
    await expect(refreshSession()).rejects.toBeInstanceOf(ApiError);
    // The in-memory token must survive: the person was never actually signed out.
    const spy = route({ "/health/live": () => json(200, { status: "ok" }), "/api/v1/me": () => json(200, {}) });
    await api("/api/v1/me");
    const call = spy.mock.calls.find(([u]) => String(u) === "/api/v1/me");
    expect(new Headers((call?.[1] as RequestInit).headers).get("Authorization")).toBe("Bearer still-valid");
    setAccessToken(null);
  });

  it("still treats a real 401 on refresh as signed out", async () => {
    route({
      "/health/live": () => json(200, { status: "ok" }),
      "/api/v1/auth/refresh": () => json(401, { title: "Session ended", status: 401, code: "session-expired" }),
    });
    expect(await refreshSession()).toBeNull();
  });
});
