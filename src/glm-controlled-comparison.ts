// Explicit scoring with NO automatic registry lookup or policy registration.
// Shared by offline comparisons and qualified runtime estimates. Coverage/family guards
// live in glm-distribution-assessment; empirical accuracy is not implied by these rules.
import { createHash } from "node:crypto";
import {
  scoreBiasFingerprint, isStrongPassByPolicy, V3H_ACTIVE_PROMPT_POLICIES,
  type BiasBaseline, type BiasObservation,
} from "./sub-model-v3g-bias-fingerprint.js";

const originalPolicy = V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster")!;
export const CONTROLLED_GLM_RULES = {
  minConfidence: originalPolicy.minConfidence,
  minLogLikelihoodGap: originalPolicy.minLogLikelihoodGap,
  minProbeVoteMargin: originalPolicy.minProbeVoteMargin,
  minAvgLogLikelihood: originalPolicy.minAvgLogLikelihood,
  strongMinConfidence: 0.95,
  strongMinLogLikelihoodGap: 2 * originalPolicy.minLogLikelihoodGap,
  minStrongPassSampleCount: originalPolicy.minStrongPassSampleCount,
  source: "Same frozen original GLM predicates for both sets; expanded-set accuracy is not independently calibrated",
} as const;

export interface ControlledMetrics {
  rankedModel: string | null;
  confidence: number;
  logLikelihoodGap: number;
  probeVoteMargin: number;
  avgLogLikelihood: number;
  sampleCount: number;
}
export function applyControlledGlmGates(metrics: ControlledMetrics) {
  const finite = !!metrics.rankedModel && metrics.sampleCount > 0 &&
    [metrics.confidence, metrics.logLikelihoodGap, metrics.probeVoteMargin, metrics.avgLogLikelihood].every(Number.isFinite);
  const failedStandardGates = [
    ...(!finite ? ["usable-evidence"] : []),
    ...(metrics.confidence < CONTROLLED_GLM_RULES.minConfidence ? ["confidence"] : []),
    ...(metrics.logLikelihoodGap < CONTROLLED_GLM_RULES.minLogLikelihoodGap ? ["likelihood-gap"] : []),
    ...(metrics.probeVoteMargin < CONTROLLED_GLM_RULES.minProbeVoteMargin ? ["prompt-vote-margin"] : []),
    ...(metrics.avgLogLikelihood < CONTROLLED_GLM_RULES.minAvgLogLikelihood ? ["absolute-fit"] : []),
  ];
  const strongPassPredicate = finite && isStrongPassByPolicy(originalPolicy, metrics);
  const standardAccepted = failedStandardGates.length === 0;
  return {
    standardOnly: { acceptedModel: standardAccepted ? metrics.rankedModel : null, failedGates: failedStandardGates },
    sharedStrongPass: {
      acceptedModel: standardAccepted || strongPassPredicate ? metrics.rankedModel : null,
      strongPassPredicate,
      voteGateWaived: !standardAccepted && strongPassPredicate,
    },
  };
}

export function scoreControlledGlmComparison(observations: BiasObservation[], candidates: BiasBaseline[]) {
  if (candidates.length < 2 || new Set(candidates.map(c => c.modelId)).size !== candidates.length) throw new Error("Unique candidates required");
  const base = scoreBiasFingerprint(observations, candidates, { minConfidence: 0 });
  const scores = Object.entries(base.scores).sort((a, b) => b[1] - a[1]);
  const rankedModel = scores[0]?.[0] ?? null;
  const sampleCount = observations.reduce((n, o) => n + o.answers.length, 0);
  const topScore = scores[0]?.[1] ?? -Infinity;
  const gap = scores.length >= 2 ? topScore - scores[1][1] : 0;
  const votes: Record<string, number> = Object.create(null);
  for (const p of base.perProbe) if (p.topModel) votes[p.topModel] = (votes[p.topModel] ?? 0) + 1;
  const runnerVotes = Math.max(0, ...Object.entries(votes).filter(([m]) => m !== rankedModel).map(([, n]) => n));
  const metrics: ControlledMetrics = {
    rankedModel, confidence: base.confidence, sampleCount,
    logLikelihoodGap: Number.isFinite(gap) ? gap : 0,
    probeVoteMargin: (rankedModel ? votes[rankedModel] ?? 0 : 0) - runnerVotes,
    avgLogLikelihood: sampleCount ? topScore / sampleCount : -Infinity,
  };
  return {
    candidateModels: candidates.map(c => c.modelId),
    observationsDigest: createHash("sha256").update(JSON.stringify(observations)).digest("hex"),
    metrics, decisions: applyControlledGlmGates(metrics), perProbe: base.perProbe,
  };
}
