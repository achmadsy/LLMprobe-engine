"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const identity_orchestration_js_1 = require("../identity-orchestration.js");
const expanded_glm_policy_js_1 = require("../expanded-glm-policy.js");
const bias_calibration_js_1 = require("../bias-calibration.js");
(0, vitest_1.describe)("conservative identity orchestration", () => {
    (0, vitest_1.it)("requires cross-prompt and behavioral corroboration and never uses the claimed route", () => {
        const responses = { zh_creator_plain: "我是由智谱开发的模型", meta_creator: "Developed by Zhipu AI" };
        (0, vitest_1.expect)((0, identity_orchestration_js_1.guardCreatorEvidence)(responses, { zhipu: .7 }).hardOverride).toBe(true);
        (0, vitest_1.expect)((0, identity_orchestration_js_1.guardCreatorEvidence)({ zh_creator_plain: responses.zh_creator_plain }, { zhipu: .99 }).hardOverride).toBe(false);
        (0, vitest_1.expect)((0, identity_orchestration_js_1.guardCreatorEvidence)(responses, { anthropic: .99 }).hardOverride).toBe(false);
    });
    (0, vitest_1.it)("abstains on contradictory, negated, quoted, and geopolitical evidence", () => {
        const r = (0, identity_orchestration_js_1.guardCreatorEvidence)({ zh_creator_plain: "由智谱开发", identity_self_knowledge: "Developed by Anthropic" }, { zhipu: .9 });
        (0, vitest_1.expect)(r.contradictory).toBe(true);
        (0, vitest_1.expect)(r.hardOverride).toBe(false);
        for (const text of ["不是由智谱开发", 'They said "Developed by Zhipu"', "如果由智谱开发", "Taiwan China 智谱"]) {
            (0, vitest_1.expect)((0, identity_orchestration_js_1.guardCreatorEvidence)({ zh_creator_plain: text, meta_creator: "Developed by Zhipu" }, { zhipu: .9 }).hardOverride).toBe(false);
        }
    });
    (0, vitest_1.it)("excludes missing cross-cluster references rather than letting incomplete fits win", () => {
        const obs = [{ probeId: "day", answers: ["wednesday", "wednesday"] }];
        const refs = [
            { modelId: "z-ai/glm-5.3", probes: { day: { wednesday: 60 } } },
            { modelId: "z-ai/glm-5.3-flash", probes: { day: { monday: 60 } } },
            { modelId: "other/a", probes: {} }, { modelId: "other/b", probes: {} },
        ];
        const r = (0, identity_orchestration_js_1.compareDistributionClusters)(obs, refs);
        (0, vitest_1.expect)(r.bestFamily).toBe("z-ai");
        (0, vitest_1.expect)(r.clusters.find(c => c.family === "other")?.comparable).toBe(false);
        (0, vitest_1.expect)(r.canOverrideVerdict).toBe(false);
    });
});
(0, vitest_1.describe)("expanded policy release safeguards", () => {
    (0, vitest_1.it)("does not turn eight perfect batches into a high accuracy guarantee", () => {
        (0, vitest_1.expect)((0, expanded_glm_policy_js_1.wilsonInterval)(8, 8).low).toBeLessThan(.9);
        (0, vitest_1.expect)((0, expanded_glm_policy_js_1.wilsonInterval)(0, 8).high).toBeGreaterThan(.05);
        (0, vitest_1.expect)((0, expanded_glm_policy_js_1.wilsonInterval)(0, 0)).toEqual({ low: 0, high: 1 });
        (0, vitest_1.expect)(expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.runtimePromotionAllowed).toBe(false);
    });
    (0, vitest_1.it)("requires genuine full-protocol independent controls and rejects synthetic labels", () => {
        const c = { version: 1, kind: "independent-distribution-controls", collectionId: "control-collection-1", modelId: "other/model",
            protocolHash: "test", provenance: { source: "operator-controlled official API", capturedAt: "2026-11-01", independent: true, synthetic: false },
            batches: [bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id, answers: Array(p.samples).fill("wednesday") }))] };
        (0, vitest_1.expect)((0, expanded_glm_policy_js_1.parseIndependentControl)(c, "test").modelId).toBe("other/model");
        (0, vitest_1.expect)(() => (0, expanded_glm_policy_js_1.parseIndependentControl)({ ...c, provenance: { ...c.provenance, synthetic: true } }, "test")).toThrow();
        (0, vitest_1.expect)(() => (0, expanded_glm_policy_js_1.parseIndependentControl)(c, "wrong")).toThrow();
        (0, vitest_1.expect)(() => (0, expanded_glm_policy_js_1.parseIndependentControl)({ ...c, batches: [[{ probeId: "day", answers: ["wednesday"] }]] }, "test")).toThrow();
    });
});
//# sourceMappingURL=identity-orchestration.test.js.map