import { describe, expect, it, vi } from "vitest";
import { collectCalibration, makeCalibrationPlan } from "../bias-calibration.js";
import { developGlmPolicy } from "../glm-policy-development.js";

async function reference(modelId: string, word: string) {
  return collectCalibration(makeCalibrationPlan({ modelId, purpose: "reference" }), {
    baseUrl: "https://trusted.example/v1", apiKey: "test-secret", maxRequests: 540, execute: true,
    fetchFn: vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: word } }] })),
  });
}
describe("reference-only policy development", () => {
  it("is deterministic and reports experiments without promoting a runtime rule", async () => {
    const refs = [await reference("z-ai/glm-5.3", "sapphire"), await reference("z-ai/glm-5.3-flash", "ruby")];
    const report = developGlmPolicy(refs);
    expect(report).toEqual(developGlmPolicy(refs));
    expect(report.state).toBe("reference-development-only");
    expect(report.runtimePromotionAllowed).toBe(false);
    expect(report.byModel.every(m => m.developmentBatches === 10)).toBe(true);
    expect(report.records).toHaveLength(20);
    expect(report.byModel.every(m => m.promptWinners.length === 9)).toBe(true);
    expect(report.limitations.join(" ")).toContain("dependent");
  });
  it("refuses final holdout collections and duplicate reference identities", async () => {
    const r = await reference("z-ai/glm-5.3", "sapphire");
    const holdout = structuredClone(r);
    holdout.plan.purpose = "validation";
    expect(() => developGlmPolicy([holdout])).toThrow("holdouts are forbidden");
    expect(() => developGlmPolicy([r, r])).toThrow("duplicate");
  });
});
