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
export declare function matchCandidates(features: FingerprintFeatureSet): IdentityCandidate[];
/**
 * Given top candidates and a claimed family, derive the overall verdict.
 * - "match": top candidate matches claimed family with confidence > 0.5
 * - "mismatch": top candidate is a different known family with high score
 * - "uncertain": no clear signal, no claimed family, or scores too close
 */
export declare function deriveVerdict(candidates: IdentityCandidate[], claimedFamily: string | undefined): {
    status: IdentityStatus;
    confidence: number;
    evidence: string[];
};
/** Convenience: resolve claimedModel string to family, then derive verdict. */
export declare function deriveVerdictFromClaimedModel(candidates: IdentityCandidate[], claimedModel: string | undefined): {
    status: IdentityStatus;
    confidence: number;
    evidence: string[];
    predictedFamily: string | undefined;
};
/**
 * Original-page verdict: even when the exact sub-model can't be confirmed, a
 * claimed family that appears among the candidates resolves to
 * "clean_match_family_only" instead of a flat mismatch. This matches the
 * official-page behavior for e.g. brand-new GLM Flash releases.
 */
export declare function deriveFamilyVerdict(candidates: IdentityCandidate[], claimedFamily: string | undefined): FamilyVerdict;
//# sourceMappingURL=candidate-matcher.d.ts.map