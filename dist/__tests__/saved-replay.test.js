"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const runner_js_1 = require("../runner.js");
const probe_suite_js_1 = require("../probe-suite.js");
const quality = probe_suite_js_1.PROBE_SUITE.find(p => p.scoring === "llm_judge");
const evidence = probe_suite_js_1.PROBE_SUITE.find(p => p.scoring === "feature_extract");
function row(probeId, response) {
    return { probeId, label: probeId, group: "integrity", neutral: false, status: "done", passed: false,
        passReason: "old verdict", ttftMs: 10, durationMs: 20, inputTokens: 5, outputTokens: 8,
        tps: 4, response, error: null };
}
(0, vitest_1.describe)("saved result replay", () => {
    (0, vitest_1.it)("rejudges saved text without preflight or any target calls, preserving measurements", async () => {
        const original = row(quality.id, "saved target response");
        const other = row(evidence.id, "I am a model");
        const fetchFn = vitest_1.vi.fn(async (url) => {
            (0, vitest_1.expect)(String(url)).toBe("https://judge.example/v1/chat/completions");
            return Response.json({ choices: [{ message: { content: '{"score":9,"reason":"correct"}' } }] });
        });
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "target-key", modelId: "m",
            operation: "rejudge", previousResults: [original, other], probeIds: [quality.id, evidence.id],
            judge: { baseUrl: "https://judge.example/v1", apiKey: "judge-key", modelId: "j" }, fetchFn, requestRetries: 0 });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(report.results[0]).toMatchObject({ response: original.response, durationMs: 20, inputTokens: 5, passed: true, judgeError: null });
        (0, vitest_1.expect)(report.results[1]).toEqual(other);
        (0, vitest_1.expect)(original.passed).toBe(false);
    });
    (0, vitest_1.it)("retries only one target task and keeps sibling evidence", async () => {
        const other = row(evidence.id, "old evidence");
        const fetchFn = vitest_1.vi.fn(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "new response" } }], usage: { prompt_tokens: 1, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }));
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "k", modelId: "m", operation: "retry",
            retryProbeId: quality.id, previousResults: [row(quality.id, "old"), other], probeIds: [quality.id, evidence.id], fetchFn, requestRetries: 0 });
        (0, vitest_1.expect)(fetchFn).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(report.results[0].response).toBe("new response");
        (0, vitest_1.expect)(report.results[1]).toEqual(other);
    });
    (0, vitest_1.it)("surfaces judge errors without discarding the saved target response", async () => {
        const original = row(quality.id, "saved response");
        const report = await (0, runner_js_1.runProbes)({ baseUrl: "https://target.example/v1", apiKey: "k", modelId: "m", operation: "rejudge",
            previousResults: [original], probeIds: [quality.id], judge: { baseUrl: "https://judge.example/v1", apiKey: "j", modelId: "j" },
            fetchFn: vitest_1.vi.fn(async () => new Response("", { status: 400 })), requestRetries: 0 });
        (0, vitest_1.expect)(report.results[0]).toMatchObject({ response: "saved response", status: "done", passed: null, judgeError: "Judge API error: HTTP 400" });
    });
});
//# sourceMappingURL=saved-replay.test.js.map