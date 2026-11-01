// Provisional closed-set model estimate, not independently verified identity.
import { createHash } from "node:crypto";
import { GLM_DISTRIBUTION_MODELS, GLM_DISTRIBUTION_PROBE_IDS } from "./glm-distribution-models.js";
import { normalizeReferenceMass } from "./reference-mass-normalization.js";
import { scoreControlledGlmComparison } from "./glm-controlled-comparison.js";
import { canonicalFamily } from "./model-id-normalize.js";
import type { BiasBaseline, BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";

export function assessGlmDistribution(observations: BiasObservation[], references: BiasBaseline[], family: {
  confirmedFamily: string | null; confidence: number; contradictory: boolean;
}) {
  // Require all slots, not merely sampleCount >= 51 or an accidental high posterior.
  const complete = observations.length === GLM_DISTRIBUTION_PROBE_IDS.length && GLM_DISTRIBUTION_PROBE_IDS.every(id => {
    const rows = observations.filter(o => o.probeId === id);
    return rows.length === 1 && rows[0].answers.length === (id === "day" ? 3 : 6) &&
      rows[0].answers.every(a => /^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a));
  });
  const familySupported = canonicalFamily(family.confirmedFamily ?? "") === "z-ai" &&
    family.confidence >= .65 && !family.contradictory;
  const candidates = GLM_DISTRIBUTION_MODELS.map(id => {
    const rows = references.filter(r => r.modelId === id);
    if (rows.length !== 1) throw new Error("All five unique GLM references required");
    return rows[0];
  });
  const normalization = normalizeReferenceMass(candidates, [...GLM_DISTRIBUTION_PROBE_IDS]);
  const comparison = complete ? scoreControlledGlmComparison(observations, normalization.references) : null;
  const acceptedModel = familySupported ? comparison?.decisions.sharedStrongPass.acceptedModel ?? null : null;
  const state = !observations.some(o => o.answers.length) ? "not-sampled" : !complete ? "partial" :
    !familySupported ? "family-unconfirmed" : acceptedModel ? "likely" : "abstained";
  return {
    state, acceptedModel, complete, familySupported,
    basis: "provisional-glm-five-equal-mass-v1",
    // Posterior is a closed-set relative score, not P(authentic model).
    comparison,
    referenceManifest: {
      sourceDigest: createHash("sha256").update(JSON.stringify(candidates)).digest("hex"),
      originalMasses: normalization.originalMasses, effectiveMass: normalization.commonMass,
      weighting: normalization.method,
    },
    limitations: ["Closed-set estimate among five GLM references, not proof of upstream authenticity",
      "Expanded five-model rules have no independent out-of-family calibration",
      "Older reference request settings are unknown; new references include the 9Router Start Plan wrapper",
      "Equalized weights do not add empirical observations or equalize reference certainty"],
  };
}
