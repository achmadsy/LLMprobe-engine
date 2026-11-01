"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardCreatorEvidence = guardCreatorEvidence;
exports.compareDistributionClusters = compareDistributionClusters;
// Conservative local orchestration guards. These are not the SaaS implementation.
const model_id_normalize_js_1 = require("./model-id-normalize.js");
const sub_model_v3g_bias_fingerprint_js_1 = require("./sub-model-v3g-bias-fingerprint.js");
const CREATOR_PROBES = ["zh_creator_plain", "zh_who_built_pressure", "meta_creator", "identity_self_knowledge"];
// Short company answers are assertions ONLY on the two prompts explicitly asking
// for company/model names. In arbitrary prose a bare vendor name proves nothing.
const MAKERS = [
    { family: "zhipu", company: "(?:智谱(?:AI)?|智譜(?:AI)?|zhipu(?:\\s*ai)?|z\\.ai)", model: "glm" },
    { family: "deepseek", company: "(?:深度求索|deepseek)", model: "deepseek" },
    { family: "qwen", company: "(?:阿里巴巴|阿里云|阿里雲|alibaba)", model: "(?:qwen|通义|通義)" },
    { family: "anthropic", company: "anthropic", model: "claude" },
    { family: "openai", company: "openai", model: "(?:gpt|chatgpt)" },
    { family: "google", company: "google", model: "gemini" },
].map(m => ({ ...m,
    assertion: new RegExp(`(?:由\\s*${m.company}|(?:开发者|開發者|开发公司|開發公司|creator|developer)\\s*(?:是|为|為|:|：|is)?\\s*${m.company}|(?:developed|created|built|trained)\\s+by\\s*[:：]?\\s*${m.company})(?![a-z0-9_/-]|\\.[a-z0-9])`, "i"),
    companyAnswer: new RegExp(`^${m.company}[.。!！\\s]*$`, "i"),
    companyModelAnswer: new RegExp(`^${m.company}\\s*[,，、:：/—-]\\s*${m.model}(?:[- ]?\\d+(?:\\.\\d+)*(?:-flash)?)?[.。!！\\s]*$`, "i"),
}));
function guardCreatorEvidence(responses, behaviorScores) {
    const votes = new Map();
    for (const id of CREATOR_PROBES) {
        const text = responses[id];
        if (!text?.trim())
            continue;
        // Negated, hypothetical, or quoted assertions are not reliable affirmative self-identification.
        if (/(?:\b(?:not|never|isn['’]t|wasn['’]t|if)\b|不是|并非|並非|并不|並不|假设|假設|如果|["“”「」])/i.test(text))
            continue;
        const plain = text.replace(/[*_`]/g, "").trim();
        const shortAnswer = id === "meta_creator" || id === "zh_creator_plain";
        const matches = MAKERS.filter(m => m.assertion.test(plain) || (shortAnswer &&
            (m.companyAnswer.test(plain) || (id === "zh_creator_plain" && m.companyModelAnswer.test(plain)))));
        // Competing explicit makers in one answer are a conflict, not a silently ignored vote.
        if (matches.length > 1) {
            for (const m of matches)
                votes.set(m.family, [...(votes.get(m.family) ?? []), id]);
            continue;
        }
        if (matches.length !== 1)
            continue;
        const family = matches[0].family;
        votes.set(family, [...(votes.get(family) ?? []), id]);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
    const winner = ranked[0];
    if (!winner)
        return { family: null, confidence: 0, hardOverride: false, supportingProbeIds: [], contradictory: false, repeatedCreatorSupport: false, evidence: ["No unambiguous affirmative creator evidence"] };
    const [family, supportingProbeIds] = winner;
    const contradictory = ranked.length > 1;
    const chinese = supportingProbeIds.some(id => id.startsWith("zh_"));
    const repeatedCreatorSupport = !contradictory && chinese && supportingProbeIds.length >= 2;
    const corroborated = repeatedCreatorSupport && (behaviorScores[family] ?? 0) >= 0.4;
    return { family, supportingProbeIds, contradictory, repeatedCreatorSupport, hardOverride: corroborated,
        // A local rule confidence, not the probability that the endpoint is authentic.
        confidence: corroborated ? 0.95 : 0,
        evidence: [corroborated ? `Creator assertions for ${family} corroborated across prompts and behavioral evidence` :
                contradictory ? "Creator assertions contradict one another; no self-ID override applied" :
                    repeatedCreatorSupport ? `Repeated creator answers support ${family}, but lack style-based corroboration; no creator-only override applied` :
                        "Creator assertion lacks cross-prompt/behavioral corroboration; no override applied",
            "Self-identification can be imitated; this guard is not proof of maker or exact model"],
    };
}
function compareDistributionClusters(observations, references) {
    // Compare identical observations and require complete per-probe reference support. Otherwise
    // a shorter baseline/probe set or missing frequency table can make avgLL incomparable.
    const usable = observations.filter(o => o.answers.length > 0);
    const groups = new Map();
    for (const ref of references) {
        const family = (0, model_id_normalize_js_1.canonicalFamily)(ref.modelId.split("/")[0]);
        groups.set(family, [...(groups.get(family) ?? []), ref]);
    }
    const clusters = [...groups.entries()].map(([family, pool]) => {
        const complete = pool.filter(b => usable.every(o => b.probes[o.probeId] && Object.values(b.probes[o.probeId]).some(n => n > 0)));
        if (!usable.length || complete.length < 2 || complete.length !== pool.length) {
            return { family, comparable: false, reason: "Incomplete equal-probe reference coverage", fit: null, topModel: null, sampleCount: 0 };
        }
        // Score the same full probe set even if a historical family policy normally selects fewer.
        // Add no policy: this comparison is fit diagnostics only, never a calibrated override.
        const scored = (0, sub_model_v3g_bias_fingerprint_js_1.scoreV3HDistributionFingerprint)(usable, complete, { minConfidence: 0, minLogLikelihoodGap: 0, minProbeVoteMargin: -100, minAvgLogLikelihood: -100 });
        const sampleCount = usable.reduce((n, o) => n + o.answers.length, 0);
        const rawScores = Object.entries(scored.scores).sort((a, b) => b[1] - a[1]);
        // The scorer may scope observations under a matched historical policy. Never compare that
        // shorter likelihood to a full-set likelihood; mark it ineligible instead.
        if (scored.sampleCount !== sampleCount)
            return { family, comparable: false, reason: "Historical policy selects a different probe set", fit: null, topModel: null, sampleCount: scored.sampleCount };
        return { family, comparable: true, reason: "Equal observations; diagnostic only", fit: rawScores[0]?.[1] / sampleCount, topModel: rawScores[0]?.[0] ?? null, sampleCount };
    });
    const valid = clusters.filter(c => c.comparable && Number.isFinite(c.fit)).sort((a, b) => b.fit - a.fit);
    return { clusters, bestFamily: valid[0]?.family ?? null,
        fitMargin: valid.length >= 2 ? valid[0].fit - valid[1].fit : null,
        canOverrideVerdict: false,
        limitations: ["Equal-probe fit is not independently calibrated cross-family evidence", "Incomplete clusters excluded rather than penalized for missing distributions"] };
}
//# sourceMappingURL=identity-orchestration.js.map