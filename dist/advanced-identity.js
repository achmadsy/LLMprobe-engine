"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLM53_REFERENCE_PACK_ID = void 0;
exports.assessAdvancedIdentity = assessAdvancedIdentity;
// Deterministic advanced identity assessment. Never performs network calls.
const node_crypto_1 = require("node:crypto");
const fingerprint_extractor_js_1 = require("./fingerprint-extractor.js");
const identity_classifier_v2_js_1 = require("./identity-classifier-v2.js");
const identity_family_fusion_js_1 = require("./identity-family-fusion.js");
const sub_model_classifier_v3_js_1 = require("./sub-model-classifier-v3.js");
const sub_model_classifier_v3e_js_1 = require("./sub-model-classifier-v3e.js");
const sub_model_classifier_v3f_js_1 = require("./sub-model-classifier-v3f.js");
const sub_model_baselines_v3e_store_js_1 = require("./sub-model-baselines-v3e-store.js");
const sub_model_classifier_v4_js_1 = require("./sub-model-classifier-v4.js");
const identity_verdict_js_1 = require("./identity-verdict.js");
const identity_orchestration_js_1 = require("./identity-orchestration.js");
const sub_model_bias_baselines_js_1 = require("./sub-model-bias-baselines.js");
const glm_distribution_assessment_js_1 = require("./glm-distribution-assessment.js");
const glm_distribution_models_js_1 = require("./glm-distribution-models.js");
const model_id_normalize_js_1 = require("./model-id-normalize.js");
const fingerprint_baseline_js_1 = require("./fingerprint-baseline.js");
const pack = require("./glm53-bias-reference-pack.json");
exports.GLM53_REFERENCE_PACK_ID = pack.id;
function validateObservations(input) {
    if (!Array.isArray(input) || input.length > 32)
        throw new Error("Invalid saved distribution observations");
    const seen = new Set();
    return input.map(o => {
        if (!o || typeof o.probeId !== "string" || !/^[a-z0-9_]{1,64}$/.test(o.probeId) || seen.has(o.probeId) ||
            !Array.isArray(o.answers) || o.answers.length > 1000 || o.answers.some(a => typeof a !== "string" || !/^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a))) {
            throw new Error("Invalid saved distribution observations");
        }
        seen.add(o.probeId);
        return { probeId: o.probeId, answers: [...o.answers] };
    });
}
function assessAdvancedIdentity(options) {
    const responses = Object.fromEntries(options.results.filter(r => r.status === "done" && !r.responseTruncated && typeof r.response === "string")
        .map(r => [r.probeId, r.response]));
    if (!Object.keys(responses).some(id => /^(identity_|meta_creator|zh_|submodel_)/.test(id)))
        return undefined;
    const features = (0, fingerprint_extractor_js_1.extractFingerprint)(responses, {}, [], responses);
    const v2 = (0, identity_classifier_v2_js_1.classifyIdentityV2)({ fingerprintFeatures: features, observedResponses: responses, baselines: [], referenceSubModels: [] });
    const claimedFamily = options.claimedModel ? (0, fingerprint_baseline_js_1.claimedModelToFamily)(options.claimedModel) : undefined;
    // Conservative local corroboration guard, not a claim of reproducing SaaS rules.
    const creatorGuard = (0, identity_orchestration_js_1.guardCreatorEvidence)(responses, v2.attackFamilyScores);
    let familyFusion = (0, identity_family_fusion_js_1.fuseFamily)({ v2Family: v2.topFamily, v2Scores: v2.familyScores, claimedFamily,
        chinese: creatorGuard.family ? { family: creatorGuard.family, confidence: creatorGuard.confidence,
            hardOverride: creatorGuard.hardOverride, evidence: creatorGuard.evidence } : null });
    const observations = validateObservations(options.savedObservations ?? []);
    const references = [...sub_model_bias_baselines_js_1.BIAS_BASELINES, ...pack.references.map(r => r.baseline)];
    let result = (0, glm_distribution_assessment_js_1.assessGlmDistribution)(observations, references, { confirmedFamily: familyFusion.confirmedFamily,
        confidence: familyFusion.confidence, contradictory: creatorGuard.contradictory });
    const distributionCandidate = result.comparison?.decisions.sharedStrongPass.acceptedModel;
    // Style-only V2 must not be an unconditional veto. Repeated maker answers on
    // the fixed company prompts can corroborate a COMPLETE, gate-passing GLM
    // distribution. The claim and incomplete cross-cluster comparison are not inputs.
    if (!result.familySupported && creatorGuard.repeatedCreatorSupport &&
        (0, model_id_normalize_js_1.canonicalFamily)(creatorGuard.family ?? "") === "z-ai" && distributionCandidate) {
        // The fixed family floor is a qualitative support level, not P(authenticity).
        familyFusion = { confirmedFamily: "zhipu", confidence: .65, source: "creator-distribution", hardOverride: false,
            claimIgnored: !!claimedFamily && (0, model_id_normalize_js_1.canonicalFamily)(claimedFamily) !== "z-ai",
            evidence: ["Repeated Zhipu/Z.ai creator answers plus complete gate-passing GLM distribution evidence",
                `V2 style candidate ${v2.topFamily} retained as a diagnostic, not a veto or exact identity`,
                "Provisional reconciliation; no independently calibrated cross-family authenticity claim"] };
        result = (0, glm_distribution_assessment_js_1.assessGlmDistribution)(observations, references, { confirmedFamily: familyFusion.confirmedFamily,
            confidence: familyFusion.confidence, contradictory: creatorGuard.contradictory });
    }
    const confirmedFamily = familyFusion.confirmedFamily ?? undefined;
    const hasV3 = ["submodel_cutoff", "submodel_capability", "submodel_refusal"].every(id => responses[id]?.trim());
    const scoped = (0, sub_model_classifier_v3_js_1.classifySubmodelV3)(responses, { predictedFamily: confirmedFamily });
    const global = (0, sub_model_classifier_v3_js_1.classifySubmodelV3)(responses);
    if (!hasV3) {
        scoped.top = null;
        scoped.abstained = true;
        global.top = null;
        global.abstained = true;
    }
    const hasExtended = ["v3e_fmt_bullets", "v3e_fmt_explain_depth", "v3e_fmt_code_lang_tag", "v3e_uncertainty_estimate"].every(id => responses[id]?.trim()) &&
        Object.keys(responses).filter(id => id.startsWith("v3e_refusal_")).length >= 6;
    const baselines = hasExtended ? (0, sub_model_baselines_v3e_store_js_1.loadV3EBaselinesFromSnapshot)() : [];
    const v3e = hasExtended ? (0, sub_model_classifier_v3e_js_1.classifySubmodelV3E)(responses, baselines, { predictedFamily: confirmedFamily }) : null;
    const v3f = hasExtended ? (0, sub_model_classifier_v3f_js_1.classifySubmodelV3F)(responses, baselines, { predictedFamily: confirmedFamily }) : null;
    const adapt = (r) => ({ subModelMatch: r.top, candidates: r.candidates, abstained: !r.top || r.abstained, familyImplied: r.familyImplied });
    const v4 = (0, sub_model_classifier_v4_js_1.fuseToV4)(adapt(scoped), adapt(global), null, undefined, v3f?.top, null, v3e?.top, confirmedFamily ? { family: confirmedFamily, confidence: familyFusion.confidence } : null);
    const behavior = Object.entries(v2.attackFamilyScores).sort((a, b) => b[1] - a[1])[0];
    const verdict = (0, identity_verdict_js_1.computeVerdict)({ claimedModel: options.claimedModel, claimedFamily: claimedFamily ?? null,
        surface: confirmedFamily ? { family: confirmedFamily, score: familyFusion.confidence } : null,
        behavior: behavior ? { family: behavior[0], score: behavior[1] } : null,
        v3: v4.subModelMatch, v3f: v3f?.top, subModelSeparable: false,
        coverage: { errors: options.results.filter(r => r.status !== "done" || r.responseTruncated).length, total: options.results.length },
    });
    const clusterComparison = (0, identity_orchestration_js_1.compareDistributionClusters)(observations, references);
    const claimReferenceCovered = !!options.claimedModel && references.some(b => (0, model_id_normalize_js_1.modelIdsMatch)(b.modelId, options.claimedModel));
    // The claim never selects the winning candidate or family. It is compared only afterward.
    if (result.acceptedModel) {
        const covered = (0, glm_distribution_models_js_1.supportsGlmDistribution)(options.claimedModel);
        const matches = covered && (0, model_id_normalize_js_1.modelIdsMatch)(result.acceptedModel, options.claimedModel);
        verdict.status = matches ? "likely_match" : covered ? "likely_submodel_mismatch" : "model_estimate";
        verdict.trueFamily = "zhipu";
        verdict.trueModel = result.acceptedModel;
        verdict.spoofMethod = null;
        verdict.confidence = "medium";
        verdict.reasoning = [`Saved distribution evidence most closely supports ${result.acceptedModel} among five GLM candidates`,
            matches ? "The estimate agrees with the claimed model" : covered ? "The estimate differs from the claim; this is not proof of substitution" : "The claim is absent or outside the supported comparison set",
            "Provisional estimate: no independently calibrated authenticity probability"];
    }
    else if ((0, glm_distribution_models_js_1.supportsGlmDistribution)(options.claimedModel)) {
        const sameFamily = (0, model_id_normalize_js_1.canonicalFamily)(confirmedFamily ?? "") === "z-ai";
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
            referenceDigest: (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(references)).digest("hex"), claimReferenceCovered,
            independentlyValidated: false, observations, result, limitations: [...result.limitations, ...pack.limitations] },
        limitations: ["Partial public-engine integration, not web-app parity", "Local conservative creator guard differs from the unpublished SaaS contradiction guard", "IKP reference corpus unavailable", "Distribution observations are replay-only; this assessment never makes target calls"],
    };
}
//# sourceMappingURL=advanced-identity.js.map