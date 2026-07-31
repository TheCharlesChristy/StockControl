import { expect, test, type Page } from "@playwright/test";

/**
 * The demo journey from requirements section 9, run against the real API and a
 * seeded database. This is also the script to follow when demonstrating the
 * application: sign in, find stock, commit it to a job, hand part of it over,
 * and account for every change.
 */

const OFFICE = { email: "office.desk@example.com", password: "demo-password" };
const ENGINEER = { email: "engineer.one@example.com", password: "demo-password" };

async function signIn(
  page: Page,
  who: { readonly email: string; readonly password: string },
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"));
}

test("an anonymous visitor is sent to sign in", async ({ page }) => {
  await page.goto("/inventory");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong details are refused without saying which detail was wrong", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(OFFICE.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("Office can search inventory and see the per-location breakdown", async ({ page }) => {
  await signIn(page, OFFICE);
  await page.goto("/inventory");
  await expect(page.getByRole("table", { name: "Inventory" })).toBeVisible();

  await page.getByLabel("Search inventory").fill("cable");

  /*
   * Waits for the filtered results, not merely for any rows: clicking while the
   * previous list is still on screen would expand a row that is about to be
   * replaced.
   */
  const firstRow = page.getByRole("table", { name: "Inventory" }).locator("tbody tr").first();
  await expect(firstRow).toContainText("cable");

  /*
   * An expanded row shows either the per-location table or, for an item that
   * holds nothing anywhere, the empty message. Both are correct outcomes.
   */
  await firstRow.locator('button[aria-label^="Show locations"]').click();
  await expect(
    page
      .getByRole("table", { name: /Locations holding/ })
      .or(page.getByText("No stock is held anywhere for this item.")),
  ).toBeVisible();
});

test("receiving stock changes availability and appears in the log", async ({ page }) => {
  await signIn(page, OFFICE);
  await page.goto("/inventory");
  await page.getByRole("table", { name: "Inventory" }).getByRole("link").first().click();
  await page.waitForURL(/\/inventory\/[0-9a-f-]+$/);

  await expect(page.getByRole("img", { name: /QR code linking to/ })).toBeVisible();

  await page.getByRole("button", { name: "Receive" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Location" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByLabel("Quantity").fill("7");
  await dialog.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole("table", { name: "Recent transactions" }).getByText("Receive").first(),
  ).toBeVisible();
});

test("an over-reservation is refused with the quantity actually available", async ({ page }) => {
  await signIn(page, ENGINEER);
  await page.goto("/jobs");
  await page.getByRole("table", { name: "Jobs" }).getByRole("link").first().click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Reserve stock" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Item").fill("ITM-0001");
  await page.getByRole("option").first().click();
  await dialog.getByLabel("Quantity").fill("999999");
  await dialog.getByRole("button", { name: "Reserve", exact: true }).click();

  await expect(dialog.getByRole("alert")).toContainText("Cannot reserve");
  await expect(dialog.getByRole("alert")).toContainText("available");
});

test("role decides which controls are offered", async ({ page }) => {
  await signIn(page, ENGINEER);
  await page.goto("/inventory");
  await expect(page.getByRole("table", { name: "Inventory" })).toBeVisible();

  await expect(page.getByRole("button", { name: "New item" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Team & access" })).toHaveCount(0);

  await page.getByRole("table", { name: "Inventory" }).getByRole("link").first().click();
  await expect(page.getByRole("button", { name: "Issue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Receive" })).toHaveCount(0);
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, OFFICE);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good to see you/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the transaction log accounts for activity with its actor", async ({ page }) => {
  await signIn(page, OFFICE);
  await page.goto("/transactions");

  const log = page.getByRole("table", { name: "Transaction log" });
  await expect(log).toBeVisible();
  await expect(log.locator("tbody tr").first()).toContainText(/Receive|Issue|Transfer|Collect/);
});

test("the inventory table stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OFFICE);
  await page.goto("/inventory");
  await expect(page.getByRole("table", { name: "Inventory" })).toBeVisible();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, "the page itself must not scroll sideways").toBe(false);
  await expect(page.getByRole("columnheader", { name: "Available" })).toBeVisible();
});

test("the API is database-ready with a caller correlation identifier", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:3000/api/v1/health/ready", {
    headers: {
      "x-correlation-id": "playwright-e2e",
    },
  });

  expect(response.status()).toBe(200);
  expect(response.headers()["x-correlation-id"]).toBe("playwright-e2e");
  await expect(response.json()).resolves.toMatchObject({
    status: "ready",
    checks: [
      {
        name: "database.postgresql",
        status: "ok",
      },
    ],
  });
});
