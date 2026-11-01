import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Isolate the reported conflict: style-only V2 favors Anthropic, not Zhipu.
vi.mock("../identity-classifier-v2.js", () => ({
  classifyIdentityV2: () => ({
    topFamily: "anthropic", familyScores: { anthropic: .8, zhipu: .15, openai: .05 },
    attackFamilyScores: { anthropic: .77, zhipu: .02, openai: .16 },
    spoofDetected: false, subModelPosteriors: [], subModelConfident: false,
  }),
}));

import { assessAdvancedIdentity } from "../advanced-identity.js";
import { GLM_DISTRIBUTION_PROBE_IDS } from "../glm-distribution-models.js";
import { runProbes, type ProbeResult } from "../runner.js";
import type { BiasBaseline, BiasObservation } from "../sub-model-v3g-bias-fingerprint.js";

function row(probeId: string, response: string): ProbeResult {
  return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true,
    passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
const results = [
  row("identity_self_knowledge", "I'm **ZCode**.\n- **Underlying model**: GLM-5.3\n- **Created by**: Z.ai"),
  row("meta_creator", "Z.AI"), row("zh_creator_plain", "Z.ai，GLM。"),
];
// Synthetic modal answers exercise orchestration, NOT independent model accuracy.
const pack = require("../glm53-bias-reference-pack.json") as { references: Array<{ baseline: BiasBaseline }> };
const reference = pack.references.find(r => r.baseline.modelId === "z-ai/glm-5.3")!.baseline;
const observations: BiasObservation[] = GLM_DISTRIBUTION_PROBE_IDS.map(probeId => ({ probeId,
  answers: Array<string>(probeId === "day" ? 3 : 6).fill(Object.entries(reference.probes[probeId]).sort((a, b) => b[1] - a[1])[0][0]),
}));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function assess(rows = results, savedObservations = observations, claimedModel: string | undefined = "glm-5.3") {
  return assessAdvancedIdentity({ results: rows, savedObservations, claimedModel })!;
}

describe("qualified creator/distribution family reconciliation", () => {
  it("reconciles repeated Z.ai answers with all 51 gate-passing observations, retaining conflicting style diagnostics", () => {
    const a = assess();
    expect(a.creatorGuard).toMatchObject({ repeatedCreatorSupport: true, hardOverride: false });
    expect(a.v2.topFamily).toBe("anthropic");
    expect(a.familyFusion).toMatchObject({ confirmedFamily: "zhipu", source: "creator-distribution", hardOverride: false });
    expect(a.distribution.result).toMatchObject({ complete: true, familySupported: true, acceptedModel: "z-ai/glm-5.3" });
    expect(a.verdict).toMatchObject({ status: "likely_match", trueFamily: "zhipu", trueModel: "z-ai/glm-5.3", confidence: "medium" });
    expect(a.verdict.reasoning.join(" ")).toContain("Provisional");
    expect(a.decisionPath.find(s => s.stage === "family")?.outcome).toBe("zhipu");
    expect(a.clusterComparison.canOverrideVerdict).toBe(false);
    expect(a.distribution.independentlyValidated).toBe(false);
  });

  it.each([
    ["glm-5.1", "likely_submodel_mismatch"],
    ["anthropic/claude-sonnet-5", "model_estimate"],
    [undefined, "model_estimate"],
  ])("never uses claim %s to select family or winner", (claimedModel, status) => {
    const a = assessAdvancedIdentity({ results, savedObservations: observations, claimedModel })!;
    expect(a.familyFusion.confirmedFamily).toBe("zhipu");
    expect(a.distribution.result.acceptedModel).toBe("z-ai/glm-5.3");
    expect(a.verdict.status).toBe(status);
    expect(digest(a.distribution.observations)).toBe(digest(observations));
  });

  it.each([
    ["absent", []],
    ["missing prompt", observations.slice(1)],
    ["missing answer", observations.map((o, i) => i ? o : { ...o, answers: o.answers.slice(1) })],
    ["failed likelihood gates", observations.map(o => ({ ...o, answers: o.answers.map(() => "unseenanswer") }))],
  ])("does not reconcile with %s distribution evidence", (_label, savedObservations) => {
    const a = assess(results, savedObservations);
    expect(a.familyFusion.source).not.toBe("creator-distribution");
    expect(a.familyFusion.confirmedFamily).toBe("anthropic");
    expect(a.distribution.result.acceptedModel).toBeNull();
    expect(a.verdict.trueModel).toBeNull();
  });

  it.each([
    ["no maker", [row("identity_self_knowledge", "I can assist with coding")]],
    ["one maker prompt", [results[1]]],
    ["no Chinese prompt", results.slice(0, 2)],
    ["competing maker", [...results, row("zh_who_built_pressure", "Developed by Anthropic")]],
    ["competing makers within an answer", [results[1], row("zh_creator_plain", "Created by Z.ai and developed by Anthropic")]],
    ["truncated Chinese prompt", results.map(r => r.probeId === "zh_creator_plain" ? { ...r, responseTruncated: true } : r)],
    ["negated Chinese prompt", [results[1], row("zh_creator_plain", "不是由智谱开发")]],
  ])("does not reconcile despite a GLM claim and passing distribution when there is %s", (_label, rows) => {
    const a = assess(rows);
    expect(a.distribution.result.comparison?.decisions.sharedStrongPass.acceptedModel).toBe("z-ai/glm-5.3");
    expect(a.familyFusion.source).not.toBe("creator-distribution");
    expect(a.distribution.state).toBe("family-unconfirmed");
    expect(a.distribution.result.acceptedModel).toBeNull();
  });

  it("rejudges in memory with identical saved evidence and primary/advanced verdicts, without fetch", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("No target requests allowed"); });
    const savedDistributionEvidence = { version: 1 as const, modelId: "glm-5.3", protocolId: "glm-nine-temperature1-max128-v1" as const,
      observations, attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51, collectedAt: "2026-11-01T00:00:00Z" };
    const before = JSON.stringify(savedDistributionEvidence);
    const report = await runProbes({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
      claimedModel: "glm-5.3", operation: "rejudge", previousResults: results,
      probeIds: results.map(r => r.probeId), savedDistributionEvidence, fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(savedDistributionEvidence)).toBe(before);
    expect(report.identityAssessment?.distributionEvidence).toEqual(savedDistributionEvidence);
    expect(report.identityAssessment?.verdict).toEqual(report.identityAssessment?.advanced?.verdict);
    expect(report.identityAssessment?.verdict).toMatchObject({ status: "likely_match", trueModel: "z-ai/glm-5.3", trueFamily: "zhipu" });
    expect(report.identityAssessment?.predictedFamily).toBe("zhipu");
    expect(report.results.map(r => r.response)).toEqual(results.map(r => r.response));
  });
});
