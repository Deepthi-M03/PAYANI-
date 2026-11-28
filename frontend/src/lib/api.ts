/**
 * API client. The access token lives only in memory (never localStorage); the refresh
 * token is an httpOnly cookie the browser sends to /api/v1/auth. On a 401 the client
 * refreshes once and retries.
 */

import { ensureApiAwake, isUnavailableStatus, markApiAlive, markApiMaybeAsleep } from "./wake";

export interface Problem {
  type: string;
  code: string;
  title: string;
  status: number;
  detail?: string;
  request_id?: string;
  errors?: { field: string; message: string }[];
}

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.title);
  }
  get status() {
    return this.problem.status;
  }
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  locale: string;
  timezone: string;
  email_verified: boolean;
  roles: string[];
  permissions: string[];
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<TokenResponse | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)payani_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      body && typeof body === "object" && "title" in body
        ? (body as Problem)
        : isUnavailableStatus(res.status)
          ? unavailableProblem(res.status)
          : { type: "urn:payani:problem:network", code: "network", title: "Unexpected response", status: res.status },
    );
  }
  return body as T;
}

function unavailableProblem(status: number): Problem {
  return {
    type: "urn:payani:problem:unavailable",
    code: "unavailable",
    title: "PAYANI's server is starting up or can't be reached. Please try again in a moment.",
    status,
  };
}

async function rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // Free hosting sleeps when idle: wait for the real API before sending anything, so a
  // request (a payment, say) is never fired into a server that is still starting.
  await ensureApiAwake();
  const send = () => fetch(path, { ...init, headers, credentials: "same-origin" });
  try {
    let res = await send();
    if (isUnavailableStatus(res.status)) {
      markApiMaybeAsleep();
      // Reads are safe to repeat once the API is back. Writes are not retried here.
      const method = (init.method ?? "GET").toUpperCase();
      if ((method === "GET" || method === "HEAD") && (await ensureApiAwake())) res = await send();
    } else {
      markApiAlive();
    }
    return res;
  } catch {
    markApiMaybeAsleep();
    throw new ApiError({
      type: "urn:payani:problem:network",
      code: "network",
      title: "Can't reach PAYANI. Check your connection and try again.",
      status: 0,
    });
  }
}

/** Exchange the refresh cookie for a new access token. Concurrent callers share one call. */
export function refreshSession(): Promise<TokenResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await rawRequest("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken() },
      });
      // The server being unreachable is not the same as having no session: keep the
      // token and let the caller decide, rather than silently signing the person out.
      if (isUnavailableStatus(res.status)) throw new ApiError(unavailableProblem(res.status));
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const data = (await res.json()) as TokenResponse;
      setAccessToken(data.access_token);
      return data;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init);
  if (res.status === 401 && accessToken && !path.startsWith("/api/v1/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawRequest(path, init);
  }
  return parse<T>(res);
}

/** Mutating call with an Idempotency-Key, so a retried click can never double-book or double-pay. */
export function post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Authenticated file download (calendar export). */
export async function download(path: string, filename: string) {
  const res = await rawRequest(path);
  if (!res.ok) throw new ApiError({ type: "urn:payani:problem:download", code: "download", title: "Download failed", status: res.status });
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const authApi = {
  login: (email: string, password: string) =>
    api<TokenResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, display_name: string) =>
    api<TokenResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),
  logout: () =>
    api<void>("/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken() } }),
  me: () => api<User>("/api/v1/me"),
};
