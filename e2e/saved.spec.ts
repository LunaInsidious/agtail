import { test, expect, type Page } from "@playwright/test";

// The "★ Saved" header button (vs the "⊕ Filters" one).
const savedButton = (page: Page) => page.locator("button.addfilter", { hasText: "★" });

async function saveCurrentAs(page: Page) {
  await savedButton(page).click();
  await page.locator(".savecur").click(); // opens the inline name field (pre-filled)
  await page.locator(".nameinput").press("Enter"); // accept the auto-name
}

test("save a search, recall it, and the button reflects the active match", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  const input = page.locator(".searchbox input[type=search]");

  await input.fill("blogsync");
  await page.keyboard.press("Escape"); // close the recent dropdown, keep the query
  await saveCurrentAs(page);

  // active filters now match the saved search → button highlights its name
  await expect(savedButton(page)).toHaveClass(/has/);

  // change the conditions → no longer matches → reverts
  await input.fill("");
  await expect(savedButton(page)).not.toHaveClass(/has/);

  // recall from the menu restores the whole condition set (here: the query)
  await savedButton(page).click();
  await page.locator(".savedapply").first().click();
  await expect(input).toHaveValue("blogsync");
});

test("the save-name flow can be cancelled", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await page.keyboard.press("Escape");

  await savedButton(page).click();
  await page.locator(".savecur").click(); // open the inline name field
  await expect(page.locator(".naming .nameinput")).toBeVisible();
  await page.locator(".naming").getByRole("button", { name: "Cancel" }).click();
  // Back to the "Save current search" button; nothing was saved.
  await expect(page.locator(".naming")).toHaveCount(0);
  await expect(page.locator(".savecur")).toBeVisible();
  await expect(page.locator(".savedapply")).toHaveCount(0);
});

test("identical conditions can't be saved twice", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await page.keyboard.press("Escape");
  await saveCurrentAs(page);

  // reopen — the same conditions are active, so saving is disabled
  await savedButton(page).click();
  await expect(page.locator(".savecur")).toBeDisabled();
});

test("manage screen is its own URL and Back returns to the session view", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await page.keyboard.press("Escape");
  await saveCurrentAs(page);

  await savedButton(page).click();
  await page.locator(".savemanage").click();
  await expect(page.locator(".screen")).toBeVisible();
  await expect(page).toHaveURL(/\/saved$/);
  await expect(page.locator(".mname")).toHaveValue(/.+/); // the saved row, renamable

  await page.goBack();
  await expect(page.locator(".screen")).toHaveCount(0);
  await expect(page.locator("main .sidebar")).toBeVisible();
});

test("the manage screen reloads at /saved (server SPA fallback)", async ({ page }) => {
  await page.goto("/saved");
  await expect(page.locator(".screen")).toBeVisible();
  await expect(page.locator(".screenempty")).toBeVisible(); // empty-state explains the concept
});

test("saved searches survive a full page reload (localStorage)", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await page.keyboard.press("Escape");
  await saveCurrentAs(page);

  await page.reload();
  await page.locator(".sess").first().waitFor();
  await savedButton(page).click();
  await expect(page.locator(".savedapply")).toHaveCount(1);
});

test("apply from the manage screen restores conditions and leaves /saved", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  const input = page.locator(".searchbox input[type=search]");
  await input.fill("blogsync");
  await page.keyboard.press("Escape");
  await saveCurrentAs(page);

  await input.fill(""); // change conditions so applying is observable
  await savedButton(page).click();
  await page.locator(".savemanage").click();
  await expect(page).toHaveURL(/\/saved$/);

  await page.locator(".mapply").first().click();
  await expect(page.locator(".screen")).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/saved$/); // left the manage URL
  await expect(input).toHaveValue("blogsync"); // the saved conditions are restored
});

test("manage: delete is a guarded two-step action", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await page.keyboard.press("Escape");
  await saveCurrentAs(page);

  await savedButton(page).click();
  await page.locator(".savemanage").click();
  await expect(page.locator(".mrow")).toHaveCount(1);

  // 🗑 → Cancel leaves the row intact
  await page.locator(".mtrash").click();
  await page.locator(".mcancel").click();
  await expect(page.locator(".mrow")).toHaveCount(1);

  // 🗑 → Delete removes it
  await page.locator(".mtrash").click();
  await page.locator(".mdel").click();
  await expect(page.locator(".mrow")).toHaveCount(0);
});
