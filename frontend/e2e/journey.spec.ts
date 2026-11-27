import { expect, test } from "@playwright/test";

const password = "a-long-test-password-2026";

test("the landing search hands the query to the search page after sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("From").fill("Chennai");
  await page.getByRole("option", { name: /Chennai Central/ }).click();
  await page.getByLabel("To").fill("Bengaluru");
  await page.getByRole("option", { name: /KSR Bengaluru/ }).click();
  await page.getByRole("button", { name: "Search trains" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("search, book, pay in sandbox, set reminders, cancel and see the refund", async ({ page }) => {
  const email = `journey-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Journey Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("link", { name: "Search", exact: true }).first().click();
  await page.getByLabel("From").fill("Chennai");
  await page.getByRole("option", { name: /Chennai Central/ }).click();
  await page.getByLabel("To").fill("Bengaluru");
  await page.getByRole("option", { name: /KSR Bengaluru/ }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/option/).first()).toBeVisible();
  await expect(page.getByText("Simulated").first()).toBeVisible();

  await page.getByRole("button", { name: "Select" }).first().click();
  await expect(page.getByRole("heading", { name: "Book this journey" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to review" }).click();

  await expect(page.getByText("Awaiting payment")).toBeVisible();
  await page.getByRole("button", { name: /Pay .* \(sandbox\)/ }).click();
  await expect(page.getByText("Confirmed (sandbox)").first()).toBeVisible();
  await expect(page.getByText(/SBX-\d+/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByText("Refund pending").first()).toBeVisible();
});

test("landing page is fully readable with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  for (const name of ["What PAYANI does", "How group booking works", "Every time says where it came from", "Privacy and safety"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("Schematic line, not track geometry.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create a free account|Open dashboard/ })).toBeVisible();
  await context.close();
});
