import { describe, expect, it } from "vitest";
import { BIAS_BASELINES } from "../sub-model-bias-baselines.js";
import { checkGlmReferenceRegression } from "../glm-reference-regression.js";
import type { BiasBaseline } from "../sub-model-v3g-bias-fingerprint.js";
const pack = require("../glm53-bias-reference-pack.json") as { references: Array<{ baseline: BiasBaseline }> };

describe("five-way reference reconstruction sanity", () => {
  it("keeps historical sibling rankings without promoting empirical controls or mutating references", () => {
    const refs = [...BIAS_BASELINES.filter(b => b.modelId.startsWith("z-ai/")), ...pack.references.map(r => r.baseline)];
    const before = JSON.stringify(refs);
    const r = checkGlmReferenceRegression(refs);
    expect(r.records).toHaveLength(50);
    expect(r.runtimePromotionAllowed).toBe(false);
    expect(r.summary.every(m => m.rankedCorrect === 10)).toBe(true);
    expect(r.summary.every(m => m.wrongAccepted === 0 && m.stolenByNewModels === 0)).toBe(true);
    const controlled = r.controlledComparison.summary;
    for (const m of controlled) {
      expect(m.sharedStrongPass.fiveCandidates).toMatchObject({ batches: 10, correct: 10, wrong: 0, abstained: 0 });
      if (m.sharedStrongPass.threeCandidates.batches) {
        expect(m.sharedStrongPass.threeCandidates).toMatchObject({ batches: 10, correct: 10, wrong: 0, abstained: 0 });
        expect(m.candidateAdditionEffects.every(e => !e.rankChanged && e.gapChange === 0)).toBe(true);
      }
    }
    expect(controlled.slice(0, 3).map(m => [m.standardOnly.threeCandidates.correct, m.standardOnly.fiveCandidates.correct]))
      .toEqual([[8, 3], [10, 9], [7, 7]]);
    for (const record of r.records) {
      if (record.controlled.threeCandidates) {
        expect(record.controlled.threeCandidates.observationsDigest).toBe(record.controlled.fiveCandidates.observationsDigest);
        expect(record.controlled.threeCandidates.metrics.sampleCount).toBe(record.controlled.fiveCandidates.metrics.sampleCount);
      }
    }
    expect(JSON.stringify(refs)).toBe(before);
    expect(() => checkGlmReferenceRegression(refs.slice(1))).toThrow("All five");
  });
});
