import { describe, expect, it } from "vitest";
import { guardCreatorEvidence, compareDistributionClusters } from "../identity-orchestration.js";
import { parseIndependentControl, wilsonInterval, EXPANDED_GLM_POLICY } from "../expanded-glm-policy.js";
import { GLM_CALIBRATION_PROBES } from "../bias-calibration.js";
import type { BiasBaseline } from "../sub-model-v3g-bias-fingerprint.js";

describe("conservative identity orchestration", () => {
  it("requires cross-prompt and behavioral corroboration and never uses the claimed route", () => {
    const responses = { zh_creator_plain: "我是由智谱开发的模型", meta_creator: "Developed by Zhipu AI" };
    expect(guardCreatorEvidence(responses, { zhipu: .7 }).hardOverride).toBe(true);
    expect(guardCreatorEvidence({ zh_creator_plain: responses.zh_creator_plain }, { zhipu: .99 }).hardOverride).toBe(false);
    expect(guardCreatorEvidence(responses, { anthropic: .99 }).hardOverride).toBe(false);
  });
  it("abstains on contradictory, negated, quoted, and geopolitical evidence", () => {
    const r = guardCreatorEvidence({ zh_creator_plain: "由智谱开发", identity_self_knowledge: "Developed by Anthropic" }, { zhipu: .9 });
    expect(r.contradictory).toBe(true); expect(r.hardOverride).toBe(false);
    for (const text of ["不是由智谱开发", 'They said "Developed by Zhipu"', "如果由智谱开发", "Taiwan China 智谱"]) {
      expect(guardCreatorEvidence({ zh_creator_plain: text, meta_creator: "Developed by Zhipu" }, { zhipu: .9 }).hardOverride).toBe(false);
    }
  });
  it("excludes missing cross-cluster references rather than letting incomplete fits win", () => {
    const obs = [{ probeId: "day", answers: ["wednesday", "wednesday"] }];
    const refs: BiasBaseline[] = [
      { modelId: "z-ai/glm-5.3", probes: { day: { wednesday: 60 } } },
      { modelId: "z-ai/glm-5.3-flash", probes: { day: { monday: 60 } } },
      { modelId: "other/a", probes: {} }, { modelId: "other/b", probes: {} },
    ];
    const r = compareDistributionClusters(obs, refs);
    expect(r.bestFamily).toBe("z-ai");
    expect(r.clusters.find(c => c.family === "other")?.comparable).toBe(false);
    expect(r.canOverrideVerdict).toBe(false);
  });
});

describe("expanded policy release safeguards", () => {
  it("does not turn eight perfect batches into a high accuracy guarantee", () => {
    expect(wilsonInterval(8, 8).low).toBeLessThan(.9);
    expect(wilsonInterval(0, 8).high).toBeGreaterThan(.05);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
    expect(EXPANDED_GLM_POLICY.runtimePromotionAllowed).toBe(false);
  });
  it("requires genuine full-protocol independent controls and rejects synthetic labels", () => {
    const c = { version: 1, kind: "independent-distribution-controls", collectionId: "control-collection-1", modelId: "other/model",
      protocolHash: "test", provenance: { source: "operator-controlled official API", capturedAt: "2026-11-01", independent: true, synthetic: false },
      batches: [GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id, answers: Array(p.samples).fill("wednesday") }))] };
    expect(parseIndependentControl(c, "test").modelId).toBe("other/model");
    expect(() => parseIndependentControl({ ...c, provenance: { ...c.provenance, synthetic: true } }, "test")).toThrow();
    expect(() => parseIndependentControl(c, "wrong")).toThrow();
    expect(() => parseIndependentControl({ ...c, batches: [[{ probeId: "day", answers: ["wednesday"] }]] }, "test")).toThrow();
  });
});
