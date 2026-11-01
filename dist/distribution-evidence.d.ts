import type { BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export declare const DISTRIBUTION_SAMPLE_CALLS = 51;
export interface DistributionEvidence {
    version: 1;
    modelId: string;
    protocolId: "glm-nine-temperature1-max128-v1";
    observations: BiasObservation[];
    attempts: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    collectedAt: string;
}
export declare function validateDistributionEvidence(input: unknown): DistributionEvidence;
export declare function collectDistributionEvidence(options: {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    fetchFn: typeof fetch;
    customHeaders?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxCalls: 51;
    onProgress?: (progress: {
        attempts: number;
        failures: number;
        total: 51;
    }) => void;
}): Promise<DistributionEvidence>;
//# sourceMappingURL=distribution-evidence.d.ts.map