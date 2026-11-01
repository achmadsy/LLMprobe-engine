"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const distribution_evidence_js_1 = require("../distribution-evidence.js");
const runner_js_1 = require("../runner.js");
const glm_distribution_models_js_1 = require("../glm-distribution-models.js");
const original_suite_js_1 = require("../original-suite.js");
const sub_model_bias_probes_js_1 = require("../sub-model-bias-probes.js");
const target = { baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm/glm-5.3", maxCalls: 51 };
const response = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "Wednesday" } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
(0, vitest_1.describe)("bounded distribution evidence", () => {
    vitest_1.it.each(glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS)("automatically samples a full %s run without opt-in", async (modelId) => {
        let distributionCalls = 0;
        const prompts = new Set(sub_model_bias_probes_js_1.BIAS_PROBES.filter(p => glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.includes(p.id)).map(p => p.prompt));
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            if (body.temperature === 1 && body.max_tokens === 128 && body.stream === false && prompts.has(body.messages[0].content)) {
                distributionCalls++;
                return response();
            }
            if (body.max_tokens === 1)
                return Response.json({});
            // Fail normal tasks immediately; no target traffic leaves this mock.
            return new Response("unsupported test task", { status: 400 });
        });
        const r = await (0, runner_js_1.runProbes)({ ...target, modelId, requestRetries: 0, probeIds: [...original_suite_js_1.ORIGINAL_SUITE_IDS], fetchFn });
        (0, vitest_1.expect)(distributionCalls).toBe(51);
        (0, vitest_1.expect)(r.identityAssessment?.distributionEvidence).toMatchObject({ attempts: 51, failures: 0, modelId });
        (0, vitest_1.expect)(r.totalInputTokens).toBe(510);
    });
    (0, vitest_1.it)("does not sample unrelated models or selected-task runs by default", async () => {
        const fetchFn = vitest_1.vi.fn(async () => response());
        await (0, runner_js_1.runProbes)({ ...target, probeIds: ["identity_self_knowledge"], requestRetries: 0, fetchFn });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(2); // preflight + selected task only
    });
    (0, vitest_1.it)("discards credential echoes and honors cancellation before any request", async () => {
        const e = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, fetchFn: vitest_1.vi.fn(async () => Response.json({
                choices: [{ finish_reason: "stop", message: { content: target.apiKey } }],
            })) });
        (0, vitest_1.expect)(e).toMatchObject({ attempts: 1, failures: 1 });
        (0, vitest_1.expect)(JSON.stringify(e)).not.toContain(target.apiKey);
        const controller = new AbortController();
        controller.abort();
        const fetchFn = vitest_1.vi.fn();
        await (0, vitest_1.expect)((0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, signal: controller.signal, fetchFn })).rejects.toThrow("canceled");
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("makes exactly 51 sequential bounded calls with the reference protocol and records usage", async () => {
        let active = 0;
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            (0, vitest_1.expect)(++active).toBe(1);
            (0, vitest_1.expect)(JSON.parse(String(init?.body))).toMatchObject({ temperature: 1, max_tokens: 128, stream: false });
            (0, vitest_1.expect)(init?.redirect).toBe("error");
            active--;
            return response();
        });
        const e = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, fetchFn });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(51);
        (0, vitest_1.expect)(e).toMatchObject({ attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51 });
        (0, vitest_1.expect)(e.observations.map(o => o.answers.length)).toEqual([3, 6, 6, 6, 6, 6, 6, 6, 6]);
        (0, vitest_1.expect)((0, distribution_evidence_js_1.validateDistributionEvidence)({ ...e, apiKey: "should-not-be-saved" })).not.toHaveProperty("apiKey");
    });
    (0, vitest_1.it)("stops at the first HTTP failure without retries or fabricated blanks", async () => {
        const fetchFn = vitest_1.vi.fn(async () => new Response("secret error", { status: 429 }));
        const e = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, fetchFn });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(e).toMatchObject({ attempts: 1, failures: 1 });
        (0, vitest_1.expect)(e.observations.every(o => !o.answers.length)).toBe(true);
        (0, vitest_1.expect)(JSON.stringify(e)).not.toContain("secret error");
    });
    (0, vitest_1.it)("rejects forged observations, unsupported models, and missing approval before network calls", async () => {
        const fetchFn = vitest_1.vi.fn();
        await (0, vitest_1.expect)((0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, modelId: "openai/other", fetchFn })).rejects.toThrow("supports only");
        await (0, vitest_1.expect)((0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, maxCalls: 50, fetchFn })).rejects.toThrow("budget");
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
        const e = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, fetchFn: vitest_1.vi.fn(async () => response()) });
        (0, vitest_1.expect)(() => (0, distribution_evidence_js_1.validateDistributionEvidence)({ ...e, attempts: 50 })).toThrow("counts");
    });
    vitest_1.it.each(["retry", "rejudge"])("%s reuses saved distribution evidence without resampling", async (operation) => {
        const evidence = await (0, distribution_evidence_js_1.collectDistributionEvidence)({ ...target, fetchFn: vitest_1.vi.fn(async () => response()) });
        const previous = { probeId: "identity_self_knowledge", label: "identity", group: "identity", neutral: true,
            status: "done", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: 20, outputTokens: 5,
            tps: null, response: "I am GLM from Zhipu AI", error: null };
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            (0, vitest_1.expect)(body.temperature === 1 && body.max_tokens === 128).toBe(false);
            return response();
        });
        const r = await (0, runner_js_1.runProbes)({ ...target, claimedModel: "glm-5.3", operation, retryProbeId: operation === "retry" ? previous.probeId : undefined, previousResults: [previous],
            savedDistributionEvidence: evidence, distributionSampling: { enabled: true, maxCalls: 51 }, probeIds: [previous.probeId], fetchFn });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(operation === "retry" ? 1 : 0);
        (0, vitest_1.expect)(r.identityAssessment?.distributionEvidence).toEqual(evidence);
        (0, vitest_1.expect)(r.identityAssessment?.distributionEvidence?.observations).toEqual(evidence.observations);
        if (operation === "rejudge")
            (0, vitest_1.expect)(r.totalInputTokens).toBe(530);
    });
});
//# sourceMappingURL=distribution-evidence.test.js.map