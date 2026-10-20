import { type ReferenceEmbedding } from "./fingerprint-vectors.js";
import type { IdentityAssessment } from "./identity-report.js";
import { type EgressOptions } from "./egress-guard.js";
export interface ProbeResult {
    probeId: string;
    label: string;
    group: string;
    neutral: boolean;
    status: "done" | "error" | "skipped";
    passed: true | false | "warning" | null;
    passReason: string | null;
    ttftMs: number | null;
    durationMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    tps: number | null;
    response: string | null;
    error: string | null;
    /** Scoring mode of the probe, for consumer-side expected/actual display. */
    scoring?: string;
    /** Expected/reference response (or containment keywords) for auditability. */
    expected?: string | null;
}
export interface RunReport {
    baseUrl: string;
    modelId: string;
    claimedModel?: string;
    startedAt: string;
    completedAt: string;
    score: number;
    scoreMax: number;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
    results: ProbeResult[];
    identityAssessment?: IdentityAssessment;
}
/**
 * Baseline responses keyed by probeId.
 * Obtained from `collect-baseline` or downloaded from the BazaarLink public API.
 */
export type BaselineMap = Record<string, string>;
export interface RunOptions {
    baseUrl: string;
    apiKey: string;
    modelId: string;
    /** Include optional probes (e.g. context_length). Default: false */
    includeOptional?: boolean;
    /**
     * Transport-level retries per request (network errors, 5xx, 429).
     * Semantic failures are never retried. Default: 2. Use 0 to disable.
     */
    requestRetries?: number;
    /** Timeout per probe request in ms. Default: 180_000 */
    timeoutMs?: number;
    /** Called after each probe completes */
    onProgress?: (result: ProbeResult, index: number, total: number) => void;
    /** Extra headers merged into every target-phase request (never overrides Authorization/Content-Type/probe extras). */
    customHeaders?: Record<string, string>;
    /** Judge endpoint for llm_judge probes (optional; skipped if absent) */
    judge?: {
        baseUrl: string;
        apiKey: string;
        modelId: string;
        /** Score threshold 1-10. Default: 7 */
        threshold?: number;
        /** Extra headers sent only on judge requests. */
        customHeaders?: Record<string, string>;
    };
    /**
     * Baseline responses to compare against during llm_judge scoring.
     * Keys are probeIds; values are the trusted baseline response text.
     * When provided, the judge compares candidate vs baseline for similarity (1-10).
     * Without a baseline, llm_judge probes are skipped.
     */
    baseline?: BaselineMap;
    /**
     * The model name the operator claims is running behind this endpoint.
     * When provided, the identity phase compares observed behavior against this family.
     */
    claimedModel?: string;
    /**
     * Judge endpoint for identity fingerprinting (optional LLM judge signal).
     * When supplied, the identity phase calls this judge to classify model family.
     */
    identityJudge?: {
        baseUrl: string;
        apiKey: string;
        modelId: string;
    };
    /**
     * Embeddings endpoint for identity fingerprinting (optional vector signal).
     * When supplied, probe responses are embedded and compared against family references.
     */
    embeddingEndpoint?: {
        baseUrl: string;
        apiKey: string;
        modelId: string;
        /** Reference embeddings (family → embedding vector). If absent, vector signal is skipped. */
        references?: ReferenceEmbedding[];
    };
    /** External AbortSignal to cancel the entire probe run */
    signal?: AbortSignal;
    /** Custom fetch implementation (defaults to safeFetch if egressOptions provided, else global fetch) */
    fetchFn?: typeof fetch;
    /** Egress guard options (SSRF defense, port allowlist, etc.) */
    egressOptions?: EgressOptions;
}
export declare function runProbes(options: RunOptions): Promise<RunReport>;
//# sourceMappingURL=runner.d.ts.map