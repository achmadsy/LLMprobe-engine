import type { BiasBaseline, BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export declare function assessGlmDistribution(observations: BiasObservation[], references: BiasBaseline[], family: {
    confirmedFamily: string | null;
    confidence: number;
    contradictory: boolean;
}): {
    state: string;
    acceptedModel: string | null;
    complete: boolean;
    familySupported: boolean;
    basis: string;
    comparison: {
        candidateModels: string[];
        observationsDigest: string;
        metrics: import("./glm-controlled-comparison.js").ControlledMetrics;
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
    } | null;
    referenceManifest: {
        sourceDigest: string;
        originalMasses: {
            modelId: string;
            probes: {
                [k: string]: number;
            };
        }[];
        effectiveMass: {
            [k: string]: number;
        };
        weighting: string;
    };
    limitations: string[];
};
//# sourceMappingURL=glm-distribution-assessment.d.ts.map