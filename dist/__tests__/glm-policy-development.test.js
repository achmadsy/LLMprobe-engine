"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const bias_calibration_js_1 = require("../bias-calibration.js");
const glm_policy_development_js_1 = require("../glm-policy-development.js");
async function reference(modelId, word) {
    return (0, bias_calibration_js_1.collectCalibration)((0, bias_calibration_js_1.makeCalibrationPlan)({ modelId, purpose: "reference" }), {
        baseUrl: "https://trusted.example/v1", apiKey: "test-secret", maxRequests: 540, execute: true,
        fetchFn: vitest_1.vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: word } }] })),
    });
}
(0, vitest_1.describe)("reference-only policy development", () => {
    (0, vitest_1.it)("is deterministic and reports experiments without promoting a runtime rule", async () => {
        const refs = [await reference("z-ai/glm-5.3", "sapphire"), await reference("z-ai/glm-5.3-flash", "ruby")];
        const report = (0, glm_policy_development_js_1.developGlmPolicy)(refs);
        (0, vitest_1.expect)(report).toEqual((0, glm_policy_development_js_1.developGlmPolicy)(refs));
        (0, vitest_1.expect)(report.state).toBe("reference-development-only");
        (0, vitest_1.expect)(report.runtimePromotionAllowed).toBe(false);
        (0, vitest_1.expect)(report.byModel.every(m => m.developmentBatches === 10)).toBe(true);
        (0, vitest_1.expect)(report.records).toHaveLength(20);
        (0, vitest_1.expect)(report.byModel.every(m => m.promptWinners.length === 9)).toBe(true);
        (0, vitest_1.expect)(report.limitations.join(" ")).toContain("dependent");
    });
    (0, vitest_1.it)("refuses final holdout collections and duplicate reference identities", async () => {
        const r = await reference("z-ai/glm-5.3", "sapphire");
        const holdout = structuredClone(r);
        holdout.plan.purpose = "validation";
        (0, vitest_1.expect)(() => (0, glm_policy_development_js_1.developGlmPolicy)([holdout])).toThrow("holdouts are forbidden");
        (0, vitest_1.expect)(() => (0, glm_policy_development_js_1.developGlmPolicy)([r, r])).toThrow("duplicate");
    });
});
//# sourceMappingURL=glm-policy-development.test.js.map