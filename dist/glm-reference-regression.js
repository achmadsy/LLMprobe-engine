"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkGlmReferenceRegression = checkGlmReferenceRegression;
// Offline sanity check only: reconstructed baseline counts are NOT independent controls.
const node_crypto_1 = require("node:crypto");
const bias_calibration_js_1 = require("./bias-calibration.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("./sub-model-v3g-bias-fingerprint.js");
const reference_mass_normalization_js_1 = require("./reference-mass-normalization.js");
const expanded_glm_policy_js_1 = require("./expanded-glm-policy.js");
const glm_controlled_comparison_js_1 = require("./glm-controlled-comparison.js");
function order(values, seed) {
    return values.map((value, i) => ({ value, key: (0, node_crypto_1.createHash)("sha256").update(`${seed}/${i}`).digest("hex") }))
        .sort((a, b) => a.key.localeCompare(b.key)).map(x => x.value);
}
function checkGlmReferenceRegression(references) {
    if (references.map(r => r.modelId).sort().join() !== [...expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.modelIds].sort().join())
        throw new Error("All five reference models required");
    const seed = "glm-five-way-reference-sanity-v1";
    const data = references.map(r => ({ modelId: r.modelId, probes: bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => {
            const counts = r.probes[p.id];
            if (!counts || Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0 || n > 10000))
                throw new Error("Invalid empirical counts");
            const expanded = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).flatMap(([answer, count]) => Array(count).fill(answer));
            if (expanded.length < 60 || expanded.length > 10000)
                throw new Error("Require 60 bounded observations per prompt");
            return { id: p.id, answers: order(expanded, `${seed}/${r.modelId}/${p.id}`).slice(0, 60) };
        }) }));
    const records = [];
    for (let fold = 0; fold < 2; fold++) {
        const train = data.map(m => ({ modelId: m.modelId, probes: Object.fromEntries(m.probes.map(p => {
                const counts = Object.create(null);
                for (const a of p.answers.slice(fold * 30, fold * 30 + 30))
                    counts[a] = (counts[a] ?? 0) + 1;
                return [p.id, counts];
            })) }));
        const equal = (0, reference_mass_normalization_js_1.normalizeReferenceMass)(train, bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => p.id)).references;
        for (const m of data)
            for (let batch = 0; batch < 5; batch++) {
                const obs = bias_calibration_js_1.GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id, answers: m.probes.find(o => o.id === p.id).answers
                        .slice((1 - fold) * 30 + batch * p.samples, (1 - fold) * 30 + (batch + 1) * p.samples) }));
                const expanded = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(obs, equal, expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.thresholds);
                const legacy = m.modelId === "z-ai/glm-5.3" || m.modelId === "z-ai/glm-5.3-flash" ? null :
                    (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(obs, train.filter(c => c.modelId !== "z-ai/glm-5.3" && c.modelId !== "z-ai/glm-5.3-flash"), expanded_glm_policy_js_1.EXPANDED_GLM_POLICY.thresholds);
                const oldCandidates = equal.filter(c => c.modelId !== "z-ai/glm-5.3" && c.modelId !== "z-ai/glm-5.3-flash");
                records.push({ expectedModel: m.modelId, fold, batch, rankedModel: expanded.posteriors[0]?.modelId ?? null,
                    acceptedModel: expanded.topModel, voteMargin: expanded.probeVoteMargin,
                    legacyAcceptedModel: legacy?.topModel ?? null, legacyRankedModel: legacy?.posteriors[0]?.modelId ?? null,
                    controlled: { threeCandidates: legacy ? (0, glm_controlled_comparison_js_1.scoreControlledGlmComparison)(obs, oldCandidates) : null,
                        fiveCandidates: (0, glm_controlled_comparison_js_1.scoreControlledGlmComparison)(obs, equal) } });
            }
    }
    const summary = data.map(m => {
        const rows = records.filter(r => r.expectedModel === m.modelId);
        return { modelId: m.modelId, batches: rows.length,
            rankedCorrect: rows.filter(r => r.rankedModel === m.modelId).length,
            acceptedCorrect: rows.filter(r => r.acceptedModel === m.modelId).length,
            wrongAccepted: rows.filter(r => r.acceptedModel !== null && r.acceptedModel !== m.modelId).length,
            abstained: rows.filter(r => r.acceptedModel === null).length,
            stolenByNewModels: rows.filter(r => !m.modelId.includes("5.3") && r.acceptedModel?.includes("5.3")).length,
            confusion: rows.reduce((a, r) => { const key = r.acceptedModel ?? "abstain"; a[key] = (a[key] ?? 0) + 1; return a; }, {}),
        };
    });
    const sameRuleSummary = data.map(m => {
        const rows = records.filter(r => r.expectedModel === m.modelId);
        const summarize = (set, rule) => {
            const applicable = rows.filter(r => r.controlled[set] !== null);
            const accepted = (r) => r.controlled[set].decisions[rule].acceptedModel;
            return { batches: applicable.length, correct: applicable.filter(r => accepted(r) === m.modelId).length,
                wrong: applicable.filter(r => accepted(r) !== null && accepted(r) !== m.modelId).length,
                abstained: applicable.filter(r => accepted(r) === null).length,
                voteGateWaived: rule === "sharedStrongPass" ? applicable.filter(r => r.controlled[set].decisions.sharedStrongPass.voteGateWaived).length : 0 };
        };
        return { modelId: m.modelId,
            standardOnly: { threeCandidates: summarize("threeCandidates", "standardOnly"), fiveCandidates: summarize("fiveCandidates", "standardOnly") },
            sharedStrongPass: { threeCandidates: summarize("threeCandidates", "sharedStrongPass"), fiveCandidates: summarize("fiveCandidates", "sharedStrongPass") },
            candidateAdditionEffects: rows.filter(r => r.controlled.threeCandidates).map(r => ({ fold: r.fold, batch: r.batch,
                rankChanged: r.controlled.threeCandidates.metrics.rankedModel !== r.controlled.fiveCandidates.metrics.rankedModel,
                gapChange: r.controlled.fiveCandidates.metrics.logLikelihoodGap - r.controlled.threeCandidates.metrics.logLikelihoodGap,
                voteMarginChange: r.controlled.fiveCandidates.metrics.probeVoteMargin - r.controlled.threeCandidates.metrics.probeVoteMargin,
            })),
        };
    });
    return { version: 2, state: "baseline-reconstruction-sanity-only", runtimePromotionAllowed: false, seed, summary, records,
        controlledComparison: { rules: glm_controlled_comparison_js_1.CONTROLLED_GLM_RULES, summary: sameRuleSummary,
            setup: "Same observed answers and effective mass=30; gate predicates do not inspect candidate IDs or registered policy membership. Strong-pass on five candidates is a hypothetical comparison, not validation." },
        limitations: ["Reconstructed historical frequency counts are not independently sampled controls", "60 observations per prompt selected deterministically; 30 used for training in each fold", "Fold train/test indices are disjoint, but opposite folds are dependent", "Matching empirical counts does not establish real upstream identity or current model behavior", "No runtime policy, threshold or baseline was modified"] };
}
//# sourceMappingURL=glm-reference-regression.js.map