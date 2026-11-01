import { type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export declare const CONTROLLED_GLM_RULES: {
    readonly minConfidence: number;
    readonly minLogLikelihoodGap: number;
    readonly minProbeVoteMargin: number;
    readonly minAvgLogLikelihood: number;
    readonly strongMinConfidence: 0.95;
    readonly strongMinLogLikelihoodGap: number;
    readonly minStrongPassSampleCount: number;
    readonly source: "Same frozen original GLM predicates for both sets; expanded-set accuracy is not independently calibrated";
};
export interface ControlledMetrics {
    rankedModel: string | null;
    confidence: number;
    logLikelihoodGap: number;
    probeVoteMargin: number;
    avgLogLikelihood: number;
    sampleCount: number;
}
export declare function applyControlledGlmGates(metrics: ControlledMetrics): {
    standardOnly: {
        acceptedModel: string | null;
        failedGates: string[];
    };
    sharedStrongPass: {
        acceptedModel: string | null;
        strongPassPredicate: boolean;
        voteGateWaived: boolean;
    };
};
export declare function scoreControlledGlmComparison(observations: BiasObservation[], candidates: BiasBaseline[]): {
    candidateModels: string[];
    observationsDigest: string;
    metrics: ControlledMetrics;
    decisions: {
        standardOnly: {
            acceptedModel: string | null;
            failedGates: string[];
        };
        sharedStrongPass: {
            acceptedModel: string | null;
            strongPassPredicate: boolean;
            voteGateWaived: boolean;
        };
    };
    perProbe: {
        probeId: string;
        topModel: string | null;
    }[];
};
//# sourceMappingURL=glm-controlled-comparison.d.ts.map