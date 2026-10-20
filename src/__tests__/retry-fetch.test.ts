import { describe, it, expect } from "vitest";
import {
  createRetryingFetch,
  retryCountOf,
  RETRY_COUNT_HEADER,
} from "../retry-fetch.js";

function jsonResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createRetryingFetch", () => {
  it("passes through a 2xx without retries", async () => {
    const inner = (() => Promise.resolve(jsonResponse("ok"))) as unknown as typeof fetch;
    const res = await createRetryingFetch(inner)("https://x.example");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(retryCountOf(res)).toBe(0);
  });

  it("retries a network throw and succeeds on a later attempt", async () => {
    let calls = 0;
    const inner = (() => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(jsonResponse("ok"));
    }) as unknown as typeof fetch;
    const res = await createRetryingFetch(inner, { baseDelayMs: 1 })("https://x.example");
    expect(calls).toBe(3);
    expect(res.status).toBe(200);
    expect(retryCountOf(res)).toBe(2);
  });

  it("retries 5xx responses and attaches the retry header", async () => {
    let calls = 0;
    const inner = (() => {
      calls++;
      return Promise.resolve(jsonResponse("bad gateway", calls === 1 ? 503 : 200));
    }) as unknown as typeof fetch;
    const res = await createRetryingFetch(inner, { baseDelayMs: 1 })("https://x.example");
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    expect(res.headers.get(RETRY_COUNT_HEADER)).toBe("1");
  });

  it("retries 429 and honors a Retry-After header", async () => {
    let calls = 0;
    const seenDelays: number[] = [];
    const inner = (() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(jsonResponse("slow down", 429, { "retry-after": "1" }));
      }
      return Promise.resolve(jsonResponse("ok"));
    }) as unknown as typeof fetch;
    const started = Date.now();
    const res = await createRetryingFetch(inner, { baseDelayMs: 5000, maxDelayMs: 10_000 })("https://x.example");
    seenDelays.push(Date.now() - started);
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    // Retry-After 1s must win over the 5s configured base delay.
    expect(seenDelays[0]).toBeGreaterThanOrEqual(900);
  }, 10_000);

  it("never retries 4xx semantic failures", async () => {
    let calls = 0;
    const inner = (() => {
      calls++;
      return Promise.resolve(jsonResponse("invalid signature", 400));
    }) as unknown as typeof fetch;
    const res = await createRetryingFetch(inner, { baseDelayMs: 1 })("https://x.example");
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
  });

  it("gives up after the configured retries and rethrows the last network error", async () => {
    let calls = 0;
    const inner = (() => {
      calls++;
      return Promise.reject(new Error("ECONNREFUSED"));
    }) as unknown as typeof fetch;
    await expect(
      createRetryingFetch(inner, { retries: 1, baseDelayMs: 1 })("https://x.example"),
    ).rejects.toThrow("ECONNREFUSED");
    expect(calls).toBe(2);
  });

  it("returns the final 5xx response when retries are exhausted", async () => {
    const inner = (() => Promise.resolve(jsonResponse("down", 502))) as unknown as typeof fetch;
    const res = await createRetryingFetch(inner, { retries: 1, baseDelayMs: 1 })("https://x.example");
    expect(res.status).toBe(502);
    expect(retryCountOf(res)).toBe(1);
  });

  it("does not retry when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");
    let calls = 0;
    const inner = (() => {
      calls++;
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }) as unknown as typeof fetch;
    await expect(
      createRetryingFetch(inner, { retries: 3, baseDelayMs: 1, signal: controller.signal })("https://x.example"),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("aborts a pending backoff wait when the caller cancels", async () => {
    const controller = new AbortController();
    const inner = (() => Promise.resolve(jsonResponse("bad", 503))) as unknown as typeof fetch;
    const pending = createRetryingFetch(inner, { retries: 1, baseDelayMs: 30_000, signal: controller.signal })(
      "https://x.example",
    );
    await delay(20);
    controller.abort("cancelled");
    await expect(pending).rejects.toThrow();
  }, 5000);
});
