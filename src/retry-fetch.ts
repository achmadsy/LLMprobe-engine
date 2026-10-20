// retry-fetch.ts — transport-level retry wrapper for probe upstream calls.
//
// Retries ONLY transport failures: thrown fetch errors, HTTP 5xx and 429.
// Semantic failures (4xx like signature_rejected, judge-scored misses) pass
// through untouched — re-rolling them would bias the audit toward pass.
// The number of retries used is attached to every response as the
// `x-probe-retry-count` header so callers can surface it in results.

export const RETRY_COUNT_HEADER = "x-probe-retry-count";

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

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return date - Date.now();
  return null;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
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
export function retryCountOf(res: Response): number {
  const raw = res.headers.get(RETRY_COUNT_HEADER);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function withRetryHeader(res: Response, retries: number): Response {
  const headers = new Headers(res.headers);
  headers.set(RETRY_COUNT_HEADER, String(retries));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function createRetryingFetch(inner: typeof fetch, options: RetryFetchOptions = {}): typeof fetch {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 8000;

  return async (input, init) => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
        await sleepWithAbort(delay, options.signal);
      }
      let res: Response;
      try {
        res = await inner(input, init);
      } catch (e) {
        // Caller cancellation is never retried.
        if (options.signal?.aborted) throw e;
        lastError = e;
        if (attempt < retries) continue;
        throw e;
      }
      if (isRetryableStatus(res.status) && attempt < retries) {
        // Drain so the upstream connection is released before backing off.
        await res.body?.cancel().catch(() => {});
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
