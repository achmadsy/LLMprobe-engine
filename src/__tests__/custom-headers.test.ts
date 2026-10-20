// src/__tests__/custom-headers.test.ts — validation, merge, secrets, redirect strip
import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_HEADERS,
  MAX_CUSTOM_HEADER_VALUE_LENGTH,
  customHeaderSecrets,
  mergeCustomHeaders,
  normalizeCustomHeaders,
  CustomHeadersError,
} from "../custom-headers.js";

describe("normalizeCustomHeaders", () => {
  it("accepts an object map", () => {
    expect(normalizeCustomHeaders({ "User-Agent": "probe/1.0", "X-Tenant": "acme" })).toEqual({
      "User-Agent": "probe/1.0",
      "X-Tenant": "acme",
    });
  });

  it("accepts name/value rows and skips fully empty rows", () => {
    expect(
      normalizeCustomHeaders([
        { name: "User-Agent", value: "Probe Client/1.0" },
        { name: "", value: "" },
        { name: "X-Test", value: "1" },
      ]),
    ).toEqual({ "User-Agent": "Probe Client/1.0", "X-Test": "1" });
  });

  it("rejects partial rows", () => {
    expect(() => normalizeCustomHeaders([{ name: "X-Only", value: undefined }])).toThrow(CustomHeadersError);
  });

  it("rejects invalid header names", () => {
    expect(() => normalizeCustomHeaders({ "X Bad Name": "1" })).toThrow(/Invalid additional header name/);
    expect(() => normalizeCustomHeaders({ "x\ninject": "1" })).toThrow(/Invalid additional header name/);
  });

  it("rejects too-long values", () => {
    expect(() => normalizeCustomHeaders({ "X-Big": "a".repeat(MAX_CUSTOM_HEADER_VALUE_LENGTH + 1) })).toThrow(
      /value is too long/,
    );
  });

  it("rejects control characters in values", () => {
    expect(() => normalizeCustomHeaders({ "X-Evil": "a\u0000b" })).toThrow(/invalid control characters/);
  });

  it("rejects blocked and proxy-prefixed headers", () => {
    expect(() => normalizeCustomHeaders({ Authorization: "Bearer attacker" })).toThrow(/is not allowed/);
    expect(() => normalizeCustomHeaders({ Host: "evil.example" })).toThrow(/is not allowed/);
    expect(() => normalizeCustomHeaders({ "Proxy-Authorization": "x" })).toThrow(/is not allowed/);
    expect(() => normalizeCustomHeaders({ "Proxy-Custom": "x" })).toThrow(/is not allowed/);
  });

  it("rejects case-insensitive duplicates", () => {
    expect(() => normalizeCustomHeaders({ "X-A": "1", "x-a": "2" })).toThrow(/Duplicate additional header/);
  });

  it("enforces the entry cap", () => {
    const big = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_HEADERS + 1 }, (_, i) => [`X-H${i}`, `v${i}`]),
    );
    expect(() => normalizeCustomHeaders(big)).toThrow(/cannot exceed/);
  });

  it("rejects non-object input", () => {
    expect(() => normalizeCustomHeaders("nope")).toThrow(/must be an object or list/);
  });

  it("returns empty map for null/undefined", () => {
    expect(normalizeCustomHeaders(undefined)).toEqual({});
    expect(normalizeCustomHeaders(null)).toEqual({});
  });
});

describe("customHeaderSecrets", () => {
  it("extracts values from both shapes", () => {
    expect(customHeaderSecrets({ "X-A": "secret-a", "X-Empty": "" })).toEqual(["secret-a"]);
    expect(customHeaderSecrets([{ name: "X-B", value: "secret-b" }])).toEqual(["secret-b"]);
    expect(customHeaderSecrets(undefined)).toEqual([]);
  });
});

describe("mergeCustomHeaders", () => {
  it("never overrides existing keys regardless of case", () => {
    const target: Record<string, string> = { Authorization: "Bearer real", "Content-Type": "application/json" };
    mergeCustomHeaders(target, { authorization: "Bearer evil", "content-type": "text/plain", "X-New": "yes" });
    expect(target.Authorization).toBe("Bearer real");
    expect(target["Content-Type"]).toBe("application/json");
    expect(target["X-New"]).toBe("yes");
  });
});
