"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/__tests__/custom-headers.test.ts — validation, merge, secrets, redirect strip
const vitest_1 = require("vitest");
const custom_headers_js_1 = require("../custom-headers.js");
(0, vitest_1.describe)("normalizeCustomHeaders", () => {
    (0, vitest_1.it)("accepts an object map", () => {
        (0, vitest_1.expect)((0, custom_headers_js_1.normalizeCustomHeaders)({ "User-Agent": "probe/1.0", "X-Tenant": "acme" })).toEqual({
            "User-Agent": "probe/1.0",
            "X-Tenant": "acme",
        });
    });
    (0, vitest_1.it)("accepts name/value rows and skips fully empty rows", () => {
        (0, vitest_1.expect)((0, custom_headers_js_1.normalizeCustomHeaders)([
            { name: "User-Agent", value: "Probe Client/1.0" },
            { name: "", value: "" },
            { name: "X-Test", value: "1" },
        ])).toEqual({ "User-Agent": "Probe Client/1.0", "X-Test": "1" });
    });
    (0, vitest_1.it)("rejects partial rows", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)([{ name: "X-Only", value: undefined }])).toThrow(custom_headers_js_1.CustomHeadersError);
    });
    (0, vitest_1.it)("rejects invalid header names", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "X Bad Name": "1" })).toThrow(/Invalid additional header name/);
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "x\ninject": "1" })).toThrow(/Invalid additional header name/);
    });
    (0, vitest_1.it)("rejects too-long values", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "X-Big": "a".repeat(custom_headers_js_1.MAX_CUSTOM_HEADER_VALUE_LENGTH + 1) })).toThrow(/value is too long/);
    });
    (0, vitest_1.it)("rejects control characters in values", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "X-Evil": "a\u0000b" })).toThrow(/invalid control characters/);
    });
    (0, vitest_1.it)("rejects blocked and proxy-prefixed headers", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ Authorization: "Bearer attacker" })).toThrow(/is not allowed/);
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ Host: "evil.example" })).toThrow(/is not allowed/);
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "Proxy-Authorization": "x" })).toThrow(/is not allowed/);
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "Proxy-Custom": "x" })).toThrow(/is not allowed/);
    });
    (0, vitest_1.it)("rejects case-insensitive duplicates", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)({ "X-A": "1", "x-a": "2" })).toThrow(/Duplicate additional header/);
    });
    (0, vitest_1.it)("enforces the entry cap", () => {
        const big = Object.fromEntries(Array.from({ length: custom_headers_js_1.MAX_CUSTOM_HEADERS + 1 }, (_, i) => [`X-H${i}`, `v${i}`]));
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)(big)).toThrow(/cannot exceed/);
    });
    (0, vitest_1.it)("rejects non-object input", () => {
        (0, vitest_1.expect)(() => (0, custom_headers_js_1.normalizeCustomHeaders)("nope")).toThrow(/must be an object or list/);
    });
    (0, vitest_1.it)("returns empty map for null/undefined", () => {
        (0, vitest_1.expect)((0, custom_headers_js_1.normalizeCustomHeaders)(undefined)).toEqual({});
        (0, vitest_1.expect)((0, custom_headers_js_1.normalizeCustomHeaders)(null)).toEqual({});
    });
});
(0, vitest_1.describe)("customHeaderSecrets", () => {
    (0, vitest_1.it)("extracts values from both shapes", () => {
        (0, vitest_1.expect)((0, custom_headers_js_1.customHeaderSecrets)({ "X-A": "secret-a", "X-Empty": "" })).toEqual(["secret-a"]);
        (0, vitest_1.expect)((0, custom_headers_js_1.customHeaderSecrets)([{ name: "X-B", value: "secret-b" }])).toEqual(["secret-b"]);
        (0, vitest_1.expect)((0, custom_headers_js_1.customHeaderSecrets)(undefined)).toEqual([]);
    });
});
(0, vitest_1.describe)("mergeCustomHeaders", () => {
    (0, vitest_1.it)("never overrides existing keys regardless of case", () => {
        const target = { Authorization: "Bearer real", "Content-Type": "application/json" };
        (0, custom_headers_js_1.mergeCustomHeaders)(target, { authorization: "Bearer evil", "content-type": "text/plain", "X-New": "yes" });
        (0, vitest_1.expect)(target.Authorization).toBe("Bearer real");
        (0, vitest_1.expect)(target["Content-Type"]).toBe("application/json");
        (0, vitest_1.expect)(target["X-New"]).toBe("yes");
    });
});
//# sourceMappingURL=custom-headers.test.js.map