import { test, expect } from "@playwright/test";

// Export lives on the list header (beside the count) and exports "what you see";
// import lives in the app header. BOTH confirm before acting — export never
// downloads and import never writes on a single stray click.

test("the export label tracks the filter (all ↔ results)", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  const exportBtn = page.locator(".exp .lhbtn");
  await expect(exportBtn).toContainText("Export all");

  await page.locator(".searchbox input[type=search]").fill("blogsync");
  await expect(page.locator(".listhead")).toContainText("Results");
  await expect(exportBtn).toContainText("Export results");
  // The confirmation states the filtered scope explicitly.
  await exportBtn.click();
  await expect(page.locator(".exp .syncmsg")).toContainText(/matching the current filter/i);
});

test("export confirms before downloading", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".exp .lhbtn").click();
  const msg = page.locator(".exp .syncmsg");
  await expect(msg).toContainText(/Export all .* sessions/i);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    msg.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toContain("agtail-export");
});

test("export can be cancelled without downloading", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();
  await page.locator(".exp .lhbtn").click();
  await expect(page.locator(".exp .syncmsg")).toBeVisible();
  await page.locator(".exp .syncmsg").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".exp .syncmsg")).toHaveCount(0);
});

const BUNDLE = JSON.stringify({
  agtailExport: 1,
  created: "2026-01-01T00:00:00.000Z",
  files: [{ agent: "codex", rel: "x.jsonl", content: "y" }],
});

test("import shows the destination/conflict options before a file is chosen", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();

  // Opening the header control shows the options first — no file picker yet.
  await page.locator(".imp .addfilter").click();
  const msg = page.locator(".imp .syncmsg");
  await expect(msg.getByRole("radio", { name: /View only in agtail/ })).toBeChecked();
  await expect(msg.getByRole("radio", { name: /Skip it/ })).toBeChecked();
  await expect(msg.getByText("Choose a bundle file…")).toBeVisible();
  // Nothing to import until a file is staged; the source-name field only appears
  // once there's a file to name.
  await expect(msg.getByRole("button", { name: "Import" })).toBeDisabled();
  await expect(msg.locator(".nameinput")).toHaveCount(0);

  await page.locator(".imp input[type=file]").setInputFiles({
    name: "bundle.json",
    mimeType: "application/json",
    buffer: Buffer.from(BUNDLE),
  });
  await expect(msg).toContainText("bundle.json");
  await expect(msg).toContainText("(1 files)");
  await expect(msg.getByRole("button", { name: "Import" })).toBeEnabled();

  // An agtail import gets a source-name field defaulted from the filename; an
  // empty/invalid name blocks the import.
  const nameField = msg.locator(".nameinput");
  await expect(nameField).toHaveValue("bundle");
  await nameField.fill("");
  await expect(msg.getByRole("button", { name: "Import" })).toBeDisabled();
  await nameField.fill("alice-macbook");
  await expect(msg.getByRole("button", { name: "Import" })).toBeEnabled();

  // The staged file can be removed (not just replaced) → back to no file.
  await msg.getByRole("button", { name: "Remove file" }).click();
  await expect(msg).not.toContainText("bundle.json");
  await expect(msg.getByText("Choose a bundle file…")).toBeVisible();
  await expect(msg.getByRole("button", { name: "Import" })).toBeDisabled();

  await msg.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".imp .syncmsg")).toHaveCount(0);
});

test("native + overwrite is gated behind an acknowledgement", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sess").first().waitFor();

  await page.locator(".imp .addfilter").click();
  const msg = page.locator(".imp .syncmsg");

  // Pick the dangerous combo: real dirs + overwrite (options come first).
  await msg.getByRole("radio", { name: /Add to Claude Code/ }).check();
  await msg.getByRole("radio", { name: /Overwrite it/ }).check();
  await expect(msg.locator(".dangerbox")).toBeVisible();

  await page.locator(".imp input[type=file]").setInputFiles({
    name: "bundle.json",
    mimeType: "application/json",
    buffer: Buffer.from(BUNDLE),
  });

  // File staged but still blocked until the overwrite box is acknowledged.
  const overwriteBtn = msg.getByRole("button", { name: "Overwrite" });
  await expect(overwriteBtn).toBeDisabled();
  await msg.getByRole("checkbox", { name: /overwrite my real history/i }).check();
  await expect(overwriteBtn).toBeEnabled();

  // Changing a choice re-arms the guard.
  await msg.getByRole("radio", { name: /Skip it/ }).check();
  await expect(msg.locator(".dangerbox")).toHaveCount(0);

  await msg.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".imp .syncmsg")).toHaveCount(0);
});
