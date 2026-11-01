"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const glm_distribution_assessment_js_1 = require("../glm-distribution-assessment.js");
const glm_distribution_models_js_1 = require("../glm-distribution-models.js");
const advanced_identity_js_1 = require("../advanced-identity.js");
const runner_js_1 = require("../runner.js");
const refs = glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS.map((modelId, i) => ({ modelId, capturedAt: "2026-11-01", sampleCount: 540,
    probes: Object.fromEntries(glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.map(id => [id, { [`answer${i}`]: i < 3 ? 200 : 60 }])) }));
const obs = (i) => glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.map(probeId => ({ probeId, answers: Array(probeId === "day" ? 3 : 6).fill(`answer${i}`) }));
const family = { confirmedFamily: "zhipu", confidence: .9, contradictory: false };
function row(probeId, response) {
    return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true, passed: null,
        passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
(0, vitest_1.describe)("provisional five-model runtime assessment", () => {
    vitest_1.it.each(glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS)("compares %s with identical gates and preserves source mass", modelId => {
        const i = glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS.indexOf(modelId), before = JSON.stringify(refs);
        const r = (0, glm_distribution_assessment_js_1.assessGlmDistribution)(obs(i), refs, family);
        (0, vitest_1.expect)(r).toMatchObject({ state: "likely", acceptedModel: modelId, complete: true });
        (0, vitest_1.expect)(r.comparison?.metrics.sampleCount).toBe(51);
        (0, vitest_1.expect)(r.referenceManifest.effectiveMass.day).toBe(60);
        (0, vitest_1.expect)(r.referenceManifest.originalMasses[0].probes.day).toBe(200);
        (0, vitest_1.expect)(JSON.stringify(refs)).toBe(before);
    });
    (0, vitest_1.it)("abstains on missing slots, duplicate prompts, out-of-set answers or unsupported/conflicting family", () => {
        const complete = obs(0);
        for (const input of [complete.slice(1), complete.map((o, i) => i ? o : { ...o, answers: o.answers.slice(1) }),
            complete.map((o, i) => i ? o : { ...o, probeId: complete[1].probeId })]) {
            (0, vitest_1.expect)((0, glm_distribution_assessment_js_1.assessGlmDistribution)(input, refs, family).acceptedModel).toBeNull();
        }
        for (const f of [{ ...family, confirmedFamily: "anthropic" }, { ...family, confidence: .64 }, { ...family, contradictory: true }])
            (0, vitest_1.expect)((0, glm_distribution_assessment_js_1.assessGlmDistribution)(complete, refs, f).acceptedModel).toBeNull();
        const alien = complete.map(o => ({ ...o, answers: o.answers.map(() => "unseen") }));
        (0, vitest_1.expect)((0, glm_distribution_assessment_js_1.assessGlmDistribution)(alien, refs, family).acceptedModel).toBeNull();
        (0, vitest_1.expect)(() => (0, glm_distribution_assessment_js_1.assessGlmDistribution)(complete, refs.slice(1), family)).toThrow("All five");
    });
    (0, vitest_1.it)("supports only the five selectors, never nearby unsupported variants", () => {
        for (const id of glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS)
            for (const selector of [id, id.slice(5), `glm/${id.slice(5).toUpperCase()}`])
                (0, vitest_1.expect)((0, glm_distribution_models_js_1.supportsGlmDistribution)(selector)).toBe(true);
        for (const id of ["glm-5-flash", "glm-5.1-flash", "glm-5.4", "glm-5.30", "glm-5.3-thinking", undefined])
            (0, vitest_1.expect)((0, glm_distribution_models_js_1.supportsGlmDistribution)(id)).toBe(false);
    });
    (0, vitest_1.it)("reports and persists a likely estimate; changing the claim never changes its rank", async () => {
        const pack = require("../glm53-bias-reference-pack.json");
        const reference = pack.references.find(r => r.baseline.modelId === "z-ai/glm-5.3").baseline;
        const observations = glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.map(probeId => {
            const sorted = Object.entries(reference.probes[probeId]).sort((a, b) => b[1] - a[1]);
            return { probeId, answers: Array(probeId === "day" ? 3 : 6).fill(sorted[0][0]) };
        });
        const results = [row("identity_self_knowledge", "I am GLM, developed by Zhipu AI"), row("meta_creator", "Zhipu AI developed GLM"),
            row("zh_creator_plain", "我是由智谱AI开发的GLM大语言模型。")];
        const a = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results, claimedModel: "glm-5.3", savedObservations: observations });
        const b = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results, claimedModel: "glm-5.1", savedObservations: observations });
        (0, vitest_1.expect)(a.distribution.result.acceptedModel).toBe("z-ai/glm-5.3");
        (0, vitest_1.expect)(b.distribution.result.acceptedModel).toBe(a.distribution.result.acceptedModel);
        (0, vitest_1.expect)(a.verdict).toMatchObject({ status: "likely_match", trueModel: "z-ai/glm-5.3", confidence: "medium" });
        (0, vitest_1.expect)(b.verdict.status).toBe("likely_submodel_mismatch");
        (0, vitest_1.expect)(a.verdict.reasoning.join(" ")).toContain("Provisional");
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
            claimedModel: "glm-5.3", operation: "rejudge", previousResults: results, probeIds: results.map(r => r.probeId),
            savedDistributionEvidence: { version: 1, modelId: "glm-5.3", protocolId: "glm-nine-temperature1-max128-v1",
                observations, attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51, collectedAt: "2026-11-01T00:00:00Z" },
            fetchFn: async () => { throw new Error("Rejudge must not fetch"); } });
        (0, vitest_1.expect)(report.identityAssessment?.verdict).toEqual(a.verdict);
        (0, vitest_1.expect)(report.identityAssessment?.status).toBe("match");
        (0, vitest_1.expect)(report.identityAssessment?.predictedFamily).toBe("zhipu");
    });
});
//# sourceMappingURL=glm-distribution-assessment.test.js.map