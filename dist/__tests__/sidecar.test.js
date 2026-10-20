"use strict";
// src/__tests__/sidecar.test.ts — Tests for sidecar API (auth, SSE, cancel, concurrency, redaction)
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const http = __importStar(require("http"));
const sidecar_js_1 = require("../sidecar.js");
const redaction_js_1 = require("../redaction.js");
(0, vitest_1.describe)("BazaarLink Probe Engine Sidecar API", () => {
    const TEST_TOKEN = "secret-sidecar-token-12345";
    let sidecar;
    let sidecarPort;
    let mockUpstream;
    let mockUpstreamPort;
    let delayUpstream = false;
    let modelsAuthorization;
    (0, vitest_1.beforeAll)(async () => {
        // 1. Start mock OpenAI-compatible upstream
        mockUpstream = http.createServer((req, res) => {
            if (req.method === "GET" && req.url === "/v1/models") {
                modelsAuthorization = req.headers.authorization;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    object: "list",
                    data: [
                        { id: "model-a", name: "Model A" },
                        { id: "model-a", name: "Duplicate" },
                        { model: "model-b" },
                    ],
                }));
                return;
            }
            if (req.method === "POST" && req.url === "/chat/completions") {
                const chunks = [];
                req.on("data", (chunk) => chunks.push(chunk));
                req.on("end", async () => {
                    const bodyStr = Buffer.concat(chunks).toString("utf-8");
                    let body = {};
                    try {
                        body = JSON.parse(bodyStr);
                    }
                    catch { /* ok */ }
                    if (delayUpstream) {
                        // Delay to allow testing cancellation
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                    }
                    if (body.stream) {
                        res.writeHead(200, {
                            "Content-Type": "text/event-stream",
                            "Cache-Control": "no-cache",
                        });
                        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "probe test response" } }] })}\n\n`);
                        res.write("data: [DONE]\n\n");
                        res.end();
                    }
                    else {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ choices: [{ message: { content: "probe test response" } }] }));
                    }
                });
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((resolve) => {
            mockUpstream.listen(0, "127.0.0.1", () => {
                const addr = mockUpstream.address();
                mockUpstreamPort = addr.port;
                resolve();
            });
        });
        // 2. Start sidecar server
        sidecar = (0, sidecar_js_1.createSidecarServer)({
            bearerToken: TEST_TOKEN,
            egressOptions: {
                allowPrivate: true, // Allow local mock upstream
                allowedPorts: [mockUpstreamPort, 80, 443],
            },
            maxBodyBytes: 65536, // 64KB for test body bounds
        });
        const bound = await sidecar.listen(0, "127.0.0.1");
        sidecarPort = bound.port;
    });
    (0, vitest_1.afterAll)(async () => {
        await sidecar.close();
        await new Promise((resolve) => mockUpstream.close(() => resolve()));
    });
    (0, vitest_1.describe)("Authentication", () => {
        (0, vitest_1.it)("rejects GET /health with 401 when Authorization header is missing", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`);
            (0, vitest_1.expect)(res.status).toBe(401);
            const json = await res.json();
            (0, vitest_1.expect)(json.error.message).toContain("Unauthorized");
        });
        (0, vitest_1.it)("rejects GET /health with 401 when Bearer token is invalid", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
                headers: { Authorization: "Bearer wrong-token" },
            });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
        (0, vitest_1.it)("rejects GET /health with 401 when scheme is not Bearer", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
                headers: { Authorization: "Basic dXNlcjpwYXNz" },
            });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
        (0, vitest_1.it)("accepts GET /health with 200 and AGPL metadata when Bearer token is valid", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
                headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            });
            (0, vitest_1.expect)(res.status).toBe(200);
            const json = await res.json();
            (0, vitest_1.expect)(json.status).toBe("ok");
            (0, vitest_1.expect)(json.service).toBe("bazaarlink-probe-engine-sidecar");
            (0, vitest_1.expect)(json.version).toBe(sidecar_js_1.SIDECAR_VERSION);
            (0, vitest_1.expect)(json.license).toBe(sidecar_js_1.SIDECAR_LICENSE);
            (0, vitest_1.expect)(json.source).toBe(sidecar_js_1.SIDECAR_SOURCE);
        });
        (0, vitest_1.it)("rejects GET /v1/probes with 401 when unauthenticated", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/probes`);
            (0, vitest_1.expect)(res.status).toBe(401);
        });
        (0, vitest_1.it)("rejects POST /v1/models with 401 when unauthenticated", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/models`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ baseUrl: "https://api.openai.com/v1" }),
            });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
        (0, vitest_1.it)("rejects POST /v1/runs with 401 when unauthenticated", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ baseUrl: "https://api.openai.com/v1" }),
            });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
        (0, vitest_1.it)("rejects POST /v1/runs/:id/cancel with 401 when unauthenticated", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/test-123/cancel`, {
                method: "POST",
            });
            (0, vitest_1.expect)(res.status).toBe(401);
        });
    });
    (0, vitest_1.describe)("Probe Catalog", () => {
        (0, vitest_1.it)("returns the authoritative probe suite without prompts or scoring rules", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/probes`, {
                headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            });
            (0, vitest_1.expect)(res.status).toBe(200);
            const json = await res.json();
            (0, vitest_1.expect)(json.version).toBe(sidecar_js_1.SIDECAR_VERSION);
            (0, vitest_1.expect)(json.probes.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(json.probes[0]).toEqual(vitest_1.expect.objectContaining({
                id: vitest_1.expect.any(String),
                label: vitest_1.expect.any(String),
                group: vitest_1.expect.any(String),
                description: vitest_1.expect.any(String),
            }));
            (0, vitest_1.expect)(json.probes[0]).not.toHaveProperty("prompt");
            (0, vitest_1.expect)(json.probes[0]).not.toHaveProperty("scoring");
        });
    });
    (0, vitest_1.describe)("Model Discovery", () => {
        (0, vitest_1.it)("fetches, normalizes, and deduplicates OpenAI-compatible models", async () => {
            modelsAuthorization = undefined;
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/models`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}/v1`,
                    apiKey: "sk-model-catalog-secret",
                }),
            });
            (0, vitest_1.expect)(res.status).toBe(200);
            (0, vitest_1.expect)(modelsAuthorization).toBe("Bearer sk-model-catalog-secret");
            (0, vitest_1.expect)(await res.json()).toEqual({
                models: [{ id: "model-a", name: "Model A" }, { id: "model-b" }],
            });
        });
        (0, vitest_1.it)("blocks private model endpoints under strict egress policy", async () => {
            const strictSidecar = (0, sidecar_js_1.createSidecarServer)({
                bearerToken: TEST_TOKEN,
                egressOptions: { allowedPorts: [80, 443] },
            });
            const bound = await strictSidecar.listen(0, "127.0.0.1");
            try {
                const res = await fetch(`http://127.0.0.1:${bound.port}/v1/models`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${TEST_TOKEN}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ baseUrl: "http://169.254.169.254/latest" }),
                });
                (0, vitest_1.expect)(res.status).toBe(400);
                const json = await res.json();
                (0, vitest_1.expect)(json.error.code).toBe("egress_blocked");
            }
            finally {
                await strictSidecar.close();
            }
        });
    });
    (0, vitest_1.describe)("Bounded Request Body", () => {
        (0, vitest_1.it)("returns 413 Payload Too Large when request body exceeds maxBodyBytes", async () => {
            // 70KB exceeds our 64KB maxBodyBytes
            const largePayload = {
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-test",
                modelId: "gpt-4o",
                junk: "x".repeat(70000),
            };
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(largePayload),
            });
            (0, vitest_1.expect)(res.status).toBe(413);
            const json = await res.json();
            (0, vitest_1.expect)(json.error.code).toBe("payload_too_large");
        });
        (0, vitest_1.it)("accepts keyless runs against endpoints that do not require auth", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    modelId: "keyless-model",
                    timeoutMs: 5000,
                }),
            });
            (0, vitest_1.expect)(res.status).toBe(200);
            const text = await res.text();
            (0, vitest_1.expect)(text).toContain("event: start");
        });
        (0, vitest_1.it)("rejects oversized apiKey values", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    apiKey: "k".repeat(10000),
                    modelId: "test-model",
                }),
            });
            (0, vitest_1.expect)(res.status).toBe(400);
        });
    });
    (0, vitest_1.describe)("Secret Redaction", () => {
        (0, vitest_1.it)("redacts explicit secrets and common token patterns", () => {
            const raw = "Error calling https://api.openai.com with Bearer secret-token-abc and sk-proj-1234567890abcdef";
            const redacted = (0, redaction_js_1.redactSecrets)(raw, ["secret-token-abc", "sk-proj-1234567890abcdef"]);
            (0, vitest_1.expect)(redacted).not.toContain("secret-token-abc");
            (0, vitest_1.expect)(redacted).not.toContain("sk-proj-1234567890abcdef");
            (0, vitest_1.expect)(redacted).toContain("[REDACTED]");
        });
        (0, vitest_1.it)("redacts URL basic auth credentials", () => {
            const raw = "Failed to connect to https://alice:supersecret@api.example.com/v1";
            const redacted = (0, redaction_js_1.redactSecrets)(raw);
            (0, vitest_1.expect)(redacted).not.toContain("alice");
            (0, vitest_1.expect)(redacted).not.toContain("supersecret");
            (0, vitest_1.expect)(redacted).toBe("Failed to connect to https://[REDACTED]:[REDACTED]@api.example.com/v1");
        });
        (0, vitest_1.it)("truncates long strings cleanly", () => {
            const long = "A".repeat(50);
            (0, vitest_1.expect)((0, redaction_js_1.truncateString)(long, 20)).toBe("AAAAAAAAAAAAAAAAAAAA…[truncated]");
        });
        (0, vitest_1.it)("bounds and redacts error objects", () => {
            const err = new Error("Connection failed with Bearer secret-tok-123456");
            const bounded = (0, redaction_js_1.boundError)(err, 50, ["secret-tok-123456"]);
            (0, vitest_1.expect)(bounded).not.toContain("secret-tok-123456");
            (0, vitest_1.expect)(bounded.length).toBeLessThanOrEqual(65);
        });
    });
    (0, vitest_1.describe)("SSE Streaming & Run Lifecycle", () => {
        (0, vitest_1.it)("streams start, progress, and complete events over SSE", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    apiKey: "sk-super-secret-key-12345",
                    modelId: "test-model",
                    timeoutMs: 5000,
                }),
            });
            (0, vitest_1.expect)(res.status).toBe(200);
            (0, vitest_1.expect)(res.headers.get("content-type")).toContain("text/event-stream");
            const text = await res.text();
            (0, vitest_1.expect)(text).toContain("event: start");
            (0, vitest_1.expect)(text).toContain("event: progress");
            (0, vitest_1.expect)(text).toContain("event: complete");
            // Verify that the secret apiKey was NOT leaked into the SSE stream
            (0, vitest_1.expect)(text).not.toContain("sk-super-secret-key-12345");
        });
    });
    (0, vitest_1.describe)("Concurrency Control (One Active Run)", () => {
        (0, vitest_1.it)("returns 409 Conflict when another run is already in progress", async () => {
            delayUpstream = true;
            // Start first run (which will be in flight)
            const firstRunPromise = fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: "run-first",
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    apiKey: "sk-secret-concurrency",
                    modelId: "test-model",
                    timeoutMs: 5000,
                }),
            });
            // Small delay to ensure first run is active
            await new Promise((r) => setTimeout(r, 100));
            // Attempt second run concurrently
            const secondRunRes = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: "run-second",
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    apiKey: "sk-secret-concurrency",
                    modelId: "test-model",
                }),
            });
            (0, vitest_1.expect)(secondRunRes.status).toBe(409);
            const json = await secondRunRes.json();
            (0, vitest_1.expect)(json.error.code).toBe("concurrency_limit");
            (0, vitest_1.expect)(json.error.activeRunId).toBe("run-first");
            // Cancel first run to unblock
            await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/run-first/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            });
            const firstRes = await firstRunPromise;
            const text = await firstRes.text();
            (0, vitest_1.expect)(text).toContain("event: canceled");
            delayUpstream = false;
        });
    });
    (0, vitest_1.describe)("Cancellation", () => {
        (0, vitest_1.it)("returns 404 when canceling an inactive or unknown run", async () => {
            const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/non-existent-id/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            });
            (0, vitest_1.expect)(res.status).toBe(404);
            const json = await res.json();
            (0, vitest_1.expect)(json.error.code).toBe("not_found");
        });
        (0, vitest_1.it)("successfully cancels an active run via POST /v1/runs/:id/cancel", async () => {
            delayUpstream = true;
            const runPromise = fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${TEST_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    id: "run-to-cancel",
                    baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
                    apiKey: "sk-secret",
                    modelId: "test-model",
                    timeoutMs: 5000,
                }),
            });
            // Wait 100ms for run to start
            await new Promise((r) => setTimeout(r, 100));
            const cancelRes = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/run-to-cancel/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${TEST_TOKEN}` },
            });
            (0, vitest_1.expect)(cancelRes.status).toBe(200);
            const cancelJson = await cancelRes.json();
            (0, vitest_1.expect)(cancelJson.ok).toBe(true);
            (0, vitest_1.expect)(cancelJson.status).toBe("canceling");
            const runRes = await runPromise;
            const text = await runRes.text();
            (0, vitest_1.expect)(text).toContain("event: canceled");
            delayUpstream = false;
        });
    });
});
//# sourceMappingURL=sidecar.test.js.map