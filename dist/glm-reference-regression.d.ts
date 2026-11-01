import { type BiasBaseline } from "./sub-model-v3g-bias-fingerprint.js";
import { scoreControlledGlmComparison } from "./glm-controlled-comparison.js";
export declare function checkGlmReferenceRegression(references: BiasBaseline[]): {
    version: number;
    state: string;
    runtimePromotionAllowed: boolean;
    seed: string;
    summary: {
        modelId: string;
        batches: number;
        rankedCorrect: number;
        acceptedCorrect: number;
        wrongAccepted: number;
        abstained: number;
        stolenByNewModels: number;
        confusion: Record<string, number>;
    }[];
    records: {
        expectedModel: string;
        fold: number;
        batch: number;
        rankedModel: string | null;
        acceptedModel: string | null;
        voteMargin: number;
        legacyAcceptedModel: string | null;
        legacyRankedModel: string | null;
        controlled: {
            threeCandidates: ReturnType<typeof scoreControlledGlmComparison> | null;
            fiveCandidates: ReturnType<typeof scoreControlledGlmComparison>;
        };
    }[];
    controlledComparison: {
        rules: {
            readonly minConfidence: number;
            readonly minLogLikelihoodGap: number;
            readonly minProbeVoteMargin: number;
            readonly minAvgLogLikelihood: number;
            readonly strongMinConfidence: 0.95;
            readonly strongMinLogLikelihoodGap: number;
            readonly minStrongPassSampleCount: number;
            readonly source: "Same frozen original GLM predicates for both sets; expanded-set accuracy is not independently calibrated";
        };
        summary: {
            modelId: string;
            standardOnly: {
                threeCandidates: {
                    batches: number;
                    correct: number;
                    wrong: number;
                    abstained: number;
                    voteGateWaived: number;
                };
                fiveCandidates: {
                    batches: number;
                    correct: number;
                    wrong: number;
                    abstained: number;
                    voteGateWaived: number;
                };
            };
            sharedStrongPass: {
                threeCandidates: {
                    batches: number;
                    correct: number;
                    wrong: number;
                    abstained: number;
                    voteGateWaived: number;
                };
                fiveCandidates: {
                    batches: number;
                    correct: number;
                    wrong: number;
                    abstained: number;
                    voteGateWaived: number;
                };
            };
            candidateAdditionEffects: {
                fold: number;
                batch: number;
                rankChanged: boolean;
                gapChange: number;
                voteMarginChange: number;
            }[];
        }[];
        setup: string;
    };
    limitations: string[];
};
//# sourceMappingURL=glm-reference-regression.d.ts.map