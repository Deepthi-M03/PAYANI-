import { expect, test } from "@playwright/test";

const password = "a-long-test-password-2026";

test("register, reach the dashboard, survive a reload, sign out", async ({ page }) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Plan, compare and book/ })).toBeVisible();
  await page.getByRole("link", { name: "Create account", exact: true }).click();

  await page.getByLabel("Your name").fill("E2E Traveller");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Hello, E2E Traveller" })).toBeVisible();
  await expect(page.getByText("Simulated", { exact: true })).toBeVisible();

  // The access token is memory-only; a reload must restore the session via the refresh cookie.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hello, E2E Traveller" })).toBeVisible();

  // Passengers do not see the admin area, and direct navigation bounces back.
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto("/app/admin/users");
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");
});

test("keyboard users can skip to main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
});
