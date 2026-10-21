// src/runner.ts — Core probe runner for @bazaarlink/probe-engine (MIT)
// No framework dependencies — uses only Node.js 18+ built-in fetch.

import { PROBE_SUITE, autoScore, generateCanary, type ProbeDefinition } from "./probe-suite.js";
import { computeProbeScore } from "./probe-score.js";
import { classifyPreflightResult } from "./probe-preflight.js";
import { detectTokenInflation, TOKEN_INFLATION_THRESHOLD } from "./token-inflation.js";
import { checkSSECompliance } from "./sse-compliance.js";
import { runContextCheck } from "./context-check.js";
import { extractFingerprint } from "./fingerprint-extractor.js";
import { matchCandidates, deriveVerdictFromClaimedModel, deriveFamilyVerdict } from "./candidate-matcher.js";
import { claimedModelToFamily } from "./fingerprint-baseline.js";
import { classifyChannelSignature } from "./channel-signature.js";
import { extractThinkingBlock, getThinkingConfig, MAX_SIGNATURE_RESPONSE_BYTES, readBoundedResponse, verifySignatureRoundtrip } from "./signature-probe.js";
import { judgeFingerprint } from "./fingerprint-judge.js";
import { embedProbeResponses, pickTopVectorScores, type ReferenceEmbedding } from "./fingerprint-vectors.js";
import { fuseScores } from "./fingerprint-fusion.js";
import type { IdentityAssessment } from "./identity-report.js";
import { combineSignals, createSafeFetch, validateUrl, type EgressOptions } from "./egress-guard.js";
import { createRetryingFetch, retryCountOf } from "./retry-fetch.js";
import { customHeaderSecrets, mergeCustomHeaders } from "./custom-headers.js";
import { boundError, redactSecrets } from "./redaction.js";

export interface ProbeResult {
  probeId: string;
  label: string;
  group: string;
  neutral: boolean;
  status: "done" | "error" | "skipped";
  passed: true | false | "warning" | null;
  passReason: string | null;
  ttftMs: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tps: number | null;
  response: string | null;
  error: string | null;
  /** Scoring mode of the probe, for consumer-side expected/actual display. */
  scoring?: string;
  /** Expected/reference response (or containment keywords) for auditability. */
  expected?: string | null;
}

export interface RunReport {
  baseUrl: string;
  modelId: string;
  claimedModel?: string;
  startedAt: string;
  completedAt: string;
  score: number;       // conservative 0-100
  scoreMax: number;    // optimistic 0-100
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  results: ProbeResult[];
  identityAssessment?: IdentityAssessment;
}

/**
 * Baseline responses keyed by probeId.
 * Obtained from `collect-baseline` or downloaded from the BazaarLink public API.
 */
export type BaselineMap = Record<string, string>;

/** Cap for reading the non-OK preflight response body before classification. */
const MAX_PREFLIGHT_RESPONSE_BYTES = 64 * 1024;

/** Cap for total bytes accumulated from a streaming (SSE) probe response. */
const MAX_STREAM_RESPONSE_BYTES = 1024 * 1024;

/** Bounded body read + parse so a hostile upstream can't buffer unlimited bytes. */
async function readBoundedJson<T>(res: Response, maxBytes = MAX_SIGNATURE_RESPONSE_BYTES): Promise<T> {
  return JSON.parse(await readBoundedResponse(res, maxBytes)) as T;
}

export interface RunOptions {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Include optional probes (e.g. context_length). Default: false */
  includeOptional?: boolean;
  /**
   * Ordered probe IDs to execute. Unknown IDs and duplicates are rejected.
   * When omitted, the full engine suite is used for backward compatibility.
   */
  probeIds?: string[];
  /**
   * Transport-level retries per request (network errors, 5xx, 429).
   * Semantic failures are never retried. Default: 2. Use 0 to disable.
   */
  requestRetries?: number;
  /** Timeout per probe request in ms. Default: 180_000 */
  timeoutMs?: number;
  /** Called after each probe completes */
  onProgress?: (result: ProbeResult, index: number, total: number) => void;
  /** Extra headers merged into every target-phase request (never overrides Authorization/Content-Type/probe extras). */
  customHeaders?: Record<string, string>;
  /** Judge endpoint for llm_judge probes (optional; skipped if absent) */
  judge?: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    /** Score threshold 1-10. Default: 7 */
    threshold?: number;
    /** Extra headers sent only on judge requests. */
    customHeaders?: Record<string, string>;
  };
  /**
   * Baseline responses to compare against during llm_judge scoring.
   * Keys are probeIds; values are the trusted baseline response text.
   * When provided, the judge compares candidate vs baseline for similarity (1-10).
   * Without a baseline, llm_judge probes are skipped.
   */
  baseline?: BaselineMap;
  /**
   * The model name the operator claims is running behind this endpoint.
   * When provided, the identity phase compares observed behavior against this family.
   */
  claimedModel?: string;
  /**
   * Judge endpoint for identity fingerprinting (optional LLM judge signal).
   * When supplied, the identity phase calls this judge to classify model family.
   */
  identityJudge?: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
  };
  /**
   * Embeddings endpoint for identity fingerprinting (optional vector signal).
   * When supplied, probe responses are embedded and compared against family references.
   */
  embeddingEndpoint?: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    /** Reference embeddings (family → embedding vector). If absent, vector signal is skipped. */
    references?: ReferenceEmbedding[];
  };
  /** External AbortSignal to cancel the entire probe run */
  signal?: AbortSignal;
  /** Custom fetch implementation (defaults to safeFetch if egressOptions provided, else global fetch) */
  fetchFn?: typeof fetch;
  /** Egress guard options (SSRF defense, port allowlist, etc.) */
  egressOptions?: EgressOptions;
}

function parseJudgeScore(text: string): { score: number; reason: string } | null {
  const candidates: string[] = [];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  const braceMatch = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
  if (braceMatch) candidates.push(braceMatch[0]);
  candidates.push(text.trim());
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as { score?: unknown; reason?: unknown };
      const score = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
      if (!isNaN(score) && score >= 1 && score <= 10) {
        return { score: Math.round(score), reason: String(parsed.reason ?? "") };
      }
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Runs the similarity-based judge — mirrors `buildJudgePrompt` in the production route.
 * Judge scores 1-10: how similar is the candidate response to the baseline response?
 */
async function runJudgeWithBaseline(
  judgeUrl: string,
  apiKey: string,
  modelId: string,
  probe: ProbeDefinition,
  candidateResponse: string,
  baselineResponse: string,
  threshold: number,
  timeoutMs: number,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
  customHeaders?: Record<string, string>,
): Promise<{ passed: boolean | null; reason: string }> {
  const judgePrompt = `You are evaluating whether two AI responses are from the same underlying model.

Original probe question: "${probe.prompt.slice(0, 300)}"

Baseline response (from official API):
${baselineResponse.slice(0, 2000)}

Candidate response (under test):
${candidateResponse.slice(0, 2000)}

Score how similar these responses are on a scale of 1-10, where:
- 10: Identical or near-identical content, style, and capability level
- 7-9: Very similar, minor variations in phrasing
- 4-6: Somewhat similar, possible different capability level or style
- 1-3: Very different, likely a different model family or capability tier

Respond ONLY with valid JSON: {"score": <number 1-10>, "reason": "<one sentence>"}`;

  try {
    const judgeHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    mergeCustomHeaders(judgeHeaders, customHeaders);
    const res = await fetchFn(`${judgeUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: judgeHeaders,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: "You are a strict JSON-only evaluator. Respond ONLY with the JSON object requested." },
          { role: "user", content: judgePrompt },
        ],
        stream: false,
        max_tokens: 256,
        temperature: 0,
      }),
      signal: combineSignals(timeoutMs, signal),
    });
    if (!res.ok) return { passed: null, reason: `Judge API error: HTTP ${res.status}` };
    const data = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }> }>(res);
    const text = data.choices?.[0]?.message?.content ?? "";
    const scored = parseJudgeScore(text);
    if (!scored) return { passed: null, reason: `Judge returned unparseable response: ${text.slice(0, 100)}` };
    return {
      passed: scored.score >= threshold,
      reason: `Similarity score: ${scored.score}/10 (threshold: ${threshold}) — ${scored.reason}`,
    };
  } catch (e) {
    return { passed: null, reason: `Judge call failed: ${(e as Error).message?.slice(0, 100)}` };
  }
}

/**
 * Rubric-based judge fallback for probes without a baseline entry: the judge
 * LLM scores the candidate response against the probe question directly
 * (instruction adherence, correctness, refusal-to-answer detection).
 */
async function runJudgeRubric(
  judgeUrl: string,
  apiKey: string,
  modelId: string,
  probe: ProbeDefinition,
  candidateResponse: string,
  threshold: number,
  timeoutMs: number,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
  customHeaders?: Record<string, string>,
): Promise<{ passed: boolean | null; reason: string }> {
  const judgePrompt = `You are grading an AI response against its original question.

Question asked to the model under test:
"${probe.prompt.slice(0, 500)}"

Response under test:
${candidateResponse.slice(0, 2000)}

Score 1-10 on: instruction adherence, factual correctness, and whether the answer actually attempts the question (a refusal or empty answer scores 1-2).
- 8-10: follows the instruction and answers correctly
- 6-7: answers with minor issues
- 1-5: ignores instructions, wrong, or refuses

Respond ONLY with valid JSON: {"score": <number 1-10>, "reason": "<one sentence>"}`;

  try {
    const judgeHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    mergeCustomHeaders(judgeHeaders, customHeaders);
    const res = await fetchFn(`${judgeUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: judgeHeaders,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: "You are a strict JSON-only evaluator. Respond ONLY with the JSON object requested." },
          { role: "user", content: judgePrompt },
        ],
        stream: false,
        max_tokens: 256,
        temperature: 0,
      }),
      signal: combineSignals(timeoutMs, signal),
    });
    if (!res.ok) return { passed: null, reason: `Judge API error: HTTP ${res.status}` };
    const data = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }> }>(res);
    const text = data.choices?.[0]?.message?.content ?? "";
    const scored = parseJudgeScore(text);
    if (!scored) return { passed: null, reason: `Judge returned unparseable response: ${text.slice(0, 100)}` };
    return {
      passed: scored.score >= threshold,
      reason: `Rubric score: ${scored.score}/10 (threshold: ${threshold}) — ${scored.reason}`,
    };
  } catch (e) {
    return { passed: null, reason: `Judge call failed: ${(e as Error).message?.slice(0, 100)}` };
  }
}

export async function runProbes(options: RunOptions): Promise<RunReport> {
  const {
    baseUrl,
    apiKey,
    modelId,
    includeOptional = false,
    timeoutMs = 180_000,
    onProgress,
    judge,
    baseline,
    customHeaders,
  } = options;

  if (options.signal?.aborted) {
    throw new Error(`Probe run aborted: ${options.signal.reason || "aborted"}`);
  }

  if (options.egressOptions) {
    validateUrl(baseUrl, options.egressOptions);
    if (judge?.baseUrl) validateUrl(judge.baseUrl, options.egressOptions);
    if (options.identityJudge?.baseUrl) validateUrl(options.identityJudge.baseUrl, options.egressOptions);
    if (options.embeddingEndpoint?.baseUrl) validateUrl(options.embeddingEndpoint.baseUrl, options.egressOptions);
  }

  const fetchImpl = createRetryingFetch(
    options.fetchFn ?? (options.egressOptions ? createSafeFetch(options.egressOptions) : fetch),
    { retries: options.requestRetries ?? 2, signal: options.signal },
  );
  const outerSignal = options.signal;
  const targetSecrets = [apiKey, ...customHeaderSecrets(customHeaders)];

  const chatUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const startedAt = new Date().toISOString();

  let selectedSuite = PROBE_SUITE;
  if (options.probeIds !== undefined) {
    if (!Array.isArray(options.probeIds) || options.probeIds.length === 0 || options.probeIds.length > PROBE_SUITE.length) {
      throw new Error("probeIds must be a non-empty array within the suite size limit");
    }
    const byId = new Map(PROBE_SUITE.map((probe) => [probe.id, probe]));
    const seen = new Set<string>();
    selectedSuite = options.probeIds.map((id) => {
      if (typeof id !== "string" || !id || seen.has(id)) {
        throw new Error("probeIds must contain unique non-empty strings");
      }
      seen.add(id);
      const probe = byId.get(id);
      if (!probe) throw new Error(`Unknown probe ID: ${id}`);
      return probe;
    });
  }
  // Explicit selectors are authoritative and may include optional probes. The
  // legacy full-suite path keeps includeOptional behavior for API compatibility.
  const probes = options.probeIds !== undefined
    ? selectedSuite
    : selectedSuite.filter(p => includeOptional || !p.optional);
  const results: ProbeResult[] = [];

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const targetHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  mergeCustomHeaders(targetHeaders, customHeaders);

  try {
    const pfRes = await fetchImpl(chatUrl, {
      method: "POST",
      headers: targetHeaders,
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
      signal: combineSignals(45_000, outerSignal),
    });
    if (!pfRes.ok) {
      const rawBody = await readBoundedResponse(pfRes, MAX_PREFLIGHT_RESPONSE_BYTES).catch(() => "");
      const { outcome, reason } = classifyPreflightResult(pfRes.status, rawBody);
      if (outcome === "abort") {
        for (const probe of probes) {
          results.push({ probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "error", passed: false, passReason: null, ttftMs: null, durationMs: null,
            inputTokens: null, outputTokens: null, tps: null, response: null, error: reason });
        }
        const { low, high } = computeProbeScore(results.map(r => ({ status: r.status, passed: r.passed, neutral: r.neutral })));
        return { baseUrl, modelId, startedAt, completedAt: new Date().toISOString(), score: low, scoreMax: high,
          totalInputTokens: null, totalOutputTokens: null, results };
      }
    }
  } catch { /* network issues on preflight — proceed anyway */ }

  // ── Run each probe ────────────────────────────────────────────────────────
  let idx = 0;
  for (const probe of probes) {
    if (outerSignal?.aborted) {
      throw new Error(`Probe run aborted: ${outerSignal.reason || "aborted"}`);
    }
    idx++;
    let result: ProbeResult;

    // ── channel_signature ─────────────────────────────────────────────────
    if (probe.scoring === "channel_signature") {
      const t0 = Date.now();
      try {
        const sigHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
        mergeCustomHeaders(sigHeaders, customHeaders);
        const r = await fetchImpl(chatUrl, {
          method: "POST",
          headers: sigHeaders,
          signal: combineSignals(timeoutMs, outerSignal),
        });
        const dur = Date.now() - t0;
        // 128 KiB bound keeps a hostile upstream from exhausting runner memory.
        const bodyText = await readBoundedResponse(r, MAX_SIGNATURE_RESPONSE_BYTES).catch(() => r.text().then((t) => t.slice(0, MAX_SIGNATURE_RESPONSE_BYTES)));
        const responseHeaders: Record<string, string> = {};
        r.headers.forEach((val, key) => { responseHeaders[key.toLowerCase()] = val; });
        let messageId: string | null = null;
        try { messageId = (JSON.parse(bodyText) as { id?: string }).id ?? null; } catch { /* ok */ }
        const sig = classifyChannelSignature({ headers: responseHeaders, messageId, rawBody: bodyText });
        result = {
          probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? true,
          status: "done", passed: null, ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
          response: `channel=${sig.channel} confidence=${sig.confidence} evidence=[${sig.evidence.join(",")}]`,
          passReason: `Upstream channel: ${sig.channel} (confidence: ${(sig.confidence * 100).toFixed(0)}%)`,
          error: null,
        };
      } catch (e) {
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? true,
          status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null,
          inputTokens: null, outputTokens: null, tps: null, response: null, error: (e as Error).message?.slice(0, 300) ?? "Unknown" };
      }
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── adaptive_check (AC-1.b) ───────────────────────────────────────────
    if (probe.scoring === "adaptive_check") {
      if (!probe.adaptiveTriggerPrompt) {
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "skipped", passed: null, passReason: "adaptiveTriggerPrompt not set", ttftMs: null, durationMs: null,
          inputTokens: null, outputTokens: null, tps: null, response: null, error: null };
        results.push(result);
        onProgress?.(result, idx, probes.length);
        continue;
      }
      const t0 = Date.now();
      const makeRequest = async (prompt: string): Promise<string | null> => {
        try {
          const acHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
          mergeCustomHeaders(acHeaders, customHeaders);
          const r = await fetchImpl(chatUrl, {
            method: "POST",
            headers: acHeaders,
            signal: combineSignals(timeoutMs, outerSignal),
          });
          if (!r.ok) return null;
          const d = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }> }>(r);
          return (d.choices?.[0]?.message?.content ?? "").trim();
        } catch { return null; }
      };
      const [neutralResp, triggerResp] = await Promise.all([
        makeRequest(probe.prompt),
        makeRequest(probe.adaptiveTriggerPrompt),
      ]);
      const dur = Date.now() - t0;

      if (!neutralResp || !triggerResp) {
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "done", passed: "warning", passReason: "One or both requests failed — cannot assess",
          ttftMs: null, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
          response: `neutral: ${neutralResp?.slice(0,100) ?? "ERROR"} | trigger: ${triggerResp?.slice(0,100) ?? "ERROR"}`, error: null };
      } else {
        const identical = neutralResp === triggerResp;
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "done", ttftMs: null, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
          response: `neutral: ${neutralResp.slice(0,100)} | trigger: ${triggerResp.slice(0,100)}`,
          passed: identical ? true : false,
          passReason: identical
            ? "Both requests returned identical content — no conditional injection detected"
            : `Responses diverge — possible conditional injection: neutral="${neutralResp.slice(0,60)}" trigger="${triggerResp.slice(0,60)}"`,
          error: null };
      }
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── thinking_check ────────────────────────────────────────────────────
    if (probe.scoring === "thinking_check") {
      const t0 = Date.now();
      try {
        const tcHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "anthropic-beta": "interleaved-thinking-2025-05-14" };
        mergeCustomHeaders(tcHeaders, customHeaders);
        const r = await fetchImpl(chatUrl, {
          method: "POST",
          headers: tcHeaders,
          body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: probe.prompt }], stream: true, max_tokens: 2048, thinking: { type: "enabled", budget_tokens: 1024 } }),
          signal: combineSignals(timeoutMs, outerSignal),
        });
        const dur = Date.now() - t0;
        if (!r.ok) {
          result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: "warning", passReason: `HTTP ${r.status} — provider may not support thinking or beta header`, ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null, response: null, error: null };
        } else {
          let hasThinking = false; let fullT = ""; let ttft: number | null = null;
          let inTok: number | null = null; let outTok: number | null = null;
          if (r.body) {
            const rd = r.body.getReader(); const dc = new TextDecoder(); let buf = "";
            while (true) {
              if (outerSignal?.aborted) {
                await rd.cancel().catch(() => {});
                break;
              }
              const { done, value } = await rd.read(); if (done) break;
              if (ttft === null) ttft = Date.now() - t0;
              buf += dc.decode(value, { stream: true });
              const ls = buf.split("\n"); buf = ls.pop() ?? "";
              for (const l of ls) {
                if (!l.startsWith("data: ")) continue;
                const p2 = l.slice(6).trim(); if (p2 === "[DONE]") continue;
                try {
                  const j = JSON.parse(p2) as Record<string, unknown>;
                  const delta = (j.choices as Array<{ delta?: { content?: string; type?: string } }>)?.[0]?.delta;
                  if (delta?.content) fullT += delta.content;
                  if ((j as { type?: string }).type === "content_block_start") hasThinking = true;
                  if (delta?.type === "thinking") hasThinking = true;
                  const usage = j.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
                  if (usage) { inTok = usage.prompt_tokens ?? null; outTok = usage.completion_tokens ?? null; }
                } catch { /* ignore */ }
              }
            }
          }
          const durationMs = Date.now() - t0;
          result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: hasThinking ? true : "warning",
            passReason: hasThinking ? "Thinking content block detected — provider forwards beta header" : "Response OK but no thinking block — provider may not forward anthropic-beta header",
            ttftMs: ttft ?? durationMs, durationMs, inputTokens: inTok, outputTokens: outTok, tps: null, response: fullT.slice(0, 1000), error: null };
        }
      } catch (e) {
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, response: null, error: (e as Error).message?.slice(0, 300) ?? "Unknown error" };
      }
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── consistency_check ─────────────────────────────────────────────────
    if (probe.scoring === "consistency_check") {
      const t0 = Date.now();
      const responses: string[] = [];
      let inTok: number | null = null; let outTok: number | null = null;
      for (let i = 0; i < 2; i++) {
        if (outerSignal?.aborted) break;
        try {
          const ccHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
          mergeCustomHeaders(ccHeaders, customHeaders);
          const r = await fetchImpl(chatUrl, {
            method: "POST",
            headers: ccHeaders,
            signal: combineSignals(timeoutMs, outerSignal),
          });
          if (!r.ok) { responses.push("__ERROR__"); continue; }
          const d = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>(r);
          responses.push((d.choices?.[0]?.message?.content ?? "").trim());
          if (i === 0) { inTok = d.usage?.prompt_tokens ?? null; outTok = d.usage?.completion_tokens ?? null; }
        } catch { responses.push("__EXCEPTION__"); }
      }
      const ok = responses.length === 2 && !responses.includes("__ERROR__") && !responses.includes("__EXCEPTION__");
      const identical = ok && responses[0] === responses[1];
      result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
        status: "done", durationMs: Date.now() - t0, inputTokens: inTok, outputTokens: outTok,
        response: responses.join(" | "), ttftMs: null, tps: null, error: null,
        passed: !ok ? "warning" : identical ? "warning" : true,
        passReason: !ok ? "One or more requests failed — cannot assess consistency"
          : identical ? `Both responses identical (${responses[0]?.slice(0, 30)}) — possible cache hit`
          : "Responses differ — confirms independent generation" };
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── context_check ──────────────────────────────────────────────────────
    if (probe.scoring === "context_check") {
      const sendFn = async (message: string) => {
        const cxHeaders: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
        mergeCustomHeaders(cxHeaders, customHeaders);
        const r = await fetchImpl(chatUrl, {
          method: "POST",
          headers: cxHeaders,
          body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: message }], max_tokens: 256, stream: false }),
          signal: combineSignals(timeoutMs, outerSignal),
        });
        const j = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }> }>(r);
        return j.choices?.[0]?.message?.content ?? "";
      };
      try {
        const ctx = await runContextCheck(sendFn);
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "done", ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null,
          response: ctx.reason, passed: ctx.warning ? "warning" : ctx.passed ? true : false, passReason: ctx.reason, error: null };
      } catch (e) {
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, response: null, error: (e as Error).message?.slice(0, 300) ?? "Unknown error" };
      }
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── signature_verify (AC-5) ──────────────────────────────────────────
    if (probe.scoring === "signature_verify") {
      const t0 = Date.now();
      try {
        const messagesUrl = baseUrl.endsWith("/messages")
          ? baseUrl
          : `${baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "")}/messages`;
        if (options.egressOptions) validateUrl(messagesUrl, options.egressOptions);
        const authHeader: "x-api-key" | "authorization" = apiKey.startsWith("sk-ant-")
          ? "x-api-key"
          : "authorization";

        const initHeaders: Record<string, string> = {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(authHeader === "x-api-key"
            ? { "x-api-key": apiKey }
            : { authorization: `Bearer ${apiKey}` }),
        };
        mergeCustomHeaders(initHeaders, customHeaders);

        const r1 = await fetchImpl(messagesUrl, {
          method: "POST",
          headers: initHeaders,
          body: JSON.stringify({
            model: modelId,
            max_tokens: Math.max(probe.maxTokens ?? 1536, 1536),
            thinking: getThinkingConfig(modelId),
            messages: [{ role: "user", content: probe.prompt }],
          }),
          signal: combineSignals(timeoutMs, outerSignal),
        });

        const initialBodyText = await readBoundedResponse(r1);
        if (!r1.ok) {
          const errBody = redactSecrets(initialBodyText, targetSecrets);
          const dur = Date.now() - t0;
          result = {
            probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: false,
            passReason: `Initial request failed (HTTP ${r1.status}): ${errBody.slice(0, 200) || "error"}`,
            ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
            response: null, error: errBody.slice(0, 300) || `HTTP ${r1.status}`,
          };
          results.push(result);
          onProgress?.(result, idx, probes.length);
          continue;
        }

        let raw: unknown = null;
        try {
          raw = JSON.parse(initialBodyText);
        } catch {
          raw = null;
        }
        const thinkingBlock = extractThinkingBlock(raw) ??
          (raw && typeof raw === "object" && "choices" in raw ? extractThinkingBlock((raw as any).choices?.[0]?.message) : null);

        if (!thinkingBlock) {
          const dur = Date.now() - t0;
          result = {
            probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: false,
            passReason: "No thinking block with signature returned by upstream",
            ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
            response: raw && typeof raw === "object"
              ? redactSecrets(JSON.stringify(raw), targetSecrets).slice(0, 1000)
              : null,
            error: null,
          };
          results.push(result);
          onProgress?.(result, idx, probes.length);
          continue;
        }

        let assistantText = "";
        if (raw && typeof raw === "object") {
          const content = (raw as { content?: unknown }).content ?? (raw as any)?.choices?.[0]?.message?.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
                assistantText += b.text;
              }
            }
          } else if (typeof content === "string") {
            assistantText = content;
          }
        }
        if (!assistantText) assistantText = "Understood.";

        const verifyRes = await verifySignatureRoundtrip({
          endpoint: messagesUrl,
          apiKey,
          model: modelId,
          originalUserPrompt: probe.prompt,
          thinkingBlock,
          assistantText,
          followUpUserPrompt: "Confirm.",
          authHeader,
          fetchImpl,
          signal: combineSignals(timeoutMs, outerSignal),
          customHeaders,
        });

        const dur = Date.now() - t0;
        if (verifyRes.verified) {
          const retries = Math.max(retryCountOf(r1), verifyRes.retries ?? 0);
          result = {
            probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: true,
            passReason: "Thinking signature successfully verified by upstream roundtrip"
              + (retries > 0 ? ` (after ${retries} transport ${retries === 1 ? "retry" : "retries"})` : ""),
            ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
            response: "verified=true",
            error: null,
          };
        } else {
          const failReason = verifyRes.reason === "signature_rejected"
            ? `Signature rejected by upstream (HTTP 400): ${verifyRes.rawErrorSnippet?.slice(0, 200) || "invalid signature"}`
            : verifyRes.reason === "http_error"
              ? `Upstream verification failed with HTTP ${verifyRes.httpStatus}: ${verifyRes.rawErrorSnippet?.slice(0, 200) || "error"}`
              : `Network error during verification: ${verifyRes.rawErrorSnippet?.slice(0, 200) || "error"}`;
          result = {
            probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
            status: "done", passed: false,
            passReason: failReason,
            ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
            response: null,
            error: verifyRes.rawErrorSnippet?.slice(0, 300) ?? failReason,
          };
        }
      } catch (e) {
        if (outerSignal?.aborted) {
          throw new Error(`Probe run aborted: ${outerSignal.reason || "aborted"}`);
        }
        const dur = Date.now() - t0;
        result = {
          probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "error", passed: null, passReason: null, ttftMs: null, durationMs: dur,
          inputTokens: null, outputTokens: null, tps: null, response: null,
          error: boundError(e, 300, targetSecrets),
        };
      }
      results.push(result);
      onProgress?.(result, idx, probes.length);
      continue;
    }

    // ── Standard probes (stream or non-stream) ────────────────────────────
    const startTime = Date.now();
    let ttftMs: number | null = null;

    try {
      // ── Dynamic canary: generate, substitute, remember for autoScore ────
      let effectivePrompt = probe.prompt;
      let canaryOverride: string | undefined;
      if (probe.dynamicCanary) {
        const canary = generateCanary();
        canaryOverride = canary;
        const placeholder = probe.canaryPlaceholder ?? "{CANARY}";
        effectivePrompt = probe.prompt.replace(placeholder, canary);
      }

      // ── Build messages array (optional system prompt) ───────────────────
      type Msg = { role: string; content: unknown };
      const messages: Msg[] = [];
      if (probe.systemPrompt) {
        messages.push({ role: "system", content: probe.systemPrompt });
      }

      // ── Build user content (text or multimodal) ─────────────────────────
      let userContent: unknown;
      if (probe.multimodalContent) {
        const mc = probe.multimodalContent;
        if (mc.kind === "image") {
          userContent = [
            { type: "image_url", image_url: { url: `data:${mc.mediaType};base64,${mc.dataB64}` } },
            { type: "text", text: effectivePrompt },
          ];
        } else {
          // pdf — send as a text block with a data URI annotation; not all providers support native PDF
          userContent = [
            { type: "text", text: `[Attached document (${mc.mediaType}), base64: data:${mc.mediaType};base64,${mc.dataB64.slice(0, 64)}…]\n\n${effectivePrompt}` },
          ];
        }
      } else {
        userContent = effectivePrompt;
      }
      messages.push({ role: "user", content: userContent });

      // ── max_tokens: per-probe override → scoring fallback ───────────────
      // Reasoning models burn hidden CoT tokens before the visible answer, so
      // the exact-answer budget must leave headroom or they return "".
      const isExact = probe.scoring === "exact_match" || probe.scoring === "exact_response";
      const maxTokens = probe.maxTokens ?? (isExact ? 768 : 1024);

      const useStream = probe.scoring !== "header_check";
      const rawSseLines: string[] = [];
      let fullText = "";
      let responseHeaders: Record<string, string> = {};
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;

      const stdHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      mergeCustomHeaders(stdHeaders, customHeaders);
      const res = await fetchImpl(chatUrl, {
        method: "POST",
        headers: stdHeaders,
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: useStream,
          ...(useStream ? { stream_options: { include_usage: true } } : {}),
          max_tokens: maxTokens,
          temperature: isExact ? 0 : 0.3,
        }),
        signal: combineSignals(timeoutMs, outerSignal),
      });

      if (!res.ok) {
        // 64 KiB bound on the error body so a hostile upstream can't flood memory.
        const errText = await readBoundedResponse(res, 64 * 1024).catch(() => "");
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "error", passed: null, passReason: null, ttftMs: null, durationMs: Date.now() - startTime,
          inputTokens: null, outputTokens: null, tps: null, response: null, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
        results.push(result);
        onProgress?.(result, idx, probes.length);
        continue;
      }

      // Capture response headers
      res.headers.forEach((val, key) => { responseHeaders[key.toLowerCase()] = val; });

      if (useStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let streamBytes = 0;
        while (true) {
          if (outerSignal?.aborted) {
            await reader.cancel().catch(() => {});
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (ttftMs === null) ttftMs = Date.now() - startTime;
          streamBytes += value.byteLength;
          if (streamBytes > MAX_STREAM_RESPONSE_BYTES) {
            await reader.cancel("Response stream too large").catch(() => {});
            throw new Error(`Probe response stream too large (max ${MAX_STREAM_RESPONSE_BYTES} bytes)`);
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            rawSseLines.push(payload);
            if (payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
              if (chunk.choices?.[0]?.delta?.content) fullText += chunk.choices[0].delta.content;
              if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? null; outputTokens = chunk.usage.completion_tokens ?? null; }
            } catch { /* ignore */ }
          }
        }
      } else {
        const data = await readBoundedJson<{ choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>(res);
        fullText = data.choices?.[0]?.message?.content ?? "";
        inputTokens = data.usage?.prompt_tokens ?? null;
        outputTokens = data.usage?.completion_tokens ?? null;
      }

      const durationMs = Date.now() - startTime;
      const tps = (outputTokens && durationMs > 0) ? Math.round(outputTokens / (durationMs / 1000)) : null;

      // ── token_check ──────────────────────────────────────────────────────
      if (probe.scoring === "token_check") {
        const inflation = inputTokens !== null ? detectTokenInflation(inputTokens, TOKEN_INFLATION_THRESHOLD) : null;
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "done", ttftMs: ttftMs ?? durationMs, durationMs, inputTokens, outputTokens, tps,
          response: fullText.slice(0, 1000), error: null,
          passed: inflation ? (inflation.detected ? false : true) : "warning",
          passReason: inflation
            ? (inflation.detected ? `Token inflation detected: prompt_tokens=${inflation.actualPromptTokens} (threshold: ${TOKEN_INFLATION_THRESHOLD}) — probable hidden system prompt injection` : `No inflation: prompt_tokens=${inflation.actualPromptTokens}`)
            : "Token count not available" };
        results.push(result);
        onProgress?.(result, idx, probes.length);
        continue;
      }

      // ── sse_compliance ───────────────────────────────────────────────────
      if (probe.scoring === "sse_compliance") {
        const compliance = checkSSECompliance(rawSseLines);
        result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
          status: "done", ttftMs: ttftMs ?? durationMs, durationMs, inputTokens, outputTokens, tps,
          response: fullText.slice(0, 500), error: null,
          passed: compliance.passed ? true : (compliance.warning ? "warning" : false),
          passReason: compliance.passed
            ? `SSE format OK (${compliance.dataLines} chunks, [DONE] confirmed)${compliance.warning ? ` — ${compliance.missingChoicesCount} chunks missing choices field` : ""}`
            : compliance.issues.join("; ") };
        results.push(result);
        onProgress?.(result, idx, probes.length);
        continue;
      }

      // ── Auto-scoreable (exact_match, keyword_match, header_check, exact_response) ─
      // English is the canonical dashboard language; the dynamic canary rides
      // in opts, not the lang slot.
      const autoResult = autoScore(probe, fullText, responseHeaders, "en", { overrideExpectedExact: canaryOverride });
      let passed: true | false | "warning" | null = null;
      let passReason: string | null = null;

      if (autoResult) {
        passed = autoResult.passed;
        passReason = autoResult.reason;
      } else if (probe.scoring === "feature_extract") {
        passed = null;
        passReason = "identity feature probe — response collected for fingerprint analysis";
      } else if (probe.scoring === "llm_judge") {
        // Prefer baseline similarity; fall back to a rubric grade when the
        // model has no published baseline so quality probes never sit gray.
        if (judge && baseline && baseline[probe.id]) {
          const judged = await runJudgeWithBaseline(
            judge.baseUrl, judge.apiKey, judge.modelId, probe, fullText,
            baseline[probe.id], judge.threshold ?? 7, timeoutMs,
            outerSignal, fetchImpl, judge.customHeaders,
          );
          passed = judged.passed === null ? null : judged.passed ? true : false;
          passReason = judged.reason;
        } else if (judge) {
          const judged = await runJudgeRubric(
            judge.baseUrl, judge.apiKey, judge.modelId, probe, fullText,
            judge.threshold ?? 7, timeoutMs,
            outerSignal, fetchImpl, judge.customHeaders,
          );
          passed = judged.passed === null ? null : judged.passed ? true : false;
          passReason = judged.reason;
        } else {
          passed = null;
          passReason = "llm_judge: no judge endpoint configured — pass --judge-base-url to enable auto-scoring";
        }
      }

      const transportRetries = retryCountOf(res);
      if (transportRetries > 0 && passReason) {
        passReason += ` (after ${transportRetries} transport ${transportRetries === 1 ? "retry" : "retries"})`;
      }

      // Surface the reference the response was judged against so the dashboard
      // can show expected-vs-actual without reverse-engineering passReason.
      const expected = probe.expectedExact ?? probe.expectedContains
        ?? (probe.passIfContains?.length ? probe.passIfContains.join(" | ") : null);

      result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
        status: "done", ttftMs: ttftMs ?? durationMs, durationMs, inputTokens, outputTokens, tps,
        response: fullText.slice(0, 4000), passed, passReason, error: null,
        scoring: probe.scoring, expected };

    } catch (err) {
      result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
        status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null,
        inputTokens: null, outputTokens: null, tps: null, response: null,
        error: ((err as Error).message ?? "Unknown error").slice(0, 300) };
    }

    results.push(result);
    onProgress?.(result, idx, probes.length);
  }

  // ── Identity Phase ────────────────────────────────────────────────────────
  let identityAssessment: IdentityAssessment | undefined;
  {
    const featureResponses: Record<string, string> = {};
    for (const r of results) {
      if (r.status === "done" && r.response) {
        const probe = probes.find(p => p.id === r.probeId);
        if (probe?.scoring === "feature_extract") {
          featureResponses[r.probeId] = r.response;
        }
      }
    }

    const riskFlags: string[] = [];
    for (const r of results) {
      if (r.passed === false) {
        const probe = probes.find(p => p.id === r.probeId);
        if (probe && (probe.group === "integrity" || probe.group === "security")) {
          riskFlags.push(`${r.label}: ${r.passReason ?? r.error ?? "failed"}`);
        }
      }
      if (r.passed === "warning" && r.probeId === "consistency_check") {
        riskFlags.push("consistency_check warning: possible cache hit — fingerprint confidence reduced");
      }
    }

    if (Object.keys(featureResponses).length > 0) {
      const features = extractFingerprint(featureResponses);

      // Rule-based candidates (always run)
      const ruleCandidates = matchCandidates(features);
      const ruleScores = ruleCandidates.map(c => ({ family: c.family, score: c.score }));

      // Optional LLM judge signal
      let judgeScores: Array<{ family: string; score: number }> = [];
      if (options.identityJudge) {
        try {
          const judgeResult = await judgeFingerprint(
            featureResponses,
            options.identityJudge.baseUrl,
            options.identityJudge.apiKey,
            options.identityJudge.modelId,
            { signal: outerSignal, fetchFn: fetchImpl },
          );
          judgeScores = judgeResult.scores;
        } catch { /* judge unavailable — fall back to rule-only */ }
      }

      // Optional vector signal
      let vectorScores: Array<{ family: string; score: number }> = [];
      if (options.embeddingEndpoint?.references?.length) {
        try {
          const embedding = await embedProbeResponses(
            featureResponses,
            options.embeddingEndpoint.baseUrl,
            options.embeddingEndpoint.apiKey,
            options.embeddingEndpoint.modelId,
            { signal: outerSignal, fetchFn: fetchImpl },
          );
          if (embedding !== null) {
            vectorScores = pickTopVectorScores(embedding, options.embeddingEndpoint.references);
          }
        } catch { /* embeddings unavailable — fall back */ }
      }

      // Fuse all signals (W_RULE=0.4, W_JUDGE=0.4, W_VECTOR=0.2)
      // fuseScores returns IdentityCandidate[] directly
      const candidates = fuseScores(ruleScores, judgeScores, vectorScores);

      const { status, confidence, evidence, predictedFamily } = deriveVerdictFromClaimedModel(
        candidates,
        options.claimedModel,
      );
      const claimedFamily = options.claimedModel
        ? claimedModelToFamily(options.claimedModel)
        : undefined;
      const adjustedConfidence = riskFlags.length > 0
        ? Math.max(0, confidence - 0.15 * Math.min(riskFlags.length, 3))
        : confidence;

      identityAssessment = {
        status,
        confidence: Math.round(adjustedConfidence * 100) / 100,
        claimedModel: options.claimedModel,
        predictedFamily,
        predictedCandidates: candidates,
        riskFlags,
        evidence,
        // Original-page verdict: claimed family present among candidates still
        // resolves to "same family — exact model unconfirmed", not a mismatch.
        verdict: {
          ...deriveFamilyVerdict(candidates, claimedFamily),
          trueModel: null,
          spoofMethod: null,
        },
      };
    }
  }

  // ── Finalize ──────────────────────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  const { low, high } = computeProbeScore(results.map(r => ({ status: r.status, passed: r.passed, neutral: r.neutral })));
  const totalIn = results.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const totalOut = results.reduce((s, r) => s + (r.outputTokens ?? 0), 0);

  return {
    baseUrl,
    modelId,
    claimedModel: options.claimedModel,
    startedAt,
    completedAt,
    score: low,
    scoreMax: high,
    totalInputTokens: totalIn > 0 ? totalIn : null,
    totalOutputTokens: totalOut > 0 ? totalOut : null,
    results,
    identityAssessment,
  };
}
