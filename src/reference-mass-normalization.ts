// Equalize effective reference mass before additive smoothing; this is not an accuracy calibration.
// Fractional counts are probability weights, not newly collected observations.
import type { BiasBaseline } from "./sub-model-v3g-bias-fingerprint.js";

export function normalizeReferenceMass(candidates: BiasBaseline[], probeIds: string[]) {
  if (candidates.length < 2 || !probeIds.length || new Set(probeIds).size !== probeIds.length ||
      new Set(candidates.map(c => c.modelId)).size !== candidates.length) throw new Error("Invalid normalization candidate/probe set");
  const masses = candidates.map(c => Object.fromEntries(probeIds.map(id => {
    const counts = c.probes[id];
    if (!counts || !Object.keys(counts).length || Object.values(counts).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Missing or invalid reference counts");
    const total = Object.values(counts).reduce((n, count) => n + count, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Empty reference distribution");
    return [id, total];
  })));
  const commonMass = Object.fromEntries(probeIds.map(id => [id, Math.min(...masses.map(m => m[id]))]));
  const references = candidates.map((c, i) => ({
    // Intentionally omit capturedAt/sampleCount: transformed weights carry no empirical
    // provenance. Runtime callers retain the original manifest separately.
    modelId: c.modelId,
    probes: Object.fromEntries(probeIds.map(id => [id, Object.fromEntries(Object.entries(c.probes[id]).map(([answer, n]) =>
      [answer, (n / masses[i][id]) * commonMass[id]]))])),
  }));
  return { references, commonMass, originalMasses: candidates.map((c, i) => ({ modelId: c.modelId, probes: masses[i] })),
    method: "common-minimum-mass-before-additive-smoothing", runtimePromotionAllowed: false as const };
}
