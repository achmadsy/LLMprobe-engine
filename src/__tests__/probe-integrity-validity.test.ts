import { describe, expect, it, vi } from "vitest";
import { runProbes } from "../runner.js";
import { expectedEcho, readProbeStream, reportsMissingPdfAttachment } from "../probe-wire.js";
import { extractFingerprint } from "../fingerprint-extractor.js";
import { matchCandidates } from "../candidate-matcher.js";
import { PROBE_PDF_B64 } from "../multimodal-fixtures.js";

function sse(text: string, extra = {}) {
  return new Response(`data:${JSON.stringify({ choices: [{ delta: { content: text, ...extra } }], usage: { prompt_tokens: 3368, completion_tokens: 8 } })}\r\ndata:[DONE]`, { headers: { "content-type": "text/event-stream" } });
}
const options = { baseUrl: "https://target.example/v1", apiKey: "secret-test-key", modelId: "glm-5.3", requestRetries: 0 };

describe("integrity probe validity", () => {
  it("sends real bodies for paired probes and compares each adaptive echo to its own expected text", async () => {
    const bodies: any[] = [];
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      const prompt = body.messages[0].content;
      return Response.json({ choices: [{ message: { content: prompt.includes("---BEGIN---") ? expectedEcho(prompt) : String(bodies.length) } }] });
    });
    const report = await runProbes({ ...options, probeIds: ["adaptive_injection", "consistency_check"], fetchFn });
    expect(report.results.every(row => row.passed === true)).toBe(true);
    expect(bodies).toHaveLength(5); // preflight plus two pairs
    for (const body of bodies.slice(1)) expect(body).toMatchObject({ model: "glm-5.3", stream: false, messages: [expect.objectContaining({ role: "user" })] });
    expect(bodies.slice(-2).every(body => body.temperature === 0.7)).toBe(true);
  });

  it("surfaces bounded redacted errors rather than completed warnings", async () => {
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.max_tokens === 1 ? Response.json({}) : new Response("invalid request secret-test-key", { status: 400 });
    });
    const report = await runProbes({ ...options, probeIds: ["adaptive_injection", "consistency_check"], fetchFn });
    for (const row of report.results) {
      expect(row.status).toBe("error");
      expect(row.error).toContain("HTTP 400");
      expect(row.error).not.toContain(options.apiKey);
    }
  });

  it("sends the entire PDF using an actual file part", async () => {
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.max_tokens !== 1) {
        expect(body.messages[0].content[0]).toEqual({ type: "file", file: { filename: "probe.pdf", file_data: `data:application/pdf;base64,${PROBE_PDF_B64}` } });
      }
      return body.stream ? sse("BAZAAR") : Response.json({});
    });
    const report = await runProbes({ ...options, probeIds: ["multimodal_pdf"], fetchFn });
    expect(report.results[0].passed).toBe(true);
  });

  it("does not penalize agent overhead or absent reasoning and recognizes reasoning_content", async () => {
    const fetchFn = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.stream ? sse("391", body.reasoning_effort ? { reasoning_content: "calculation" } : {}) : Response.json({});
    });
    const report = await runProbes({ ...options, probeIds: ["token_inflation", "thinking_block", "sse_compliance"], fetchFn });
    expect(report.results[0]).toMatchObject({ neutral: true, passed: null });
    expect(report.results[0].passReason).not.toContain("probable hidden");
    expect(report.results[1].passReason).toContain("Structured reasoning observed");
    expect(report.results[1].passed).toBeNull();
    expect(report.results[2].passed).toBe(true);
  });

  it("marks explicitly unsupported PDFs as unassessed rather than failed", async () => {
    const report = await runProbes({ ...options, probeIds: ["multimodal_pdf"], fetchFn: vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.max_tokens === 1 ? Response.json({}) : new Response("PDF input is not supported", { status: 400 });
    }) });
    expect(report.results[0]).toMatchObject({ status: "skipped", neutral: true, passed: null });
  });

  it("classifies the reported missing PDF as unconfirmed delivery and fixes it during offline rejudge", async () => {
    const text = "I don't have access to the PDF you're referring to — the file wasn't included with your message, so I can't read its contents. Let me check whether it exists in the working directory.";
    const report = await runProbes({ ...options, probeIds: ["multimodal_pdf"], fetchFn: vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); return body.stream ? sse(text) : Response.json({});
    }) });
    const result = report.results[0];
    expect(result).toMatchObject({ status: "done", neutral: true, passed: null, response: text });
    expect(result.passReason).toContain("delivery is unconfirmed");
    const fetchFn = vi.fn(async () => { throw new Error("No target requests"); });
    const rejudged = await runProbes({ ...options, operation: "rejudge", probeIds: ["multimodal_pdf"],
      previousResults: [{ ...result, passed: false, neutral: false }], fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(rejudged.results[0]).toMatchObject({ response: text, passed: null, neutral: true });
  });

  it("does not turn an incorrect PDF answer or ordinary reading failure into missing delivery", () => {
    for (const text of ["The word is MARKET", "I read the PDF but cannot identify the word", "The file is blurry", "BAZAAR"])
      expect(reportsMissingPdfAttachment(text)).toBe(false);
  });

  it("treats ordinary content blocks as text, not evidence of thinking", async () => {
    const report = await runProbes({ ...options, probeIds: ["thinking_block"], fetchFn: vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.stream ? new Response(`data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "text", text: "391" } })}\n\ndata: [DONE]\n\n`) : Response.json({});
    }) });
    expect(report.results[0].passReason).toContain("No structured reasoning exposed");
    expect(report.results[0].passed).toBeNull();
  });

  it("parses chunk splits, CRLF, no data spacing, and EOF tail", async () => {
    expect(await readProbeStream(sse("ok"))).toEqual([expect.stringContaining('"content":"ok"'), "[DONE]"]);
  });

  it("does not auto-score generic ZCode bullet style as Anthropic 100", () => {
    const responses = { identity_self_knowledge: "I am ZCode, an interactive coding agent", identity_style_en: "I think software is useful.\n- clear\n- helpful", meta_creator: "Zhipu AI developed GLM", tok_self_knowledge: "SentencePiece" };
    const features = extractFingerprint(responses, {}, [], responses);
    expect(features.selfClaim.agent_wrapper).toBe(1);
    expect(features.linguisticFingerprint?.meta_creator_zhipu).toBe(1);
    const candidates = matchCandidates(features);
    expect(candidates[0].family).toBe("zhipu");
    expect(candidates.find(row => row.family === "anthropic")?.score ?? 0).toBeLessThan(0.5);
    expect(candidates.every(row => row.score < 1)).toBe(true);
  });
});
