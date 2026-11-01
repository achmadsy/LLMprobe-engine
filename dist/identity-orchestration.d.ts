import { type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
export interface CreatorGuardResult {
    family: string | null;
    confidence: number;
    hardOverride: boolean;
    evidence: string[];
    supportingProbeIds: string[];
    contradictory: boolean;
}
export declare function guardCreatorEvidence(responses: Record<string, string>, behaviorScores: Record<string, number>): CreatorGuardResult;
export declare function compareDistributionClusters(observations: BiasObservation[], references: BiasBaseline[]): {
    clusters: {
        family: string;
        comparable: boolean;
        reason: string;
        fit: number | null;
        topModel: string | null;
        sampleCount: number;
    }[];
    bestFamily: string;
    fitMargin: number | null;
    canOverrideVerdict: false;
    limitations: string[];
};
//# sourceMappingURL=identity-orchestration.d.ts.map