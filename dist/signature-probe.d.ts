export declare const MAX_SIGNATURE_RESPONSE_BYTES: number;
export type ThinkingConfig = {
    type: "adaptive";
} | {
    type: "enabled";
    budget_tokens: number;
};
export declare function getThinkingConfig(model: string): ThinkingConfig;
export interface AnthropicThinkingBlock {
    type: "thinking";
    thinking: string;
    signature: string;
}
export declare function extractThinkingBlock(raw: unknown): AnthropicThinkingBlock | null;
export interface RoundtripBodyArgs {
    model: string;
    originalUserPrompt: string;
    thinkingBlock: AnthropicThinkingBlock;
    assistantText: string;
    followUpUserPrompt: string;
}
export interface VerifyArgs extends RoundtripBodyArgs {
    endpoint: string;
    apiKey: string;
    /** Override header style for relays that use Authorization: Bearer instead of x-api-key. */
    authHeader?: "x-api-key" | "authorization";
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    customHeaders?: Record<string, string>;
}
export interface VerifyResult {
    verified: boolean;
    httpStatus: number;
    reason: "ok" | "signature_rejected" | "http_error" | "network_error";
    rawErrorSnippet: string | null;
}
export type RoundtripBody = ReturnType<typeof buildRoundtripBody>;
export declare function readBoundedResponse(response: Response, maxBytes?: number): Promise<string>;
export declare function buildRoundtripBody(args: RoundtripBodyArgs): {
    model: string;
    max_tokens: number;
    thinking: ThinkingConfig;
    messages: Array<{
        role: string;
        content: string | Array<{
            type: string;
            thinking?: string;
            signature?: string;
            text?: string;
        }>;
    }>;
};
export declare function verifySignatureRoundtrip(args: VerifyArgs): Promise<VerifyResult>;
//# sourceMappingURL=signature-probe.d.ts.map