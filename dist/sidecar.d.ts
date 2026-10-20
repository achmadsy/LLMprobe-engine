import { type EgressOptions } from "./egress-guard.js";
export interface SidecarConfig {
    port?: number;
    host?: string;
    bearerToken?: string;
    egressOptions?: EgressOptions;
    maxBodyBytes?: number;
}
export interface ActiveRunState {
    id: string;
    modelId: string;
    startedAt: string;
    abortController: AbortController;
}
export declare const SIDECAR_VERSION = "0.12.0";
export declare const SIDECAR_LICENSE = "AGPL-3.0-only";
export declare const SIDECAR_SOURCE = "https://github.com/achmadsy/LLMprobe-engine";
export declare class SidecarServer {
    private server;
    private activeRun;
    private config;
    private configuredToken;
    constructor(config?: SidecarConfig);
    getActiveRun(): {
        id: string;
        modelId: string;
        startedAt: string;
    } | null;
    private authenticate;
    private readBoundedBody;
    private handleHealth;
    private readBoundedResponse;
    private handleProbes;
    private handleModels;
    private handleRuns;
    private handleCancel;
    private handleRequest;
    listen(port?: number, host?: string): Promise<{
        port: number;
        host: string;
    }>;
    close(): Promise<void>;
}
export declare function createSidecarServer(config?: SidecarConfig): SidecarServer;
//# sourceMappingURL=sidecar.d.ts.map