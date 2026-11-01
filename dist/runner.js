"use strict";
// src/runner.ts — Core probe runner for @bazaarlink/probe-engine (MIT)
// No framework dependencies — uses only Node.js 18+ built-in fetch.
Object.defineProperty(exports, "__esModule", { value: true });
exports.runProbes = runProbes;
const probe_suite_js_1 = require("./probe-suite.js");
const probe_score_js_1 = require("./probe-score.js");
const probe_preflight_js_1 = require("./probe-preflight.js");
const token_inflation_js_1 = require("./token-inflation.js");
const sse_compliance_js_1 = require("./sse-compliance.js");
const probe_wire_js_1 = require("./probe-wire.js");
const context_check_js_1 = require("./context-check.js");
const fingerprint_extractor_js_1 = require("./fingerprint-extractor.js");
const candidate_matcher_js_1 = require("./candidate-matcher.js");
const fingerprint_baseline_js_1 = require("./fingerprint-baseline.js");
const channel_signature_js_1 = require("./channel-signature.js");
const signature_probe_js_1 = require("./signature-probe.js");
const fingerprint_judge_js_1 = require("./fingerprint-judge.js");
const fingerprint_vectors_js_1 = require("./fingerprint-vectors.js");
const fingerprint_fusion_js_1 = require("./fingerprint-fusion.js");
const advanced_identity_js_1 = require("./advanced-identity.js");
const distribution_evidence_js_1 = require("./distribution-evidence.js");
const glm_distribution_models_js_1 = require("./glm-distribution-models.js");
const original_suite_js_1 = require("./original-suite.js");
const egress_guard_js_1 = require("./egress-guard.js");
const retry_fetch_js_1 = require("./retry-fetch.js");
const custom_headers_js_1 = require("./custom-headers.js");
const redaction_js_1 = require("./redaction.js");
/** Cap for reading the non-OK preflight response body before classification. */
const MAX_PREFLIGHT_RESPONSE_BYTES = 64 * 1024;
/** Cap for total bytes accumulated from a streaming (SSE) probe response. */
const MAX_STREAM_RESPONSE_BYTES = 1024 * 1024;
/** Bounded body read + parse so a hostile upstream can't buffer unlimited bytes. */
async function readBoundedJson(res, maxBytes = signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES) {
    return JSON.parse(await (0, signature_probe_js_1.readBoundedResponse)(res, maxBytes));
}
function parseJudgeScore(text) {
    const candidates = [];
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch)
        candidates.push(fenceMatch[1].trim());
    const braceMatch = text.match(/\{[\s\S]*?"score"[\s\S]*?\}/);
    if (braceMatch)
        candidates.push(braceMatch[0]);
    candidates.push(text.trim());
    for (const raw of candidates) {
        try {
            const parsed = JSON.parse(raw);
            const score = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
            if (!isNaN(score) && score >= 1 && score <= 10) {
                return { score: Math.round(score), reason: String(parsed.reason ?? "") };
            }
        }
        catch { /* try next */ }
    }
    return null;
}
/**
 * Runs the similarity-based judge — mirrors `buildJudgePrompt` in the production route.
 * Judge scores 1-10: how similar is the candidate response to the baseline response?
 */
async function runJudgeWithBaseline(judgeUrl, apiKey, modelId, probe, candidateResponse, baselineResponse, threshold, timeoutMs, signal, fetchFn = fetch, customHeaders) {
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
        const judgeHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
        (0, custom_headers_js_1.mergeCustomHeaders)(judgeHeaders, customHeaders);
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
            signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, signal),
        });
        if (!res.ok)
            return { passed: null, reason: `Judge API error: HTTP ${res.status}` };
        const data = await readBoundedJson(res);
        const text = data.choices?.[0]?.message?.content ?? "";
        const scored = parseJudgeScore(text);
        if (!scored)
            return { passed: null, reason: `Judge returned unparseable response: ${text.slice(0, 100)}` };
        return {
            passed: scored.score >= threshold,
            reason: `Similarity score: ${scored.score}/10 (threshold: ${threshold}) — ${scored.reason}`,
        };
    }
    catch (e) {
        return { passed: null, reason: `Judge call failed: ${e.message?.slice(0, 100)}` };
    }
}
/**
 * Rubric-based judge fallback for probes without a baseline entry: the judge
 * LLM scores the candidate response against the probe question directly
 * (instruction adherence, correctness, refusal-to-answer detection).
 */
async function runJudgeRubric(judgeUrl, apiKey, modelId, probe, candidateResponse, threshold, timeoutMs, signal, fetchFn = fetch, customHeaders) {
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
        const judgeHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
        (0, custom_headers_js_1.mergeCustomHeaders)(judgeHeaders, customHeaders);
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
            signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, signal),
        });
        if (!res.ok)
            return { passed: null, reason: `Judge API error: HTTP ${res.status}` };
        const data = await readBoundedJson(res);
        const text = data.choices?.[0]?.message?.content ?? "";
        const scored = parseJudgeScore(text);
        if (!scored)
            return { passed: null, reason: `Judge returned unparseable response: ${text.slice(0, 100)}` };
        return {
            passed: scored.score >= threshold,
            reason: `Rubric score: ${scored.score}/10 (threshold: ${threshold}) — ${scored.reason}`,
        };
    }
    catch (e) {
        return { passed: null, reason: `Judge call failed: ${e.message?.slice(0, 100)}` };
    }
}
async function runProbes(options) {
    const { baseUrl, apiKey, modelId, includeOptional = false, timeoutMs = 180000, onProgress, judge, baseline, customHeaders, } = options;
    if (options.signal?.aborted) {
        throw new Error(`Probe run aborted: ${options.signal.reason || "aborted"}`);
    }
    if (options.egressOptions) {
        (0, egress_guard_js_1.validateUrl)(baseUrl, options.egressOptions);
        if (judge?.baseUrl)
            (0, egress_guard_js_1.validateUrl)(judge.baseUrl, options.egressOptions);
        if (options.identityJudge?.baseUrl)
            (0, egress_guard_js_1.validateUrl)(options.identityJudge.baseUrl, options.egressOptions);
        if (options.embeddingEndpoint?.baseUrl)
            (0, egress_guard_js_1.validateUrl)(options.embeddingEndpoint.baseUrl, options.egressOptions);
    }
    const rawFetch = options.fetchFn ?? (options.egressOptions ? (0, egress_guard_js_1.createSafeFetch)(options.egressOptions) : fetch);
    const fetchImpl = (0, retry_fetch_js_1.createRetryingFetch)(rawFetch, { retries: options.requestRetries ?? 2, signal: options.signal });
    const outerSignal = options.signal;
    const targetSecrets = [apiKey, ...(0, custom_headers_js_1.customHeaderSecrets)(customHeaders)];
    const chatUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const startedAt = new Date().toISOString();
    if (options.distributionSampling && (options.distributionSampling.enabled !== true || options.distributionSampling.maxCalls !== 51 ||
        !(0, glm_distribution_models_js_1.supportsGlmDistribution)(modelId)))
        throw new Error("Invalid distribution sampling configuration");
    let distributionEvidence = options.savedDistributionEvidence ? (0, distribution_evidence_js_1.validateDistributionEvidence)(options.savedDistributionEvidence) : undefined;
    if (distributionEvidence && !options.operation)
        throw new Error("Saved distribution evidence is only accepted for replay");
    if (distributionEvidence && distributionEvidence.modelId !== modelId)
        throw new Error("Saved distribution evidence belongs to a different target model");
    let selectedSuite = probe_suite_js_1.PROBE_SUITE;
    if (options.probeIds !== undefined) {
        if (!Array.isArray(options.probeIds) || options.probeIds.length === 0 || options.probeIds.length > probe_suite_js_1.PROBE_SUITE.length) {
            throw new Error("probeIds must be a non-empty array within the suite size limit");
        }
        const byId = new Map(probe_suite_js_1.PROBE_SUITE.map((probe) => [probe.id, probe]));
        const seen = new Set();
        selectedSuite = options.probeIds.map((id) => {
            if (typeof id !== "string" || !id || seen.has(id)) {
                throw new Error("probeIds must contain unique non-empty strings");
            }
            seen.add(id);
            const probe = byId.get(id);
            if (!probe)
                throw new Error(`Unknown probe ID: ${id}`);
            return probe;
        });
    }
    // Explicit selectors are authoritative and may include optional probes. The
    // legacy full-suite path keeps includeOptional behavior for API compatibility.
    const probes = options.probeIds !== undefined
        ? selectedSuite
        : selectedSuite.filter(p => includeOptional || !p.optional);
    const replay = options.operation === "retry" || options.operation === "rejudge";
    const previousById = new Map((options.previousResults ?? []).map(row => [row.probeId, row]));
    const results = [];
    // ── Pre-flight ────────────────────────────────────────────────────────────
    const targetHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    (0, custom_headers_js_1.mergeCustomHeaders)(targetHeaders, customHeaders);
    if (!replay)
        try {
            const pfRes = await fetchImpl(chatUrl, {
                method: "POST",
                headers: targetHeaders,
                body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
                signal: (0, egress_guard_js_1.combineSignals)(45000, outerSignal),
            });
            if (!pfRes.ok) {
                const rawBody = await (0, signature_probe_js_1.readBoundedResponse)(pfRes, MAX_PREFLIGHT_RESPONSE_BYTES).catch(() => "");
                const { outcome, reason } = (0, probe_preflight_js_1.classifyPreflightResult)(pfRes.status, rawBody);
                if (outcome === "abort") {
                    for (const probe of probes) {
                        results.push({ probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                            status: "error", passed: false, passReason: null, ttftMs: null, durationMs: null,
                            inputTokens: null, outputTokens: null, tps: null, response: null, error: reason });
                    }
                    const { low, high } = (0, probe_score_js_1.computeProbeScore)(results.map(r => ({ status: r.status, passed: r.passed, neutral: r.neutral })));
                    return { baseUrl, modelId, startedAt, completedAt: new Date().toISOString(), score: low, scoreMax: high,
                        totalInputTokens: null, totalOutputTokens: null, results };
                }
            }
        }
        catch { /* network issues on preflight — proceed anyway */ }
    // ── Run each probe ────────────────────────────────────────────────────────
    let idx = 0;
    for (const probe of probes) {
        if (outerSignal?.aborted) {
            throw new Error(`Probe run aborted: ${outerSignal.reason || "aborted"}`);
        }
        idx++;
        let result;
        if (replay && (options.operation === "rejudge" || probe.id !== options.retryProbeId)) {
            const previous = previousById.get(probe.id);
            if (!previous)
                continue;
            result = { ...previous };
            // Transport/header/dynamic-canary checks cannot be reconstructed from
            // response text. Preserve those verdicts and re-score supported text checks.
            if (options.operation === "rejudge" && (!options.retryProbeId || probe.id === options.retryProbeId) && probe.scoring === "llm_judge"
                && previous.status === "done" && !previous.responseTruncated && typeof previous.response === "string" && judge) {
                const judged = baseline?.[probe.id]
                    ? await runJudgeWithBaseline(judge.baseUrl, judge.apiKey, judge.modelId, probe, previous.response, baseline[probe.id], judge.threshold ?? 7, timeoutMs, outerSignal, fetchImpl, judge.customHeaders)
                    : await runJudgeRubric(judge.baseUrl, judge.apiKey, judge.modelId, probe, previous.response, judge.threshold ?? 7, timeoutMs, outerSignal, fetchImpl, judge.customHeaders);
                result.passed = judged.passed;
                result.passReason = judged.reason;
                result.judgeError = judged.passed === null ? judged.reason : null;
            }
            if (options.operation === "rejudge" && (!options.retryProbeId || probe.id === options.retryProbeId)
                && previous.status === "done" && !previous.responseTruncated && typeof previous.response === "string"
                && ["keyword_match", "exact_match"].includes(probe.scoring)) {
                const scored = (0, probe_suite_js_1.autoScore)(probe, previous.response, {}, "en");
                if (scored) {
                    result.passed = scored.passed;
                    result.passReason = scored.reason;
                }
                if (probe.id === "multimodal_pdf" && scored?.passed !== true && (0, probe_wire_js_1.reportsMissingPdfAttachment)(previous.response)) {
                    result.passed = null;
                    result.neutral = true;
                    result.passReason = "PDF attachment delivery is unconfirmed: the saved response reports a missing file. PDF reading was not assessed; rejudge cannot establish delivery from text alone";
                }
            }
            results.push(result);
            onProgress?.(result, idx, probes.length);
            continue;
        }
        // ── channel_signature ─────────────────────────────────────────────────
        if (probe.scoring === "channel_signature") {
            const t0 = Date.now();
            try {
                const sigHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
                (0, custom_headers_js_1.mergeCustomHeaders)(sigHeaders, customHeaders);
                const r = await fetchImpl(chatUrl, {
                    method: "POST",
                    headers: sigHeaders,
                    signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                });
                const dur = Date.now() - t0;
                // 128 KiB bound keeps a hostile upstream from exhausting runner memory.
                const bodyText = await (0, signature_probe_js_1.readBoundedResponse)(r, signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES).catch(() => r.text().then((t) => t.slice(0, signature_probe_js_1.MAX_SIGNATURE_RESPONSE_BYTES)));
                const responseHeaders = {};
                r.headers.forEach((val, key) => { responseHeaders[key.toLowerCase()] = val; });
                let messageId = null;
                try {
                    messageId = JSON.parse(bodyText).id ?? null;
                }
                catch { /* ok */ }
                const sig = (0, channel_signature_js_1.classifyChannelSignature)({ headers: responseHeaders, messageId, rawBody: bodyText });
                result = {
                    probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? true,
                    status: "done", passed: null, ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
                    response: `channel=${sig.channel} confidence=${sig.confidence} evidence=[${sig.evidence.join(",")}]`,
                    passReason: `Upstream channel: ${sig.channel} (confidence: ${(sig.confidence * 100).toFixed(0)}%)`,
                    error: null,
                };
            }
            catch (e) {
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? true,
                    status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null,
                    inputTokens: null, outputTokens: null, tps: null, response: null, error: e.message?.slice(0, 300) ?? "Unknown" };
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
            const pairErrors = [];
            const makeRequest = async (prompt) => {
                try {
                    const acHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
                    (0, custom_headers_js_1.mergeCustomHeaders)(acHeaders, customHeaders);
                    const r = await fetchImpl(chatUrl, {
                        method: "POST",
                        headers: acHeaders,
                        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 256, temperature: 0 }),
                        signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                    });
                    if (!r.ok)
                        throw new Error(`HTTP ${r.status}: ${await (0, signature_probe_js_1.readBoundedResponse)(r, 4096)}`);
                    const d = await readBoundedJson(r);
                    return (d.choices?.[0]?.message?.content ?? "").trim();
                }
                catch (error) {
                    pairErrors.push((0, redaction_js_1.boundError)(error, 300, targetSecrets));
                    return null;
                }
            };
            const [neutralResp, triggerResp] = await Promise.all([
                makeRequest(probe.prompt),
                makeRequest(probe.adaptiveTriggerPrompt),
            ]);
            const dur = Date.now() - t0;
            if (!neutralResp || !triggerResp) {
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "error", passed: null, passReason: "One or both requests failed — not assessed",
                    ttftMs: null, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
                    response: `neutral: ${neutralResp?.slice(0, 100) ?? "ERROR"} | trigger: ${triggerResp?.slice(0, 100) ?? "ERROR"}`, error: pairErrors.join("; ") || "Empty paired response" };
            }
            else {
                const neutralMatches = neutralResp === (0, probe_wire_js_1.expectedEcho)(probe.prompt);
                const triggerMatches = triggerResp === (0, probe_wire_js_1.expectedEcho)(probe.adaptiveTriggerPrompt);
                const passed = neutralMatches && triggerMatches;
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "done", ttftMs: null, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
                    response: `neutral: ${neutralResp.slice(0, 100)} | trigger: ${triggerResp.slice(0, 100)}`,
                    passed: passed ? true : "warning",
                    passReason: passed
                        ? "Both responses match their own expected echoes — no conditional deviation observed"
                        : neutralMatches && !triggerMatches
                            ? "Neutral echo matched but trigger echo deviated — possible conditional behavior, not proof of injection"
                            : "Echo instructions were not followed consistently — conditional injection not established",
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
                const tcHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
                (0, custom_headers_js_1.mergeCustomHeaders)(tcHeaders, customHeaders);
                const r = await fetchImpl(chatUrl, {
                    method: "POST",
                    headers: tcHeaders,
                    body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: probe.prompt }], stream: true, stream_options: { include_usage: true }, max_tokens: 2048, reasoning_effort: "high" }),
                    signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                });
                const dur = Date.now() - t0;
                if (!r.ok) {
                    const unsupported = [400, 415, 422].includes(r.status);
                    const detail = (0, redaction_js_1.boundError)(await (0, signature_probe_js_1.readBoundedResponse)(r, 4096), 300, targetSecrets);
                    result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: true,
                        status: unsupported ? "skipped" : "error", passed: null,
                        passReason: `HTTP ${r.status} — reasoning visibility was not assessed on this interface`,
                        ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null, response: null,
                        error: `HTTP ${r.status}: ${detail}` };
                }
                else {
                    let hasThinking = false;
                    let fullT = "";
                    let ttft = null;
                    let inTok = null;
                    let outTok = null;
                    const payloads = await (0, probe_wire_js_1.readProbeStream)(r, outerSignal, () => { ttft = Date.now() - t0; });
                    for (const payload of payloads) {
                        if (payload === "[DONE]")
                            continue;
                        try {
                            const j = JSON.parse(payload);
                            const delta = j.choices?.[0]?.delta;
                            if (delta?.content)
                                fullT += delta.content;
                            if (delta?.reasoning_content || delta?.reasoning || delta?.type === "thinking"
                                || j.content_block?.type === "thinking" || j.delta?.type === "thinking_delta")
                                hasThinking = true;
                            if (j.usage) {
                                inTok = j.usage.prompt_tokens ?? null;
                                outTok = j.usage.completion_tokens ?? null;
                            }
                        }
                        catch { /* malformed payload is evaluated by the SSE-specific check */ }
                    }
                    const durationMs = Date.now() - t0;
                    result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                        status: "done", passed: null,
                        passReason: hasThinking ? "Structured reasoning observed on this interface; this does not prove header forwarding" : "No structured reasoning exposed on this interface; this may be expected and is not an integrity failure",
                        ttftMs: ttft ?? durationMs, durationMs, inputTokens: inTok, outputTokens: outTok, tps: null, response: fullT.slice(0, 1000), error: null };
                }
            }
            catch (e) {
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, response: null, error: e.message?.slice(0, 300) ?? "Unknown error" };
            }
            results.push(result);
            onProgress?.(result, idx, probes.length);
            continue;
        }
        // ── consistency_check ─────────────────────────────────────────────────
        if (probe.scoring === "consistency_check") {
            const t0 = Date.now();
            const responses = [];
            const pairErrors = [];
            let inTok = null;
            let outTok = null;
            for (let i = 0; i < 2; i++) {
                if (outerSignal?.aborted)
                    break;
                try {
                    const ccHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
                    (0, custom_headers_js_1.mergeCustomHeaders)(ccHeaders, customHeaders);
                    const r = await fetchImpl(chatUrl, {
                        method: "POST",
                        headers: ccHeaders,
                        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: probe.prompt }], stream: false, max_tokens: 256, temperature: 0.7 }),
                        signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                    });
                    if (!r.ok)
                        throw new Error(`HTTP ${r.status}: ${await (0, signature_probe_js_1.readBoundedResponse)(r, 4096)}`);
                    const d = await readBoundedJson(r);
                    responses.push((d.choices?.[0]?.message?.content ?? "").trim());
                    if (i === 0) {
                        inTok = d.usage?.prompt_tokens ?? null;
                        outTok = d.usage?.completion_tokens ?? null;
                    }
                }
                catch (error) {
                    pairErrors.push((0, redaction_js_1.boundError)(error, 300, targetSecrets));
                    responses.push("__ERROR__");
                }
            }
            const ok = responses.length === 2 && responses.every(text => text.length > 0 && text !== "__ERROR__");
            const identical = ok && responses[0] === responses[1];
            result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                status: ok ? "done" : "error", durationMs: Date.now() - t0, inputTokens: inTok, outputTokens: outTok,
                response: responses.join(" | "), ttftMs: null, tps: null, error: ok ? null : pairErrors.join("; ") || "Empty paired response",
                passed: !ok ? null : identical ? "warning" : true,
                passReason: !ok ? "One or more requests failed — cannot assess consistency"
                    : identical ? `Both responses identical (${responses[0]?.slice(0, 30)}) — possible cache hit`
                        : "Responses differ — no identical-output signal observed (not proof of cache absence)" };
            results.push(result);
            onProgress?.(result, idx, probes.length);
            continue;
        }
        // ── context_check ──────────────────────────────────────────────────────
        if (probe.scoring === "context_check") {
            const sendFn = async (message) => {
                const cxHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
                (0, custom_headers_js_1.mergeCustomHeaders)(cxHeaders, customHeaders);
                const r = await fetchImpl(chatUrl, {
                    method: "POST",
                    headers: cxHeaders,
                    body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: message }], max_tokens: 256, stream: false }),
                    signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                });
                const j = await readBoundedJson(r);
                return j.choices?.[0]?.message?.content ?? "";
            };
            try {
                const ctx = await (0, context_check_js_1.runContextCheck)(sendFn);
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "done", ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null,
                    response: ctx.reason, passed: ctx.warning ? "warning" : ctx.passed ? true : false, passReason: ctx.reason, error: null };
            }
            catch (e) {
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, response: null, error: e.message?.slice(0, 300) ?? "Unknown error" };
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
                if (options.egressOptions)
                    (0, egress_guard_js_1.validateUrl)(messagesUrl, options.egressOptions);
                const authHeader = apiKey.startsWith("sk-ant-")
                    ? "x-api-key"
                    : "authorization";
                const initHeaders = {
                    "content-type": "application/json",
                    "anthropic-version": "2023-06-01",
                    ...(authHeader === "x-api-key"
                        ? { "x-api-key": apiKey }
                        : { authorization: `Bearer ${apiKey}` }),
                };
                (0, custom_headers_js_1.mergeCustomHeaders)(initHeaders, customHeaders);
                const r1 = await fetchImpl(messagesUrl, {
                    method: "POST",
                    headers: initHeaders,
                    body: JSON.stringify({
                        model: modelId,
                        max_tokens: Math.max(probe.maxTokens ?? 1536, 1536),
                        thinking: (0, signature_probe_js_1.getThinkingConfig)(modelId),
                        messages: [{ role: "user", content: probe.prompt }],
                    }),
                    signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                });
                const initialBodyText = await (0, signature_probe_js_1.readBoundedResponse)(r1);
                if (!r1.ok) {
                    const errBody = (0, redaction_js_1.redactSecrets)(initialBodyText, targetSecrets);
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
                let raw = null;
                try {
                    raw = JSON.parse(initialBodyText);
                }
                catch {
                    raw = null;
                }
                const thinkingBlock = (0, signature_probe_js_1.extractThinkingBlock)(raw) ??
                    (raw && typeof raw === "object" && "choices" in raw ? (0, signature_probe_js_1.extractThinkingBlock)(raw.choices?.[0]?.message) : null);
                if (!thinkingBlock) {
                    const dur = Date.now() - t0;
                    result = {
                        probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                        status: "done", passed: false,
                        passReason: "No thinking block with signature returned by upstream",
                        ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
                        response: raw && typeof raw === "object"
                            ? (0, redaction_js_1.redactSecrets)(JSON.stringify(raw), targetSecrets).slice(0, 1000)
                            : null,
                        error: null,
                    };
                    results.push(result);
                    onProgress?.(result, idx, probes.length);
                    continue;
                }
                let assistantText = "";
                if (raw && typeof raw === "object") {
                    const content = raw.content ?? raw?.choices?.[0]?.message?.content;
                    if (Array.isArray(content)) {
                        for (const b of content) {
                            if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
                                assistantText += b.text;
                            }
                        }
                    }
                    else if (typeof content === "string") {
                        assistantText = content;
                    }
                }
                if (!assistantText)
                    assistantText = "Understood.";
                const verifyRes = await (0, signature_probe_js_1.verifySignatureRoundtrip)({
                    endpoint: messagesUrl,
                    apiKey,
                    model: modelId,
                    originalUserPrompt: probe.prompt,
                    thinkingBlock,
                    assistantText,
                    followUpUserPrompt: "Confirm.",
                    authHeader,
                    fetchImpl,
                    signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
                    customHeaders,
                });
                const dur = Date.now() - t0;
                if (verifyRes.verified) {
                    const retries = Math.max((0, retry_fetch_js_1.retryCountOf)(r1), verifyRes.retries ?? 0);
                    result = {
                        probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                        status: "done", passed: true,
                        passReason: "Thinking signature successfully verified by upstream roundtrip"
                            + (retries > 0 ? ` (after ${retries} transport ${retries === 1 ? "retry" : "retries"})` : ""),
                        ttftMs: dur, durationMs: dur, inputTokens: null, outputTokens: null, tps: null,
                        response: "verified=true",
                        error: null,
                    };
                }
                else {
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
            }
            catch (e) {
                if (outerSignal?.aborted) {
                    throw new Error(`Probe run aborted: ${outerSignal.reason || "aborted"}`);
                }
                const dur = Date.now() - t0;
                result = {
                    probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                    status: "error", passed: null, passReason: null, ttftMs: null, durationMs: dur,
                    inputTokens: null, outputTokens: null, tps: null, response: null,
                    error: (0, redaction_js_1.boundError)(e, 300, targetSecrets),
                };
            }
            results.push(result);
            onProgress?.(result, idx, probes.length);
            continue;
        }
        // ── Standard probes (stream or non-stream) ────────────────────────────
        const startTime = Date.now();
        let ttftMs = null;
        try {
            // ── Dynamic canary: generate, substitute, remember for autoScore ────
            let effectivePrompt = probe.prompt;
            let canaryOverride;
            if (probe.dynamicCanary) {
                const canary = (0, probe_suite_js_1.generateCanary)();
                canaryOverride = canary;
                const placeholder = probe.canaryPlaceholder ?? "{CANARY}";
                effectivePrompt = probe.prompt.replace(placeholder, canary);
            }
            const messages = [];
            if (probe.systemPrompt) {
                messages.push({ role: "system", content: probe.systemPrompt });
            }
            // ── Build user content (text or multimodal) ─────────────────────────
            let userContent;
            if (probe.multimodalContent) {
                const mc = probe.multimodalContent;
                if (mc.kind === "image") {
                    userContent = [
                        { type: "image_url", image_url: { url: `data:${mc.mediaType};base64,${mc.dataB64}` } },
                        { type: "text", text: effectivePrompt },
                    ];
                }
                else {
                    // OpenAI file content part, translated to a native document block by
                    // compatible gateways. Send the entire fixture, never a base64 excerpt.
                    userContent = [
                        { type: "file", file: { filename: "probe.pdf", file_data: `data:${mc.mediaType};base64,${mc.dataB64}` } },
                        { type: "text", text: effectivePrompt },
                    ];
                }
            }
            else {
                userContent = effectivePrompt;
            }
            messages.push({ role: "user", content: userContent });
            // ── max_tokens: per-probe override → scoring fallback ───────────────
            // Reasoning models burn hidden CoT tokens before the visible answer, so
            // the exact-answer budget must leave headroom or they return "".
            const isExact = probe.scoring === "exact_match" || probe.scoring === "exact_response";
            const maxTokens = probe.maxTokens ?? (isExact ? 768 : 1024);
            const useStream = probe.scoring !== "header_check";
            const rawSseLines = [];
            let fullText = "";
            let responseHeaders = {};
            let inputTokens = null;
            let outputTokens = null;
            const stdHeaders = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
            (0, custom_headers_js_1.mergeCustomHeaders)(stdHeaders, customHeaders);
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
                signal: (0, egress_guard_js_1.combineSignals)(timeoutMs, outerSignal),
            });
            if (!res.ok) {
                // 64 KiB bound on the error body so a hostile upstream can't flood memory.
                const errText = await (0, signature_probe_js_1.readBoundedResponse)(res, 64 * 1024).catch(() => "");
                const unsupportedDocument = probe.id === "multimodal_pdf" && [400, 415, 422].includes(res.status)
                    && /(?:unsupported|not support|not supported|invalid).{0,80}(?:pdf|document|file)|(?:pdf|document|file).{0,80}(?:unsupported|not support|not supported)/i.test(errText);
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: unsupportedDocument || (probe.neutral ?? false),
                    status: unsupportedDocument ? "skipped" : "error", passed: null,
                    passReason: unsupportedDocument ? "PDF input is unsupported on this endpoint — not assessed" : null,
                    ttftMs: null, durationMs: Date.now() - startTime,
                    inputTokens: null, outputTokens: null, tps: null, response: null, error: `HTTP ${res.status}: ${(0, redaction_js_1.boundError)(errText, 200, targetSecrets)}` };
                results.push(result);
                onProgress?.(result, idx, probes.length);
                continue;
            }
            // Capture response headers
            res.headers.forEach((val, key) => { responseHeaders[key.toLowerCase()] = val; });
            if (useStream && res.body) {
                rawSseLines.push(...await (0, probe_wire_js_1.readProbeStream)(res, outerSignal, () => { ttftMs = Date.now() - startTime; }));
                for (const payload of rawSseLines) {
                    if (payload === "[DONE]")
                        continue;
                    try {
                        const chunk = JSON.parse(payload);
                        if (chunk.error)
                            throw new Error(JSON.stringify(chunk.error));
                        if (chunk.choices?.[0]?.delta?.content)
                            fullText += chunk.choices[0].delta.content;
                        if (chunk.usage) {
                            inputTokens = chunk.usage.prompt_tokens ?? null;
                            outputTokens = chunk.usage.completion_tokens ?? null;
                        }
                    }
                    catch (error) {
                        if (!(error instanceof SyntaxError))
                            throw error;
                    }
                }
            }
            else {
                const data = await readBoundedJson(res);
                fullText = data.choices?.[0]?.message?.content ?? "";
                inputTokens = data.usage?.prompt_tokens ?? null;
                outputTokens = data.usage?.completion_tokens ?? null;
            }
            const durationMs = Date.now() - startTime;
            const tps = (outputTokens && durationMs > 0) ? Math.round(outputTokens / (durationMs / 1000)) : null;
            // ── token_check ──────────────────────────────────────────────────────
            if (probe.scoring === "token_check") {
                const inflation = inputTokens !== null ? (0, token_inflation_js_1.detectTokenInflation)(inputTokens, token_inflation_js_1.TOKEN_INFLATION_THRESHOLD) : null;
                result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: true,
                    status: "done", ttftMs: ttftMs ?? durationMs, durationMs, inputTokens, outputTokens, tps,
                    response: fullText.slice(0, 1000), error: null,
                    passed: null,
                    passReason: inflation
                        ? (inflation.detected ? `Additional prompt overhead observed: prompt_tokens=${inflation.actualPromptTokens} (reference: ${token_inflation_js_1.TOKEN_INFLATION_THRESHOLD}). Agent/system wrappers can legitimately add tokens; this does not establish malicious injection` : `No inflation: prompt_tokens=${inflation.actualPromptTokens}`)
                        : "Token count not available" };
                results.push(result);
                onProgress?.(result, idx, probes.length);
                continue;
            }
            // ── sse_compliance ───────────────────────────────────────────────────
            if (probe.scoring === "sse_compliance") {
                const compliance = (0, sse_compliance_js_1.checkSSECompliance)(rawSseLines);
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
            const autoResult = (0, probe_suite_js_1.autoScore)(probe, fullText, responseHeaders, "en", { overrideExpectedExact: canaryOverride });
            let passed = null;
            let passReason = null;
            if (autoResult) {
                passed = autoResult.passed;
                passReason = autoResult.reason;
            }
            else if (probe.scoring === "feature_extract") {
                passed = null;
                passReason = "identity feature probe — response collected for fingerprint analysis";
            }
            else if (probe.scoring === "llm_judge") {
                // Prefer baseline similarity; fall back to a rubric grade when the
                // model has no published baseline so quality probes never sit gray.
                if (judge && baseline && baseline[probe.id]) {
                    const judged = await runJudgeWithBaseline(judge.baseUrl, judge.apiKey, judge.modelId, probe, fullText, baseline[probe.id], judge.threshold ?? 7, timeoutMs, outerSignal, fetchImpl, judge.customHeaders);
                    passed = judged.passed === null ? null : judged.passed ? true : false;
                    passReason = judged.reason;
                }
                else if (judge) {
                    const judged = await runJudgeRubric(judge.baseUrl, judge.apiKey, judge.modelId, probe, fullText, judge.threshold ?? 7, timeoutMs, outerSignal, fetchImpl, judge.customHeaders);
                    passed = judged.passed === null ? null : judged.passed ? true : false;
                    passReason = judged.reason;
                }
                else {
                    passed = null;
                    passReason = "llm_judge: no judge endpoint configured — pass --judge-base-url to enable auto-scoring";
                }
            }
            const pdfDeliveryUnconfirmed = probe.id === "multimodal_pdf" && passed !== true && (0, probe_wire_js_1.reportsMissingPdfAttachment)(fullText);
            if (pdfDeliveryUnconfirmed) {
                passed = null;
                passReason = "PDF attachment delivery is unconfirmed: the response reports a missing file. PDF reading was not assessed; this does not establish a model integrity failure";
            }
            const transportRetries = (0, retry_fetch_js_1.retryCountOf)(res);
            if (transportRetries > 0 && passReason) {
                passReason += ` (after ${transportRetries} transport ${transportRetries === 1 ? "retry" : "retries"})`;
            }
            // Surface the reference the response was judged against so the dashboard
            // can show expected-vs-actual without reverse-engineering passReason.
            const expected = probe.expectedExact ?? probe.expectedContains
                ?? (probe.passIfContains?.length ? probe.passIfContains.join(" | ") : null);
            result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: pdfDeliveryUnconfirmed || (probe.neutral ?? false),
                status: "done", ttftMs: ttftMs ?? durationMs, durationMs, inputTokens, outputTokens, tps,
                response: fullText.slice(0, 4000), responseTruncated: fullText.length > 4000, passed, passReason, error: null,
                scoring: probe.scoring, expected,
                judgeError: probe.scoring === "llm_judge" && judge && passed === null ? passReason : null };
        }
        catch (err) {
            result = { probeId: probe.id, label: probe.label, group: probe.group, neutral: probe.neutral ?? false,
                status: "error", passed: null, passReason: null, ttftMs: null, durationMs: null,
                inputTokens: null, outputTokens: null, tps: null, response: null,
                error: (err.message ?? "Unknown error").slice(0, 300) };
        }
        results.push(result);
        onProgress?.(result, idx, probes.length);
    }
    // ── Identity Phase ────────────────────────────────────────────────────────
    const fullSuite = options.probeIds === undefined || original_suite_js_1.ORIGINAL_SUITE_IDS.every(id => options.probeIds.includes(id));
    if (!replay && (0, glm_distribution_models_js_1.supportsGlmDistribution)(modelId) && (fullSuite || options.distributionSampling)) {
        distributionEvidence = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ baseUrl, apiKey, modelId, customHeaders,
            signal: outerSignal, timeoutMs, fetchFn: rawFetch, maxCalls: 51, onProgress: options.onDistributionProgress });
    }
    let identityAssessment;
    {
        const featureResponses = {};
        for (const r of results) {
            if (r.status === "done" && r.response) {
                const probe = probes.find(p => p.id === r.probeId);
                if (probe?.scoring === "feature_extract") {
                    featureResponses[r.probeId] = r.response;
                }
            }
        }
        const riskFlags = [];
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
            // Feature-extract responses include the linguistic/tokenizer/creator
            // probes too. Without the fallback map all of those discriminating
            // features were silently empty and generic agent style dominated.
            const features = (0, fingerprint_extractor_js_1.extractFingerprint)(featureResponses, {}, [], featureResponses);
            // Rule-based candidates (always run)
            const ruleCandidates = (0, candidate_matcher_js_1.matchCandidates)(features);
            const ruleScores = ruleCandidates.map(c => ({ family: c.family, score: c.score }));
            // Optional LLM judge signal
            let judgeScores = [];
            if (options.identityJudge) {
                try {
                    const judgeResult = await (0, fingerprint_judge_js_1.judgeFingerprint)(featureResponses, options.identityJudge.baseUrl, options.identityJudge.apiKey, options.identityJudge.modelId, { signal: outerSignal, fetchFn: fetchImpl });
                    judgeScores = judgeResult.scores;
                }
                catch { /* judge unavailable — fall back to rule-only */ }
            }
            // Optional vector signal
            let vectorScores = [];
            if (options.embeddingEndpoint?.references?.length) {
                try {
                    const embedding = await (0, fingerprint_vectors_js_1.embedProbeResponses)(featureResponses, options.embeddingEndpoint.baseUrl, options.embeddingEndpoint.apiKey, options.embeddingEndpoint.modelId, { signal: outerSignal, fetchFn: fetchImpl });
                    if (embedding !== null) {
                        vectorScores = (0, fingerprint_vectors_js_1.pickTopVectorScores)(embedding, options.embeddingEndpoint.references);
                    }
                }
                catch { /* embeddings unavailable — fall back */ }
            }
            // Fuse all signals (W_RULE=0.4, W_JUDGE=0.4, W_VECTOR=0.2)
            // fuseScores returns IdentityCandidate[] directly
            const candidates = (0, fingerprint_fusion_js_1.fuseScores)(ruleScores, judgeScores, vectorScores);
            const { status, confidence, evidence, predictedFamily } = (0, candidate_matcher_js_1.deriveVerdictFromClaimedModel)(candidates, options.claimedModel);
            const claimedFamily = options.claimedModel
                ? (0, fingerprint_baseline_js_1.claimedModelToFamily)(options.claimedModel)
                : undefined;
            const adjustedConfidence = riskFlags.length > 0
                ? Math.max(0, confidence - 0.15 * Math.min(riskFlags.length, 3))
                : confidence;
            let advanced;
            try {
                advanced = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results, claimedModel: options.claimedModel, savedObservations: distributionEvidence?.observations });
            }
            catch {
                // Optional diagnostics must not discard a completed run or expose response text.
                riskFlags.push("Advanced identity diagnostics unavailable; primary family assessment retained");
            }
            identityAssessment = {
                status,
                confidence: Math.round(adjustedConfidence * 100) / 100,
                claimedModel: options.claimedModel,
                predictedFamily,
                predictedCandidates: candidates,
                riskFlags,
                evidence,
                // Preserve supported family consistency despite style overlap; this
                // evidence cannot establish the exact model.
                verdict: {
                    ...(0, candidate_matcher_js_1.deriveFamilyVerdict)(candidates, claimedFamily),
                    trueModel: null,
                    spoofMethod: null,
                },
                advanced,
                distributionEvidence,
            };
            // One persisted verdict drives both the saved detail and summary. Never promote
            // the closed-set posterior into the legacy numeric assessment confidence.
            if (advanced?.distribution.result.acceptedModel) {
                identityAssessment.verdict = advanced.verdict;
                identityAssessment.predictedFamily = "zhipu";
                identityAssessment.status = advanced.verdict.status === "likely_match" ? "match" : "uncertain";
            }
        }
    }
    // Even if every text task failed, keep the paid distribution sample for replay.
    if (!identityAssessment && distributionEvidence) {
        identityAssessment = { status: "insufficient_data", confidence: 0, claimedModel: options.claimedModel,
            predictedFamily: undefined, predictedCandidates: [], riskFlags: [],
            evidence: ["No usable family text evidence; saved distribution samples cannot establish identity alone"],
            verdict: { status: "insufficient_data", trueFamily: null, trueModel: null, spoofMethod: null,
                confidence: "low", reasoning: ["Family corroboration unavailable"] }, distributionEvidence };
    }
    // ── Finalize ──────────────────────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    const { low, high } = (0, probe_score_js_1.computeProbeScore)(results.map(r => ({ status: r.status, passed: r.passed, neutral: r.neutral })));
    const totalIn = results.reduce((s, r) => s + (r.inputTokens ?? 0), 0) + (distributionEvidence?.inputTokens ?? 0);
    const totalOut = results.reduce((s, r) => s + (r.outputTokens ?? 0), 0) + (distributionEvidence?.outputTokens ?? 0);
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
//# sourceMappingURL=runner.js.map