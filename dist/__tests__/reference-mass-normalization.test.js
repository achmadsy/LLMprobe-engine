"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const reference_mass_normalization_js_1 = require("../reference-mass-normalization.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("../sub-model-v3g-bias-fingerprint.js");
(0, vitest_1.describe)("development-only reference mass normalization", () => {
    (0, vitest_1.it)("makes proportional frequencies equal despite different original sample counts", () => {
        const refs = [{ modelId: "test/a", sampleCount: 200, capturedAt: "2026-11-01", probes: { day: { monday: 100, friday: 100 } } },
            { modelId: "test/b", sampleCount: 60, capturedAt: "2026-11-01", probes: { day: { monday: 30, friday: 30 } } }];
        const before = structuredClone(refs);
        const normalized = (0, reference_mass_normalization_js_1.normalizeReferenceMass)(refs, ["day"]);
        (0, vitest_1.expect)(normalized.commonMass.day).toBe(60);
        (0, vitest_1.expect)(normalized.references[0].probes.day).toEqual(normalized.references[1].probes.day);
        (0, vitest_1.expect)(normalized.references[0]).not.toHaveProperty("sampleCount");
        (0, vitest_1.expect)(refs).toEqual(before);
        const r = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)([{ probeId: "day", answers: ["monday", "friday"] }], normalized.references);
        (0, vitest_1.expect)(r.scores["test/a"]).toBe(r.scores["test/b"]);
        (0, vitest_1.expect)(normalized.runtimePromotionAllowed).toBe(false);
    });
    (0, vitest_1.it)("rejects missing, negative, nonfinite and empty distributions", () => {
        const invalid = [{}, { monday: -1 }, { monday: NaN }, { monday: 0 }];
        for (const counts of invalid) {
            (0, vitest_1.expect)(() => (0, reference_mass_normalization_js_1.normalizeReferenceMass)([{ modelId: "a", probes: { day: counts } }, { modelId: "b", probes: { day: { monday: 1 } } }], ["day"])).toThrow();
        }
        (0, vitest_1.expect)(() => (0, reference_mass_normalization_js_1.normalizeReferenceMass)([{ modelId: "a", probes: {} }, { modelId: "b", probes: {} }], ["day"])).toThrow();
    });
});
//# sourceMappingURL=reference-mass-normalization.test.js.map