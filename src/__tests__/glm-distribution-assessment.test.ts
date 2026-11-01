import { describe, expect, it } from "vitest";
import { assessGlmDistribution } from "../glm-distribution-assessment.js";
import { GLM_DISTRIBUTION_MODELS, GLM_DISTRIBUTION_PROBE_IDS, supportsGlmDistribution } from "../glm-distribution-models.js";
import { assessAdvancedIdentity } from "../advanced-identity.js";
import type { BiasBaseline } from "../sub-model-v3g-bias-fingerprint.js";
import { runProbes, type ProbeResult } from "../runner.js";
const refs: BiasBaseline[] = GLM_DISTRIBUTION_MODELS.map((modelId, i) => ({ modelId, capturedAt: "2026-11-01", sampleCount: 540,
  probes: Object.fromEntries(GLM_DISTRIBUTION_PROBE_IDS.map(id => [id, { [`answer${i}`]: i < 3 ? 200 : 60 }])) }));
const obs = (i: number) => GLM_DISTRIBUTION_PROBE_IDS.map(probeId => ({ probeId, answers: Array<string>(probeId === "day" ? 3 : 6).fill(`answer${i}`) }));
const family = { confirmedFamily: "zhipu", confidence: .9, contradictory: false };
function row(probeId: string, response: string): ProbeResult {
  return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true, passed: null,
    passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
describe("provisional five-model runtime assessment", () => {
  it.each(GLM_DISTRIBUTION_MODELS)("compares %s with identical gates and preserves source mass", modelId => {
    const i = GLM_DISTRIBUTION_MODELS.indexOf(modelId), before = JSON.stringify(refs);
    const r = assessGlmDistribution(obs(i), refs, family);
    expect(r).toMatchObject({ state: "likely", acceptedModel: modelId, complete: true });
    expect(r.comparison?.metrics.sampleCount).toBe(51);
    expect(r.referenceManifest.effectiveMass.day).toBe(60);
    expect(r.referenceManifest.originalMasses[0].probes.day).toBe(200);
    expect(JSON.stringify(refs)).toBe(before);
  });
  it("abstains on missing slots, duplicate prompts, out-of-set answers or unsupported/conflicting family", () => {
    const complete = obs(0);
    for (const input of [complete.slice(1), complete.map((o, i) => i ? o : { ...o, answers: o.answers.slice(1) }),
      complete.map((o, i) => i ? o : { ...o, probeId: complete[1].probeId })]) {
      expect(assessGlmDistribution(input, refs, family).acceptedModel).toBeNull();
    }
    for (const f of [{ ...family, confirmedFamily: "anthropic" }, { ...family, confidence: .64 }, { ...family, contradictory: true }])
      expect(assessGlmDistribution(complete, refs, f).acceptedModel).toBeNull();
    const alien = complete.map(o => ({ ...o, answers: o.answers.map(() => "unseen") }));
    expect(assessGlmDistribution(alien, refs, family).acceptedModel).toBeNull();
    expect(() => assessGlmDistribution(complete, refs.slice(1), family)).toThrow("All five");
  });
  it("supports only the five selectors, never nearby unsupported variants", () => {
    for (const id of GLM_DISTRIBUTION_MODELS) for (const selector of [id, id.slice(5), `glm/${id.slice(5).toUpperCase()}`]) expect(supportsGlmDistribution(selector)).toBe(true);
    for (const id of ["glm-5-flash", "glm-5.1-flash", "glm-5.4", "glm-5.30", "glm-5.3-thinking", undefined]) expect(supportsGlmDistribution(id)).toBe(false);
  });
  it("reports and persists a likely estimate; changing the claim never changes its rank", async () => {
    const pack = require("../glm53-bias-reference-pack.json") as { references: Array<{ baseline: BiasBaseline }> };
    const reference = pack.references.find(r => r.baseline.modelId === "z-ai/glm-5.3")!.baseline;
    const observations = GLM_DISTRIBUTION_PROBE_IDS.map(probeId => {
      const sorted = Object.entries(reference.probes[probeId]).sort((a, b) => b[1] - a[1]);
      return { probeId, answers: Array<string>(probeId === "day" ? 3 : 6).fill(sorted[0][0]) };
    });
    const results = [row("identity_self_knowledge", "I am GLM, developed by Zhipu AI"), row("meta_creator", "Zhipu AI developed GLM"),
      row("zh_creator_plain", "我是由智谱AI开发的GLM大语言模型。")];
    const a = assessAdvancedIdentity({ results, claimedModel: "glm-5.3", savedObservations: observations })!;
    const b = assessAdvancedIdentity({ results, claimedModel: "glm-5.1", savedObservations: observations })!;
    expect(a.distribution.result.acceptedModel).toBe("z-ai/glm-5.3");
    expect(b.distribution.result.acceptedModel).toBe(a.distribution.result.acceptedModel);
    expect(a.verdict).toMatchObject({ status: "likely_match", trueModel: "z-ai/glm-5.3", confidence: "medium" });
    expect(b.verdict.status).toBe("likely_submodel_mismatch");
    expect(a.verdict.reasoning.join(" ")).toContain("Provisional");
    const report = await runProbes({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
      claimedModel: "glm-5.3", operation: "rejudge", previousResults: results, probeIds: results.map(r => r.probeId),
      savedDistributionEvidence: { version: 1, modelId: "glm-5.3", protocolId: "glm-nine-temperature1-max128-v1",
        observations, attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51, collectedAt: "2026-11-01T00:00:00Z" },
      fetchFn: async () => { throw new Error("Rejudge must not fetch"); } });
    expect(report.identityAssessment?.verdict).toEqual(a.verdict);
    expect(report.identityAssessment?.status).toBe("match");
    expect(report.identityAssessment?.predictedFamily).toBe("zhipu");
  });
});
