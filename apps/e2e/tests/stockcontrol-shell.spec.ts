import { expect, test } from "@playwright/test";

test("an Admin can sign in and enter the responsive application shell", async ({ page }) => {
  await page.goto("/inventory");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await page.getByLabel("Work email").fill("admin.owner@example.com");
  await page.getByLabel("Password", { exact: true }).fill("development-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team & access" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
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
