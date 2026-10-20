// src/signature-probe.ts — Anthropic extended-thinking signature round-trip (MIT)
//
// A genuine Anthropic upstream returns an opaque `signature` on every thinking
// content block and will reject a round-tripped message whose signature has been
// altered (HTTP 400 invalid_request_error).
// A middleman that synthesises thinking blocks cannot produce a signature that
// the official verifier accepts.

import { customHeaderSecrets, mergeCustomHeaders } from "./custom-headers.js";
import { boundError, redactSecrets } from "./redaction.js";

export const MAX_SIGNATURE_RESPONSE_BYTES = 128 * 1024;
const THINKING_BUDGET_TOKENS = 1024;
const MAX_TOKENS = 1536;

export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budget_tokens: number };

export function getThinkingConfig(model: string): ThinkingConfig {
  const normalized = model.toLowerCase();
  const usesAdaptiveThinking =
    /(?:^|[-_.])fable[-_.]5(?:[-_.]1)?(?:$|[-_.])/.test(normalized) ||
    /(?:^|[-_.])sonnet[-_.](?:4[-_.]6|5(?:[-_.]5)?)(?:$|[-_.])/.test(normalized) ||
    /(?:^|[-_.])opus[-_.](?:4[-_.](?:6|7|8)|5(?:[-_.]5)?)(?:$|[-_.])/.test(normalized);

  return usesAdaptiveThinking
    ? { type: "adaptive" }
    : { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS };
}

export interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export function extractThinkingBlock(raw: unknown): AnthropicThinkingBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "thinking") continue;
    if (typeof b.signature !== "string" || b.signature.length === 0) continue;
    if (typeof b.thinking !== "string") continue;
    return { type: "thinking", thinking: b.thinking, signature: b.signature };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Round-trip helpers
// ---------------------------------------------------------------------------

export interface RoundtripBodyArgs {
  model: string;
  originalUserPrompt: string;
  thinkingBlock: AnthropicThinkingBlock;
  assistantText: string;
  followUpUserPrompt: string;
}

export interface VerifyArgs extends RoundtripBodyArgs {
  endpoint: string;
  apiKey: string;
  /** Override header style for relays that use Authorization: Bearer instead of x-api-key. */
  authHeader?: "x-api-key" | "authorization";
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  customHeaders?: Record<string, string>;
}

export interface VerifyResult {
  verified: boolean;
  httpStatus: number;
  reason: "ok" | "signature_rejected" | "http_error" | "network_error";
  rawErrorSnippet: string | null;
}

export type RoundtripBody = ReturnType<typeof buildRoundtripBody>;

export async function readBoundedResponse(
  response: Response,
  maxBytes = MAX_SIGNATURE_RESPONSE_BYTES,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Response body too large");
        throw new Error(`Signature response too large (max ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function buildRoundtripBody(args: RoundtripBodyArgs): {
  model: string;
  max_tokens: number;
  thinking: ThinkingConfig;
  messages: Array<{ role: string; content: string | Array<{ type: string; thinking?: string; signature?: string; text?: string }> }>;
} {
  const { model, originalUserPrompt, thinkingBlock, assistantText, followUpUserPrompt } = args;
  return {
    model,
    max_tokens: MAX_TOKENS,
    thinking: getThinkingConfig(model),
    messages: [
      { role: "user", content: originalUserPrompt },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: thinkingBlock.thinking, signature: thinkingBlock.signature },
          { type: "text", text: assistantText },
        ],
      },
      { role: "user", content: followUpUserPrompt },
    ],
  };
}

export async function verifySignatureRoundtrip(args: VerifyArgs): Promise<VerifyResult> {
  const {
    endpoint, apiKey,
    authHeader = "x-api-key",
    fetchImpl = fetch,
    signal,
  } = args;

  const body = buildRoundtripBody(args);
  const secrets = [
    apiKey,
    args.thinkingBlock.signature,
    ...customHeaderSecrets(args.customHeaders),
  ];

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(authHeader === "x-api-key"
      ? { "x-api-key": apiKey }
      : { authorization: `Bearer ${apiKey}` }),
  };
  mergeCustomHeaders(headers, args.customHeaders);

  let resp: Response;
  try {
    resp = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      verified: false,
      httpStatus: 0,
      reason: "network_error",
      rawErrorSnippet: boundError(e, 200, secrets),
    };
  }

  let bodyText = "";
  try {
    bodyText = await readBoundedResponse(resp);
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      verified: false,
      httpStatus: resp.status,
      reason: "http_error",
      rawErrorSnippet: boundError(e, 300, secrets),
    };
  }

  if (resp.ok) {
    return { verified: true, httpStatus: resp.status, reason: "ok", rawErrorSnippet: null };
  }

  const errorSnippet = redactSecrets(bodyText, secrets).slice(0, 300);
  if (resp.status === 400 && bodyText.toLowerCase().includes("invalid")) {
    return { verified: false, httpStatus: 400, reason: "signature_rejected", rawErrorSnippet: errorSnippet };
  }

  return { verified: false, httpStatus: resp.status, reason: "http_error", rawErrorSnippet: errorSnippet };
}
