"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const retry_fetch_js_1 = require("../retry-fetch.js");
function jsonResponse(body, status = 200, headers = {}) {
    return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
(0, vitest_1.describe)("createRetryingFetch", () => {
    (0, vitest_1.it)("passes through a 2xx without retries", async () => {
        const inner = (() => Promise.resolve(jsonResponse("ok")));
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner)("https://x.example");
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(await res.text()).toBe("ok");
        (0, vitest_1.expect)((0, retry_fetch_js_1.retryCountOf)(res)).toBe(0);
    });
    (0, vitest_1.it)("retries a network throw and succeeds on a later attempt", async () => {
        let calls = 0;
        const inner = (() => {
            calls++;
            if (calls < 3)
                return Promise.reject(new Error("ECONNRESET"));
            return Promise.resolve(jsonResponse("ok"));
        });
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner, { baseDelayMs: 1 })("https://x.example");
        (0, vitest_1.expect)(calls).toBe(3);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)((0, retry_fetch_js_1.retryCountOf)(res)).toBe(2);
    });
    (0, vitest_1.it)("retries 5xx responses and attaches the retry header", async () => {
        let calls = 0;
        const inner = (() => {
            calls++;
            return Promise.resolve(jsonResponse("bad gateway", calls === 1 ? 503 : 200));
        });
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner, { baseDelayMs: 1 })("https://x.example");
        (0, vitest_1.expect)(calls).toBe(2);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.headers.get(retry_fetch_js_1.RETRY_COUNT_HEADER)).toBe("1");
    });
    (0, vitest_1.it)("retries 429 and honors a Retry-After header", async () => {
        let calls = 0;
        const seenDelays = [];
        const inner = (() => {
            calls++;
            if (calls === 1) {
                return Promise.resolve(jsonResponse("slow down", 429, { "retry-after": "1" }));
            }
            return Promise.resolve(jsonResponse("ok"));
        });
        const started = Date.now();
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner, { baseDelayMs: 5000, maxDelayMs: 10000 })("https://x.example");
        seenDelays.push(Date.now() - started);
        (0, vitest_1.expect)(calls).toBe(2);
        (0, vitest_1.expect)(res.status).toBe(200);
        // Retry-After 1s must win over the 5s configured base delay.
        (0, vitest_1.expect)(seenDelays[0]).toBeGreaterThanOrEqual(900);
    }, 10000);
    (0, vitest_1.it)("never retries 4xx semantic failures", async () => {
        let calls = 0;
        const inner = (() => {
            calls++;
            return Promise.resolve(jsonResponse("invalid signature", 400));
        });
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner, { baseDelayMs: 1 })("https://x.example");
        (0, vitest_1.expect)(calls).toBe(1);
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)("gives up after the configured retries and rethrows the last network error", async () => {
        let calls = 0;
        const inner = (() => {
            calls++;
            return Promise.reject(new Error("ECONNREFUSED"));
        });
        await (0, vitest_1.expect)((0, retry_fetch_js_1.createRetryingFetch)(inner, { retries: 1, baseDelayMs: 1 })("https://x.example")).rejects.toThrow("ECONNREFUSED");
        (0, vitest_1.expect)(calls).toBe(2);
    });
    (0, vitest_1.it)("returns the final 5xx response when retries are exhausted", async () => {
        const inner = (() => Promise.resolve(jsonResponse("down", 502)));
        const res = await (0, retry_fetch_js_1.createRetryingFetch)(inner, { retries: 1, baseDelayMs: 1 })("https://x.example");
        (0, vitest_1.expect)(res.status).toBe(502);
        (0, vitest_1.expect)((0, retry_fetch_js_1.retryCountOf)(res)).toBe(1);
    });
    (0, vitest_1.it)("does not retry when the caller signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort("cancelled");
        let calls = 0;
        const inner = (() => {
            calls++;
            return Promise.reject(new DOMException("aborted", "AbortError"));
        });
        await (0, vitest_1.expect)((0, retry_fetch_js_1.createRetryingFetch)(inner, { retries: 3, baseDelayMs: 1, signal: controller.signal })("https://x.example")).rejects.toThrow();
        (0, vitest_1.expect)(calls).toBe(1);
    });
    (0, vitest_1.it)("aborts a pending backoff wait when the caller cancels", async () => {
        const controller = new AbortController();
        const inner = (() => Promise.resolve(jsonResponse("bad", 503)));
        const pending = (0, retry_fetch_js_1.createRetryingFetch)(inner, { retries: 1, baseDelayMs: 30000, signal: controller.signal })("https://x.example");
        await delay(20);
        controller.abort("cancelled");
        await (0, vitest_1.expect)(pending).rejects.toThrow();
    }, 5000);
});
//# sourceMappingURL=retry-fetch.test.js.map