import { type CalibrationArtifact } from "./bias-calibration.js";
export declare function developGlmPolicy(references: CalibrationArtifact[]): {
    version: number;
    state: string;
    runtimePromotionAllowed: boolean;
    developmentSeed: string;
    protocolHash: string;
    sourceCollectionIds: string[];
    candidateModels: string[];
    hypothesis: {
        id: string;
        minimumConfidence: number;
        minimumGap: number;
        minimumAverageLogLikelihood: number;
        minimumSamples: number;
        minimumVoteMargin: number;
    };
    referenceMass: {
        modelId: string;
        perPrompt: {
            [k: string]: number;
        };
    }[];
    normalizationExperiment: {
        method: string;
        foldMasses: {
            fold: number;
            commonMass: {
                [k: string]: number;
            };
            originalMasses: {
                modelId: string;
                probes: {
                    [k: string]: number;
                };
            }[];
        }[];
        note: string;
    };
    byModel: {
        modelId: string;
        developmentBatches: number;
        fixedGate: {
            correct: number;
            wrong: number;
            abstained: number;
        };
        strongPassHypothesis: {
            correct: number;
            wrong: number;
            abstained: number;
        };
        normalizedMass: {
            fixedGate: {
                correct: number;
                wrong: number;
                abstained: number;
            };
            strongPassHypothesis: {
                correct: number;
                wrong: number;
                abstained: number;
            };
            rankedCorrect: number;
            voteMargins: number[];
        };
        promptWinners: {
            probeId: string;
            expectedWins: number;
            winners: Record<string, number>;
        }[];
    }[];
    records: {
        fold: number;
        batch: number;
        expectedModel: string;
        rankedModel: string | null;
        fixedGateModel: string | null;
        hypothesisModel: string | null;
        voteMargin: number;
        gap: number;
        avgLogLikelihood: number;
        perProbe: Array<{
            probeId: string;
            topModel: string | null;
        }>;
        normalized: {
            rankedModel: string | null;
            fixedGateModel: string | null;
            hypothesisModel: string | null;
            voteMargin: number;
            gap: number;
            avgLogLikelihood: number;
            perProbe: Array<{
                probeId: string;
                topModel: string | null;
            }>;
        };
    }[];
    limitations: string[];
};
//# sourceMappingURL=glm-policy-development.d.ts.map