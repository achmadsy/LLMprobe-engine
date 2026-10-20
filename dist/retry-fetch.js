"use strict";
// retry-fetch.ts — transport-level retry wrapper for probe upstream calls.
//
// Retries ONLY transport failures: thrown fetch errors, HTTP 5xx and 429.
// Semantic failures (4xx like signature_rejected, judge-scored misses) pass
// through untouched — re-rolling them would bias the audit toward pass.
// The number of retries used is attached to every response as the
// `x-probe-retry-count` header so callers can surface it in results.
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRY_COUNT_HEADER = void 0;
exports.retryCountOf = retryCountOf;
exports.createRetryingFetch = createRetryingFetch;
exports.RETRY_COUNT_HEADER = "x-probe-retry-count";
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}
function parseRetryAfter(value) {
    if (!value)
        return null;
    const seconds = Number(value);
    if (!Number.isNaN(seconds))
        return seconds * 1000;
    const date = Date.parse(value);
    if (!Number.isNaN(date))
        return date - Date.now();
    return null;
}
function sleepWithAbort(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
/** Retries used before the returned response, from the `x-probe-retry-count` header. */
function retryCountOf(res) {
    const raw = res.headers.get(exports.RETRY_COUNT_HEADER);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
}
function withRetryHeader(res, retries) {
    const headers = new Headers(res.headers);
    headers.set(exports.RETRY_COUNT_HEADER, String(retries));
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
    });
}
function createRetryingFetch(inner, options = {}) {
    const retries = options.retries ?? 2;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 8000;
    return async (input, init) => {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (attempt > 0) {
                const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
                await sleepWithAbort(delay, options.signal);
            }
            let res;
            try {
                res = await inner(input, init);
            }
            catch (e) {
                // Caller cancellation is never retried.
                if (options.signal?.aborted)
                    throw e;
                lastError = e;
                if (attempt < retries)
                    continue;
                throw e;
            }
            if (isRetryableStatus(res.status) && attempt < retries) {
                // Drain so the upstream connection is released before backing off.
                await res.body?.cancel().catch(() => { });
                const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
                const delay = Math.min(retryAfter ?? baseDelayMs * 2 ** attempt, maxDelayMs);
                await sleepWithAbort(delay, options.signal);
                if (options.signal?.aborted) {
                    throw new DOMException("The operation was aborted", "AbortError");
                }
                continue;
            }
            return withRetryHeader(res, attempt);
        }
        throw lastError ?? new Error("retry fetch exhausted");
    };
}
//# sourceMappingURL=retry-fetch.js.map