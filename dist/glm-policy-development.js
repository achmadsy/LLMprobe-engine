"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.developGlmPolicy = developGlmPolicy;
// Reference-only development diagnostics. Never consumes final evaluation holdouts.
const node_crypto_1 = require("node:crypto");
const bias_calibration_js_1 = require("./bias-calibration.js");
const sub_model_bias_baselines_js_1 = require("./sub-model-bias-baselines.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("./sub-model-v3g-bias-fingerprint.js");
const expanded_glm_policy_js_1 = require("./expanded-glm-policy.js");
const reference_mass_normalization_js_1 = require("./reference-mass-normalization.js");
function distribution(obs, modelId) {
    return { modelId, probes: Object.fromEntries(obs.map(o => {
            const counts = Object.create(null);
            for (const a of o.answers)
                counts[a] = (counts[a] ?? 0) + 1;
            return [o.probeId, counts];
        })) };
}
function shuffled(items, seed) {
    // Stable hash ordering, not random baseline resampling: each source observation
    // belongs to exactly one half. Reproducible from source artifact + seed.
    return items.map((value, index) => ({ value, order: (0, node_crypto_1.createHash)("sha256").update(`${seed}/${index}`).digest("hex") }))
        .sort((a, b) => a.order.localeCompare(b.order)).map(x => x.value);
}
function developGlmPolicy(references) {
    references.forEach(bias_calibration_js_1.parseCalibrationArtifact);
    if (!references.length || references.some(r => r.plan.purpose !== "reference" || r.failures || r.plan.samplesPerProbe < 60)) {
        throw new Error("Complete reference collections >=60 samples/prompt required; evaluation holdouts are forbidden");
    }
    const protocols = new Set(references.map(r => r.plan.protocolHash));
    if (protocols.size !== 1 || new Set(references.map(r => r.plan.modelId)).size !== references.length)
        throw new Error("Incompatible or duplicate references");
    const developmentSeed = "glm-reference-twofold-v1";
    const halves = references.map(r => ({ modelId: r.plan.modelId, halves: [0, 1].map(half => r.observations.map(o => {
            const ordered = shuffled(o.answers, `${developmentSeed}/${r.collectionId}/${o.probeId}`);
            const split = Math.floor(ordered.length / 2);
            return { probeId: o.probeId, answers: half === 0 ? ordered.slice(0, split) : ordered.slice(split) };
        })) }));
    const newIds = new Set(references.map(r => r.plan.modelId));
    const older = sub_model_bias_baselines_js_1.BIAS_BASELINES.filter(b => b.modelId.startsWith("z-ai/") && !newIds.has(b.modelId));
    const records = [];
    const foldMasses = [];
    for (let fold = 0; fold < 2; fold++) {
        const candidates = [...older, ...halves.map(m => distribution(m.halves[fold], m.modelId))];
        const normalized = (0, reference_mass_normalization_js_1.normalizeReferenceMass)(candidates, bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => p.id));
        foldMasses.push({ fold, commonMass: normalized.commonMass, originalMasses: normalized.originalMasses });
        for (const m of halves) {
            const test = m.halves[1 - fold];
            const batches = Math.min(...bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => Math.floor(test.find(o => o.probeId === p.id).answers.length / p.samples)));
            for (let batch = 0; batch < batches; batch++) {
                const observations = bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id, answers: test.find(o => o.probeId === p.id).answers.slice(batch * p.samples, (batch + 1) * p.samples) }));
                const r = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(observations, candidates, expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.thresholds);
                const top = r.posteriors[0]?.modelId ?? null;
                // Historical strong-pass shape is an alternative DEVELOPMENT hypothesis,
                // not a registered calibrated policy. Do not apply it to final evaluation here.
                const strongHypothesis = r.confidence >= .95 && r.logLikelihoodGap >= 5 && r.avgLogLikelihood >= -3.2 &&
                    r.sampleCount >= 18 && r.probeVoteMargin >= 0;
                const nr = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(observations, normalized.references, expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.thresholds);
                const nTop = nr.posteriors[0]?.modelId ?? null;
                const nStrong = nr.confidence >= .95 && nr.logLikelihoodGap >= 5 && nr.avgLogLikelihood >= -3.2 &&
                    nr.sampleCount >= 18 && nr.probeVoteMargin >= 0;
                records.push({ fold, batch, expectedModel: m.modelId, rankedModel: top,
                    fixedGateModel: r.topModel, hypothesisModel: strongHypothesis ? top : r.topModel,
                    voteMargin: r.probeVoteMargin, gap: r.logLikelihoodGap, avgLogLikelihood: r.avgLogLikelihood,
                    perProbe: r.perProbe, normalized: { rankedModel: nTop, fixedGateModel: nr.topModel,
                        hypothesisModel: nStrong ? nTop : nr.topModel, voteMargin: nr.probeVoteMargin,
                        gap: nr.logLikelihoodGap, avgLogLikelihood: nr.avgLogLikelihood, perProbe: nr.perProbe } });
            }
        }
    }
    const byModel = references.map(r => {
        const rows = records.filter(x => x.expectedModel === r.plan.modelId);
        const summarize = (key) => ({
            correct: rows.filter(x => x[key] === x.expectedModel).length,
            wrong: rows.filter(x => x[key] !== null && x[key] !== x.expectedModel).length,
            abstained: rows.filter(x => x[key] === null).length,
        });
        const normalizedSummary = (key) => ({
            correct: rows.filter(x => x.normalized[key] === x.expectedModel).length,
            wrong: rows.filter(x => x.normalized[key] !== null && x.normalized[key] !== x.expectedModel).length,
            abstained: rows.filter(x => x.normalized[key] === null).length,
        });
        return { modelId: r.plan.modelId, developmentBatches: rows.length,
            fixedGate: summarize("fixedGateModel"), strongPassHypothesis: summarize("hypothesisModel"),
            normalizedMass: { fixedGate: normalizedSummary("fixedGateModel"), strongPassHypothesis: normalizedSummary("hypothesisModel"),
                rankedCorrect: rows.filter(x => x.normalized.rankedModel === x.expectedModel).length,
                voteMargins: rows.map(x => x.normalized.voteMargin) },
            promptWinners: bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id,
                expectedWins: rows.filter(x => x.perProbe.find(v => v.probeId === p.id)?.topModel === x.expectedModel).length,
                winners: rows.reduce((counts, x) => {
                    const winner = x.perProbe.find(v => v.probeId === p.id)?.topModel ?? "none";
                    counts[winner] = (counts[winner] ?? 0) + 1;
                    return counts;
                }, {}),
            })),
        };
    });
    return { version: 1, state: "reference-development-only", runtimePromotionAllowed: false,
        developmentSeed, protocolHash: references[0].plan.protocolHash,
        sourceCollectionIds: references.map(r => r.collectionId), candidateModels: [...older.map(r => r.modelId), ...references.map(r => r.plan.modelId)],
        hypothesis: { id: "historical-strong-pass-shape-unvalidated", minimumConfidence: .95, minimumGap: 5,
            minimumAverageLogLikelihood: -3.2, minimumSamples: 18, minimumVoteMargin: 0 },
        referenceMass: [...older, ...references.map(r => r.baseline)].map(b => ({ modelId: b.modelId,
            perPrompt: Object.fromEntries(bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => [p.id, Object.values(b.probes[p.id] ?? {}).reduce((n, count) => n + count, 0)])) })),
        normalizationExperiment: { method: "common-minimum-mass-before-additive-smoothing", foldMasses,
            note: "Fractional reweighting equalizes smoothing strength, not empirical uncertainty or endpoint settings. Thresholds remain provisional." },
        byModel, records,
        limitations: ["Reference-only twofold development, not final validation", "Within each fold source test answers are excluded from its training distribution", "The opposite folds reuse observations in swapped roles; aggregate counts are dependent, not independent trials", "Older sibling references have different/unrecorded protocol and training size; no fresh sibling controls", "The scorer uses fixed additive smoothing: unequal reference counts change shrinkage and can bias per-prompt winners; this experiment does not isolate model differences", "No new empirical samples or out-of-family controls", "Held-out validation was already viewed before forming this development investigation; confirmation of a new rule requires untouched evaluation", "No rule is selected or promoted automatically"],
    };
}
//# sourceMappingURL=glm-policy-development.js.map