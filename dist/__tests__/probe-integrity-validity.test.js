"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const runner_js_1 = require("../runner.js");
const probe_wire_js_1 = require("../probe-wire.js");
const fingerprint_extractor_js_1 = require("../fingerprint-extractor.js");
const candidate_matcher_js_1 = require("../candidate-matcher.js");
const multimodal_fixtures_js_1 = require("../multimodal-fixtures.js");
function sse(text, extra = {}) {
    return new Response(`data:${JSON.stringify({ choices: [{ delta: { content: text, ...extra } }], usage: { prompt_tokens: 3368, completion_tokens: 8 } })}\r\ndata:[DONE]`, { headers: { "content-type": "text/event-stream" } });
}
const options = { baseUrl: "https://target.example/v1", apiKey: "secret-test-key", modelId: "glm-5.3", requestRetries: 0 };
(0, vitest_1.describe)("integrity probe validity", () => {
    (0, vitest_1.it)("sends real bodies for paired probes and compares each adaptive echo to its own expected text", async () => {
        const bodies = [];
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            const prompt = body.messages[0].content;
            return Response.json({ choices: [{ message: { content: prompt.includes("---BEGIN---") ? (0, probe_wire_js_1.expectedEcho)(prompt) : String(bodies.length) } }] });
        });
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["adaptive_injection", "consistency_check"], fetchFn });
        (0, vitest_1.expect)(report.results.every(row => row.passed === true)).toBe(true);
        (0, vitest_1.expect)(bodies).toHaveLength(5); // preflight plus two pairs
        for (const body of bodies.slice(1))
            (0, vitest_1.expect)(body).toMatchObject({ model: "glm-5.3", stream: false, messages: [vitest_1.expect.objectContaining({ role: "user" })] });
        (0, vitest_1.expect)(bodies.slice(-2).every(body => body.temperature === 0.7)).toBe(true);
    });
    (0, vitest_1.it)("surfaces bounded redacted errors rather than completed warnings", async () => {
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            return body.max_tokens === 1 ? Response.json({}) : new Response("invalid request secret-test-key", { status: 400 });
        });
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["adaptive_injection", "consistency_check"], fetchFn });
        for (const row of report.results) {
            (0, vitest_1.expect)(row.status).toBe("error");
            (0, vitest_1.expect)(row.error).toContain("HTTP 400");
            (0, vitest_1.expect)(row.error).not.toContain(options.apiKey);
        }
    });
    (0, vitest_1.it)("sends the entire PDF using an actual file part", async () => {
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            if (body.max_tokens !== 1) {
                (0, vitest_1.expect)(body.messages[0].content[0]).toEqual({ type: "file", file: { filename: "probe.pdf", file_data: `data:application/pdf;base64,${multimodal_fixtures_js_1.PROBE_PDF_B64}` } });
            }
            return body.stream ? sse("BAZAAR") : Response.json({});
        });
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["multimodal_pdf"], fetchFn });
        (0, vitest_1.expect)(report.results[0].passed).toBe(true);
    });
    (0, vitest_1.it)("does not penalize agent overhead or absent reasoning and recognizes reasoning_content", async () => {
        const fetchFn = vitest_1.vi.fn(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            return body.stream ? sse("391", body.reasoning_effort ? { reasoning_content: "calculation" } : {}) : Response.json({});
        });
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["token_inflation", "thinking_block", "sse_compliance"], fetchFn });
        (0, vitest_1.expect)(report.results[0]).toMatchObject({ neutral: true, passed: null });
        (0, vitest_1.expect)(report.results[0].passReason).not.toContain("probable hidden");
        (0, vitest_1.expect)(report.results[1].passReason).toContain("Structured reasoning observed");
        (0, vitest_1.expect)(report.results[1].passed).toBeNull();
        (0, vitest_1.expect)(report.results[2].passed).toBe(true);
    });
    (0, vitest_1.it)("marks explicitly unsupported PDFs as unassessed rather than failed", async () => {
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["multimodal_pdf"], fetchFn: vitest_1.vi.fn(async (_url, init) => {
                const body = JSON.parse(String(init?.body));
                return body.max_tokens === 1 ? Response.json({}) : new Response("PDF input is not supported", { status: 400 });
            }) });
        (0, vitest_1.expect)(report.results[0]).toMatchObject({ status: "skipped", neutral: true, passed: null });
    });
    (0, vitest_1.it)("classifies the reported missing PDF as unconfirmed delivery and fixes it during offline rejudge", async () => {
        const text = "I don't have access to the PDF you're referring to — the file wasn't included with your message, so I can't read its contents. Let me check whether it exists in the working directory.";
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["multimodal_pdf"], fetchFn: vitest_1.vi.fn(async (_url, init) => {
                const body = JSON.parse(String(init?.body));
                return body.stream ? sse(text) : Response.json({});
            }) });
        const result = report.results[0];
        (0, vitest_1.expect)(result).toMatchObject({ status: "done", neutral: true, passed: null, response: text });
        (0, vitest_1.expect)(result.passReason).toContain("delivery is unconfirmed");
        const fetchFn = vitest_1.vi.fn(async () => { throw new Error("No target requests"); });
        const rejudged = await (0, runner_js_1.runProbes)({ ...options, operation: "rejudge", probeIds: ["multimodal_pdf"],
            previousResults: [{ ...result, passed: false, neutral: false }], fetchFn });
        (0, vitest_1.expect)(fetchFn).not.toHaveBeenCalled();
        (0, vitest_1.expect)(rejudged.results[0]).toMatchObject({ response: text, passed: null, neutral: true });
    });
    (0, vitest_1.it)("does not turn an incorrect PDF answer or ordinary reading failure into missing delivery", () => {
        for (const text of ["The word is MARKET", "I read the PDF but cannot identify the word", "The file is blurry", "BAZAAR"])
            (0, vitest_1.expect)((0, probe_wire_js_1.reportsMissingPdfAttachment)(text)).toBe(false);
    });
    (0, vitest_1.it)("treats ordinary content blocks as text, not evidence of thinking", async () => {
        const report = await (0, runner_js_1.runProbes)({ ...options, probeIds: ["thinking_block"], fetchFn: vitest_1.vi.fn(async (_url, init) => {
                const body = JSON.parse(String(init?.body));
                return body.stream ? new Response(`data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "text", text: "391" } })}\n\ndata: [DONE]\n\n`) : Response.json({});
            }) });
        (0, vitest_1.expect)(report.results[0].passReason).toContain("No structured reasoning exposed");
        (0, vitest_1.expect)(report.results[0].passed).toBeNull();
    });
    (0, vitest_1.it)("parses chunk splits, CRLF, no data spacing, and EOF tail", async () => {
        (0, vitest_1.expect)(await (0, probe_wire_js_1.readProbeStream)(sse("ok"))).toEqual([vitest_1.expect.stringContaining('"content":"ok"'), "[DONE]"]);
    });
    (0, vitest_1.it)("does not auto-score generic ZCode bullet style as Anthropic 100", () => {
        const responses = { identity_self_knowledge: "I am ZCode, an interactive coding agent", identity_style_en: "I think software is useful.\n- clear\n- helpful", meta_creator: "Zhipu AI developed GLM", tok_self_knowledge: "SentencePiece" };
        const features = (0, fingerprint_extractor_js_1.extractFingerprint)(responses, {}, [], responses);
        (0, vitest_1.expect)(features.selfClaim.agent_wrapper).toBe(1);
        (0, vitest_1.expect)(features.linguisticFingerprint?.meta_creator_zhipu).toBe(1);
        const candidates = (0, candidate_matcher_js_1.matchCandidates)(features);
        (0, vitest_1.expect)(candidates[0].family).toBe("zhipu");
        (0, vitest_1.expect)(candidates.find(row => row.family === "anthropic")?.score ?? 0).toBeLessThan(0.5);
        (0, vitest_1.expect)(candidates.every(row => row.score < 1)).toBe(true);
    });
});
//# sourceMappingURL=probe-integrity-validity.test.js.map