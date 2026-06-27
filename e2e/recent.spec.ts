import { test, expect } from "@playwright/test";

test("recent searches are recorded, suggested, and keyboard-selectable", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  const input = page.locator(".searchbox input[type=search]");

  await input.fill("blogsync");
  await page.keyboard.press("Enter"); // records to recent (persisted in localStorage)
  await input.fill("");
  await input.click(); // focus the empty box → suggestions
  await expect(page.locator(".recent")).toBeVisible();
  await expect(page.locator(".recentitem")).toContainText("blogsync");

  // ↓ highlights, Enter accepts
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".recentitem.active")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("blogsync");
});

test("Escape closes the suggestions without clearing the typed query", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  const input = page.locator(".searchbox input[type=search]");

  await input.fill("blog"); // opens suggestions
  await page.keyboard.press("Escape");
  await expect(page.locator(".recent")).toHaveCount(0);
  await expect(input).toHaveValue("blog"); // not cleared by type=search's native Esc
});
