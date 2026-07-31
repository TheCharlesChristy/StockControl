import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The demo journey from requirements section 9 and the acceptance list from
 * section 11, run against the real API and a seeded database. This is also the
 * script to follow when demonstrating the application: sign in, find stock,
 * commit it to a job, hand part of it over, and account for every change.
 *
 * Tests that move stock create their own item first. They run in parallel
 * against one database, so nothing here may depend on a figure another test
 * could be changing at the same moment.
 */

const OFFICE = { email: "office.desk@example.com", password: "demo-password" };
const ENGINEER = { email: "engineer.one@example.com", password: "demo-password" };

interface Credentials {
  readonly email: string;
  readonly password: string;
}

async function signIn(page: Page, who: Credentials): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"));
}

/** The display name of whoever is signed in, as the shell shows it. */
async function signedInName(page: Page): Promise<string> {
  return (
    await page.getByRole("group", { name: "Signed in as" }).locator("p").first().innerText()
  ).trim();
}

/** The figure shown on a labelled statistic tile, e.g. "40 each". */
function stat(page: Page, label: string): Locator {
  return page.getByRole("group", { name: label, exact: true }).getByRole("paragraph");
}

/**
 * Creates a catalogue item and opens it, returning the reference the server
 * allocated. The name is unique per test so the search below cannot match
 * another test's item.
 */
async function createItemAndOpen(page: Page, name: string): Promise<string> {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "New item" }).click();

  /*
   * By accessible name, not by label text: a required MUI field renders its
   * asterisk inside the <label>, so the label text is "Name *".
   */
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Unit", exact: true }).fill("each");
  await dialog.getByRole("button", { name: "Create item" }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel("Search inventory").fill(name);

  const row = page.getByRole("table", { name: "Inventory" }).locator("tbody tr").first();
  await expect(row).toContainText(name);

  const link = row.getByRole("link").first();
  const reference = (await link.innerText()).trim();

  await link.click();
  await page.waitForURL(/\/inventory\/[0-9a-f-]+$/);

  return reference;
}

/** Runs one of the four direct operations from the item detail page. */
async function runOperation(
  page: Page,
  operation: { readonly open: string; readonly submit: string },
  fill: (dialog: Locator) => Promise<void>,
): Promise<void> {
  await page.getByRole("button", { name: operation.open, exact: true }).click();

  const dialog = page.getByRole("dialog");
  await fill(dialog);
  await dialog.getByRole("button", { name: operation.submit, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function chooseOption(page: Page, dialog: Locator, label: string): Promise<void> {
  await dialog.getByRole("combobox", { name: label }).click();
  await page.getByRole("option").first().click();
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

/*
 * Acceptance items 3, 4 and 8, and the journey named in requirements section 9.
 * Every figure is asserted rather than the operation merely being clicked,
 * because the point of the demo is that the numbers stay honest.
 */
test("the demo journey: create, receive, reserve, collect, and account for it", async ({
  page,
}) => {
  /* Six screens and five round trips to the database; the default budget is tight. */
  test.slow();

  const name = `D9 journey bracket ${Date.now()}`;

  await signIn(page, OFFICE);
  const reference = await createItemAndOpen(page, name);
  const itemUrl = page.url();

  await expect(page.getByText("No stock is held anywhere for this item yet.")).toBeVisible();
  await expect(stat(page, "On hand")).toHaveText("0 each");

  /* Receive 40 into a store: on hand and available both become 40. */
  await runOperation(page, { open: "Receive", submit: "Receive" }, async (dialog) => {
    await chooseOption(page, dialog, "Location");
    await dialog.getByLabel("Quantity").fill("40");
  });

  await expect(stat(page, "On hand")).toHaveText("40 each");
  await expect(stat(page, "In stores")).toHaveText("40");
  await expect(stat(page, "Available")).toHaveText("40");

  /* Reserve 15 against a job: availability drops, on hand does not move. */
  await page.goto("/jobs");
  await page.getByRole("table", { name: "Jobs" }).getByRole("link").first().click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);
  const jobUrl = page.url();

  await page.getByRole("button", { name: "Reserve stock" }).click();
  const reserveDialog = page.getByRole("dialog");
  await reserveDialog.getByLabel("Item").fill(reference);
  await page.getByRole("option").first().click();
  await reserveDialog.getByLabel("Quantity").fill("15");
  await reserveDialog.getByRole("button", { name: "Reserve", exact: true }).click();
  await expect(reserveDialog).toBeHidden();

  const reservationRow = page
    .getByRole("table", { name: "Reservations" })
    .locator("tbody tr")
    .filter({ hasText: reference });
  await expect(reservationRow).toContainText("Open");

  await page.goto(itemUrl);
  await expect(stat(page, "On hand")).toHaveText("40 each");
  await expect(stat(page, "Reserved")).toHaveText("15");
  await expect(stat(page, "Available")).toHaveText("25");

  /* Collect 6 of the 15: the remaining 9 stays reserved. */
  await page.goto(jobUrl);
  await reservationRow.getByRole("button", { name: "Collect" }).click();

  const collectDialog = page.getByRole("dialog");
  await chooseOption(page, collectDialog, "Collect from");
  await collectDialog.getByLabel("Quantity").fill("6");
  await collectDialog.getByRole("button", { name: "Collect", exact: true }).click();
  await expect(collectDialog).toBeHidden();

  /* Reserved, collected, outstanding — and still open on the remainder. */
  await expect(reservationRow.locator("td").nth(1)).toHaveText("15");
  await expect(reservationRow.locator("td").nth(2)).toHaveText("6");
  await expect(reservationRow.locator("td").nth(3)).toHaveText("9");
  await expect(reservationRow).toContainText("Open");
  await expect(
    page.getByRole("table", { name: "Stock at the job site" }).filter({ hasText: reference }),
  ).toBeVisible();

  /*
   * Collecting moved stock to the job site without changing the total, and
   * availability is unchanged because the 6 left the stores and the
   * reservation shrank by the same amount.
   */
  await page.goto(itemUrl);
  await expect(stat(page, "On hand")).toHaveText("40 each");
  await expect(stat(page, "In stores")).toHaveText("34");
  await expect(stat(page, "At job sites")).toHaveText("6");
  await expect(stat(page, "Reserved")).toHaveText("9");
  await expect(stat(page, "Available")).toHaveText("25");

  /* Every one of those changes is in the log, against the person who made it. */
  const actor = await signedInName(page);

  await page.getByRole("link", { name: "See the full log" }).click();
  await page.waitForURL(/\/transactions\?itemId=/);

  const log = page.getByRole("table", { name: "Transaction log" });
  await expect(log.locator("tbody tr")).toHaveCount(3);
  await expect(log).toContainText("Receive");
  await expect(log).toContainText("Reserve");
  await expect(log).toContainText("Collect");

  for (const row of await log.locator("tbody tr").all()) {
    await expect(row).toContainText(actor);
  }
});

/* Acceptance item 6. */
test("transferring keeps the total, and an adjustment records its reason", async ({ page }) => {
  const name = `D9 transfer conduit ${Date.now()}`;

  await signIn(page, OFFICE);
  await createItemAndOpen(page, name);

  await runOperation(page, { open: "Receive", submit: "Receive" }, async (dialog) => {
    await chooseOption(page, dialog, "Location");
    await dialog.getByLabel("Quantity").fill("40");
  });

  await runOperation(page, { open: "Transfer", submit: "Transfer" }, async (dialog) => {
    await chooseOption(page, dialog, "From location");
    await chooseOption(page, dialog, "To location");
    await dialog.getByLabel("Quantity").fill("10");
  });

  /* Two locations now, and not one unit more or less than before. */
  await expect(stat(page, "On hand")).toHaveText("40 each");
  await expect(
    page.getByRole("table", { name: "Stock by location" }).locator("tbody tr"),
  ).toHaveCount(2);

  await runOperation(page, { open: "Adjust", submit: "Post adjustment" }, async (dialog) => {
    await chooseOption(page, dialog, "Location");
    await dialog.getByLabel("Counted quantity").fill("25");
    await dialog.getByLabel("Reason").fill("Cycle count during the demo");
  });

  await expect(stat(page, "On hand")).toHaveText("35 each");
  await expect(
    page
      .getByRole("table", { name: "Recent transactions" })
      .locator("tbody tr")
      .filter({ hasText: "Adjust" }),
  ).toContainText("Cycle count during the demo");
});

/* Acceptance item 5, first half. */
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

/* Acceptance item 5, second half. */
test("an over-issue is refused with what is actually on the shelf", async ({ page }) => {
  const name = `D9 over-issue gland ${Date.now()}`;

  await signIn(page, OFFICE);
  await createItemAndOpen(page, name);

  await runOperation(page, { open: "Receive", submit: "Receive" }, async (dialog) => {
    await chooseOption(page, dialog, "Location");
    await dialog.getByLabel("Quantity").fill("12");
  });

  await page.getByRole("button", { name: "Issue", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await chooseOption(page, dialog, "Location");
  await dialog.getByLabel("Quantity").fill("40");
  await dialog.getByRole("button", { name: "Issue", exact: true }).click();

  await expect(dialog.getByRole("alert")).toContainText("Cannot issue 40");
  await expect(dialog.getByRole("alert")).toContainText("12");

  /* Refused means refused: nothing was taken. */
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(stat(page, "On hand")).toHaveText("12 each");
});

/* Acceptance items 2 and 7: a phone-sized visitor scanning a label cold. */
test("a scanned item opens after signing in, on a phone", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OFFICE);
  await page.goto("/inventory");
  await page.getByRole("table", { name: "Inventory" }).getByRole("link").first().click();
  await page.waitForURL(/\/inventory\/[0-9a-f-]+$/);

  const itemUrl = page.url();
  await expect(page.getByRole("img", { name: /QR code linking to/ })).toBeVisible();

  /* The QR code encodes this page's own address, so that is what a camera opens. */
  await context.clearCookies();
  await page.goto(itemUrl);
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel("Work email").fill(ENGINEER.email);
  await page.getByLabel("Password", { exact: true }).fill(ENGINEER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(itemUrl);
  await expect(page.getByRole("img", { name: /QR code linking to/ })).toBeVisible();

  /* An Engineer who arrives by camera still only gets an Engineer's controls. */
  await expect(page.getByRole("button", { name: "Issue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Receive" })).toHaveCount(0);
});

/* Acceptance item 2. */
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

/* Acceptance item 2: the same URL, two roles, two outcomes. */
test("the user screen is reachable by an Admin and refused to an Office user", async ({ page }) => {
  await signIn(page, OFFICE);
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await signIn(page, { email: "admin.owner@example.com", password: "demo-password" });
  await page.goto("/team");
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
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

  /* The filter takes the reference people read off a label, not an internal id. */
  await page.getByLabel("Item", { exact: true }).fill("ITM-0001");
  await expect(log.locator("tbody tr").first()).toBeVisible();
  await expect(log.locator("tbody tr").first()).toContainText(/Receive|Issue|Transfer|Collect/);
});

async function noSidewaysScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test("the inventory table stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OFFICE);
  await page.goto("/inventory");
  await expect(page.getByRole("table", { name: "Inventory" })).toBeVisible();

  expect(await noSidewaysScroll(page), "the page itself must not scroll sideways").toBe(false);
  await expect(page.getByRole("columnheader", { name: "Available" })).toBeVisible();
});

/*
 * Every screen with a wide table is a candidate for the page itself scrolling
 * sideways rather than the table alone. Checked on the item and job detail
 * pages specifically because they carry the widest tables in the application
 * (seven columns of transaction detail, and reservations with an actions
 * column).
 */
test("item detail and job detail stay usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, OFFICE);

  await page.goto("/inventory");
  await page.getByRole("table", { name: "Inventory" }).getByRole("link").first().click();
  await page.waitForURL(/\/inventory\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await noSidewaysScroll(page), "item detail must not scroll sideways").toBe(false);

  await page.goto("/jobs");
  await page.getByRole("table", { name: "Jobs" }).getByRole("link").first().click();
  await page.waitForURL(/\/jobs\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await noSidewaysScroll(page), "job detail must not scroll sideways").toBe(false);
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
