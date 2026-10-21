import { describe, it, expect, vi } from "vitest";
import {
  MAX_SIGNATURE_RESPONSE_BYTES,
  buildRoundtripBody,
  extractThinkingBlock,
  getThinkingConfig,
  readBoundedResponse,
  verifySignatureRoundtrip,
  type AnthropicThinkingBlock,
} from "../signature-probe.js";

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

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("extractThinkingBlock", () => {
  it("returns the thinking block when present", () => {
    const result = extractThinkingBlock(GENUINE_RESPONSE);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("thinking");
    expect(result!.signature).toMatch(/^ErcBCkg/);
    expect(result!.thinking).toContain("2+2");
  });

  it("returns null when content array has no thinking block", () => {
    const noThinking = { ...GENUINE_RESPONSE, content: [{ type: "text", text: "4" }] };
    expect(extractThinkingBlock(noThinking)).toBeNull();
  });

  it("returns null when signature is missing from the thinking block", () => {
    const noSig = {
      ...GENUINE_RESPONSE,
      content: [{ type: "thinking", thinking: "..." }],
    };
    expect(extractThinkingBlock(noSig)).toBeNull();
  });

  it("returns null when signature is empty string", () => {
    const emptySig = {
      ...GENUINE_RESPONSE,
      content: [{ type: "thinking", thinking: "...", signature: "" }],
    };
    expect(extractThinkingBlock(emptySig)).toBeNull();
  });

  it("returns null on malformed input", () => {
    expect(extractThinkingBlock(null)).toBeNull();
    expect(extractThinkingBlock({})).toBeNull();
    expect(extractThinkingBlock({ content: "not an array" })).toBeNull();
  });
});

describe("getThinkingConfig", () => {
  it.each([
    "claude-fable-5",
    "anthropic/claude-fable-5-1",
    "claude-sonnet-4-6",
    "claude-sonnet-5-5-20261001",
    "claude-opus-4-8",
    "claude-opus-5",
  ])("uses adaptive thinking for %s", (model) => {
    expect(getThinkingConfig(model)).toEqual({ type: "adaptive" });
  });

  it.each([
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-3-7-sonnet-latest",
    "relay-model",
  ])("uses a token budget for legacy or unknown model %s", (model) => {
    expect(getThinkingConfig(model)).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
  });
});

describe("readBoundedResponse", () => {
  it("reads a streamed response within the limit", async () => {
    await expect(readBoundedResponse(response("ok"))).resolves.toBe("ok");
  });

  it("rejects a response larger than the configured limit", async () => {
    const oversized = "x".repeat(MAX_SIGNATURE_RESPONSE_BYTES + 1);
    await expect(readBoundedResponse(response(oversized))).rejects.toThrow(
      `Signature response too large (max ${MAX_SIGNATURE_RESPONSE_BYTES} bytes)`,
    );
  });

  it("returns an empty string for a response without a body", async () => {
    await expect(readBoundedResponse(new Response(null, { status: 204 }))).resolves.toBe("");
  });
});

describe("buildRoundtripBody", () => {
  const block: AnthropicThinkingBlock = {
    type: "thinking",
    thinking: "Let me think about this.",
    signature: "ErcBCkgIBhABGAIiQI6testsig=",
  };

  it("builds a 2-turn legacy body echoing the thinking block unchanged", () => {
    const body = buildRoundtripBody({
      model: "claude-opus-4-5",
      originalUserPrompt: "What is 2+2?",
      thinkingBlock: block,
      assistantText: "4",
      followUpUserPrompt: "And 3+3?",
    });

    expect(body.model).toBe("claude-opus-4-5");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: expect.any(Number) });
    expect(body.thinking.type).toBe("enabled");
    if (body.thinking.type === "enabled") {
      expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
    }
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: "user", content: "What is 2+2?" });
    expect(body.messages[1].role).toBe("assistant");
    const assistantContent = body.messages[1].content as Array<{ type: string }>;
    expect(Array.isArray(assistantContent)).toBe(true);
    expect(assistantContent[0].type).toBe("thinking");
    expect((assistantContent[0] as AnthropicThinkingBlock).signature).toBe(block.signature);
    expect(assistantContent[1].type).toBe("text");
    expect(body.messages[2]).toEqual({ role: "user", content: "And 3+3?" });
  });

  it("uses adaptive thinking without budget_tokens for current models", () => {
    const body = buildRoundtripBody({
      model: "claude-opus-5-5",
      originalUserPrompt: "q",
      thinkingBlock: block,
      assistantText: "a",
      followUpUserPrompt: "q2",
    });

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.thinking).not.toHaveProperty("budget_tokens");
  });

  it("never mutates the passed-in thinking block", () => {
    const original = { ...block };
    buildRoundtripBody({
      model: "claude-opus-4-5",
      originalUserPrompt: "q",
      thinkingBlock: block,
      assistantText: "a",
      followUpUserPrompt: "q2",
    });
    expect(block).toEqual(original);
  });
});

describe("verifySignatureRoundtrip", () => {
  const block: AnthropicThinkingBlock = {
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

  it("returns { verified: true } on HTTP 200", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("{}"));
    const result = await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });
    expect(result.verified).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.rawErrorSnippet).toBeNull();
    expect(JSON.stringify(result)).not.toContain(block.signature);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("returns { verified: false, reason: 'signature_rejected' } on HTTP 400", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response(JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "invalid signature" },
    }), 400));
    const result = await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_rejected");
    expect(result.httpStatus).toBe(400);
  });

  it("returns { verified: false, reason: 'http_error' } on 5xx", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("bad gateway", 502));
    const result = await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("http_error");
    expect(result.httpStatus).toBe(502);
  });

  it("sends POST with x-api-key header and echoes signature in body", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("{}"));
    await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });
    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBeDefined();
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: Array<AnthropicThinkingBlock> }> };
    expect(body.messages[1].content[0].signature).toBe(block.signature);
  });

  it("supports authHeader: 'authorization' for Bearer-style relays", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("{}"));
    await verifySignatureRoundtrip({
      ...baseArgs,
      authHeader: "authorization",
      fetchImpl: fakeFetch,
    });
    const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe("Bearer sk-ant-test");
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("returns { verified: false, reason: 'network_error' } when fetch throws", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("network_error");
    expect(result.httpStatus).toBe(0);
    expect(result.rawErrorSnippet).toContain("ECONNREFUSED");
  });

  it("propagates caller cancellation instead of recording a network error", async () => {
    const controller = new AbortController();
    controller.abort("cancelled by caller");
    const aborted = new DOMException("cancelled", "AbortError");
    const fakeFetch = vi.fn().mockRejectedValue(aborted);

    await expect(verifySignatureRoundtrip({
      ...baseArgs,
      fetchImpl: fakeFetch,
      signal: controller.signal,
    })).rejects.toBe(aborted);
  });

  it("redacts API keys and custom-header values from network errors", async () => {
    const customSecret = "custom-secret-value";
    const fakeFetch = vi.fn().mockRejectedValue(
      new Error(`failed with sk-ant-test and ${customSecret}`),
    );
    const result = await verifySignatureRoundtrip({
      ...baseArgs,
      customHeaders: { "X-Relay-Secret": customSecret },
      fetchImpl: fakeFetch,
    });

    expect(result.rawErrorSnippet).not.toContain("sk-ant-test");
    expect(result.rawErrorSnippet).not.toContain(customSecret);
  });

  it("redacts signature bytes and secrets from upstream errors", async () => {
    const customSecret = "custom-secret-value";
    const fakeFetch = vi.fn().mockResolvedValue(response(
      `invalid ${block.signature} sk-ant-test ${customSecret}`,
      400,
    ));
    const result = await verifySignatureRoundtrip({
      ...baseArgs,
      customHeaders: { "X-Relay-Secret": customSecret },
      fetchImpl: fakeFetch,
    });

    expect(result.reason).toBe("signature_rejected");
    expect(result.rawErrorSnippet).not.toContain(block.signature);
    expect(result.rawErrorSnippet).not.toContain("sk-ant-test");
    expect(result.rawErrorSnippet).not.toContain(customSecret);
  });

  it("rejects oversized verification responses", async () => {
    const oversized = "x".repeat(MAX_SIGNATURE_RESPONSE_BYTES + 1);
    const fakeFetch = vi.fn().mockResolvedValue(response(oversized, 502));
    const result = await verifySignatureRoundtrip({ ...baseArgs, fetchImpl: fakeFetch });

    expect(result.verified).toBe(false);
    expect(result.reason).toBe("http_error");
    expect(result.rawErrorSnippet).toContain("Signature response too large");
  });

  it("forwards customHeaders to upstream request", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("{}"));
    await verifySignatureRoundtrip({
      ...baseArgs,
      customHeaders: { "X-Custom-Tracking": "relay-audit-123" },
      fetchImpl: fakeFetch,
    });
    const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["X-Custom-Tracking"]).toBe("relay-audit-123");
  });

  it("prevents customHeaders from overriding required transport and auth headers", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(response("{}"));
    await verifySignatureRoundtrip({
      ...baseArgs,
      customHeaders: {
        "content-type": "text/plain",
        "x-api-key": "attacker-key",
        "anthropic-version": "1999-01-01",
      },
      fetchImpl: fakeFetch,
    });
    const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("ac5_signature_verify suite integration", () => {
  it("PROBE_SUITE contains exactly 100 unique probes", async () => {
    const { PROBE_SUITE } = await import("../probe-suite.js");
    expect(PROBE_SUITE).toHaveLength(100);
    const ids = new Set(PROBE_SUITE.map((p) => p.id));
    expect(ids.size).toBe(100);
  });

  it("ac5_signature_verify definition matches AC-5 specification", async () => {
    const { PROBE_SUITE, autoScore } = await import("../probe-suite.js");
    const probe = PROBE_SUITE.find((p) => p.id === "ac5_signature_verify");
    expect(probe).toBeDefined();
    expect(probe!.group).toBe("signature");
    expect(probe!.scoring).toBe("signature_verify");
    expect(probe!.acCategory).toBe("AC-5");
    expect(probe!.maxTokens).toBe(1024);
    expect(autoScore(probe!, "test response")).toBeNull();
  });
});
