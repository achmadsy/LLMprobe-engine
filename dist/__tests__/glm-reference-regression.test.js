"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const sub_model_bias_baselines_js_1 = require("../sub-model-bias-baselines.js");
const glm_reference_regression_js_1 = require("../glm-reference-regression.js");
const pack = require("../glm53-bias-reference-pack.json");
(0, vitest_1.describe)("five-way reference reconstruction sanity", () => {
    (0, vitest_1.it)("keeps historical sibling rankings without promoting empirical controls or mutating references", () => {
        const refs = [...sub_model_bias_baselines_js_1.BIAS_BASELINES.filter(b => b.modelId.startsWith("z-ai/")), ...pack.references.map(r => r.baseline)];
        const before = JSON.stringify(refs);
        const r = (0, glm_reference_regression_js_1.checkGlmReferenceRegression)(refs);
        (0, vitest_1.expect)(r.records).toHaveLength(50);
        (0, vitest_1.expect)(r.runtimePromotionAllowed).toBe(false);
        (0, vitest_1.expect)(r.summary.every(m => m.rankedCorrect === 10)).toBe(true);
        (0, vitest_1.expect)(r.summary.every(m => m.wrongAccepted === 0 && m.stolenByNewModels === 0)).toBe(true);
        const controlled = r.controlledComparison.summary;
        for (const m of controlled) {
            (0, vitest_1.expect)(m.sharedStrongPass.fiveCandidates).toMatchObject({ batches: 10, correct: 10, wrong: 0, abstained: 0 });
            if (m.sharedStrongPass.threeCandidates.batches) {
                (0, vitest_1.expect)(m.sharedStrongPass.threeCandidates).toMatchObject({ batches: 10, correct: 10, wrong: 0, abstained: 0 });
                (0, vitest_1.expect)(m.candidateAdditionEffects.every(e => !e.rankChanged && e.gapChange === 0)).toBe(true);
            }
        }
        (0, vitest_1.expect)(controlled.slice(0, 3).map(m => [m.standardOnly.threeCandidates.correct, m.standardOnly.fiveCandidates.correct]))
            .toEqual([[8, 3], [10, 9], [7, 7]]);
        for (const record of r.records) {
            if (record.controlled.threeCandidates) {
                (0, vitest_1.expect)(record.controlled.threeCandidates.observationsDigest).toBe(record.controlled.fiveCandidates.observationsDigest);
                (0, vitest_1.expect)(record.controlled.threeCandidates.metrics.sampleCount).toBe(record.controlled.fiveCandidates.metrics.sampleCount);
            }
        }
        (0, vitest_1.expect)(JSON.stringify(refs)).toBe(before);
        (0, vitest_1.expect)(() => (0, glm_reference_regression_js_1.checkGlmReferenceRegression)(refs.slice(1))).toThrow("All five");
    });
});
//# sourceMappingURL=glm-reference-regression.test.js.map