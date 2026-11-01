import { describe, it, expect, vi } from "vitest";
import { collectDistributionEvidence, validateDistributionEvidence } from "../distribution-evidence.js";
import { runProbes, type ProbeResult } from "../runner.js";
import { GLM_DISTRIBUTION_MODELS, GLM_DISTRIBUTION_PROBE_IDS } from "../glm-distribution-models.js";
import { ORIGINAL_SUITE_IDS } from "../original-suite.js";
import { BIAS_PROBES } from "../sub-model-bias-probes.js";

const target = { baseUrl: "https://target.example/v1", apiKey: "test-secret", modelId: "glm/glm-5.3", maxCalls: 51 as const };
const response = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "Wednesday" } }], usage: { prompt_tokens: 10, completion_tokens: 1 } });
describe("bounded distribution evidence", () => {
  it.each(GLM_DISTRIBUTION_MODELS)("automatically samples a full %s run without opt-in", async modelId => {
    let distributionCalls = 0;
    const prompts = new Set(BIAS_PROBES.filter(p => (GLM_DISTRIBUTION_PROBE_IDS as readonly string[]).includes(p.id)).map(p => p.prompt));
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.temperature === 1 && body.max_tokens === 128 && body.stream === false && prompts.has(body.messages[0].content)) {
        distributionCalls++; return response();
      }
      if (body.max_tokens === 1) return Response.json({});
      // Fail normal tasks immediately; no target traffic leaves this mock.
      return new Response("unsupported test task", { status: 400 });
    });
    const r = await runProbes({ ...target, modelId, requestRetries: 0, probeIds: [...ORIGINAL_SUITE_IDS], fetchFn });
    expect(distributionCalls).toBe(51);
    expect(r.identityAssessment?.distributionEvidence).toMatchObject({ attempts: 51, failures: 0, modelId });
    expect(r.totalInputTokens).toBe(510);
  });

  it("does not sample unrelated models or selected-task runs by default", async () => {
    const fetchFn = vi.fn(async () => response());
    await runProbes({ ...target, probeIds: ["identity_self_knowledge"], requestRetries: 0, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2); // preflight + selected task only
  });

  it("discards credential echoes and honors cancellation before any request", async () => {
    const e = await collectDistributionEvidence({ ...target, fetchFn: vi.fn(async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: target.apiKey } }],
    })) });
    expect(e).toMatchObject({ attempts: 1, failures: 1 });
    expect(JSON.stringify(e)).not.toContain(target.apiKey);
    const controller = new AbortController(); controller.abort();
    const fetchFn = vi.fn();
    await expect(collectDistributionEvidence({ ...target, signal: controller.signal, fetchFn })).rejects.toThrow("canceled");
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it("makes exactly 51 sequential bounded calls with the reference protocol and records usage", async () => {
    let active = 0;
    const fetchFn = vi.fn(async (_url, init) => {
      expect(++active).toBe(1);
      expect(JSON.parse(String(init?.body))).toMatchObject({ temperature: 1, max_tokens: 128, stream: false });
      expect(init?.redirect).toBe("error"); active--;
      return response();
    });
    const e = await collectDistributionEvidence({ ...target, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(51);
    expect(e).toMatchObject({ attempts: 51, failures: 0, inputTokens: 510, outputTokens: 51 });
    expect(e.observations.map(o => o.answers.length)).toEqual([3, 6, 6, 6, 6, 6, 6, 6, 6]);
    expect(validateDistributionEvidence({ ...e, apiKey: "should-not-be-saved" })).not.toHaveProperty("apiKey");
  });

  it("stops at the first HTTP failure without retries or fabricated blanks", async () => {
    const fetchFn = vi.fn(async () => new Response("secret error", { status: 429 }));
    const e = await collectDistributionEvidence({ ...target, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(e).toMatchObject({ attempts: 1, failures: 1 });
    expect(e.observations.every(o => !o.answers.length)).toBe(true);
    expect(JSON.stringify(e)).not.toContain("secret error");
  });

  it("rejects forged observations, unsupported models, and missing approval before network calls", async () => {
    const fetchFn = vi.fn();
    await expect(collectDistributionEvidence({ ...target, modelId: "openai/other", fetchFn })).rejects.toThrow("supports only");
    await expect(collectDistributionEvidence({ ...target, maxCalls: 50 as 51, fetchFn })).rejects.toThrow("budget");
    expect(fetchFn).not.toHaveBeenCalled();
    const e = await collectDistributionEvidence({ ...target, fetchFn: vi.fn(async () => response()) });
    expect(() => validateDistributionEvidence({ ...e, attempts: 50 })).toThrow("counts");
  });

  it.each(["retry", "rejudge"] as const)("%s reuses saved distribution evidence without resampling", async operation => {
    const evidence = await collectDistributionEvidence({ ...target, fetchFn: vi.fn(async () => response()) });
    const previous: ProbeResult = { probeId: "identity_self_knowledge", label: "identity", group: "identity", neutral: true,
      status: "done", passed: null, passReason: null, ttftMs: null, durationMs: null, inputTokens: 20, outputTokens: 5,
      tps: null, response: "I am GLM from Zhipu AI", error: null };
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.temperature === 1 && body.max_tokens === 128).toBe(false);
      return response();
    });
    const r = await runProbes({ ...target, claimedModel: "glm-5.3", operation, retryProbeId: operation === "retry" ? previous.probeId : undefined, previousResults: [previous],
      savedDistributionEvidence: evidence, distributionSampling: { enabled: true, maxCalls: 51 }, probeIds: [previous.probeId], fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(operation === "retry" ? 1 : 0);
    expect(r.identityAssessment?.distributionEvidence).toEqual(evidence);
    expect(r.identityAssessment?.distributionEvidence?.observations).toEqual(evidence.observations);
    if (operation === "rejudge") expect(r.totalInputTokens).toBe(530);
  });
});
