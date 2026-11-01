"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const glm_controlled_comparison_js_1 = require("../glm-controlled-comparison.js");
const sub_model_bias_probes_js_1 = require("../sub-model-bias-probes.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("../sub-model-v3g-bias-fingerprint.js");
const decisive = { rankedModel: "z-ai/glm-5", confidence: .999, sampleCount: 51,
    logLikelihoodGap: 10, probeVoteMargin: 1, avgLogLikelihood: -2 };
(0, vitest_1.describe)("controlled GLM acceptance rules", () => {
    (0, vitest_1.it)("reports standard-only and strong-pass separately without changing thresholds", () => {
        const r = (0, glm_controlled_comparison_js_1.applyControlledGlmGates)(decisive);
        (0, vitest_1.expect)(r.standardOnly).toEqual({ acceptedModel: null, failedGates: ["prompt-vote-margin"] });
        (0, vitest_1.expect)(r.sharedStrongPass).toEqual({ acceptedModel: decisive.rankedModel, strongPassPredicate: true, voteGateWaived: true });
        (0, vitest_1.expect)((0, glm_controlled_comparison_js_1.applyControlledGlmGates)({ ...decisive, probeVoteMargin: 3 }).standardOnly.acceptedModel).toBe(decisive.rankedModel);
    });
    (0, vitest_1.it)("retains confidence, gap, fit and negative-vote sample floors for strong-pass", () => {
        for (const metrics of [
            { ...decisive, confidence: .93 }, { ...decisive, logLikelihoodGap: 4.9 },
            { ...decisive, avgLogLikelihood: -3.21 }, { ...decisive, probeVoteMargin: -1, sampleCount: 17 },
            { ...decisive, avgLogLikelihood: NaN }, { ...decisive, rankedModel: null },
        ])
            (0, vitest_1.expect)((0, glm_controlled_comparison_js_1.applyControlledGlmGates)(metrics).sharedStrongPass.acceptedModel).toBeNull();
        (0, vitest_1.expect)((0, glm_controlled_comparison_js_1.applyControlledGlmGates)({ ...decisive, probeVoteMargin: -1, sampleCount: 18 }).sharedStrongPass.acceptedModel).toBe(decisive.rankedModel);
    });
    (0, vitest_1.it)("uses the original GLM strong-pass predicate exactly, including boundary values", () => {
        const policy = sub_model_v3g_bias_fingerprint_js_1.V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster");
        for (const confidence of [.94, .95, .999])
            for (const gap of [2.5, 4.99, 5])
                for (const votes of [-1, 0, 3])
                    for (const samples of [17, 18, 51]) {
                        const metrics = { ...decisive, confidence, logLikelihoodGap: gap, probeVoteMargin: votes, sampleCount: samples };
                        (0, vitest_1.expect)((0, glm_controlled_comparison_js_1.applyControlledGlmGates)(metrics).sharedStrongPass.strongPassPredicate).toBe((0, sub_model_v3g_bias_fingerprint_js_1.isStrongPassByPolicy)(policy, metrics));
                    }
    });
    (0, vitest_1.it)("holds observation coverage fixed and bypasses implicit candidate-set policy matching", () => {
        const policy = sub_model_v3g_bias_fingerprint_js_1.V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster");
        const probes = sub_model_bias_probes_js_1.BIAS_PROBES.filter(p => policy.activeProbeIds.includes(p.id));
        const obs = probes.map(p => ({ probeId: p.id, answers: Array(p.samples).fill("alpha") }));
        const three = policy.modelIds.map((modelId, i) => ({ modelId,
            probes: Object.fromEntries(probes.map(p => [p.id, { [i === 0 ? "alpha" : "beta"]: 30 }])) }));
        const five = [...three, ...["z-ai/glm-5.3", "z-ai/glm-5.3-flash"].map(modelId => ({ modelId,
                probes: Object.fromEntries(probes.map(p => [p.id, { gamma: 30 }])) }))];
        (0, vitest_1.expect)((0, sub_model_v3g_bias_fingerprint_js_1.policyForCandidates)(three)?.id).toBe("zhipu-glm-cluster");
        (0, vitest_1.expect)((0, sub_model_v3g_bias_fingerprint_js_1.policyForCandidates)(five)).toBeNull();
        const before = JSON.stringify({ three, five, obs });
        const a = (0, glm_controlled_comparison_js_1.scoreControlledGlmComparison)(obs, three), b = (0, glm_controlled_comparison_js_1.scoreControlledGlmComparison)(obs, five);
        (0, vitest_1.expect)(a.observationsDigest).toBe(b.observationsDigest);
        (0, vitest_1.expect)(a.metrics.sampleCount).toBe(51);
        (0, vitest_1.expect)(b.metrics.sampleCount).toBe(51);
        (0, vitest_1.expect)(a.decisions.standardOnly.acceptedModel).toBe("z-ai/glm-5");
        (0, vitest_1.expect)(b.decisions.standardOnly.acceptedModel).toBe("z-ai/glm-5");
        const historical = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(obs, three);
        (0, vitest_1.expect)(a.metrics.logLikelihoodGap).toBeCloseTo(historical.logLikelihoodGap, 12);
        (0, vitest_1.expect)(a.metrics.probeVoteMargin).toBe(historical.probeVoteMargin);
        (0, vitest_1.expect)(a.decisions.sharedStrongPass.acceptedModel).toBe(historical.topModel);
        (0, vitest_1.expect)(JSON.stringify({ three, five, obs })).toBe(before);
        // A successful hypothetical result must not register or alter the runtime policy.
        (0, vitest_1.expect)((0, sub_model_v3g_bias_fingerprint_js_1.policyForCandidates)(five)).toBeNull();
    });
});
//# sourceMappingURL=glm-controlled-comparison.test.js.map