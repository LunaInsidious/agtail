import { test, expect } from "@playwright/test";

test("loads the SPA and lists sessions from the server", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".brand")).toContainText("agtail");
  await expect(page.locator(".sess").first()).toBeVisible();
});

test("a text search returns results that actually match the query", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();

  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await expect(page.locator(".listhead")).toContainText("Results");
  // not just "some hit" — the snippet must contain the searched term, proving it
  // actually filtered rather than listing everything.
  await expect(page.locator(".hit .snippet").first()).toContainText("blogsync");
});
