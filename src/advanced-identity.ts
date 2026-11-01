// Deterministic advanced identity assessment. Never performs network calls.
import { createHash } from "node:crypto";
import { extractFingerprint } from "./fingerprint-extractor.js";
import { classifyIdentityV2 } from "./identity-classifier-v2.js";
import { fuseFamily } from "./identity-family-fusion.js";
import { classifySubmodelV3 } from "./sub-model-classifier-v3.js";
import { classifySubmodelV3E } from "./sub-model-classifier-v3e.js";
import { classifySubmodelV3F } from "./sub-model-classifier-v3f.js";
import { loadV3EBaselinesFromSnapshot } from "./sub-model-baselines-v3e-store.js";
import { fuseToV4 } from "./sub-model-classifier-v4.js";
import { computeVerdict } from "./identity-verdict.js";
import { guardCreatorEvidence, compareDistributionClusters } from "./identity-orchestration.js";
import { BIAS_BASELINES } from "./sub-model-bias-baselines.js";
import { type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
import { assessGlmDistribution } from "./glm-distribution-assessment.js";
import { supportsGlmDistribution } from "./glm-distribution-models.js";
import { canonicalFamily, modelIdsMatch } from "./model-id-normalize.js";
import { claimedModelToFamily } from "./fingerprint-baseline.js";
import type { ProbeResult } from "./runner.js";
import type { IdentityAssessment } from "./identity-report.js";

const pack = require("./glm53-bias-reference-pack.json") as {
  id: string; limitations: string[]; references: Array<{ baseline: BiasBaseline; protocolHash: string }>;
};
export const GLM53_REFERENCE_PACK_ID = pack.id;

export interface AdvancedIdentityAssessment {
  version: "advanced-offline-v1";
  familyFusion: ReturnType<typeof fuseFamily>;
  creatorGuard: ReturnType<typeof guardCreatorEvidence>;
  clusterComparison: ReturnType<typeof compareDistributionClusters>;
  decisionPath: Array<{ stage: string; outcome: string; reason: string }>;
  v2: ReturnType<typeof classifyIdentityV2>;
  v3: ReturnType<typeof classifySubmodelV3> & { global: ReturnType<typeof classifySubmodelV3> };
  v3e: ReturnType<typeof classifySubmodelV3E> | null;
  v3f: ReturnType<typeof classifySubmodelV3F> | null;
  v4: ReturnType<typeof fuseToV4>;
  verdict: NonNullable<IdentityAssessment["verdict"]>;
  distribution: {
    state: ReturnType<typeof assessGlmDistribution>["state"];
    referencePackId: string;
    referenceDigest: string;
    claimReferenceCovered: boolean;
    independentlyValidated: false;
    observations: BiasObservation[];
    result: ReturnType<typeof assessGlmDistribution>;
    limitations: string[];
  };
  limitations: string[];
}

function validateObservations(input: BiasObservation[]): BiasObservation[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error("Invalid saved distribution observations");
  const seen = new Set<string>();
  return input.map(o => {
    if (!o || typeof o.probeId !== "string" || !/^[a-z0-9_]{1,64}$/.test(o.probeId) || seen.has(o.probeId) ||
        !Array.isArray(o.answers) || o.answers.length > 1000 || o.answers.some(a => typeof a !== "string" || !/^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a))) {
      throw new Error("Invalid saved distribution observations");
    }
    seen.add(o.probeId);
    return { probeId: o.probeId, answers: [...o.answers] };
  });
}

export function assessAdvancedIdentity(options: {
  results: ProbeResult[]; claimedModel?: string; savedObservations?: BiasObservation[];
}): AdvancedIdentityAssessment | undefined {
  const responses = Object.fromEntries(options.results.filter(r => r.status === "done" && !r.responseTruncated && typeof r.response === "string")
    .map(r => [r.probeId, r.response!]));
  if (!Object.keys(responses).some(id => /^(identity_|meta_creator|zh_|submodel_)/.test(id))) return undefined;
  const features = extractFingerprint(responses, {}, [], responses);
  const v2 = classifyIdentityV2({ fingerprintFeatures: features, observedResponses: responses, baselines: [], referenceSubModels: [] });
  const claimedFamily = options.claimedModel ? claimedModelToFamily(options.claimedModel) : undefined;
  // Conservative local corroboration guard, not a claim of reproducing SaaS rules.
  const creatorGuard = guardCreatorEvidence(responses, v2.attackFamilyScores);
  let familyFusion = fuseFamily({ v2Family: v2.topFamily, v2Scores: v2.familyScores, claimedFamily,
    chinese: creatorGuard.family ? { family: creatorGuard.family, confidence: creatorGuard.confidence,
      hardOverride: creatorGuard.hardOverride, evidence: creatorGuard.evidence } : null });
  const observations = validateObservations(options.savedObservations ?? []);
  const references = [...BIAS_BASELINES, ...pack.references.map(r => r.baseline)];
  let result = assessGlmDistribution(observations, references, { confirmedFamily: familyFusion.confirmedFamily,
    confidence: familyFusion.confidence, contradictory: creatorGuard.contradictory });
  const distributionCandidate = result.comparison?.decisions.sharedStrongPass.acceptedModel;
  // Style-only V2 must not be an unconditional veto. Repeated maker answers on
  // the fixed company prompts can corroborate a COMPLETE, gate-passing GLM
  // distribution. The claim and incomplete cross-cluster comparison are not inputs.
  if (!result.familySupported && creatorGuard.repeatedCreatorSupport &&
      canonicalFamily(creatorGuard.family ?? "") === "z-ai" && distributionCandidate) {
    // The fixed family floor is a qualitative support level, not P(authenticity).
    familyFusion = { confirmedFamily: "zhipu", confidence: .65, source: "creator-distribution", hardOverride: false,
      claimIgnored: !!claimedFamily && canonicalFamily(claimedFamily) !== "z-ai",
      evidence: ["Repeated Zhipu/Z.ai creator answers plus complete gate-passing GLM distribution evidence",
        `V2 style candidate ${v2.topFamily} retained as a diagnostic, not a veto or exact identity`,
        "Provisional reconciliation; no independently calibrated cross-family authenticity claim"] };
    result = assessGlmDistribution(observations, references, { confirmedFamily: familyFusion.confirmedFamily,
      confidence: familyFusion.confidence, contradictory: creatorGuard.contradictory });
  }
  const confirmedFamily = familyFusion.confirmedFamily ?? undefined;
  const hasV3 = ["submodel_cutoff", "submodel_capability", "submodel_refusal"].every(id => responses[id]?.trim());
  const scoped = classifySubmodelV3(responses, { predictedFamily: confirmedFamily });
  const global = classifySubmodelV3(responses);
  if (!hasV3) { scoped.top = null; scoped.abstained = true; global.top = null; global.abstained = true; }
  const hasExtended = ["v3e_fmt_bullets", "v3e_fmt_explain_depth", "v3e_fmt_code_lang_tag", "v3e_uncertainty_estimate"].every(id => responses[id]?.trim()) &&
    Object.keys(responses).filter(id => id.startsWith("v3e_refusal_")).length >= 6;
  const baselines = hasExtended ? loadV3EBaselinesFromSnapshot() : [];
  const v3e = hasExtended ? classifySubmodelV3E(responses, baselines, { predictedFamily: confirmedFamily }) : null;
  const v3f = hasExtended ? classifySubmodelV3F(responses, baselines, { predictedFamily: confirmedFamily }) : null;
  const adapt = (r: typeof scoped) => ({ subModelMatch: r.top, candidates: r.candidates, abstained: !r.top || r.abstained, familyImplied: r.familyImplied });
  const v4 = fuseToV4(adapt(scoped), adapt(global), null, undefined, v3f?.top, null, v3e?.top,
    confirmedFamily ? { family: confirmedFamily, confidence: familyFusion.confidence } : null);
  const behavior = Object.entries(v2.attackFamilyScores).sort((a, b) => b[1] - a[1])[0];
  const verdict: NonNullable<IdentityAssessment["verdict"]> = computeVerdict({ claimedModel: options.claimedModel, claimedFamily: claimedFamily ?? null,
    surface: confirmedFamily ? { family: confirmedFamily, score: familyFusion.confidence } : null,
    behavior: behavior ? { family: behavior[0], score: behavior[1] } : null,
    v3: v4.subModelMatch, v3f: v3f?.top, subModelSeparable: false,
    coverage: { errors: options.results.filter(r => r.status !== "done" || r.responseTruncated).length, total: options.results.length },
  });
  const clusterComparison = compareDistributionClusters(observations, references);
  const claimReferenceCovered = !!options.claimedModel && references.some(b => modelIdsMatch(b.modelId, options.claimedModel!));
  // The claim never selects the winning candidate or family. It is compared only afterward.
  if (result.acceptedModel) {
    const covered = supportsGlmDistribution(options.claimedModel);
    const matches = covered && modelIdsMatch(result.acceptedModel, options.claimedModel!);
    verdict.status = matches ? "likely_match" : covered ? "likely_submodel_mismatch" : "model_estimate";
    verdict.trueFamily = "zhipu";
    verdict.trueModel = result.acceptedModel;
    verdict.spoofMethod = null;
    verdict.confidence = "medium";
    verdict.reasoning = [`Saved distribution evidence most closely supports ${result.acceptedModel} among five GLM candidates`,
      matches ? "The estimate agrees with the claimed model" : covered ? "The estimate differs from the claim; this is not proof of substitution" : "The claim is absent or outside the supported comparison set",
      "Provisional estimate: no independently calibrated authenticity probability"];
  } else if (supportsGlmDistribution(options.claimedModel)) {
    const sameFamily = canonicalFamily(confirmedFamily ?? "") === "z-ai";
    verdict.status = sameFamily ? "clean_match_family_only" : "ambiguous";
    verdict.trueFamily = confirmedFamily ?? null;
    verdict.trueModel = null;
    verdict.spoofMethod = null;
    verdict.confidence = "low";
    verdict.reasoning = [sameFamily ? "Observed evidence supports the Zhipu family; exact model remains unconfirmed" : "Family evidence does not establish an exact identity",
      `GLM distribution recheck: ${result.state}; no model substitution is asserted`];
  }
  return {
    version: "advanced-offline-v1", familyFusion, creatorGuard, clusterComparison,
    decisionPath: [
      { stage: "coverage", outcome: options.results.every(r => r.status === "done") ? "answered" : "partial", reason: "Derived from stored task statuses" },
      { stage: "family", outcome: confirmedFamily ?? "abstain", reason: familyFusion.source === "creator-distribution" ? "Repeated creator answers corroborated by all 51 distribution answers passing fixed gates; V2 style conflict retained" : creatorGuard.hardOverride ? "Corroborated creator assertions plus behavioral support" : "Behavioral evidence; unsupported or conflicting creator claims do not override" },
      { stage: "submodel", outcome: v4.subModelMatch?.modelId ?? "abstain", reason: `Legacy public-engine diagnostic: ${v4.fuseSource}; the qualified distribution stage below governs any accepted GLM estimate` },
      { stage: "twin-recheck", outcome: result.state, reason: result.acceptedModel ?? "Complete sampling, corroborated family and acceptance gates required" },
      { stage: "claim-comparison", outcome: verdict.status, reason: verdict.reasoning[0] ?? "Evidence insufficient" },
    ], v2, v3: { ...scoped, global }, v3e, v3f, v4, verdict,
    distribution: { state: result.state, referencePackId: pack.id,
      referenceDigest: createHash("sha256").update(JSON.stringify(references)).digest("hex"), claimReferenceCovered,
      independentlyValidated: false, observations, result, limitations: [...result.limitations, ...pack.limitations] },
    limitations: ["Partial public-engine integration, not web-app parity", "Local conservative creator guard differs from the unpublished SaaS contradiction guard", "IKP reference corpus unavailable", "Distribution observations are replay-only; this assessment never makes target calls"],
  };
}
