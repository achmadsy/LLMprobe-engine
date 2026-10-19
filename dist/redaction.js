"use strict";
// src/redaction.ts — Secret redaction & bounded string utilities
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactSecrets = redactSecrets;
exports.truncateString = truncateString;
exports.boundError = boundError;
exports.sanitizeProbeResult = sanitizeProbeResult;
exports.sanitizeReport = sanitizeReport;
/**
 * Redact sensitive tokens and credentials from text.
 * Ensures API keys, bearer tokens, and URL credentials are not leaked.
 */
function redactSecrets(text, secrets) {
    if (!text)
        return text;
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
function truncateString(str, maxLen = 16384) {
    if (!str)
        return str;
    if (str.length <= maxLen)
        return str;
    return str.slice(0, maxLen) + "…[truncated]";
}
/**
 * Safely format and redact an error.
 */
function boundError(err, maxLen = 1000, secrets) {
    let message = "Unknown error";
    if (err instanceof Error) {
        message = err.message || err.name;
    }
    else if (typeof err === "string") {
        message = err;
    }
    else {
        try {
            message = JSON.stringify(err);
        }
        catch {
            message = String(err);
        }
    }
    return truncateString(redactSecrets(message, secrets), maxLen);
}
/**
 * Sanitize a ProbeResult: redact secrets and bound large response/error strings.
 */
function sanitizeProbeResult(res, secrets) {
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
function sanitizeReport(report, secrets) {
    return {
        ...report,
        baseUrl: redactSecrets(report.baseUrl, secrets),
        results: report.results.map(r => sanitizeProbeResult(r, secrets)),
    };
}
//# sourceMappingURL=redaction.js.map