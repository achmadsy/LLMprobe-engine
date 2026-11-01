import { classifyIdentityV2 } from "./identity-classifier-v2.js";
import { fuseFamily } from "./identity-family-fusion.js";
import { classifySubmodelV3 } from "./sub-model-classifier-v3.js";
import { classifySubmodelV3E } from "./sub-model-classifier-v3e.js";
import { classifySubmodelV3F } from "./sub-model-classifier-v3f.js";
import { fuseToV4 } from "./sub-model-classifier-v4.js";
import { guardCreatorEvidence, compareDistributionClusters } from "./identity-orchestration.js";
import { type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
import { assessGlmDistribution } from "./glm-distribution-assessment.js";
import type { ProbeResult } from "./runner.js";
import type { IdentityAssessment } from "./identity-report.js";
export declare const GLM53_REFERENCE_PACK_ID: string;
export interface AdvancedIdentityAssessment {
    version: "advanced-offline-v1";
    familyFusion: ReturnType<typeof fuseFamily>;
    creatorGuard: ReturnType<typeof guardCreatorEvidence>;
    clusterComparison: ReturnType<typeof compareDistributionClusters>;
    decisionPath: Array<{
        stage: string;
        outcome: string;
        reason: string;
    }>;
    v2: ReturnType<typeof classifyIdentityV2>;
    v3: ReturnType<typeof classifySubmodelV3> & {
        global: ReturnType<typeof classifySubmodelV3>;
    };
    v3e: ReturnType<typeof classifySubmodelV3E> | null;
    v3f: ReturnType<typeof classifySubmodelV3F> | null;
    v4: ReturnType<typeof fuseToV4>;
    verdict: NonNullable<IdentityAssessment["verdict"]>;
    distribution: {
        state: ReturnType<typeof assessGlmDistribution>["state"];
        referencePackId: string;
        referenceDigest: string;
        claimReferenceCovered: boolean;
        independentlyValidated: false;
        observations: BiasObservation[];
        result: ReturnType<typeof assessGlmDistribution>;
        limitations: string[];
    };
    limitations: string[];
}
export declare function assessAdvancedIdentity(options: {
    results: ProbeResult[];
    claimedModel?: string;
    savedObservations?: BiasObservation[];
}): AdvancedIdentityAssessment | undefined;
//# sourceMappingURL=advanced-identity.d.ts.map