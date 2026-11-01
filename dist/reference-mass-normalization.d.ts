import type { BiasBaseline } from "./sub-model-v3g-bias-fingerprint.js";
export declare function normalizeReferenceMass(candidates: BiasBaseline[], probeIds: string[]): {
    references: {
        modelId: string;
        probes: {
            [k: string]: {
                [k: string]: number;
            };
        };
    }[];
    commonMass: {
        [k: string]: number;
    };
    originalMasses: {
        modelId: string;
        probes: {
            [k: string]: number;
        };
    }[];
    method: string;
    runtimePromotionAllowed: false;
};
//# sourceMappingURL=reference-mass-normalization.d.ts.map