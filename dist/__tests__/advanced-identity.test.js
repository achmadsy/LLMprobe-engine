"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const advanced_identity_js_1 = require("../advanced-identity.js");
const runner_js_1 = require("../runner.js");
function row(probeId, response) {
    return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true,
        passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
const rows = [row("identity_self_knowledge", "I am GLM, developed by Zhipu AI"), row("meta_creator", "Zhipu AI developed GLM"),
    row("submodel_cutoff", "2026"), row("submodel_capability", "I can help with coding"), row("submodel_refusal", "I rate my reasoning 8 out of 10")];
(0, vitest_1.describe)("offline advanced identity stages", () => {
    (0, vitest_1.it)("records current reference coverage but never fabricates sampling or exact-model verification", () => {
        const a = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results: rows, claimedModel: "glm-5.3" });
        (0, vitest_1.expect)(a.version).toBe("advanced-offline-v1");
        (0, vitest_1.expect)(a.distribution).toMatchObject({ state: "not-sampled", claimReferenceCovered: true, independentlyValidated: false,
            result: { acceptedModel: null, complete: false, comparison: null } });
        (0, vitest_1.expect)(a.verdict.status).not.toBe("clean_match_submodel_mismatch");
        (0, vitest_1.expect)(a.verdict.trueModel).toBeNull();
        (0, vitest_1.expect)(a.v3.global).toBeDefined();
        (0, vitest_1.expect)(a.v4).toBeDefined();
    });
    (0, vitest_1.it)("retains partial evidence without asserting an exact model", () => {
        const a = (0, advanced_identity_js_1.assessAdvancedIdentity)({ results: rows, claimedModel: "glm-5.3-flash", savedObservations: [{ probeId: "day", answers: ["wednesday", "thursday"] }] });
        (0, vitest_1.expect)(a.distribution.state).toBe("partial");
        (0, vitest_1.expect)(a.distribution.observations[0].answers).toHaveLength(2);
        (0, vitest_1.expect)(a.distribution.independentlyValidated).toBe(false);
        (0, vitest_1.expect)(a.verdict.trueModel).toBeNull();
    });
    (0, vitest_1.it)("rejects hostile saved observations and skips truncated response evidence", () => {
        (0, vitest_1.expect)(() => (0, advanced_identity_js_1.assessAdvancedIdentity)({ results: rows, savedObservations: [{ probeId: "day", answers: ["not normalized!"] }] })).toThrow("observations");
        (0, vitest_1.expect)((0, advanced_identity_js_1.assessAdvancedIdentity)({ results: rows.map(r => ({ ...r, responseTruncated: true })) })).toBeUndefined();
    });
    (0, vitest_1.it)("rejudges saved responses with advanced diagnostics without any target request", async () => {
        const fetchFn = vitest_1.vi.fn(async () => { throw new Error("No target requests allowed"); });
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
            claimedModel: "glm-5.3", operation: "rejudge", previousResults: rows,
            probeIds: rows.map(r => r.probeId), fetchFn });
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
        (0, vitest_1.expect)(report.identityAssessment?.advanced?.distribution.state).toBe("not-sampled");
        (0, vitest_1.expect)(report.identityAssessment?.verdict).toMatchObject({ status: "clean_match_family_only", trueFamily: "zhipu", trueModel: null });
        (0, vitest_1.expect)(report.results.map(r => r.response)).toEqual(rows.map(r => r.response));
    });
});
//# sourceMappingURL=advanced-identity.test.js.map