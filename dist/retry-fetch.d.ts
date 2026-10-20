export declare const RETRY_COUNT_HEADER = "x-probe-retry-count";
export interface RetryFetchOptions {
    /** Extra attempts after the first. Default 2. */
    retries?: number;
    /** Base backoff delay. Default 1000ms. */
    baseDelayMs?: number;
    /** Upper clamp for computed and Retry-After delays. Default 8000ms. */
    maxDelayMs?: number;
    /** Caller abort signal; honored during backoff waits. */
    signal?: AbortSignal;
}
/** Retries used before the returned response, from the `x-probe-retry-count` header. */
export declare function retryCountOf(res: Response): number;
export declare function createRetryingFetch(inner: typeof fetch, options?: RetryFetchOptions): typeof fetch;
//# sourceMappingURL=retry-fetch.d.ts.map