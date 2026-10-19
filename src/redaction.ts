// src/redaction.ts — Secret redaction & bounded string utilities
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)

import type { ProbeResult, RunReport } from "./runner.js";

/**
 * Redact sensitive tokens and credentials from text.
 * Ensures API keys, bearer tokens, and URL credentials are not leaked.
 */
export function redactSecrets(text: string, secrets?: string[]): string {
  if (!text) return text;
  let result = text;

  // Specific secrets passed in (e.g. from request body)
  if (secrets && Array.isArray(secrets)) {
    for (const secret of secrets) {
      if (secret && typeof secret === "string" && secret.trim().length >= 4) {
        const escaped = secret.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(escaped, "g"), "[REDACTED]");
      }
    }
  }

  // Generic bearer tokens: Bearer <token>
  result = result.replace(/Bearer\s+([A-Za-z0-9_\-\.]{6,})/gi, "Bearer [REDACTED]");

  // OpenAI / generic sk- API keys
  result = result.replace(/sk-[A-Za-z0-9_\-]{8,}/g, "[REDACTED]");

  // Basic auth in URLs: http(s)://user:pass@host
  result = result.replace(/(https?:\/\/)([^:\s\/]+):([^@\s\/]+)@/g, "$1[REDACTED]:[REDACTED]@");

  // Common credential query params
  result = result.replace(/([?&](?:api_?key|token|secret|password|auth)=)[^&\s]+/gi, "$1[REDACTED]");

  return result;
}

/**
 * Truncate a string to a safe maximum length.
 */
export function truncateString(str: string, maxLen = 16384): string {
  if (!str) return str;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…[truncated]";
}

/**
 * Safely format and redact an error.
 */
export function boundError(err: unknown, maxLen = 1000, secrets?: string[]): string {
  let message = "Unknown error";
  if (err instanceof Error) {
    message = err.message || err.name;
  } else if (typeof err === "string") {
    message = err;
  } else {
    try {
      message = JSON.stringify(err);
    } catch {
      message = String(err);
    }
  }
  return truncateString(redactSecrets(message, secrets), maxLen);
}

/**
 * Sanitize a ProbeResult: redact secrets and bound large response/error strings.
 */
export function sanitizeProbeResult(res: ProbeResult, secrets?: string[]): ProbeResult {
  return {
    ...res,
    passReason: res.passReason ? truncateString(redactSecrets(res.passReason, secrets), 1000) : null,
    response: res.response ? truncateString(redactSecrets(res.response, secrets), 16384) : null,
    error: res.error ? truncateString(redactSecrets(res.error, secrets), 1000) : null,
  };
}

/**
 * Sanitize an entire RunReport.
 */
export function sanitizeReport(report: RunReport, secrets?: string[]): RunReport {
  return {
    ...report,
    baseUrl: redactSecrets(report.baseUrl, secrets),
    results: report.results.map(r => sanitizeProbeResult(r, secrets)),
  };
}
