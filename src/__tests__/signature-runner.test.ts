// src/__tests__/signature-runner.test.ts — end-to-end coverage for the
// ac5_signature_verify probe executed through runProbes (signature_verify
// scoring): roundtrip acceptance, every failure branch, header handling,
// redaction, bounded reads and caller cancellation.

import { afterEach, describe, expect, it, vi } from "vitest";
import { runProbes } from "../runner.js";
import { MAX_SIGNATURE_RESPONSE_BYTES } from "../signature-probe.js";
import { PROBE_SUITE } from "../probe-suite.js";

const PROBE_ID = "ac5_signature_verify";
const BASE_URL = "https://gateway.example/v1";
const MESSAGES_URL = "https://gateway.example/v1/messages";
const SIG = "ErcBCkgIBhABGAIiQLwzRUNFWEtTVUJfT0xBUF9UUkFUI251bGwYAg==";
const API_KEY = "sk-ant-runner-test-key";
const CUSTOM_SECRET = "runner-custom-secret-9999";

interface RecordedCall {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function jsonResponse(body: string | null, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Upstream that always answers a Messages request with a signed thinking block. */
function signedFirstResponse(): string {
  return JSON.stringify({
    id: "msg_initial",
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "17×23 = 391.", signature: SIG },
      { type: "text", text: "391" },
    ],
  });
}

const SSE_BODY =
  'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
const JSON_STD = JSON.stringify({
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

interface FakeFetchOptions {
  /** Status for the roundtrip replay request. */
  verifyStatus?: number;
  /** Body for the roundtrip replay request. */
  verifyBody?: string;
  /** Error thrown instead of resolving the replay request. */
  replayThrow?: unknown;
  /** Status for the initial /messages request. */
  initialStatus?: number;
  /** Body for the initial /messages request (default: signed thinking block). */
  initialBody?: string;
}

function makeFakeFetch(opts: FakeFetchOptions = {}): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? init.body : "";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), body, headers });
    // Replay: only the roundtrip echoes both the thinking block and its signature.
    if (body.includes('"signature"') && body.includes('"thinking"')) {
      if (opts.replayThrow) throw opts.replayThrow;
      return jsonResponse(opts.verifyBody ?? "{}", opts.verifyStatus ?? 200);
    }
    // Initial Messages request (also ends in /messages but carries no signature).
    if (String(url).includes("/messages")) {
      return jsonResponse(opts.initialBody ?? signedFirstResponse(), opts.initialStatus ?? 200);
    }
    if (body.includes('"stream":true')) {
      return new Response(SSE_BODY, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    return jsonResponse(JSON_STD, 200);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

interface RunOptionsLite {  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  includeOptional?: boolean;
  customHeaders?: Record<string, string>;
  egressOptions?: { allowedPorts?: number[] };
  signal?: AbortSignal;
}

/** Runner result type kept loose so tests don't re-derive ProbeResult's shape. */
interface ProbeResultLike {
  probeId: string;
  passed: boolean | null;
  status: string;
  passReason: string | null;
  error: string | null;
  response: string;
  [key: string]: unknown;
}

async function runSuite(
  opts: FakeFetchOptions = {},
  extra: RunOptionsLite = {},
  // Set false when the variant never reaches the roundtrip replay.
  requireReplay = true,
): Promise<{
  result: ProbeResultLike;
  initCall: RecordedCall;
  replayCall: RecordedCall | null;
  onProgressSig: number;
  calls: RecordedCall[];
}> {
  const { fetchImpl, calls } = makeFakeFetch(opts);
  const onProgress = vi.fn();
  const report = await runProbes({
    baseUrl: extra.baseUrl ?? BASE_URL,
    apiKey: extra.apiKey ?? API_KEY,
    modelId: extra.modelId ?? "claude-opus-4-5",
    includeOptional: extra.includeOptional ?? true,
    fetchFn: fetchImpl,
    onProgress: onProgress as never,
    ...(extra.customHeaders ? { customHeaders: extra.customHeaders } : {}),
    ...(extra.egressOptions ? { egressOptions: extra.egressOptions } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  } as never);
  const results = report.results as unknown as ProbeResultLike[];
  const sig = results.filter((r) => r.probeId === PROBE_ID);
  expect(sig).toHaveLength(1);
  const result = sig[0];
  const initCall = expectIsDefined(
    calls.find((c) => c.url.includes("/messages") && !c.url.includes("/chat/completions")),
  );
  const replayCall = requireReplay
    ? expectIsDefined(
        calls.find((c) => c.body.includes('"signature"') && c.body.includes('"thinking"')),
      )
    : (calls.find((c) => c.body.includes('"signature"') && c.body.includes('"thinking"')) ?? null);
  const onProgressSig = onProgress.mock.calls.filter(
    (c: unknown[]) => (c[0] as { probeId?: string })?.probeId === PROBE_ID,
  ).length;
  return { result, initCall, replayCall, onProgressSig, calls };
}

function expectIsDefined<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected recorded call to exist");
  return value;
}


describe("runProbes(ac5_signature_verify) integration", () => {
  it("reports verified=true when the upstream accepts the roundtrip replay", async () => {
    const { result, onProgressSig } = await runSuite();
    expect(result.passed).toBe(true);
    expect(result.passReason).toBe(
      "Thinking signature successfully verified by upstream roundtrip",
    );
    expect(result.response).toBe("verified=true");
    expect(onProgressSig).toBe(1);
  });

  it("sends the initial request to baseUrl + /messages with auth headers", async () => {
    const { initCall } = await runSuite();
    expect(initCall.url).toBe(MESSAGES_URL);
    expect(initCall.headers["x-api-key"]).toBe(API_KEY);
    expect(initCall.headers["anthropic-version"]).toBe("2023-06-01");
    expect(initCall.headers["content-type"]).toBe("application/json");
  });

  it("reuses a baseUrl that already ends in /messages verbatim", async () => {
    const { initCall } = await runSuite({}, { baseUrl: MESSAGES_URL });
    expect(initCall.url).toBe(MESSAGES_URL);
  });

  it("strips a chat/completions suffix and trailing slash before appending /messages", async () => {
    const one = await runSuite({}, { baseUrl: "https://gateway.example/v1/chat/completions" });
    expect(one.initCall.url).toBe(MESSAGES_URL);
    const two = await runSuite({}, { baseUrl: "https://gateway.example/v1/" });
    expect(two.initCall.url).toBe(MESSAGES_URL);
  });

  it("echoes the signature, assistant text and follow-up in the roundtrip body", async () => {
    const { replayCall } = await runSuite();
    const body = JSON.parse(expectIsDefined(replayCall).body) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].role).toBe("assistant");
    const assistant = body.messages[1].content as Array<{ type: string; signature?: string; text?: string }>;
    expect(assistant[0].type).toBe("thinking");
    expect(assistant[0].signature).toBe(SIG);
    expect(assistant[1].text).toBe("391");
    expect(body.messages[2]).toEqual({ role: "user", content: "Confirm." });
  });

  it("sends legacy budget thinking for non-adaptive models", async () => {
    const { result, initCall } = await runSuite({}, { modelId: "claude-opus-4-5" });
    const body = JSON.parse(initCall.body) as { thinking: { type: string; budget_tokens?: number } };
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(result.passed).toBe(true);
  });

  it("sends adaptive thinking for current models", async () => {
    const { result, initCall } = await runSuite({}, { modelId: "claude-sonnet-5-5" });
    const body = JSON.parse(initCall.body) as { thinking: { type: string; budget_tokens?: number } };
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    expect(result.passed).toBe(true);
  });

  it("uses x-api-key for sk-ant- keys and Bearer for others", async () => {
    const antKey = await runSuite();
    const antReplay = expectIsDefined(antKey.replayCall);
    expect(antReplay.headers["x-api-key"]).toBe(API_KEY);
    expect(antReplay.headers["authorization"]).toBeUndefined();

    const bearer = await runSuite({}, { apiKey: "gw-runner-bearer-key" });
    const bearerReplay = expectIsDefined(bearer.replayCall);
    expect(bearerReplay.headers["authorization"]).toBe("Bearer gw-runner-bearer-key");
    expect(bearerReplay.headers["x-api-key"]).toBeUndefined();
  });

  it("fails with the initial-request reason when /messages rejects the request", async () => {
    const { result } = await runSuite({
      initialStatus: 500,
      initialBody: JSON.stringify({ error: { message: "boom" } }),
    }, {}, false);
    expect(result.passed).toBe(false);
    expect(result.passReason ?? "").toContain("Initial request failed (HTTP 500)");
  });

  it("fails with the no-thinking reason when the upstream omits a signature", async () => {
    const leakedBody = JSON.stringify({
      id: "msg_initial",
      content: [{ type: "text", text: `leak ${API_KEY}` }],
    });
    const { result } = await runSuite({ initialBody: leakedBody }, {}, false);
    expect(result.passed).toBe(false);
    expect(result.passReason).toBe("No thinking block with signature returned by upstream");
    expect(result.response).not.toContain(API_KEY);
    expect(result.response).toContain("[REDACTED]");
  });

  it("reports signature_rejected on a tampered-signature HTTP 400 replay", async () => {
    const verifyBody = `invalid request: signature ${SIG} key ${API_KEY} ${CUSTOM_SECRET}`;
    const { result } = await runSuite({ verifyStatus: 400, verifyBody }, {
      customHeaders: { "X-Relay-Secret": CUSTOM_SECRET },
    });
    expect(result.passed).toBe(false);
    expect(result.passReason ?? "").toContain("Signature rejected by upstream (HTTP 400): ");
    // Secrets must never surface in passReason or error evidence.
    const evidence = `${result.passReason ?? ""} ${result.error ?? ""}`;
    expect(evidence).not.toContain(API_KEY);
    expect(evidence).not.toContain(CUSTOM_SECRET);
    expect(evidence).not.toContain(SIG);
    expect(evidence).toContain("[REDACTED]");
  });

  it("reports http_error on a 5xx replay", async () => {
    const { result } = await runSuite({ verifyStatus: 502, verifyBody: "bad gateway" });
    expect(result.passed).toBe(false);
    expect(result.passReason ?? "").toContain("Upstream verification failed with HTTP 502");
  });

  it("reports network_error when the replay fetch throws", async () => {
    const { result } = await runSuite({
      replayThrow: new Error("ECONNRESET mid-stream"),
    });
    expect(result.passed).toBe(false);
    expect(result.passReason ?? "").toContain("Network error during verification: ");
    expect(result.passReason ?? "").toContain("ECONNRESET");
  });

  it("rejects an oversized initial response through the bounded read", async () => {
    const { result } = await runSuite({
      initialBody: "x".repeat(MAX_SIGNATURE_RESPONSE_BYTES + 1),
    }, {}, false);
    // The bounded read throws before buffering, so the branch catch records
    // an error result (not a clean pass/fail) carrying the oversize evidence.
    expect(result.passed).toBeNull();
    expect(result.status).toBe("error");
    const evidence = `${result.passReason ?? ""} ${result.error ?? ""}`;
    expect(evidence).toContain("too large");
  });

  it("forwards custom headers and never lets them override protected keys", async () => {
    const { replayCall } = await runSuite({}, {
      customHeaders: {
        "X-Relay-Secret": CUSTOM_SECRET,
        "content-type": "text/plain",
        "x-api-key": "attacker-key-123",
        "anthropic-version": "1999-01-01",
      },
    });
    expect(replayCall).not.toBeNull();
    const replay = expectIsDefined(replayCall);
    expect(replay.headers["X-Relay-Secret"]).toBe(CUSTOM_SECRET);
    expect(replay.headers["content-type"]).toBe("application/json");
    expect(replay.headers["x-api-key"]).toBe(API_KEY);
    expect(replay.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("stays verified across the derived Messages URL under egress guard", async () => {
    const { result, initCall } = await runSuite({}, { egressOptions: { allowedPorts: [443] } });
    expect(initCall.url).toBe(MESSAGES_URL);
    expect(result.passed).toBe(true);
    expect(result.response).toBe("verified=true");
  });

  it("propagates caller cancellation instead of recording a failure", async () => {
    const controller = new AbortController();
    const calls: RecordedCall[] = [];
    const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? init.body : "";
      calls.push({ url: String(url), body, headers: (init.headers ?? {}) as Record<string, string> });
      const replay = body.includes('"signature"') && body.includes('"thinking"');
      if (!replay && String(url).includes("/messages")) {
        controller.abort("cancelled by caller");
        return jsonResponse(signedFirstResponse(), 200);
      }
      if (controller.signal.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      if (replay) return jsonResponse("{}", 200);
      if (body.includes('"stream":true')) {
        return new Response(SSE_BODY, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return jsonResponse(JSON_STD, 200);
    }) as unknown as typeof fetch;

    const onProgress = vi.fn();
    await expect(
      runProbes({
        baseUrl: BASE_URL,
        apiKey: API_KEY,
        modelId: "claude-opus-4-5",
        includeOptional: true,
        fetchFn: fetchImpl,
        onProgress: onProgress as never,
        signal: controller.signal,
      } as never),
    ).rejects.toThrow(/Probe run aborted/);
  });

  it("ac5_signature_verify is present once in the suite", () => {
    const matches = PROBE_SUITE.filter((p) => p.id === PROBE_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0].scoring).toBe("signature_verify");
  });
}, 20_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
