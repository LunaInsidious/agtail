import { test, expect } from "@playwright/test";

test("filter popover toggles a condition into a removable chip", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();

  await page.locator("button.addfilter", { hasText: "Filters" }).click();
  await expect(page.locator(".filterpop")).toBeVisible();

  // toggle the "archived" status checkbox
  await page.locator(".filterpop label", { hasText: "archived" }).locator("input").check();
  await page.locator(".brand").click(); // close the popover

  // an applied-filter chip appears and the list switches to Results
  await expect(page.locator(".fchip", { hasText: "archived" })).toBeVisible();
  await expect(page.locator(".listhead")).toContainText("Results");

  // remove it via the chip ✕ → back to the browse list
  await page.locator(".fchip", { hasText: "archived" }).locator("button.x").click();
  await expect(page.locator(".fchip", { hasText: "archived" })).toHaveCount(0);
  await expect(page.locator(".listhead")).toContainText("Sessions");
});
