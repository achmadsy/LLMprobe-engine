import { type CalibrationArtifact } from "./bias-calibration.js";
import { type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export interface IndependentControlCollection {
    version: 1;
    kind: "independent-distribution-controls";
    collectionId: string;
    modelId: string;
    protocolHash: string;
    provenance: {
        source: string;
        capturedAt: string;
        independent: true;
        synthetic: false;
    };
    /** Each entry is a separately sampled full 51-answer run, not resampled baseline counts. */
    batches: BiasObservation[][];
}
export declare const EXPANDED_GLM_POLICY: {
    readonly id: "glm-five-experimental-v1";
    readonly modelIds: readonly ["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"];
    readonly thresholds: {
        readonly minConfidence: 0.94;
        readonly minLogLikelihoodGap: 2.5;
        readonly minProbeVoteMargin: 3;
        readonly minAvgLogLikelihood: -3.2;
    };
    readonly provenance: "Frozen inherited thresholds; NOT optimized against new held-out observations";
    readonly releaseRequirements: {
        readonly minimumBatchesPerModel: 60;
        readonly minimumOutOfFamilyModels: 3;
        readonly minimumBatchesPerControlModel: 75;
        readonly minimumAcceptedRecall: 0.9;
        readonly minimumCorrectRateWilsonLower: 0.9;
        readonly maximumFalseAcceptWilsonUpper: 0.05;
    };
    readonly runtimePromotionAllowed: false;
};
export declare function wilsonInterval(successes: number, total: number): {
    low: number;
    high: number;
};
export declare function parseIndependentControl(input: unknown, protocolHash: string): IndependentControlCollection;
export declare function evaluateExpandedGlmPolicy(references: CalibrationArtifact[], holdouts: CalibrationArtifact[], controls?: unknown[]): {
    version: number;
    policy: {
        readonly id: "glm-five-experimental-v1";
        readonly modelIds: readonly ["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"];
        readonly thresholds: {
            readonly minConfidence: 0.94;
            readonly minLogLikelihoodGap: 2.5;
            readonly minProbeVoteMargin: 3;
            readonly minAvgLogLikelihood: -3.2;
        };
        readonly provenance: "Frozen inherited thresholds; NOT optimized against new held-out observations";
        readonly releaseRequirements: {
            readonly minimumBatchesPerModel: 60;
            readonly minimumOutOfFamilyModels: 3;
            readonly minimumBatchesPerControlModel: 75;
            readonly minimumAcceptedRecall: 0.9;
            readonly minimumCorrectRateWilsonLower: 0.9;
            readonly maximumFalseAcceptWilsonUpper: 0.05;
        };
        readonly runtimePromotionAllowed: false;
    };
    policyDigest: string;
    state: string;
    eligibleForPromotion: boolean;
    gates: {
        exactCandidateSet: boolean;
        freshSiblingReferences: boolean;
        siblingHoldoutCount: boolean;
        siblingRecall: boolean;
        siblingCorrectRateBound: boolean;
        noObservedWrongSibling: boolean;
        controlFamilyCoverage: boolean;
        controlSampleCount: boolean;
        controlFalseAcceptBound: boolean;
        provenanceAndRobustnessReview: boolean;
    };
    failedGates: string[];
    byModel: {
        modelId: "z-ai/glm-5" | "z-ai/glm-5.1" | "z-ai/glm-5.2" | "z-ai/glm-5.3" | "z-ai/glm-5.3-flash";
        batches: number;
        correct: number;
        wrong: number;
        abstained: number;
        acceptedRecall: number | null;
        correctRateWilson95: {
            low: number;
            high: number;
        };
    }[];
    controlModels: {
        modelId: string;
        batches: number;
        falseAccepts: number;
        falseAcceptWilson95: {
            low: number;
            high: number;
        };
    }[];
    diagnosticReport: {
        version: number;
        state: string;
        eligibleForPromotion: boolean;
        candidateModels: string[];
        protocolHash: string;
        referenceCollectionIds: string[];
        validationCollectionIds: string[];
        missingNewReferences: ("z-ai/glm-5.3" | "z-ai/glm-5.3-flash")[];
        missingCandidateHoldouts: string[];
        limitations: string[];
        diagnostics: {
            modelId: string;
            batches: number;
            correct: number;
            wrong: number;
            abstained: number;
            decisions: {
                topModel: string | null;
                abstained: boolean;
                posterior: number;
                avgLogLikelihood: number;
                gap: number;
            }[];
        }[];
    };
    limitations: string[];
};
//# sourceMappingURL=expanded-glm-policy.d.ts.map