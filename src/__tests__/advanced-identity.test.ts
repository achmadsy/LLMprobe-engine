import { describe, expect, it, vi } from "vitest";
import { assessAdvancedIdentity } from "../advanced-identity.js";
import { runProbes, type ProbeResult } from "../runner.js";

function row(probeId: string, response: string): ProbeResult {
  return { probeId, response, status: "done", group: "identity", label: probeId, neutral: true,
    passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: null, outputTokens: null, tps: null, error: null };
}
const rows = [row("identity_self_knowledge", "I am GLM, developed by Zhipu AI"), row("meta_creator", "Zhipu AI developed GLM"),
  row("submodel_cutoff", "2026"), row("submodel_capability", "I can help with coding"), row("submodel_refusal", "I rate my reasoning 8 out of 10")];

describe("offline advanced identity stages", () => {
  it("records current reference coverage but never fabricates sampling or exact-model verification", () => {
    const a = assessAdvancedIdentity({ results: rows, claimedModel: "glm-5.3" })!;
    expect(a.version).toBe("advanced-offline-v1");
    expect(a.distribution).toMatchObject({ state: "not-sampled", claimReferenceCovered: true, independentlyValidated: false,
      result: { acceptedModel: null, complete: false, comparison: null } });
    expect(a.verdict.status).not.toBe("clean_match_submodel_mismatch");
    expect(a.verdict.trueModel).toBeNull();
    expect(a.v3.global).toBeDefined();
    expect(a.v4).toBeDefined();
  });

  it("retains partial evidence without asserting an exact model", () => {
    const a = assessAdvancedIdentity({ results: rows, claimedModel: "glm-5.3-flash", savedObservations: [{ probeId: "day", answers: ["wednesday", "thursday"] }] })!;
    expect(a.distribution.state).toBe("partial");
    expect(a.distribution.observations[0].answers).toHaveLength(2);
    expect(a.distribution.independentlyValidated).toBe(false);
    expect(a.verdict.trueModel).toBeNull();
  });

  it("rejects hostile saved observations and skips truncated response evidence", () => {
    expect(() => assessAdvancedIdentity({ results: rows, savedObservations: [{ probeId: "day", answers: ["not normalized!"] }] })).toThrow("observations");
    expect(assessAdvancedIdentity({ results: rows.map(r => ({ ...r, responseTruncated: true })) })).toBeUndefined();
  });

  it("rejudges saved responses with advanced diagnostics without any target request", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("No target requests allowed"); });
    const report = await runProbes({ baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm-5.3",
      claimedModel: "glm-5.3", operation: "rejudge", previousResults: rows,
      probeIds: rows.map(r => r.probeId), fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(report.identityAssessment?.advanced?.distribution.state).toBe("not-sampled");
    expect(report.results.map(r => r.response)).toEqual(rows.map(r => r.response));
  });
});
