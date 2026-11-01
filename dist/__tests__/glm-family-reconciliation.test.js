"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_crypto_1 = require("node:crypto");
// Isolate the reported conflict: style-only V2 favors Anthropic, not Zhipu.
vitest_1.vi.mock("../identity-classifier-v2.js", () => ({
    classifyIdentityV2: () => ({
        topFamily: "anthropic", familyScores: { anthropic: .8, zhipu: .15, openai: .05 },
        attackFamilyScores: { anthropic: .77, zhipu: .02, openai: .16 },
        spoofDetected: false, subModelPosteriors: [], subModelConfident: false,
    }),
}));
const advanced_identity_js_1 = require("../advanced-identity.js");
const glm_distribution_models_js_1 = require("../glm-distribution-models.js");
const runner_js_1 = require("../runner.js");
function row(probeId, response) {
    return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true,
        passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
const results = [
    row("identity_self_knowledge", "I'm **ZCode**.\n- **Underlying model**: GLM-5.3\n- **Created by**: Z.ai"),
    row("meta_creator", "Z.AI"), row("zh_creator_plain", "Z.ai，GLM。"),
];
// Synthetic modal answers exercise orchestration, NOT independent model accuracy.
const pack = require("../glm53-bias-reference-pack.json");
const reference = pack.references.find(r => r.baseline.modelId === "z-ai/glm-5.3").baseline;
const observations = glm_distribution_models_js_1.GLM_DISTRIBUTION_PROBE_IDS.map(probeId => ({ probeId,
    answers: Array(probeId === "day" ? 3 : 6).fill(Object.entries(reference.probes[probeId]).sort((a, b) => b[1] - a[1])[0][0]),
}));
const digest = (value) => (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(value)).digest("hex");
function assess(rows = results, savedObservations = observations, claimedModel = "glm-5.3") {
    return (0, advanced_identity_js_1.assessAdvancedIdentity)({ results: rows, savedObservations, claimedModel });
}
(0, vitest_1.describe)("qualified creator/distribution family reconciliation", () => {
    (0, vitest_1.it)("reconciles repeated Z.ai answers with all 51 gate-passing observations, retaining conflicting style diagnostics", () => {
        const a = assess();
        (0, vitest_1.expect)(a.creatorGuard).toMatchObject({ repeatedCreatorSupport: true, hardOverride: false });
        (0, vitest_1.expect)(a.v2.topFamily).toBe("anthropic");
        (0, vitest_1.expect)(a.familyFusion).toMatchObject({ confirmedFamily: "zhipu", source: "creator-distribution", hardOverride: false });
        (0, vitest_1.expect)(a.distribution.result).toMatchObject({ complete: true, familySupported: true, acceptedModel: "z-ai/glm-5.3" });
        (0, vitest_1.expect)(a.verdict).toMatchObject({ status: "likely_match", trueFamily: "zhipu", trueModel: "z-ai/glm-5.3", confidence: "medium" });
        (0, vitest_1.expect)(a.verdict.reasoning.join(" ")).toContain("Provisional");
        (0, vitest_1.expect)(a.decisionPath.find(s => s.stage === "family")?.outcome).toBe("zhipu");
        (0, vitest_1.expect)(a.clusterComparison.canOverrideVerdict).toBe(false);
        (0, vitest_1.expect)(a.distribution.independentlyValidated).toBe(false);
    });
    vitest_1.it.each([
        ["glm-5.1", "likely_submodel_mismatch"],
        ["anthropic/claude-sonnet-5", "model_estimate"],
        [undefined, "model_estimate"],
    ])("never uses claim %s to select family or winner", (claimedModel, status) => {
        const a = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results, savedObservations: observations, claimedModel });
        (0, vitest_1.expect)(a.familyFusion.confirmedFamily).toBe("zhipu");
        (0, vitest_1.expect)(a.distribution.result.acceptedModel).toBe("z-ai/glm-5.3");
        (0, vitest_1.expect)(a.verdict.status).toBe(status);
        (0, vitest_1.expect)(digest(a.distribution.observations)).toBe(digest(observations));
    });
    vitest_1.it.each([
        ["absent", []],
        ["missing prompt", observations.slice(1)],
        ["missing answer", observations.map((o, i) => i ? o : { ...o, answers: o.answers.slice(1) })],
        ["failed likelihood gates", observations.map(o => ({ ...o, answers: o.answers.map(() => "unseenanswer") }))],
    ])("does not reconcile with %s distribution evidence", (_label, savedObservations) => {
        const a = assess(results, savedObservations);
        (0, vitest_1.expect)(a.familyFusion.source).not.toBe("creator-distribution");
        (0, vitest_1.expect)(a.familyFusion.confirmedFamily).toBe("anthropic");
        (0, vitest_1.expect)(a.distribution.result.acceptedModel).toBeNull();
        (0, vitest_1.expect)(a.verdict.trueModel).toBeNull();
    });
    vitest_1.it.each([
        ["no maker", [row("identity_self_knowledge", "I can assist with coding")]],
        ["one maker prompt", [results[1]]],
        ["no Chinese prompt", results.slice(0, 2)],
        ["competing maker", [...results, row("zh_who_built_pressure", "Developed by Anthropic")]],
        ["competing makers within an answer", [results[1], row("zh_creator_plain", "Created by Z.ai and developed by Anthropic")]],
        ["truncated Chinese prompt", results.map(r => r.probeId === "zh_creator_plain" ? { ...r, responseTruncated: true } : r)],
        ["negated Chinese prompt", [results[1], row("zh_creator_plain", "不是由智谱开发")]],
    ])("does not reconcile despite a GLM claim and passing distribution when there is %s", (_label, rows) => {
        const a = assess(rows);
        (0, vitest_1.expect)(a.distribution.result.comparison?.decisions.sharedStrongPass.acceptedModel).toBe("z-ai/glm-5.3");
        (0, vitest_1.expect)(a.familyFusion.source).not.toBe("creator-distribution");
        (0, vitest_1.expect)(a.distribution.state).toBe("family-unconfirmed");
        (0, vitest_1.expect)(a.distribution.result.acceptedModel).toBeNull();
    });
    (0, vitest_1.it)("rejudges in memory with identical saved evidence and primary/advanced verdicts, without fetch", async () => {
        const fetchFn = vitest_1.vi.fn(async () => { throw new Error("No target requests allowed"); });
        const savedDistributionEvidence = { version: 1, modelId: "glm-5.3", protocolId: "glm-nine-temperature1-max128-v1",
            observations, attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51, collectedAt: "2026-11-01T00:00:00Z" };
        const before = JSON.stringify(savedDistributionEvidence);
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
            claimedModel: "glm-5.3", operation: "rejudge", previousResults: results,
            probeIds: results.map(r => r.probeId), savedDistributionEvidence, fetchFn });
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
        (0, vitest_1.expect)(JSON.stringify(savedDistributionEvidence)).toBe(before);
        (0, vitest_1.expect)(report.identityAssessment?.distributionEvidence).toEqual(savedDistributionEvidence);
        (0, vitest_1.expect)(report.identityAssessment?.verdict).toEqual(report.identityAssessment?.advanced?.verdict);
        (0, vitest_1.expect)(report.identityAssessment?.verdict).toMatchObject({ status: "likely_match", trueModel: "z-ai/glm-5.3", trueFamily: "zhipu" });
        (0, vitest_1.expect)(report.identityAssessment?.predictedFamily).toBe("zhipu");
        (0, vitest_1.expect)(report.results.map(r => r.response)).toEqual(results.map(r => r.response));
    });
});
//# sourceMappingURL=glm-family-reconciliation.test.js.map