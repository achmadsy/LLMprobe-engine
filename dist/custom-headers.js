"use strict";
// src/custom-headers.ts — Shared validation for user-supplied additional headers
// Mirrors the 9Router probe validator so both ends reject the same inputs.
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomHeadersError = exports.MAX_CUSTOM_HEADERS_BYTES = exports.MAX_CUSTOM_HEADER_VALUE_LENGTH = exports.MAX_CUSTOM_HEADER_NAME_LENGTH = exports.MAX_CUSTOM_HEADERS = void 0;
exports.normalizeCustomHeaders = normalizeCustomHeaders;
exports.customHeaderSecrets = customHeaderSecrets;
exports.mergeCustomHeaders = mergeCustomHeaders;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/u;
exports.MAX_CUSTOM_HEADERS = 16;
exports.MAX_CUSTOM_HEADER_NAME_LENGTH = 128;
exports.MAX_CUSTOM_HEADER_VALUE_LENGTH = 2048;
exports.MAX_CUSTOM_HEADERS_BYTES = 8192;
class CustomHeadersError extends Error {
    constructor(message) {
        super(message);
        this.name = "CustomHeadersError";
    }
}
exports.CustomHeadersError = CustomHeadersError;
// Headers that would corrupt the proxied request, smuggle_hop, or override
// transport/credentials/sidecar control-plane state.
const BLOCKED_HEADERS = new Set([
    "authorization",
    "connection",
    "content-length",
    "content-type",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);
function entriesFrom(value) {
    if (value == null)
        return [];
    if (Array.isArray(value)) {
        return value.map((entry) => ({
            name: entry?.name,
            value: entry?.value,
        }));
    }
    if (typeof value === "object") {
        return Object.entries(value).map(([name, v]) => ({ name, value: v }));
    }
    throw new CustomHeadersError("Additional headers must be an object or list of name/value rows");
}
/**
 * Validates and normalizes user-supplied additional headers into an object map.
 * Accepts either `Record<string,string>` or an array of `{name, value}` rows.
 * Empty rows (name & value both empty) are ignored; partial rows are rejected.
 * Throws CustomHeadersError on any invalid input.
 */
function normalizeCustomHeaders(value) {
    const entries = entriesFrom(value);
    if (entries.length > exports.MAX_CUSTOM_HEADERS) {
        throw new CustomHeadersError(`Additional headers cannot exceed ${exports.MAX_CUSTOM_HEADERS} entries`);
    }
    const normalized = {};
    const seen = new Set();
    let totalBytes = 0;
    for (const { name: rawName, value: rawValue } of entries) {
        const name = typeof rawName === "string" ? rawName.trim() : "";
        const headerValue = typeof rawValue === "string" ? rawValue : "";
        if (!name && !headerValue)
            continue;
        if (!name || typeof rawValue !== "string") {
            throw new CustomHeadersError("Each additional header requires a name and value");
        }
        if (name.length > exports.MAX_CUSTOM_HEADER_NAME_LENGTH || !HEADER_NAME_PATTERN.test(name)) {
            throw new CustomHeadersError(`Invalid additional header name: ${name.slice(0, exports.MAX_CUSTOM_HEADER_NAME_LENGTH) || "(empty)"}`);
        }
        if (headerValue.length > exports.MAX_CUSTOM_HEADER_VALUE_LENGTH) {
            throw new CustomHeadersError(`Additional header ${name} value is too long`);
        }
        if (CONTROL_CHARS.test(headerValue)) {
            throw new CustomHeadersError(`Additional header ${name} contains invalid control characters`);
        }
        const lowerName = name.toLowerCase();
        if (BLOCKED_HEADERS.has(lowerName) || lowerName.startsWith("proxy-")) {
            throw new CustomHeadersError(`Additional header ${name} is not allowed`);
        }
        if (seen.has(lowerName)) {
            throw new CustomHeadersError(`Duplicate additional header: ${name}`);
        }
        totalBytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(headerValue, "utf8") + 4;
        if (totalBytes > exports.MAX_CUSTOM_HEADERS_BYTES) {
            throw new CustomHeadersError(`Additional headers cannot exceed ${exports.MAX_CUSTOM_HEADERS_BYTES} bytes`);
        }
        seen.add(lowerName);
        normalized[name] = headerValue;
    }
    return normalized;
}
/**
 * Collects the VALUES of additional headers into a redaction secrets array.
 * Only non-empty string values are kept.
 */
function customHeaderSecrets(extra) {
    if (!extra || typeof extra !== "object")
        return [];
    const values = [];
    if (Array.isArray(extra)) {
        for (const entry of extra) {
            const v = entry?.value;
            if (typeof v === "string" && v.length > 0)
                values.push(v);
        }
        return values;
    }
    for (const v of Object.values(extra)) {
        if (typeof v === "string" && v.length > 0)
            values.push(v);
    }
    return values;
}
/**
 * Merges additional headers into a headers object where they apply.
 * Never overrides keys already present (Authorization from apiKey, required
 * Content-Type, probe-injected extras like anthropic-beta always win).
 */
function mergeCustomHeaders(target, extra) {
    if (!extra || typeof extra !== "object")
        return;
    for (const [name, value] of Object.entries(extra)) {
        const existing = Object.keys(target).find((k) => k.toLowerCase() === name.toLowerCase());
        if (existing === undefined) {
            target[name] = value;
        }
    }
}
//# sourceMappingURL=custom-headers.js.map