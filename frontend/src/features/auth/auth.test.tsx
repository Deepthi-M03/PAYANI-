import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthContext";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { loginSchema, registerSchema } from "./schemas";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const user = {
  id: "0193-u",
  email: "priya@example.com",
  display_name: "Priya",
  locale: "en",
  timezone: "Asia/Kolkata",
  email_verified: false,
  roles: ["passenger"],
  permissions: ["profile.read_own"],
  created_at: "2026-11-26T10:00:00Z",
};

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/app", element: <p>Dashboard reached</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("auth schemas", () => {
  it("mirror the API password rule (12 to 128 characters)", () => {
    expect(registerSchema.safeParse({ display_name: "A", email: "a@example.com", password: "x".repeat(11) }).success).toBe(false);
    expect(registerSchema.safeParse({ display_name: "A", email: "a@example.com", password: "x".repeat(12) }).success).toBe(true);
    expect(registerSchema.safeParse({ display_name: "A", email: "a@example.com", password: "x".repeat(129) }).success).toBe(false);
  });

  it("rejects malformed email", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("LoginPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return json(401, { title: "Session ended", status: 401, code: "session-expired" });
      if (url.endsWith("/auth/login")) {
        return json(200, { access_token: "t", token_type: "bearer", expires_in: 900, user });
      }
      return json(404, { title: "Not found", status: 404, code: "not-found" });
    });
  });

  it("shows field errors without calling the API when the form is empty", async () => {
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    const loginCalls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).endsWith("/auth/login"));
    expect(loginCalls).toHaveLength(0);
  });

  it("signs in and goes to the dashboard", async () => {
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "priya@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Dashboard reached")).toBeInTheDocument();
  });

  it("shows the API's message on wrong credentials", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).endsWith("/auth/login")
        ? json(401, { title: "Email or password is incorrect.", status: 401, code: "invalid-credentials" })
        : json(401, { title: "Session ended", status: 401, code: "session-expired" }),
    );
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "priya@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });
});

describe("RegisterPage", () => {
  it("puts server field errors next to the right input", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/auth/register")
        ? json(422, {
            title: "Some fields need attention.",
            status: 422,
            code: "validation-error",
            errors: [{ field: "password", message: "Password is too repetitive." }],
          })
        : json(401, { title: "Session ended", status: 401, code: "session-expired" }),
    );
    renderAt("/register");
    await userEvent.type(await screen.findByLabelText("Your name"), "Priya");
    await userEvent.type(screen.getByLabelText("Email"), "priya@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "aaaaaaaaaaaa");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password is too repetitive.")).toBeInTheDocument();
  });
});
