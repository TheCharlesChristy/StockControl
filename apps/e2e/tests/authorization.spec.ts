import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The rules that decide who may do what, exercised in a browser against the
 * real API. The demo journey proves the product works; this proves it says no.
 *
 * Nothing here moves stock or changes an account, so these run safely in
 * parallel with the journey against the same seeded database.
 */

const OFFICE = { email: "office.desk@example.com", password: "demo-password" };
const ENGINEER = { email: "engineer.one@example.com", password: "demo-password" };

interface Credentials {
  readonly email: string;
  readonly password: string;
}

/*
 * Anchored at the start rather than exact: a required MUI field renders its
 * asterisk inside the <label>, so the accessible label is "New password *" and
 * an exact match finds nothing. A plain substring match is no good either —
 * Playwright's is case-insensitive, so "New password" would also match
 * "Confirm new password *" and the two fields would be ambiguous.
 */
function newPassword(page: Page): Locator {
  return page.getByLabel(/^New password/u);
}

async function signIn(page: Page, who: Credentials): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"));
}

test.describe("what a role cannot reach", () => {
  test("an Engineer asking for the team page is refused, not shown an empty one", async ({
    page,
  }) => {
    await signIn(page, ENGINEER);
    await page.goto("/team");

    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add person" })).toBeHidden();
  });

  /*
   * The browser hiding a control is presentation. This is the part that matters:
   * the API refuses the same request when nothing in the browser is enforcing
   * anything.
   */
  test("the API refuses the same request the hidden control would have made", async ({ page }) => {
    await signIn(page, ENGINEER);

    const denied = await page.evaluate(async () => {
      const response = await fetch("/api/v1/users", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return { status: response.status };
    });

    expect(denied.status).toBe(403);
  });

  test("an Engineer cannot reset somebody else's password through the API", async ({ page }) => {
    await signIn(page, ENGINEER);

    const denied = await page.evaluate(async () => {
      const response = await fetch("/api/v1/users/00000000-0000-4000-8000-000000000000/password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ newPassword: "a-much-better-passphrase" }),
      });
      return { status: response.status };
    });

    expect(denied.status).toBe(403);
  });
});

test.describe("signing in", () => {
  test("throttles repeated failures for one account", async ({ page }) => {
    await page.goto("/sign-in");

    /*
     * Through the API rather than the form: the point is the server's limit,
     * and driving the form ten times would mostly be testing the form. The
     * account limit is five in fifteen minutes, so the sixth must be refused.
     * A unique address keeps this from throttling a real demo account.
     */
    const address = `throttle-${String(Date.now())}@example.com`;
    const statuses = await page.evaluate(async (email) => {
      const attempts: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await fetch("/api/v1/auth/sign-in", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email, password: "definitely-not-the-password" }),
        });
        attempts.push(response.status);
      }
      return attempts;
    }, address);

    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses).toContain(429);
  });

  test("says the same thing for an unknown account as for a wrong password", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill("nobody.here@example.com");
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const unknownAccount = await page.getByRole("alert").innerText();

    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(OFFICE.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toHaveText(unknownAccount);
  });
});

test.describe("changing your own password", () => {
  test("requires the current one", async ({ page }) => {
    await signIn(page, OFFICE);
    await page.goto("/change-password");

    await page.getByLabel("Current password").fill("not-the-current-password");
    await newPassword(page).fill("a-much-better-passphrase");
    await page.getByLabel("Confirm new password").fill("a-much-better-passphrase");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByText("That password was not recognised.")).toBeVisible();
    /* Still on the page, and still signed in with the password that works. */
    await expect(page).toHaveURL(/change-password/u);
  });

  test("will not submit while the confirmation disagrees", async ({ page }) => {
    await signIn(page, OFFICE);
    await page.goto("/change-password");

    await page.getByLabel("Current password").fill(OFFICE.password);
    await newPassword(page).fill("a-much-better-passphrase");
    await page.getByLabel("Confirm new password").fill("something-entirely-different");

    await expect(page.getByText("This does not match the new password.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
  });
});

test.describe("responses carry their security headers", () => {
  test("an API response is not sniffable and is not stored", async ({ page }) => {
    await signIn(page, OFFICE);

    const response = await page.request.get("/api/v1/health/live");

    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
  });
});
