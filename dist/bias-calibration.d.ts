import { type BiasProbe } from "./sub-model-bias-probes.js";
import { type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export declare const GLM_CALIBRATION_MODELS: readonly ["z-ai/glm-5.3", "z-ai/glm-5.3-flash"];
export declare const GLM_CALIBRATION_PROBES: BiasProbe[];
export interface CalibrationPlan {
    version: 1;
    purpose: "reference" | "validation";
    modelId: string;
    requestModelId: string;
    samplesPerProbe: number;
    plannedRequests: number;
    settings: {
        temperature: 1;
        max_tokens: number;
        stream: false;
    };
    probes: BiasProbe[];
    protocolHash: string;
}
export interface CalibrationArtifact {
    version: 1;
    kind: "glm-bias-calibration";
    state: "draft";
    collectionId: string;
    startedAt: string;
    completedAt: string;
    endpoint: string;
    plan: CalibrationPlan;
    observations: BiasObservation[];
    attempts: number;
    failures: number;
    failureKinds: Record<string, number>;
    usage: {
        promptTokens: number;
        completionTokens: number;
    };
    baseline: BiasBaseline;
}
export declare function makeCalibrationPlan(options: {
    modelId: string;
    requestModelId?: string;
    purpose: "reference" | "validation";
    samplesPerProbe?: number;
    maxTokens?: number;
}): CalibrationPlan;
export declare function collectCalibration(plan: CalibrationPlan, options: {
    baseUrl: string;
    apiKey: string;
    maxRequests: number;
    execute: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
    allowLocalGateway?: boolean;
    onProgress?: (completed: number, total: number) => void;
}): Promise<CalibrationArtifact>;
export declare function parseCalibrationArtifact(input: unknown): CalibrationArtifact;
export declare function validateCalibration(references: CalibrationArtifact[], holdouts: CalibrationArtifact[]): {
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
//# sourceMappingURL=bias-calibration.d.ts.map