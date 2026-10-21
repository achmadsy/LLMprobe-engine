// src/candidate-matcher.ts — Weighted family scoring and verdict derivation (MIT)

import { FAMILY_BASELINES, claimedModelToFamily } from "./fingerprint-baseline.js";
import type { FingerprintFeatureSet, IdentityCandidate, IdentityStatus } from "./identity-report.js";
import type { ConfidenceBand, VerdictStatus } from "./identity-verdict.js";

/** Original-page verdict object: family-level resolution with explicit status. */
export interface FamilyVerdict {
  status: VerdictStatus;
  trueFamily: string | null;
  reasoning: string[];
  confidence: ConfidenceBand;
}

/**
 * Score each family baseline against the observed feature set.
 * Returns top-3 candidates sorted by score descending, normalized to 0-1.
 */
export function matchCandidates(features: FingerprintFeatureSet): IdentityCandidate[] {
  const rawScores: Array<{ family: string; displayName: string; raw: number; reasons: string[] }> = [];

  for (const baseline of FAMILY_BASELINES) {
    let raw = 0;
    const reasons: string[] = [];

    for (const [category, key, weight] of baseline.signals) {
      // Some baseline signals reference feature categories that may be absent
      // when the caller supplies a partial FingerprintFeatureSet (e.g. unit
      // tests that mock only the rule-based categories, or extractor stages
      // that haven't run a particular fingerprint family yet). Treat absent
      // categories as zero rather than throwing.
      const cat = features[category] as Record<string, number> | undefined;
      const value = cat?.[key] ?? 0;
      if (value === 0) continue;
      raw += weight * value;
      if (weight > 0) {
        reasons.push(`${key.replace(/_/g, " ")} detected (+${weight.toFixed(1)})`);
      } else {
        reasons.push(`${key.replace(/_/g, " ")} contradicts ${baseline.family} (${weight.toFixed(1)})`);
      }
    }

    rawScores.push({ family: baseline.family, displayName: baseline.displayName, raw, reasons });
  }

  const maxRaw = Math.max(...rawScores.map(s => s.raw), 1);
  return rawScores
    .filter(s => s.raw > 0)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 3)
    .map(s => ({
      model: s.displayName,
      family: s.family,
      score: Math.min(1, Math.max(0, s.raw / maxRaw)),
      reasons: s.reasons.slice(0, 5),
    }));
}

/**
 * Given top candidates and a claimed family, derive the overall verdict.
 * - "match": top candidate matches claimed family with confidence > 0.5
 * - "mismatch": top candidate is a different known family with high score
 * - "uncertain": no clear signal, no claimed family, or scores too close
 */
export function deriveVerdict(
  candidates: IdentityCandidate[],
  claimedFamily: string | undefined,
): { status: IdentityStatus; confidence: number; evidence: string[] } {
  if (candidates.length === 0) {
    return { status: "uncertain", confidence: 0, evidence: ["No behavioral signals detected"] };
  }

  const top = candidates[0];
  const evidence = top.reasons.slice(0, 3);

  if (!claimedFamily) {
    return { status: "uncertain", confidence: top.score * 0.7, evidence };
  }

  if (top.family === claimedFamily && top.score > 0.5) {
    const secondScore = candidates[1]?.score ?? 0;
    const margin = top.score - secondScore;
    const confidence = Math.min(1, top.score * (0.6 + margin * 0.4));
    return { status: "match", confidence, evidence };
  }

  if (top.family !== claimedFamily && top.score > 0.4) {
    return {
      status: "mismatch",
      confidence: top.score,
      evidence: [
        `Behavior most consistent with ${top.model} (score: ${top.score.toFixed(2)})`,
        `Claimed family ${claimedFamily} not in top candidates`,
        ...evidence,
      ],
    };
  }

  return { status: "uncertain", confidence: top.score * 0.5, evidence };
}

/** Convenience: resolve claimedModel string to family, then derive verdict. */
export function deriveVerdictFromClaimedModel(
  candidates: IdentityCandidate[],
  claimedModel: string | undefined,
): { status: IdentityStatus; confidence: number; evidence: string[]; predictedFamily: string | undefined } {
  const claimedFamily = claimedModel ? claimedModelToFamily(claimedModel) : undefined;
  const verdict = deriveVerdict(candidates, claimedFamily);
  return { ...verdict, predictedFamily: candidates[0]?.family };
}

function confidenceBand(score: number): ConfidenceBand {
  return score >= 0.65 ? "high" : score >= 0.35 ? "medium" : "low";
}

/**
 * Original-page verdict: even when the exact sub-model can't be confirmed, a
 * claimed family that appears among the candidates resolves to
 * "clean_match_family_only" instead of a flat mismatch. This matches the
 * official-page behavior for e.g. brand-new GLM Flash releases.
 */
export function deriveFamilyVerdict(
  candidates: IdentityCandidate[],
  claimedFamily: string | undefined,
): FamilyVerdict {
  if (candidates.length === 0) {
    return {
      status: "insufficient_data", trueFamily: claimedFamily ?? null,
      confidence: "low", reasoning: ["No behavioral signals detected"],
    };
  }
  const top = candidates[0];
  const claimed = claimedFamily
    ? candidates.find(c => c.family === claimedFamily)
    : undefined;

  if (claimed && top.family === claimedFamily && top.score > 0.5) {
    return {
      status: "clean_match",
      trueFamily: claimedFamily,
      confidence: confidenceBand(top.score),
      reasoning: [
        `Behavior most consistent with ${top.model} (score: ${top.score.toFixed(2)})`,
        ...top.reasons.slice(0, 3),
      ],
    };
  }

  if (claimed && claimed.score >= 0.2) {
    return {
      status: "clean_match_family_only",
      trueFamily: claimedFamily ?? null,
      confidence: confidenceBand(claimed.score),
      reasoning: [
        `Evidence leans toward ${top.model} (${Math.round(top.score * 100)}%) rather than the claimed ${claimed.model} (${Math.round(claimed.score * 100)}%), but the claimed family is present — same family, exact model unconfirmed`,
        `Likelihood gap ${Math.abs(top.score - claimed.score).toFixed(2)}; per-signal vote: ${candidates.map(c => `${c.model} ${Math.round(c.score * 100)}%`).join(" : ")}`,
      ],
    };
  }

  if (top.score > 0.4) {
    return {
      status: "plain_mismatch",
      trueFamily: top.family,
      confidence: confidenceBand(top.score),
      reasoning: [
        `Behavior most consistent with ${top.model} (score: ${top.score.toFixed(2)})`,
        claimedFamily
          ? `Claimed family ${claimedFamily} not among candidates`
          : "No claimed family supplied",
        ...top.reasons.slice(0, 2),
      ],
    };
  }

  return {
    status: "ambiguous",
    trueFamily: top.family,
    confidence: "low",
    reasoning: [`No stable majority: ${candidates.map(c => `${c.model} ${Math.round(c.score * 100)}%`).join(" : ")}`],
  };
}
