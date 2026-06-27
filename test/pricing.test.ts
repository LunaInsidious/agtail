import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadPriceResolver, resetPriceCache } from "../src/core/pricing.js";

const priced = { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
const baseSheet = { "gpt-x": priced };

// Per-test scratch: an isolated XDG cache root, so the resolver reads/writes a
// throwaway prices file instead of the developer's real ~/.cache.
const ctx = { root: "", priceFile: "", xdg: process.env.XDG_CACHE_HOME };

// Write the cache file with a given age, so cacheAgeMs() sees it as fresh/stale.
const writeCache = async (sheet: object, ageMs: number): Promise<void> => {
  await mkdir(join(ctx.root, "agtail"), { recursive: true });
  await writeFile(ctx.priceFile, JSON.stringify(sheet));
  const t = new Date(Date.now() - ageMs);
  await utimes(ctx.priceFile, t, t);
};

const fetchReturning = (sheet: object) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(sheet))));

describe("pricing", () => {
  beforeEach(async () => {
    ctx.root = await mkdtemp(join(tmpdir(), "agtail-price-"));
    ctx.priceFile = join(ctx.root, "agtail", "litellm_prices.json");
    process.env.XDG_CACHE_HOME = ctx.root;
    resetPriceCache();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (ctx.xdg === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = ctx.xdg;
    await rm(ctx.root, { recursive: true, force: true });
  });

  test("a known model is priced from a fresh cache without any fetch", async () => {
    await writeCache(baseSheet, 0);
    const fetchMock = fetchReturning(baseSheet);
    vi.stubGlobal("fetch", fetchMock);

    const resolve = await loadPriceResolver(["gpt-x"]);
    expect(resolve("gpt-x")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a model unknown to a stale cache triggers one refetch and is priced if upstream now has it", async () => {
    await writeCache(baseSheet, 2 * 60 * 60 * 1000); // 2h old (> soft-refresh window)
    const fetchMock = fetchReturning({ ...baseSheet, "new-model": priced });
    vi.stubGlobal("fetch", fetchMock);

    const resolve = await loadPriceResolver(["new-model"]);
    expect(resolve("new-model")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("a model upstream still lacks is marked absent in the file and not refetched again", async () => {
    await writeCache(baseSheet, 2 * 60 * 60 * 1000);
    const fetchMock = fetchReturning(baseSheet); // upstream still has no "ghost"
    vi.stubGlobal("fetch", fetchMock);

    const resolve = await loadPriceResolver(["ghost"]);
    expect(resolve("ghost")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();

    // The marker was persisted into the same prices file.
    const onDisk = JSON.parse(await readFile(ctx.priceFile, "utf-8"));
    expect(onDisk).toHaveProperty("ghost");

    // A fresh process (memo cleared) reads the marker from disk and doesn't refetch.
    resetPriceCache();
    const resolve2 = await loadPriceResolver(["ghost"]);
    expect(resolve2("ghost")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce(); // still just the one call
  });
});
