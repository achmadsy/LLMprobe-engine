import type { ProbeResult, RunReport } from "./runner.js";
/**
 * Redact sensitive tokens and credentials from text.
 * Ensures API keys, bearer tokens, and URL credentials are not leaked.
 */
export declare function redactSecrets(text: string, secrets?: string[]): string;
/**
 * Truncate a string to a safe maximum length.
 */
export declare function truncateString(str: string, maxLen?: number): string;
/**
 * Safely format and redact an error.
 */
export declare function boundError(err: unknown, maxLen?: number, secrets?: string[]): string;
/**
 * Sanitize a ProbeResult: redact secrets and bound large response/error strings.
 */
export declare function sanitizeProbeResult(res: ProbeResult, secrets?: string[]): ProbeResult;
/**
 * Sanitize an entire RunReport.
 */
export declare function sanitizeReport(report: RunReport, secrets?: string[]): RunReport;
//# sourceMappingURL=redaction.d.ts.map