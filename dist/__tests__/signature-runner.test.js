"use strict";
// src/__tests__/signature-runner.test.ts — end-to-end coverage for the
// ac5_signature_verify probe executed through runProbes (signature_verify
// scoring): roundtrip acceptance, every failure branch, header handling,
// redaction, bounded reads and caller cancellation.
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const runner_js_1 = require("../runner.js");
const signature_probe_js_1 = require("../signature-probe.js");
const probe_suite_js_1 = require("../probe-suite.js");
const PROBE_ID = "ac5_signature_verify";
const BASE_URL = "https://gateway.example/v1";
const MESSAGES_URL = "https://gateway.example/v1/messages";
const SIG = "ErcBCkgIBhABGAIiQLwzRUNFWEtTVUJfT0xBUF9UUkFUI251bGwYAg==";
const API_KEY = "sk-ant-runner-test-key";
const CUSTOM_SECRET = "runner-custom-secret-9999";
function jsonResponse(body, status = 200) {
    return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
    });
}
/** Upstream that always answers a Messages request with a signed thinking block. */
function signedFirstResponse() {
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
const SSE_BODY = 'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
const JSON_STD = JSON.stringify({
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
});
function makeFakeFetch(opts = {}) {
    const calls = [];
    const fetchImpl = (async (url, init = {}) => {
        const body = typeof init.body === "string" ? init.body : "";
        const headers = (init.headers ?? {});
        calls.push({ url: String(url), body, headers });
        // Replay: only the roundtrip echoes both the thinking block and its signature.
        if (body.includes('"signature"') && body.includes('"thinking"')) {
            if (opts.replayThrow)
                throw opts.replayThrow;
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
    });
    return { fetchImpl, calls };
}
async function runSuite(opts = {}, extra = {}, 
// Set false when the variant never reaches the roundtrip replay.
requireReplay = true) {
    const { fetchImpl, calls } = makeFakeFetch(opts);
    const onProgress = vitest_1.vi.fn();
    const report = await (0, runner_js_1.runProbes)({
        baseUrl: extra.baseUrl ?? BASE_URL,
        apiKey: extra.apiKey ?? API_KEY,
        modelId: extra.modelId ?? "claude-opus-4-5",
        includeOptional: extra.includeOptional ?? true,
        fetchFn: fetchImpl,
        onProgress: onProgress,
        ...(extra.customHeaders ? { customHeaders: extra.customHeaders } : {}),
        ...(extra.egressOptions ? { egressOptions: extra.egressOptions } : {}),
        ...(extra.signal ? { signal: extra.signal } : {}),
    });
    const results = report.results;
    const sig = results.filter((r) => r.probeId === PROBE_ID);
    (0, vitest_1.expect)(sig).toHaveLength(1);
    const result = sig[0];
    const initCall = expectIsDefined(calls.find((c) => c.url.includes("/messages") && !c.url.includes("/chat/completions")));
    const replayCall = requireReplay
        ? expectIsDefined(calls.find((c) => c.body.includes('"signature"') && c.body.includes('"thinking"')))
        : (calls.find((c) => c.body.includes('"signature"') && c.body.includes('"thinking"')) ?? null);
    const onProgressSig = onProgress.mock.calls.filter((c) => c[0]?.probeId === PROBE_ID).length;
    return { result, initCall, replayCall, onProgressSig, calls };
}
function expectIsDefined(value) {
    if (value === undefined || value === null)
        throw new Error("expected recorded call to exist");
    return value;
}
(0, vitest_1.describe)("runProbes(ac5_signature_verify) integration", () => {
    (0, vitest_1.it)("reports verified=true when the upstream accepts the roundtrip replay", async () => {
        const { result, onProgressSig } = await runSuite();
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.passReason).toBe("Thinking signature successfully verified by upstream roundtrip");
        (0, vitest_1.expect)(result.response).toBe("verified=true");
        (0, vitest_1.expect)(onProgressSig).toBe(1);
    });
    (0, vitest_1.it)("sends the initial request to baseUrl + /messages with auth headers", async () => {
        const { initCall } = await runSuite();
        (0, vitest_1.expect)(initCall.url).toBe(MESSAGES_URL);
        (0, vitest_1.expect)(initCall.headers["x-api-key"]).toBe(API_KEY);
        (0, vitest_1.expect)(initCall.headers["anthropic-version"]).toBe("2023-06-01");
        (0, vitest_1.expect)(initCall.headers["content-type"]).toBe("application/json");
    });
    (0, vitest_1.it)("reuses a baseUrl that already ends in /messages verbatim", async () => {
        const { initCall } = await runSuite({}, { baseUrl: MESSAGES_URL });
        (0, vitest_1.expect)(initCall.url).toBe(MESSAGES_URL);
    });
    (0, vitest_1.it)("strips a chat/completions suffix and trailing slash before appending /messages", async () => {
        const one = await runSuite({}, { baseUrl: "https://gateway.example/v1/chat/completions" });
        (0, vitest_1.expect)(one.initCall.url).toBe(MESSAGES_URL);
        const two = await runSuite({}, { baseUrl: "https://gateway.example/v1/" });
        (0, vitest_1.expect)(two.initCall.url).toBe(MESSAGES_URL);
    });
    (0, vitest_1.it)("echoes the signature, assistant text and follow-up in the roundtrip body", async () => {
        const { replayCall } = await runSuite();
        const body = JSON.parse(expectIsDefined(replayCall).body);
        (0, vitest_1.expect)(body.messages).toHaveLength(3);
        (0, vitest_1.expect)(body.messages[1].role).toBe("assistant");
        const assistant = body.messages[1].content;
        (0, vitest_1.expect)(assistant[0].type).toBe("thinking");
        (0, vitest_1.expect)(assistant[0].signature).toBe(SIG);
        (0, vitest_1.expect)(assistant[1].text).toBe("391");
        (0, vitest_1.expect)(body.messages[2]).toEqual({ role: "user", content: "Confirm." });
    });
    (0, vitest_1.it)("sends legacy budget thinking for non-adaptive models", async () => {
        const { result, initCall } = await runSuite({}, { modelId: "claude-opus-4-5" });
        const body = JSON.parse(initCall.body);
        (0, vitest_1.expect)(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
        (0, vitest_1.expect)(result.passed).toBe(true);
    });
    (0, vitest_1.it)("sends adaptive thinking for current models", async () => {
        const { result, initCall } = await runSuite({}, { modelId: "claude-sonnet-5-5" });
        const body = JSON.parse(initCall.body);
        (0, vitest_1.expect)(body.thinking).toEqual({ type: "adaptive" });
        (0, vitest_1.expect)(body.thinking).not.toHaveProperty("budget_tokens");
        (0, vitest_1.expect)(result.passed).toBe(true);
    });
    (0, vitest_1.it)("uses x-api-key for sk-ant- keys and Bearer for others", async () => {
        const antKey = await runSuite();
        const antReplay = expectIsDefined(antKey.replayCall);
        (0, vitest_1.expect)(antReplay.headers["x-api-key"]).toBe(API_KEY);
        (0, vitest_1.expect)(antReplay.headers["authorization"]).toBeUndefined();
        const bearer = await runSuite({}, { apiKey: "gw-runner-bearer-key" });
        const bearerReplay = expectIsDefined(bearer.replayCall);
        (0, vitest_1.expect)(bearerReplay.headers["authorization"]).toBe("Bearer gw-runner-bearer-key");
        (0, vitest_1.expect)(bearerReplay.headers["x-api-key"]).toBeUndefined();
    });
    (0, vitest_1.it)("fails with the initial-request reason when /messages rejects the request", async () => {
        const { result } = await runSuite({
            initialStatus: 500,
            initialBody: JSON.stringify({ error: { message: "boom" } }),
        }, {}, false);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.passReason ?? "").toContain("Initial request failed (HTTP 500)");
    });
    (0, vitest_1.it)("fails with the no-thinking reason when the upstream omits a signature", async () => {
        const leakedBody = JSON.stringify({
            id: "msg_initial",
            content: [{ type: "text", text: `leak ${API_KEY}` }],
        });
        const { result } = await runSuite({ initialBody: leakedBody }, {}, false);
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.passReason).toBe("No thinking block with signature returned by upstream");
        (0, vitest_1.expect)(result.response).not.toContain(API_KEY);
        (0, vitest_1.expect)(result.response).toContain("[REDACTED]");
    });
    (0, vitest_1.it)("reports signature_rejected on a tampered-signature HTTP 400 replay", async () => {
        const verifyBody = `invalid request: signature ${SIG} key ${API_KEY} ${CUSTOM_SECRET}`;
        const { result } = await runSuite({ verifyStatus: 400, verifyBody }, {
            customHeaders: { "X-Relay-Secret": CUSTOM_SECRET },
        });
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.passReason ?? "").toContain("Signature rejected by upstream (HTTP 400): ");
        // Secrets must never surface in passReason or error evidence.
        const evidence = `${result.passReason ?? ""} ${result.error ?? ""}`;
        (0, vitest_1.expect)(evidence).not.toContain(API_KEY);
        (0, vitest_1.expect)(evidence).not.toContain(CUSTOM_SECRET);
        (0, vitest_1.expect)(evidence).not.toContain(SIG);
        (0, vitest_1.expect)(evidence).toContain("[REDACTED]");
    });
    (0, vitest_1.it)("reports http_error on a 5xx replay", async () => {
        const { result } = await runSuite({ verifyStatus: 502, verifyBody: "bad gateway" });
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.passReason ?? "").toContain("Upstream verification failed with HTTP 502");
    });
    (0, vitest_1.it)("reports network_error when the replay fetch throws", async () => {
        const { result } = await runSuite({
            replayThrow: new Error("ECONNRESET mid-stream"),
        });
        (0, vitest_1.expect)(result.passed).toBe(false);
        (0, vitest_1.expect)(result.passReason ?? "").toContain("Network error during verification: ");
        (0, vitest_1.expect)(result.passReason ?? "").toContain("ECONNRESET");
    });
    (0, vitest_1.it)("rejects an oversized initial response through the bounded read", async () => {
        const { result } = await runSuite({
            initialBody: "x".repeat(signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES + 1),
        }, {}, false);
        // The bounded read throws before buffering, so the branch catch records
        // an error result (not a clean pass/fail) carrying the oversize evidence.
        (0, vitest_1.expect)(result.passed).toBeNull();
        (0, vitest_1.expect)(result.status).toBe("error");
        const evidence = `${result.passReason ?? ""} ${result.error ?? ""}`;
        (0, vitest_1.expect)(evidence).toContain("too large");
    });
    (0, vitest_1.it)("forwards custom headers and never lets them override protected keys", async () => {
        const { replayCall } = await runSuite({}, {
            customHeaders: {
                "X-Relay-Secret": CUSTOM_SECRET,
                "content-type": "text/plain",
                "x-api-key": "attacker-key-123",
                "anthropic-version": "1999-01-01",
            },
        });
        (0, vitest_1.expect)(replayCall).not.toBeNull();
        const replay = expectIsDefined(replayCall);
        (0, vitest_1.expect)(replay.headers["X-Relay-Secret"]).toBe(CUSTOM_SECRET);
        (0, vitest_1.expect)(replay.headers["content-type"]).toBe("application/json");
        (0, vitest_1.expect)(replay.headers["x-api-key"]).toBe(API_KEY);
        (0, vitest_1.expect)(replay.headers["anthropic-version"]).toBe("2023-06-01");
    });
    (0, vitest_1.it)("stays verified across the derived Messages URL under egress guard", async () => {
        const { result, initCall } = await runSuite({}, { egressOptions: { allowedPorts: [443] } });
        (0, vitest_1.expect)(initCall.url).toBe(MESSAGES_URL);
        (0, vitest_1.expect)(result.passed).toBe(true);
        (0, vitest_1.expect)(result.response).toBe("verified=true");
    });
    (0, vitest_1.it)("propagates caller cancellation instead of recording a failure", async () => {
        const controller = new AbortController();
        const calls = [];
        const fetchImpl = (async (url, init = {}) => {
            const body = typeof init.body === "string" ? init.body : "";
            calls.push({ url: String(url), body, headers: (init.headers ?? {}) });
            const replay = body.includes('"signature"') && body.includes('"thinking"');
            if (!replay && String(url).includes("/messages")) {
                controller.abort("cancelled by caller");
                return jsonResponse(signedFirstResponse(), 200);
            }
            if (controller.signal.aborted) {
                throw new DOMException("The operation was aborted", "AbortError");
            }
            if (replay)
                return jsonResponse("{}", 200);
            if (body.includes('"stream":true')) {
                return new Response(SSE_BODY, { status: 200, headers: { "content-type": "text/event-stream" } });
            }
            return jsonResponse(JSON_STD, 200);
        });
        const onProgress = vitest_1.vi.fn();
        await (0, vitest_1.expect)((0, runner_js_1.runProbes)({
            baseUrl: BASE_URL,
            apiKey: API_KEY,
            modelId: "claude-opus-4-5",
            includeOptional: true,
            fetchFn: fetchImpl,
            onProgress: onProgress,
            signal: controller.signal,
        })).rejects.toThrow(/Probe run aborted/);
    });
    (0, vitest_1.it)("ac5_signature_verify is present once in the suite", () => {
        const matches = probe_suite_js_1.PROBE_SUITE.filter((p) => p.id === PROBE_ID);
        (0, vitest_1.expect)(matches).toHaveLength(1);
        (0, vitest_1.expect)(matches[0].scoring).toBe("signature_verify");
    });
}, 20000);
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.unstubAllGlobals();
    vitest_1.vi.restoreAllMocks();
});
//# sourceMappingURL=signature-runner.test.js.map