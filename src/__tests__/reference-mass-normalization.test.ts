import { describe, expect, it } from "vitest";
import { normalizeReferenceMass } from "../reference-mass-normalization.js";
import { scoreV3HDistributionFingerprint } from "../sub-model-v3g-bias-fingerprint.js";

describe("development-only reference mass normalization", () => {
  it("makes proportional frequencies equal despite different original sample counts", () => {
    const refs = [{ modelId: "test/a", sampleCount: 200, capturedAt: "2026-11-01", probes: { day: { monday: 100, friday: 100 } } },
      { modelId: "test/b", sampleCount: 60, capturedAt: "2026-11-01", probes: { day: { monday: 30, friday: 30 } } }];
    const before = structuredClone(refs);
    const normalized = normalizeReferenceMass(refs, ["day"]);
    expect(normalized.commonMass.day).toBe(60);
    expect(normalized.references[0].probes.day).toEqual(normalized.references[1].probes.day);
    expect(normalized.references[0]).not.toHaveProperty("sampleCount");
    expect(refs).toEqual(before);
    const r = scoreV3HDistributionFingerprint([{ probeId: "day", answers: ["monday", "friday"] }], normalized.references);
    expect(r.scores["test/a"]).toBe(r.scores["test/b"]);
    expect(normalized.runtimePromotionAllowed).toBe(false);
  });
  it("rejects missing, negative, nonfinite and empty distributions", () => {
    const invalid: Array<Record<string, number>> = [{}, { monday: -1 }, { monday: NaN }, { monday: 0 }];
    for (const counts of invalid) {
      expect(() => normalizeReferenceMass([{ modelId: "a", probes: { day: counts } }, { modelId: "b", probes: { day: { monday: 1 } } }], ["day"])).toThrow();
    }
    expect(() => normalizeReferenceMass([{ modelId: "a", probes: {} }, { modelId: "b", probes: {} }], ["day"])).toThrow();
  });
});
