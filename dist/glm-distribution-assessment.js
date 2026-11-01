"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessGlmDistribution = assessGlmDistribution;
// Provisional closed-set model estimate, not independently verified identity.
const node_crypto_1 = require("node:crypto");
const glm_distribution_models_js_1 = require("./glm-distribution-models.js");
const reference_mass_normalization_js_1 = require("./reference-mass-normalization.js");
const glm_controlled_comparison_js_1 = require("./glm-controlled-comparison.js");
const model_id_normalize_js_1 = require("./model-id-normalize.js");
function assessGlmDistribution(observations, references, family) {
    // Require all slots, not merely sampleCount >= 51 or an accidental high posterior.
    const complete = observations.length === glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.length && glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.every(id => {
        const rows = observations.filter(o => o.probeId === id);
        return rows.length === 1 && rows[0].answers.length === (id === "day" ? 3 : 6) &&
            rows[0].answers.every(a => /^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a));
    });
    const familySupported = (0, model_id_normalize_js_1.canonicalFamily)(family.confirmedFamily ?? "") === "z-ai" &&
        family.confidence >= .65 && !family.contradictory;
    const candidates = glm_distribution_models_js_1.GLM_DISTRIBUTION_MODELS.map(id => {
        const rows = references.filter(r => r.modelId === id);
        if (rows.length !== 1)
            throw new Error("All five unique GLM references required");
        return rows[0];
    });
    const normalization = (0, reference_mass_normalization_js_1.normalizeReferenceMass)(candidates, [...glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS]);
    const comparison = complete ? (0, glm_controlled_comparison_js_1.scoreControlledGlmComparison)(observations, normalization.references) : null;
    const acceptedModel = familySupported ? comparison?.decisions.sharedStrongPass.acceptedModel ?? null : null;
    const state = !observations.some(o => o.answers.length) ? "not-sampled" : !complete ? "partial" :
        !familySupported ? "family-unconfirmed" : acceptedModel ? "likely" : "abstained";
    return {
        state, acceptedModel, complete, familySupported,
        basis: "provisional-glm-five-equal-mass-v1",
        // Posterior is a closed-set relative score, not P(authentic model).
        comparison,
        referenceManifest: {
            sourceDigest: (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(candidates)).digest("hex"),
            originalMasses: normalization.originalMasses, effectiveMass: normalization.commonMass,
            weighting: normalization.method,
        },
        limitations: ["Closed-set estimate among five GLM references, not proof of upstream authenticity",
            "Expanded five-model rules have no independent out-of-family calibration",
            "Older reference request settings are unknown; new references include the 9Router Start Plan wrapper",
            "Equalized weights do not add empirical observations or equalize reference certainty"],
    };
}
//# sourceMappingURL=glm-distribution-assessment.js.map