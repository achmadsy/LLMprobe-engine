"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPANDED_GLM_POLICY = void 0;
exports.wilsonInterval = wilsonInterval;
exports.parseIndependentControl = parseIndependentControl;
exports.evaluateExpandedGlmPolicy = evaluateExpandedGlmPolicy;
// Offline policy evaluation: fixed pre-existing gates, no tuning on final holdouts.
const node_crypto_1 = require("node:crypto");
const bias_calibration_js_1 = require("./bias-calibration.js");
const sub_model_bias_baselines_js_1 = require("./sub-model-bias-baselines.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("./sub-model-v3g-bias-fingerprint.js");
exports.EXPANDED_GLM_POLICY = {
    id: "glm-five-experimental-v1",
    modelIds: ["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"],
    thresholds: { minConfidence: 0.94, minLogLikelihoodGap: 2.5, minProbeVoteMargin: 3, minAvgLogLikelihood: -3.2 },
    provenance: "Frozen inherited thresholds; NOT optimized against new held-out observations",
    releaseRequirements: { minimumBatchesPerModel: 60, minimumOutOfFamilyModels: 3, minimumBatchesPerControlModel: 75,
        minimumAcceptedRecall: 0.9, minimumCorrectRateWilsonLower: 0.9, maximumFalseAcceptWilsonUpper: 0.05 },
    runtimePromotionAllowed: false,
};
function wilsonInterval(successes, total) {
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(successes) || total < 0 || successes < 0 || successes > total)
        throw new Error("Invalid binomial counts");
    if (!total)
        return { low: 0, high: 1 };
    const z = 1.959963984540054, p = successes / total, denom = 1 + z * z / total;
    const center = (p + z * z / (2 * total)) / denom;
    const delta = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom;
    return { low: Math.max(0, center - delta), high: Math.min(1, center + delta) };
}
function parseIndependentControl(input, protocolHash) {
    const c = input;
    if (!c || c.version !== 1 || c.kind !== "independent-distribution-controls" || typeof c.collectionId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(c.collectionId) || typeof c.modelId !== "string" ||
        !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(c.modelId) || c.protocolHash !== protocolHash ||
        c.provenance?.independent !== true || c.provenance?.synthetic !== false || typeof c.provenance?.source !== "string" ||
        c.provenance.source.length < 3 || c.provenance.source.length > 500 || !Number.isFinite(Date.parse(c.provenance.capturedAt)) ||
        !Array.isArray(c.batches) || !c.batches.length || c.batches.length > 1000)
        throw new Error("Invalid independent controls or incompatible protocol");
    for (const batch of c.batches) {
        if (!Array.isArray(batch) || batch.length !== bias_calibration_js_1.GLM_CALIBRATION_PROBES.length)
            throw new Error("Controls require full equal-probe batches");
        for (const [i, p] of bias_calibration_js_1.GLM_CALIBRATION_PROBES.entries()) {
            const o = batch[i];
            if (o?.probeId !== p.id || !Array.isArray(o.answers) || o.answers.length !== p.samples ||
                o.answers.some(a => typeof a !== "string" || !/^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a)))
                throw new Error("Invalid control observations");
        }
    }
    return c;
}
function evaluateExpandedGlmPolicy(references, holdouts, controls = []) {
    const initial = (0, bias_calibration_js_1.validateCalibration)(references, holdouts);
    const parsed = controls.map(c => parseIndependentControl(c, initial.protocolHash));
    const ids = [...initial.referenceCollectionIds, ...initial.validationCollectionIds, ...parsed.map(c => c.collectionId)];
    if (new Set(ids).size !== ids.length)
        throw new Error("Controls overlap reference/validation collection IDs");
    if (parsed.some(c => c.modelId.startsWith("z-ai/") || c.modelId.startsWith("zhipu/")))
        throw new Error("Out-of-family controls must not be GLM siblings");
    const newIds = new Set(references.map(a => a.plan.modelId));
    const candidates = [...sub_model_bias_baselines_js_1.BIAS_BASELINES.filter(b => b.modelId.startsWith("z-ai/") && !newIds.has(b.modelId)), ...references.map(a => a.baseline)];
    const modelSetMatches = [...candidates.map(c => c.modelId)].sort().join("\n") === [...exports.EXPANDED_GLM_POLICY.modelIds].sort().join("\n");
    const byModel = exports.EXPANDED_GLM_POLICY.modelIds.map(modelId => {
        const rows = initial.diagnostics.filter(d => d.modelId === modelId);
        const batches = rows.reduce((n, r) => n + r.batches, 0), correct = rows.reduce((n, r) => n + r.correct, 0);
        const wrong = rows.reduce((n, r) => n + r.wrong, 0), abstained = rows.reduce((n, r) => n + r.abstained, 0);
        return { modelId, batches, correct, wrong, abstained, acceptedRecall: batches ? correct / batches : null,
            correctRateWilson95: wilsonInterval(correct, batches) };
    });
    const controlModels = [...new Set(parsed.map(c => c.modelId))].map(modelId => {
        const batches = parsed.filter(c => c.modelId === modelId).flatMap(c => c.batches);
        const falseAccepts = batches.filter(obs => !(0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(obs, candidates, exports.EXPANDED_GLM_POLICY.thresholds).abstained).length;
        return { modelId, batches: batches.length, falseAccepts, falseAcceptWilson95: wilsonInterval(falseAccepts, batches.length) };
    });
    const requirements = exports.EXPANDED_GLM_POLICY.releaseRequirements;
    const gates = {
        exactCandidateSet: modelSetMatches,
        freshSiblingReferences: exports.EXPANDED_GLM_POLICY.modelIds.every(id => references.some(r => r.plan.modelId === id)),
        siblingHoldoutCount: byModel.every(m => m.batches >= requirements.minimumBatchesPerModel),
        siblingRecall: byModel.every(m => m.acceptedRecall !== null && m.acceptedRecall >= requirements.minimumAcceptedRecall),
        siblingCorrectRateBound: byModel.every(m => m.correctRateWilson95.low >= requirements.minimumCorrectRateWilsonLower),
        noObservedWrongSibling: byModel.every(m => m.wrong === 0),
        controlFamilyCoverage: new Set(controlModels.map(m => m.modelId.split("/")[0])).size >= requirements.minimumOutOfFamilyModels,
        controlSampleCount: controlModels.length >= requirements.minimumOutOfFamilyModels && controlModels.every(m => m.batches >= requirements.minimumBatchesPerControlModel),
        controlFalseAcceptBound: controlModels.length > 0 && controlModels.every(m => m.falseAcceptWilson95.high <= requirements.maximumFalseAcceptWilsonUpper),
        // Explicit human review is necessary: self-reported independent metadata is not proof.
        provenanceAndRobustnessReview: false,
    };
    return {
        version: 1, policy: exports.EXPANDED_GLM_POLICY, policyDigest: (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(exports.EXPANDED_GLM_POLICY)).digest("hex"),
        state: "experimental-not-approved", eligibleForPromotion: false, gates,
        failedGates: Object.entries(gates).filter(([, pass]) => !pass).map(([name]) => name),
        byModel, controlModels, diagnosticReport: initial,
        limitations: ["Evaluation does not activate or rewrite runtime policies", "Wilson intervals assume independent Bernoulli trials; temporally grouped batches can violate that assumption", "Control provenance must be reviewed; a JSON independent flag is not proof", "Proxy/wrapper cohorts, noise tests and source identity remain review requirements", "Reusing held-out results to tune thresholds invalidates them as final evaluation"],
    };
}
//# sourceMappingURL=expanded-glm-policy.js.map