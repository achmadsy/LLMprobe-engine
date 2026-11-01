"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const bias_calibration_js_1 = require("../bias-calibration.js");
const base = { baseUrl: "https://official.example/v1", apiKey: "secret-calibration-key", execute: true, maxRequests: 9000 };
const answer = (text = "Sapphire") => Response.json({ choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
async function artifact(purpose, modelId = "z-ai/glm-5.3", text = "Sapphire") {
    const a = await (0, bias_calibration_js_1.collectCalibration)((0, bias_calibration_js_1.makeCalibrationPlan)({ modelId, purpose }), { ...base, fetchFn: vitest_1.vi.fn(async () => answer(text)) });
    // Deterministic non-overlapping simulated collection times; no network used.
    a.startedAt = purpose === "reference" ? "2026-11-01T00:00:00.000Z" : "2026-11-01T01:00:00.000Z";
    a.completedAt = purpose === "reference" ? "2026-11-01T00:30:00.000Z" : "2026-11-01T01:30:00.000Z";
    a.baseline.capturedAt = a.completedAt;
    return a;
}
(0, vitest_1.describe)("GLM distribution calibration", () => {
    (0, vitest_1.it)("plans both new models with real GLM discriminator prompts without fetching", () => {
        for (const modelId of ["z-ai/glm-5.3", "z-ai/glm-5.3-flash"]) {
            const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId, purpose: "reference" });
            (0, vitest_1.expect)(p.plannedRequests).toBe(540);
            (0, vitest_1.expect)(p.requestModelId).toBe(modelId.slice(5));
            (0, vitest_1.expect)(p.probes.map(p => p.id)).toEqual(["day", "rand_dwarf", "rand_gem", "rand_month", "rand_city", "rand_bird", "rand_element", "rand_bignum", "rand_fruit"]);
        }
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.2-flash", purpose: "reference" })).toThrow();
    });
    (0, vitest_1.it)("refuses execution, insufficient budgets, unsafe endpoints, and mutated plans before fetch", async () => {
        const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
        const fetchFn = vitest_1.vi.fn();
        await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)(p, { ...base, execute: false, fetchFn })).rejects.toThrow("approval");
        await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)(p, { ...base, maxRequests: 53, fetchFn })).rejects.toThrow("Budget");
        for (const baseUrl of ["http://official.example/v1", "https://key:secret@official.example/v1", "https://official.example/v1?token=secret"]) {
            await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)(p, { ...base, baseUrl, fetchFn })).rejects.toThrow("HTTPS");
        }
        await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)({ ...p, plannedRequests: 1 }, { ...base, fetchFn })).rejects.toThrow("plan");
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("collects bounded normalized distributions sequentially, without secrets or model-claim trust", async () => {
        const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3-flash", purpose: "reference", samplesPerProbe: 6 });
        let active = 0;
        const fetchFn = vitest_1.vi.fn(async (url, init) => {
            (0, vitest_1.expect)(++active).toBe(1);
            (0, vitest_1.expect)(url).toBe("https://official.example/v1/chat/completions");
            (0, vitest_1.expect)(init?.redirect).toBe("error");
            (0, vitest_1.expect)(JSON.parse(String(init?.body))).toMatchObject({ model: "glm-5.3-flash", temperature: 1, stream: false, max_tokens: 128 });
            active--;
            return answer(" Sapphire! ");
        });
        const a = await (0, bias_calibration_js_1.collectCalibration)(p, { ...base, fetchFn });
        (0, vitest_1.expect)(a).toMatchObject({ state: "draft", attempts: 54, failures: 0, baseline: { modelId: "z-ai/glm-5.3-flash", sampleCount: 54 } });
        (0, vitest_1.expect)(a.baseline.probes.rand_gem).toEqual({ sapphire: 6 });
        (0, vitest_1.expect)(a.usage).toEqual({ promptTokens: 540, completionTokens: 108 });
        (0, vitest_1.expect)(JSON.stringify(a)).not.toContain(base.apiKey);
        (0, vitest_1.expect)((0, bias_calibration_js_1.parseCalibrationArtifact)(JSON.parse(JSON.stringify(a)))).toEqual(a);
    });
    (0, vitest_1.it)("counts failed requests separately from actual blank observations and never retries", async () => {
        let calls = 0;
        const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
        const a = await (0, bias_calibration_js_1.collectCalibration)(p, { ...base, fetchFn: vitest_1.vi.fn(async () => {
                calls++;
                if (calls === 1)
                    return new Response(base.apiKey, { status: 429 });
                if (calls === 2)
                    return answer(base.apiKey);
                if (calls === 3)
                    return Response.json({ choices: [{ finish_reason: "length", message: { content: "partial" } }] });
                if (calls === 4)
                    return new Response("x".repeat(65537));
                return answer("");
            }) });
        (0, vitest_1.expect)(calls).toBe(54);
        (0, vitest_1.expect)(a.failures).toBe(4);
        (0, vitest_1.expect)(a.baseline.sampleCount).toBe(50);
        (0, vitest_1.expect)(a.observations[0].answers).toEqual(["(blank)", "(blank)"]);
        (0, vitest_1.expect)(a.failureKinds).toMatchObject({ "http-429": 1, "credential-in-answer": 1, "truncated-answer": 1, "response-too-large": 1 });
        (0, vitest_1.expect)(JSON.stringify(a)).not.toContain(base.apiKey);
        (0, bias_calibration_js_1.parseCalibrationArtifact)(a);
    });
    (0, vitest_1.it)("stops on credential failures and propagates cancellation without continuing", async () => {
        const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
        const badAuth = vitest_1.vi.fn(async () => new Response(base.apiKey, { status: 401 }));
        await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)(p, { ...base, fetchFn: badAuth })).rejects.toThrow("http-401");
        (0, vitest_1.expect)(badAuth).toHaveBeenCalledTimes(1);
        const controller = new AbortController();
        const fetchFn = vitest_1.vi.fn(async () => { controller.abort(); return answer(); });
        await (0, vitest_1.expect)((0, bias_calibration_js_1.collectCalibration)(p, { ...base, fetchFn, signal: controller.signal })).rejects.toThrow("canceled");
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("times out stalled requests, counts slots, and does not retry them", async () => {
        const p = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "reference", samplesPerProbe: 6 });
        let calls = 0;
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            if (++calls !== 1)
                return answer();
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new Error("private transport details")), { once: true });
            });
        });
        const a = await (0, bias_calibration_js_1.collectCalibration)(p, { ...base, timeoutMs: 100, fetchFn });
        (0, vitest_1.expect)(a.failureKinds).toEqual({ timeout: 1 });
        (0, vitest_1.expect)(calls).toBe(54);
        (0, vitest_1.expect)(a.baseline.sampleCount).toBe(53);
        (0, vitest_1.expect)(JSON.stringify(a)).not.toContain("private transport");
    });
    (0, vitest_1.it)("checks held-out disjoint batches and never activates an inherited policy", async () => {
        const refs = [await artifact("reference"), await artifact("reference", "z-ai/glm-5.3-flash", "Ruby")];
        const holds = [await artifact("validation"), await artifact("validation", "z-ai/glm-5.3-flash", "Ruby")];
        const r = (0, bias_calibration_js_1.validateCalibration)(refs, holds);
        (0, vitest_1.expect)(r.state).toBe("experimental-not-validated");
        (0, vitest_1.expect)(r.eligibleForPromotion).toBe(false);
        (0, vitest_1.expect)(r.missingNewReferences).toEqual([]);
        (0, vitest_1.expect)(r.candidateModels).toContain("z-ai/glm-5.2");
        (0, vitest_1.expect)(r.missingCandidateHoldouts).toContain("z-ai/glm-5.2");
        (0, vitest_1.expect)(r.diagnostics.every(d => d.batches === 8)).toBe(true);
        (0, vitest_1.expect)(r.diagnostics[0].correct).toBe(8);
        (0, vitest_1.expect)(r.diagnostics[1].correct).toBe(8);
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.validateCalibration)(refs, [{ ...holds[0], collectionId: refs[0].collectionId }])).toThrow("independent");
        const overlapping = structuredClone(holds[0]);
        overlapping.startedAt = refs[0].startedAt;
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.validateCalibration)(refs, [overlapping])).toThrow("overlap");
    });
    (0, vitest_1.it)("rejects inconsistent artifact counts and incompatible sampling protocols", async () => {
        const ref = await artifact("reference");
        const hold = await artifact("validation");
        const corrupt = structuredClone(ref);
        corrupt.baseline.probes.day.sapphire++;
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.parseCalibrationArtifact)(corrupt)).toThrow("counts");
        const alternate = await (0, bias_calibration_js_1.collectCalibration)((0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "validation", maxTokens: 256 }), { ...base, fetchFn: vitest_1.vi.fn(async () => answer()) });
        alternate.startedAt = "2026-11-02T00:00:00Z";
        alternate.completedAt = "2026-11-02T01:00:00Z";
        alternate.baseline.capturedAt = alternate.completedAt;
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.validateCalibration)([ref], [alternate])).toThrow("protocols");
        const failed = await (0, bias_calibration_js_1.collectCalibration)((0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: "z-ai/glm-5.3", purpose: "validation" }), { ...base, fetchFn: vitest_1.vi.fn(async () => new Response("busy", { status: 503 })) });
        failed.startedAt = "2026-11-02T00:00:00Z";
        failed.completedAt = "2026-11-02T01:00:00Z";
        failed.baseline.capturedAt = failed.completedAt;
        (0, vitest_1.expect)(() => (0, bias_calibration_js_1.validateCalibration)([ref], [failed])).toThrow("complete");
    });
});
//# sourceMappingURL=bias-calibration.test.js.map