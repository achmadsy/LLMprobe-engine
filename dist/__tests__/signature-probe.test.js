"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const signature_probe_js_1 = require("../signature-probe.js");
const GENUINE_RESPONSE = {
    id: "msg_01ABC",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-5",
    content: [
        {
            type: "thinking",
            thinking: "The user asked for 2+2. That is 4.",
            signature: "ErcBCkgIBhABGAIiQI6...opaque-blob...=",
        },
        { type: "text", text: "4" },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
};
function response(body, status = 200) {
    return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
    });
}
(0, vitest_1.describe)("extractThinkingBlock", () => {
    (0, vitest_1.it)("returns the thinking block when present", () => {
        const result = (0, signature_probe_js_1.extractThinkingBlock)(GENUINE_RESPONSE);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.type).toBe("thinking");
        (0, vitest_1.expect)(result.signature).toMatch(/^ErcBCkg/);
        (0, vitest_1.expect)(result.thinking).toContain("2+2");
    });
    (0, vitest_1.it)("returns null when content array has no thinking block", () => {
        const noThinking = { ...GENUINE_RESPONSE, content: [{ type: "text", text: "4" }] };
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)(noThinking)).toBeNull();
    });
    (0, vitest_1.it)("returns null when signature is missing from the thinking block", () => {
        const noSig = {
            ...GENUINE_RESPONSE,
            content: [{ type: "thinking", thinking: "..." }],
        };
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)(noSig)).toBeNull();
    });
    (0, vitest_1.it)("returns null when signature is empty string", () => {
        const emptySig = {
            ...GENUINE_RESPONSE,
            content: [{ type: "thinking", thinking: "...", signature: "" }],
        };
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)(emptySig)).toBeNull();
    });
    (0, vitest_1.it)("returns null on malformed input", () => {
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)(null)).toBeNull();
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)({})).toBeNull();
        (0, vitest_1.expect)((0, signature_probe_js_1.extractThinkingBlock)({ content: "not an array" })).toBeNull();
    });
});
(0, vitest_1.describe)("getThinkingConfig", () => {
    vitest_1.it.each([
        "claude-fable-5",
        "anthropic/claude-fable-5-1",
        "claude-sonnet-4-6",
        "claude-sonnet-5-5-20261001",
        "claude-opus-4-8",
        "claude-opus-5",
    ])("uses adaptive thinking for %s", (model) => {
        (0, vitest_1.expect)((0, signature_probe_js_1.getThinkingConfig)(model)).toEqual({ type: "adaptive" });
    });
    vitest_1.it.each([
        "claude-opus-4-5",
        "claude-sonnet-4-5",
        "claude-3-7-sonnet-latest",
        "relay-model",
    ])("uses a token budget for legacy or unknown model %s", (model) => {
        (0, vitest_1.expect)((0, signature_probe_js_1.getThinkingConfig)(model)).toEqual({
            type: "enabled",
            budget_tokens: 1024,
        });
    });
});
(0, vitest_1.describe)("readBoundedResponse", () => {
    (0, vitest_1.it)("reads a streamed response within the limit", async () => {
        await (0, vitest_1.expect)((0, signature_probe_js_1.readBoundedResponse)(response("ok"))).resolves.toBe("ok");
    });
    (0, vitest_1.it)("rejects a response larger than the configured limit", async () => {
        const oversized = "x".repeat(signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES + 1);
        await (0, vitest_1.expect)((0, signature_probe_js_1.readBoundedResponse)(response(oversized))).rejects.toThrow(`Signature response too large (max ${signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES} bytes)`);
    });
    (0, vitest_1.it)("returns an empty string for a response without a body", async () => {
        await (0, vitest_1.expect)((0, signature_probe_js_1.readBoundedResponse)(new Response(null, { status: 204 }))).resolves.toBe("");
    });
});
(0, vitest_1.describe)("buildRoundtripBody", () => {
    const block = {
        type: "thinking",
        thinking: "Let me think about this.",
        signature: "ErcBCkgIBhABGAIiQI6testsig=",
    };
    (0, vitest_1.it)("builds a 2-turn legacy body echoing the thinking block unchanged", () => {
        const body = (0, signature_probe_js_1.buildRoundtripBody)({
            model: "claude-opus-4-5",
            originalUserPrompt: "What is 2+2?",
            thinkingBlock: block,
            assistantText: "4",
            followUpUserPrompt: "And 3+3?",
        });
        (0, vitest_1.expect)(body.model).toBe("claude-opus-4-5");
        (0, vitest_1.expect)(body.thinking).toEqual({ type: "enabled", budget_tokens: vitest_1.expect.any(Number) });
        (0, vitest_1.expect)(body.thinking.type).toBe("enabled");
        if (body.thinking.type === "enabled") {
            (0, vitest_1.expect)(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
        }
        (0, vitest_1.expect)(body.messages).toHaveLength(3);
        (0, vitest_1.expect)(body.messages[0]).toEqual({ role: "user", content: "What is 2+2?" });
        (0, vitest_1.expect)(body.messages[1].role).toBe("assistant");
        const assistantContent = body.messages[1].content;
        (0, vitest_1.expect)(Array.isArray(assistantContent)).toBe(true);
        (0, vitest_1.expect)(assistantContent[0].type).toBe("thinking");
        (0, vitest_1.expect)(assistantContent[0].signature).toBe(block.signature);
        (0, vitest_1.expect)(assistantContent[1].type).toBe("text");
        (0, vitest_1.expect)(body.messages[2]).toEqual({ role: "user", content: "And 3+3?" });
    });
    (0, vitest_1.it)("uses adaptive thinking without budget_tokens for current models", () => {
        const body = (0, signature_probe_js_1.buildRoundtripBody)({
            model: "claude-opus-5-5",
            originalUserPrompt: "q",
            thinkingBlock: block,
            assistantText: "a",
            followUpUserPrompt: "q2",
        });
        (0, vitest_1.expect)(body.thinking).toEqual({ type: "adaptive" });
        (0, vitest_1.expect)(body.thinking).not.toHaveProperty("budget_tokens");
    });
    (0, vitest_1.it)("never mutates the passed-in thinking block", () => {
        const original = { ...block };
        (0, signature_probe_js_1.buildRoundtripBody)({
            model: "claude-opus-4-5",
            originalUserPrompt: "q",
            thinkingBlock: block,
            assistantText: "a",
            followUpUserPrompt: "q2",
        });
        (0, vitest_1.expect)(block).toEqual(original);
    });
});
(0, vitest_1.describe)("verifySignatureRoundtrip", () => {
    const block = {
        type: "thinking",
        thinking: "t",
        signature: "ErcBCkgIBhABGAIiQI6sig=",
    };
    const baseArgs = {
        endpoint: "https://api.anthropic.com/v1/messages",
        apiKey: "sk-ant-test",
        model: "claude-opus-4-5",
        originalUserPrompt: "q",
        thinkingBlock: block,
        assistantText: "a",
        followUpUserPrompt: "q2",
    };
    (0, vitest_1.it)("returns { verified: true } on HTTP 200", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("{}"));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        (0, vitest_1.expect)(result.verified).toBe(true);
        (0, vitest_1.expect)(result.httpStatus).toBe(200);
        (0, vitest_1.expect)(result.rawErrorSnippet).toBeNull();
        (0, vitest_1.expect)(JSON.stringify(result)).not.toContain(block.signature);
        (0, vitest_1.expect)(fakeFetch).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("returns { verified: false, reason: 'signature_rejected' } on HTTP 400", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response(JSON.stringify({
            type: "error",
            error: { type: "invalid_request_error", message: "invalid signature" },
        }), 400));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        (0, vitest_1.expect)(result.verified).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe("signature_rejected");
        (0, vitest_1.expect)(result.httpStatus).toBe(400);
    });
    (0, vitest_1.it)("returns { verified: false, reason: 'http_error' } on 5xx", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("bad gateway", 502));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        (0, vitest_1.expect)(result.verified).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe("http_error");
        (0, vitest_1.expect)(result.httpStatus).toBe(502);
    });
    (0, vitest_1.it)("sends POST with x-api-key header and echoes signature in body", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("{}"));
        await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        const [url, init] = fakeFetch.mock.calls[0];
        (0, vitest_1.expect)(url).toBe("https://api.anthropic.com/v1/messages");
        (0, vitest_1.expect)(init.method).toBe("POST");
        (0, vitest_1.expect)(init.headers["x-api-key"]).toBe("sk-ant-test");
        (0, vitest_1.expect)(init.headers["anthropic-version"]).toBeDefined();
        const body = JSON.parse(init.body);
        (0, vitest_1.expect)(body.messages[1].content[0].signature).toBe(block.signature);
    });
    (0, vitest_1.it)("supports authHeader: 'authorization' for Bearer-style relays", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("{}"));
        await (0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            authHeader: "authorization",
            fetchImpl: fakeFetch,
        });
        const [, init] = fakeFetch.mock.calls[0];
        (0, vitest_1.expect)(init.headers.authorization).toBe("Bearer sk-ant-test");
        (0, vitest_1.expect)(init.headers["x-api-key"]).toBeUndefined();
    });
    (0, vitest_1.it)("returns { verified: false, reason: 'network_error' } when fetch throws", async () => {
        const fakeFetch = vitest_1.vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        (0, vitest_1.expect)(result.verified).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe("network_error");
        (0, vitest_1.expect)(result.httpStatus).toBe(0);
        (0, vitest_1.expect)(result.rawErrorSnippet).toContain("ECONNREFUSED");
    });
    (0, vitest_1.it)("propagates caller cancellation instead of recording a network error", async () => {
        const controller = new AbortController();
        controller.abort("cancelled by caller");
        const aborted = new DOMException("cancelled", "AbortError");
        const fakeFetch = vitest_1.vi.fn().mockRejectedValue(aborted);
        await (0, vitest_1.expect)((0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            fetchImpl: fakeFetch,
            signal: controller.signal,
        })).rejects.toBe(aborted);
    });
    (0, vitest_1.it)("redacts API keys and custom-header values from network errors", async () => {
        const customSecret = "custom-secret-value";
        const fakeFetch = vitest_1.vi.fn().mockRejectedValue(new Error(`failed with sk-ant-test and ${customSecret}`));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            customHeaders: { "X-Relay-Secret": customSecret },
            fetchImpl: fakeFetch,
        });
        (0, vitest_1.expect)(result.rawErrorSnippet).not.toContain("sk-ant-test");
        (0, vitest_1.expect)(result.rawErrorSnippet).not.toContain(customSecret);
    });
    (0, vitest_1.it)("redacts signature bytes and secrets from upstream errors", async () => {
        const customSecret = "custom-secret-value";
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response(`invalid ${block.signature} sk-ant-test ${customSecret}`, 400));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            customHeaders: { "X-Relay-Secret": customSecret },
            fetchImpl: fakeFetch,
        });
        (0, vitest_1.expect)(result.reason).toBe("signature_rejected");
        (0, vitest_1.expect)(result.rawErrorSnippet).not.toContain(block.signature);
        (0, vitest_1.expect)(result.rawErrorSnippet).not.toContain("sk-ant-test");
        (0, vitest_1.expect)(result.rawErrorSnippet).not.toContain(customSecret);
    });
    (0, vitest_1.it)("rejects oversized verification responses", async () => {
        const oversized = "x".repeat(signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES + 1);
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response(oversized, 502));
        const result = await (0, signature_probe_js_1.verifySignatureRoundtrip)({ ...baseArgs, fetchImpl: fakeFetch });
        (0, vitest_1.expect)(result.verified).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe("http_error");
        (0, vitest_1.expect)(result.rawErrorSnippet).toContain("Signature response too large");
    });
    (0, vitest_1.it)("forwards customHeaders to upstream request", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("{}"));
        await (0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            customHeaders: { "X-Custom-Tracking": "relay-audit-123" },
            fetchImpl: fakeFetch,
        });
        const [, init] = fakeFetch.mock.calls[0];
        (0, vitest_1.expect)(init.headers["X-Custom-Tracking"]).toBe("relay-audit-123");
    });
    (0, vitest_1.it)("prevents customHeaders from overriding required transport and auth headers", async () => {
        const fakeFetch = vitest_1.vi.fn().mockResolvedValue(response("{}"));
        await (0, signature_probe_js_1.verifySignatureRoundtrip)({
            ...baseArgs,
            customHeaders: {
                "content-type": "text/plain",
                "x-api-key": "attacker-key",
                "anthropic-version": "1999-01-01",
            },
            fetchImpl: fakeFetch,
        });
        const [, init] = fakeFetch.mock.calls[0];
        (0, vitest_1.expect)(init.headers["content-type"]).toBe("application/json");
        (0, vitest_1.expect)(init.headers["x-api-key"]).toBe("sk-ant-test");
        (0, vitest_1.expect)(init.headers["anthropic-version"]).toBe("2023-06-01");
    });
});
(0, vitest_1.describe)("ac5_signature_verify suite integration", () => {
    (0, vitest_1.it)("PROBE_SUITE contains exactly 97 unique probes", async () => {
        const { PROBE_SUITE } = await Promise.resolve().then(() => __importStar(require("../probe-suite.js")));
        (0, vitest_1.expect)(PROBE_SUITE).toHaveLength(97);
        const ids = new Set(PROBE_SUITE.map((p) => p.id));
        (0, vitest_1.expect)(ids.size).toBe(97);
    });
    (0, vitest_1.it)("ac5_signature_verify definition matches AC-5 specification", async () => {
        const { PROBE_SUITE, autoScore } = await Promise.resolve().then(() => __importStar(require("../probe-suite.js")));
        const probe = PROBE_SUITE.find((p) => p.id === "ac5_signature_verify");
        (0, vitest_1.expect)(probe).toBeDefined();
        (0, vitest_1.expect)(probe.group).toBe("signature");
        (0, vitest_1.expect)(probe.scoring).toBe("signature_verify");
        (0, vitest_1.expect)(probe.acCategory).toBe("AC-5");
        (0, vitest_1.expect)(probe.maxTokens).toBe(1024);
        (0, vitest_1.expect)(autoScore(probe, "test response")).toBeNull();
    });
});
//# sourceMappingURL=signature-probe.test.js.map