import { describe, expect, it } from "vitest";
import { mask, maskValue } from "../src/core/mask.js";
import { isRecord } from "../src/core/utils.js";

describe("mask", () => {
  it("redacts known token shapes", () => {
    expect(mask("token ghp_" + "a".repeat(30))).toContain("<redacted>");
    expect(mask("key sk-" + "b".repeat(30))).toContain("<redacted>");
  });
  it("redacts KEY=value pairs", () => {
    expect(mask('API_KEY="supersecretvalue"')).toBe("API_KEY=<redacted>");
  });
  it("leaves ordinary text untouched", () => {
    expect(mask("just a normal sentence")).toBe("just a normal sentence");
  });
  it("deep-masks nested objects", () => {
    const out = maskValue({ a: "AKIA" + "1234567890123456", b: ["plain"] });
    expect(isRecord(out)).toBe(true);
    if (!isRecord(out)) return;
    expect(out.a).toContain("<redacted>");
    expect(Array.isArray(out.b) ? out.b[0] : undefined).toBe("plain");
  });
});
