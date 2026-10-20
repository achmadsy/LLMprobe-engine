// src/custom-headers.ts — Shared validation for user-supplied additional headers
// Mirrors the 9Router probe validator so both ends reject the same inputs.
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/u;

export const MAX_CUSTOM_HEADERS = 16;
export const MAX_CUSTOM_HEADER_NAME_LENGTH = 128;
export const MAX_CUSTOM_HEADER_VALUE_LENGTH = 2048;
export const MAX_CUSTOM_HEADERS_BYTES = 8192;

class CustomHeadersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomHeadersError";
  }
}

export { CustomHeadersError };

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

type RawEntry = { name: unknown; value: unknown };

function entriesFrom(value: unknown): RawEntry[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => ({
      name: (entry as RawEntry | null | undefined)?.name,
      value: (entry as RawEntry | null | undefined)?.value,
    }));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([name, v]) => ({ name, value: v }));
  }
  throw new CustomHeadersError("Additional headers must be an object or list of name/value rows");
}

/**
 * Validates and normalizes user-supplied additional headers into an object map.
 * Accepts either `Record<string,string>` or an array of `{name, value}` rows.
 * Empty rows (name & value both empty) are ignored; partial rows are rejected.
 * Throws CustomHeadersError on any invalid input.
 */
export function normalizeCustomHeaders(value: unknown): Record<string, string> {
  const entries = entriesFrom(value);
  if (entries.length > MAX_CUSTOM_HEADERS) {
    throw new CustomHeadersError(`Additional headers cannot exceed ${MAX_CUSTOM_HEADERS} entries`);
  }

  const normalized: Record<string, string> = {};
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const { name: rawName, value: rawValue } of entries) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const headerValue = typeof rawValue === "string" ? rawValue : "";
    if (!name && !headerValue) continue;
    if (!name || typeof rawValue !== "string") {
      throw new CustomHeadersError("Each additional header requires a name and value");
    }
    if (name.length > MAX_CUSTOM_HEADER_NAME_LENGTH || !HEADER_NAME_PATTERN.test(name)) {
      throw new CustomHeadersError(
        `Invalid additional header name: ${name.slice(0, MAX_CUSTOM_HEADER_NAME_LENGTH) || "(empty)"}`,
      );
    }
    if (headerValue.length > MAX_CUSTOM_HEADER_VALUE_LENGTH) {
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
    if (totalBytes > MAX_CUSTOM_HEADERS_BYTES) {
      throw new CustomHeadersError(`Additional headers cannot exceed ${MAX_CUSTOM_HEADERS_BYTES} bytes`);
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
export function customHeaderSecrets(extra: unknown): string[] {
  if (!extra || typeof extra !== "object") return [];
  const values: string[] = [];
  if (Array.isArray(extra)) {
    for (const entry of extra) {
      const v = (entry as { value?: unknown } | null | undefined)?.value;
      if (typeof v === "string" && v.length > 0) values.push(v);
    }
    return values;
  }
  for (const v of Object.values(extra as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) values.push(v);
  }
  return values;
}

/**
 * Merges additional headers into a headers object where they apply.
 * Never overrides keys already present (Authorization from apiKey, required
 * Content-Type, probe-injected extras like anthropic-beta always win).
 */
export function mergeCustomHeaders(
  target: Record<string, string>,
  extra: Record<string, string> | undefined,
): void {
  if (!extra || typeof extra !== "object") return;
  for (const [name, value] of Object.entries(extra)) {
    const existing = Object.keys(target).find((k) => k.toLowerCase() === name.toLowerCase());
    if (existing === undefined) {
      target[name] = value;
    }
  }
}
