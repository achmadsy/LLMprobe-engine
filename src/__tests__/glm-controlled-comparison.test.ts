import { describe, expect, it } from "vitest";
import { applyControlledGlmGates, scoreControlledGlmComparison, type ControlledMetrics } from "../glm-controlled-comparison.js";
import { BIAS_PROBES } from "../sub-model-bias-probes.js";
import { isStrongPassByPolicy, policyForCandidates, scoreV3HDistributionFingerprint, V3H_ACTIVE_PROMPT_POLICIES, type BiasBaseline } from "../sub-model-v3g-bias-fingerprint.js";

const decisive: ControlledMetrics = { rankedModel: "z-ai/glm-5", confidence: .999, sampleCount: 51,
  logLikelihoodGap: 10, probeVoteMargin: 1, avgLogLikelihood: -2 };

describe("controlled GLM acceptance rules", () => {
  it("reports standard-only and strong-pass separately without changing thresholds", () => {
    const r = applyControlledGlmGates(decisive);
    expect(r.standardOnly).toEqual({ acceptedModel: null, failedGates: ["prompt-vote-margin"] });
    expect(r.sharedStrongPass).toEqual({ acceptedModel: decisive.rankedModel, strongPassPredicate: true, voteGateWaived: true });
    expect(applyControlledGlmGates({ ...decisive, probeVoteMargin: 3 }).standardOnly.acceptedModel).toBe(decisive.rankedModel);
  });

  it("retains confidence, gap, fit and negative-vote sample floors for strong-pass", () => {
    for (const metrics of [
      { ...decisive, confidence: .93 }, { ...decisive, logLikelihoodGap: 4.9 },
      { ...decisive, avgLogLikelihood: -3.21 }, { ...decisive, probeVoteMargin: -1, sampleCount: 17 },
      { ...decisive, avgLogLikelihood: NaN }, { ...decisive, rankedModel: null },
    ]) expect(applyControlledGlmGates(metrics).sharedStrongPass.acceptedModel).toBeNull();
    expect(applyControlledGlmGates({ ...decisive, probeVoteMargin: -1, sampleCount: 18 }).sharedStrongPass.acceptedModel).toBe(decisive.rankedModel);
  });

  it("uses the original GLM strong-pass predicate exactly, including boundary values", () => {
    const policy = V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster")!;
    for (const confidence of [.94, .95, .999]) for (const gap of [2.5, 4.99, 5])
      for (const votes of [-1, 0, 3]) for (const samples of [17, 18, 51]) {
        const metrics = { ...decisive, confidence, logLikelihoodGap: gap, probeVoteMargin: votes, sampleCount: samples };
        expect(applyControlledGlmGates(metrics).sharedStrongPass.strongPassPredicate).toBe(isStrongPassByPolicy(policy, metrics));
      }
  });

  it("holds observation coverage fixed and bypasses implicit candidate-set policy matching", () => {
    const policy = V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster")!;
    const probes = BIAS_PROBES.filter(p => policy.activeProbeIds.includes(p.id));
    const obs = probes.map(p => ({ probeId: p.id, answers: Array(p.samples).fill("alpha") as string[] }));
    const three: BiasBaseline[] = policy.modelIds.map((modelId, i) => ({ modelId,
      probes: Object.fromEntries(probes.map(p => [p.id, { [i === 0 ? "alpha" : "beta"]: 30 }])) }));
    const five = [...three, ...["z-ai/glm-5.3", "z-ai/glm-5.3-flash"].map(modelId => ({ modelId,
      probes: Object.fromEntries(probes.map(p => [p.id, { gamma: 30 }])) }))];
    expect(policyForCandidates(three)?.id).toBe("zhipu-glm-cluster");
    expect(policyForCandidates(five)).toBeNull();
    const before = JSON.stringify({ three, five, obs });
    const a = scoreControlledGlmComparison(obs, three), b = scoreControlledGlmComparison(obs, five);
    expect(a.observationsDigest).toBe(b.observationsDigest);
    expect(a.metrics.sampleCount).toBe(51);
    expect(b.metrics.sampleCount).toBe(51);
    expect(a.decisions.standardOnly.acceptedModel).toBe("z-ai/glm-5");
    expect(b.decisions.standardOnly.acceptedModel).toBe("z-ai/glm-5");
    const historical = scoreV3HDistributionFingerprint(obs, three);
    expect(a.metrics.logLikelihoodGap).toBeCloseTo(historical.logLikelihoodGap, 12);
    expect(a.metrics.probeVoteMargin).toBe(historical.probeVoteMargin);
    expect(a.decisions.sharedStrongPass.acceptedModel).toBe(historical.topModel);
    expect(JSON.stringify({ three, five, obs })).toBe(before);
    // A successful hypothetical result must not register or alter the runtime policy.
    expect(policyForCandidates(five)).toBeNull();
  });
});
