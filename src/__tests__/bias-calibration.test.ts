import { describe, it, expect, vi } from "vitest";
import { collectCalibration, makeCalibrationPlan, parseCalibrationArtifact, validateCalibration } from "../bias-calibration.js";

const base = { baseUrl: "https://official.example/v1", apiKey: "secret-calibration-key", execute: true, maxRequests: 9000 };
const answer = (text = "Sapphire") => Response.json({ choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });

async function artifact(purpose: "reference" | "validation", modelId = "z-ai/glm-5.3", text = "Sapphire") {
  const a = await collectCalibration(makeCalibrationPlan({ modelId, purpose }), { ...base, fetchFn: vi.fn(async () => answer(text)) });
  // Deterministic non-overlapping simulated collection times; no network used.
  a.startedAt = purpose === "reference" ? "2026-11-01T00:00:00.000Z" : "2026-11-01T01:00:00.000Z";
  a.completedAt = purpose === "reference" ? "2026-11-01T00:30:00.000Z" : "2026-11-01T01:30:00.000Z";
  a.baseline.capturedAt = a.completedAt;
  return a;
}

describe("GLM distribution calibration", () => {
  it("plans both new models with real GLM discriminator prompts without fetching", () => {
    for (const modelId of ["z-ai/glm-5.3", "z-ai/glm-5.3-flash"]) {
      const p = makeCalibrationPlan({ modelId, purpose: "reference" });
      expect(p.plannedRequests).toBe(540);
      expect(p.requestModelId).toBe(modelId.slice(5));
      expect(p.probes.map(p => p.id)).toEqual(["day", "rand_dwarf", "rand_gem", "rand_month", "rand_city", "rand_bird", "rand_element", "rand_bignum", "rand_fruit"]);
    }
    expect(() => makeCalibrationPlan({ modelId: "z-ai/glm-5.2-flash", purpose: "reference" })).toThrow();
  });

  it("refuses execution, insufficient budgets, unsafe endpoints, and mutated plans before fetch", async () => {
    const p = makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
    const fetchFn = vi.fn();
    await expect(collectCalibration(p, { ...base, execute: false, fetchFn })).rejects.toThrow("approval");
    await expect(collectCalibration(p, { ...base, maxRequests: 53, fetchFn })).rejects.toThrow("Budget");
    for (const baseUrl of ["http://official.example/v1", "https://key:secret@official.example/v1", "https://official.example/v1?token=secret"]) {
      await expect(collectCalibration(p, { ...base, baseUrl, fetchFn })).rejects.toThrow("HTTPS");
    }
    await expect(collectCalibration({ ...p, plannedRequests: 1 }, { ...base, fetchFn })).rejects.toThrow("plan");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("collects bounded normalized distributions sequentially, without secrets or model-claim trust", async () => {
    const p = makeCalibrationPlan({ modelId: "z-ai/glm-5.3-flash", purpose: "reference", samplesPerProbe: 6 });
    let active = 0;
    const fetchFn = vi.fn(async (url, init) => {
      expect(++active).toBe(1);
      expect(url).toBe("https://official.example/v1/chat/completions");
      expect(init?.redirect).toBe("error");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "glm-5.3-flash", temperature: 1, stream: false, max_tokens: 128 });
      active--;
      return answer(" Sapphire! ");
    });
    const a = await collectCalibration(p, { ...base, fetchFn });
    expect(a).toMatchObject({ state: "draft", attempts: 54, failures: 0, baseline: { modelId: "z-ai/glm-5.3-flash", sampleCount: 54 } });
    expect(a.baseline.probes.rand_gem).toEqual({ sapphire: 6 });
    expect(a.usage).toEqual({ promptTokens: 540, completionTokens: 108 });
    expect(JSON.stringify(a)).not.toContain(base.apiKey);
    expect(parseCalibrationArtifact(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("counts failed requests separately from actual blank observations and never retries", async () => {
    let calls = 0;
    const p = makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
    const a = await collectCalibration(p, { ...base, fetchFn: vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response(base.apiKey, { status: 429 });
      if (calls === 2) return answer(base.apiKey);
      if (calls === 3) return Response.json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] });
      if (calls === 4) return new Response("x".repeat(65537));
      return answer("");
    }) });
    expect(calls).toBe(54);
    expect(a.failures).toBe(4);
    expect(a.baseline.sampleCount).toBe(50);
    expect(a.observations[0].answers).toEqual(["(blank)", "(blank)"]);
    expect(a.failureKinds).toMatchObject({ "http-429": 1, "credential-in-answer": 1, "truncated-answer": 1, "response-too-large": 1 });
    expect(JSON.stringify(a)).not.toContain(base.apiKey);
    parseCalibrationArtifact(a);
  });

  it("stops on credential failures and propagates cancellation without continuing", async () => {
    const p = makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
    const badAuth = vi.fn(async () => new Response(base.apiKey, { status: 401 }));
    await expect(collectCalibration(p, { ...base, fetchFn: badAuth })).rejects.toThrow("http-401");
    expect(badAuth).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const fetchFn = vi.fn(async () => { controller.abort(); return answer(); });
    await expect(collectCalibration(p, { ...base, fetchFn, signal: controller.signal })).rejects.toThrow("canceled");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("times out stalled requests, counts slots, and does not retry them", async () => {
    const p = makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
    let calls = 0;
    const fetchFn = vi.fn(async (_url, init) => {
      if (++calls !== 1) return answer();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("private transport details")), { once: true });
      });
    });
    const a = await collectCalibration(p, { ...base, timeoutMs: 100, fetchFn });
    expect(a.failureKinds).toEqual({ timeout: 1 });
    expect(calls).toBe(54);
    expect(a.baseline.sampleCount).toBe(53);
    expect(JSON.stringify(a)).not.toContain("private transport");
  });

  it("checks held-out disjoint batches and never activates an inherited policy", async () => {
    const refs = [await artifact("reference"), await artifact("reference", "z-ai/glm-5.3-flash", "Ruby")];
    const holds = [await artifact("validation"), await artifact("validation", "z-ai/glm-5.3-flash", "Ruby")];
    const r = validateCalibration(refs, holds);
    expect(r.state).toBe("experimental-not-validated");
    expect(r.eligibleForPromotion).toBe(false);
    expect(r.missingNewReferences).toEqual([]);
    expect(r.candidateModels).toContain("z-ai/glm-5.2");
    expect(r.missingCandidateHoldouts).toContain("z-ai/glm-5.2");
    expect(r.diagnostics.every(d => d.batches === 8)).toBe(true);
    expect(r.diagnostics[0].correct).toBe(8);
    expect(r.diagnostics[1].correct).toBe(8);
    expect(() => validateCalibration(refs, [{ ...holds[0], collectionId: refs[0].collectionId }])).toThrow("independent");
    const overlapping = structuredClone(holds[0]);
    overlapping.startedAt = refs[0].startedAt;
    expect(() => validateCalibration(refs, [overlapping])).toThrow("overlap");
  });

  it("rejects inconsistent artifact counts and incompatible sampling protocols", async () => {
    const ref = await artifact("reference");
    const hold = await artifact("validation");
    const corrupt = structuredClone(ref);
    corrupt.baseline.probes.day.sapphire++;
    expect(() => parseCalibrationArtifact(corrupt)).toThrow("counts");
    const alternate = await collectCalibration(makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "validation", maxTokens: 256 }), { ...base, fetchFn: vi.fn(async () => answer()) });
    alternate.startedAt = "2026-11-02T00:00:00Z";
    alternate.completedAt = "2026-11-02T01:00:00Z";
    alternate.baseline.capturedAt = alternate.completedAt;
    expect(() => validateCalibration([ref], [alternate])).toThrow("protocols");
    const failed = await collectCalibration(makeCalibrationPlan({ modelId: "z-ai/glm-5.3", purpose: "validation" }), { ...base, fetchFn: vi.fn(async () => new Response("busy", { status: 503 })) });
    failed.startedAt = "2026-11-02T00:00:00Z";
    failed.completedAt = "2026-11-02T01:00:00Z";
    failed.baseline.capturedAt = failed.completedAt;
    expect(() => validateCalibration([ref], [failed])).toThrow("complete");
  });
});
