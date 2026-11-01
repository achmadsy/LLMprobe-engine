"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISTRIBUTION_SAMPLE_CALLS = void 0;
exports.validateDistributionEvidence = validateDistributionEvidence;
exports.collectDistributionEvidence = collectDistributionEvidence;
// Explicitly budgeted, sequential distribution sampling. No implicit transport retries.
const sub_model_bias_probes_js_1 = require("./sub-model-bias-probes.js");
const sub_model_bias_probes_js_2 = require("./sub-model-bias-probes.js");
const custom_headers_js_1 = require("./custom-headers.js");
const signature_probe_js_1 = require("./signature-probe.js");
const glm_distribution_models_js_1 = require("./glm-distribution-models.js");
exports.DISTRIBUTION_SAMPLE_CALLS = 51;
function validateDistributionEvidence(input) {
    const e = input;
    if (!e || e.version !== 1 || typeof e.modelId !== "string" || !(0, glm_distribution_models_js_1.supportsGlmDistribution)(e.modelId) || e.protocolId !== "glm-nine-temperature1-max128-v1" || !Array.isArray(e.observations) ||
        e.observations.length !== glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.length || !Number.isFinite(Date.parse(e.collectedAt)) ||
        !Number.isSafeInteger(e.attempts) || e.attempts < 0 || e.attempts > 51 ||
        !Number.isSafeInteger(e.failures) || e.failures < 0 || e.failures > e.attempts ||
        ![e.inputTokens, e.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9))
        throw new Error("Invalid saved distribution evidence");
    let samples = 0;
    const observations = glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.map((id, i) => {
        const o = e.observations[i];
        const max = id === "day" ? 3 : 6;
        if (!o || o.probeId !== id || !Array.isArray(o.answers) || o.answers.length > max ||
            o.answers.some(a => typeof a !== "string" || !/^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a)))
            throw new Error("Invalid saved distribution evidence");
        samples += o.answers.length;
        return { probeId: id, answers: [...o.answers] };
    });
    if (samples !== e.attempts - e.failures)
        throw new Error("Distribution evidence counts disagree");
    // Whitelist fields: never echo arbitrary input or endpoint credentials into report metadata.
    return { version: 1, modelId: e.modelId, protocolId: e.protocolId, observations, attempts: e.attempts, failures: e.failures,
        inputTokens: e.inputTokens, outputTokens: e.outputTokens, collectedAt: e.collectedAt };
}
async function collectDistributionEvidence(options) {
    if (options.maxCalls !== 51)
        throw new Error("Explicit 51-call sampling budget required");
    if (!(0, glm_distribution_models_js_1.supportsGlmDistribution)(options.modelId))
        throw new Error("Distribution sampling supports only GLM-5 / 5.1 / 5.2 / 5.3 / 5.3-Flash");
    const headers = { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" };
    (0, custom_headers_js_1.mergeCustomHeaders)(headers, options.customHeaders);
    const e = { version: 1, modelId: options.modelId, protocolId: "glm-nine-temperature1-max128-v1", observations: [],
        attempts: 0, failures: 0, inputTokens: 0, outputTokens: 0, collectedAt: new Date().toISOString() };
    const secrets = [options.apiKey, ...Object.values(options.customHeaders ?? {})].filter(Boolean);
    let stop = false;
    for (const id of glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS) {
        const probe = sub_model_bias_probes_js_1.BIAS_PROBES.find(p => p.id === id);
        const answers = [];
        for (let slot = 0; slot < probe.samples && !stop; slot++) {
            if (options.signal?.aborted)
                throw new Error("Probe run canceled");
            const controller = new AbortController();
            const abort = () => controller.abort();
            options.signal?.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(abort, Math.min(options.timeoutMs ?? 60000, 90000));
            e.attempts++;
            try {
                const response = await options.fetchFn(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
                    method: "POST", redirect: "error", headers, signal: controller.signal,
                    body: JSON.stringify({ model: options.modelId, messages: [{ role: "user", content: probe.prompt }], temperature: 1, max_tokens: 128, stream: false }),
                });
                if (!response.ok) {
                    await response.body?.cancel().catch(() => { });
                    stop = true;
                    throw new Error("Sampling HTTP failure");
                }
                const data = JSON.parse(await (0, signature_probe_js_1.readBoundedResponse)(response, 65536));
                for (const [source, target] of [["prompt_tokens", "inputTokens"], ["completion_tokens", "outputTokens"]]) {
                    const n = data?.usage?.[source];
                    if (Number.isSafeInteger(n) && n >= 0 && n <= 1e7)
                        e[target] += n;
                }
                const choice = data?.choices?.[0], content = choice?.message?.content;
                if (choice?.finish_reason !== "stop" || typeof content !== "string" || choice?.message?.tool_calls?.length ||
                    secrets.some(s => content.includes(s))) {
                    stop = true;
                    throw new Error("Invalid sampling answer");
                }
                answers.push((0, sub_model_bias_probes_js_2.normalizeBiasAnswer)(content) || "(blank)");
            }
            catch {
                if (options.signal?.aborted)
                    throw new Error("Probe run canceled");
                e.failures++;
                // A broken route must not burn the whole budget; retain partial evidence, never fake blanks.
                stop = true;
            }
            finally {
                clearTimeout(timer);
                options.signal?.removeEventListener("abort", abort);
            }
            options.onProgress?.({ attempts: e.attempts, failures: e.failures, total: 51 });
        }
        e.observations.push({ probeId: id, answers });
    }
    e.collectedAt = new Date().toISOString();
    return validateDistributionEvidence(e);
}
//# sourceMappingURL=distribution-evidence.js.map