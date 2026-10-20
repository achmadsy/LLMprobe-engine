export declare const MAX_CUSTOM_HEADERS = 16;
export declare const MAX_CUSTOM_HEADER_NAME_LENGTH = 128;
export declare const MAX_CUSTOM_HEADER_VALUE_LENGTH = 2048;
export declare const MAX_CUSTOM_HEADERS_BYTES = 8192;
declare class CustomHeadersError extends Error {
    constructor(message: string);
}
export { CustomHeadersError };
/**
 * Validates and normalizes user-supplied additional headers into an object map.
 * Accepts either `Record<string,string>` or an array of `{name, value}` rows.
 * Empty rows (name & value both empty) are ignored; partial rows are rejected.
 * Throws CustomHeadersError on any invalid input.
 */
export declare function normalizeCustomHeaders(value: unknown): Record<string, string>;
/**
 * Collects the VALUES of additional headers into a redaction secrets array.
 * Only non-empty string values are kept.
 */
export declare function customHeaderSecrets(extra: unknown): string[];
/**
 * Merges additional headers into a headers object where they apply.
 * Never overrides keys already present (Authorization from apiKey, required
 * Content-Type, probe-injected extras like anthropic-beta always win).
 */
export declare function mergeCustomHeaders(target: Record<string, string>, extra: Record<string, string> | undefined): void;
//# sourceMappingURL=custom-headers.d.ts.map