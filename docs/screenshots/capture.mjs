// Capture documentation screenshots from the fictional sample dataset.
//
// Prereq: a server is running against docs/screenshots/sample with an isolated
// XDG_DATA_HOME (no real imports) and AGTAIL_PLUGINS_DIR=test/fixtures/plugins
// (so plugin chips resolve). See docs/screenshots/README.md for the one-liner.
//
//   node docs/screenshots/capture.mjs [baseURL]
//
// Writes PNGs into docs/public/screenshots/.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = process.argv[2] || "http://127.0.0.1:4787";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "screenshots");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1360, height: 880 }, deviceScaleFactor: 2 });

const shot = (name) => page.screenshot({ path: join(outDir, name) });
const settle = () => page.waitForTimeout(450);

await page.goto(base);
await page.waitForSelector(".sess");
await settle();
await shot("overview.png");

// Filters popover — tool / model / project checklists + the rest.
await page.locator("button", { hasText: "Filters" }).first().click();
await page.waitForSelector(".filterpop");
await settle();
await shot("filters.png");
await page.keyboard.press("Escape").catch(() => {});

// Timeline of the rate-limiting session (tool calls + cost badges + subagent).
await page.locator(".sess", { hasText: "rate limiting" }).first().click();
await page.waitForSelector(".timeline, .session");
await settle();
await shot("timeline.png");

// Hooks: the auth-hardening session surfaces hook events with a plugin chip.
await page.locator(".sess", { hasText: "Harden the auth middleware" }).first().click();
await settle();
await shot("hooks.png");

// Cross-session search result (hits list).
await page
  .locator(".sess")
  .first()
  .click()
  .catch(() => {});
const search = page.locator('input[placeholder="Search across all sessions…"]');
await search.click();
await search.fill("rate");
await page.waitForTimeout(700);
await shot("search.png");

await browser.close();
console.log("screenshots written to", outDir);
