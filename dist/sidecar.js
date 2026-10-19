"use strict";
// src/sidecar.ts — Internal Bearer-Auth HTTP API Sidecar
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
exports.SidecarServer = exports.SIDECAR_SOURCE = exports.SIDECAR_LICENSE = exports.SIDECAR_VERSION = void 0;
exports.createSidecarServer = createSidecarServer;
const http = __importStar(require("http"));
const crypto_1 = require("crypto");
const runner_js_1 = require("./runner.js");
const egress_guard_js_1 = require("./egress-guard.js");
const redaction_js_1 = require("./redaction.js");
exports.SIDECAR_VERSION = "0.11.0";
exports.SIDECAR_LICENSE = "AGPL-3.0-only";
exports.SIDECAR_SOURCE = "https://github.com/achmadsy/LLMprobe-engine";
class SidecarServer {
    constructor(config = {}) {
        this.activeRun = null;
        this.config = config;
        this.configuredToken =
            config.bearerToken ??
                process.env.PROBE_SIDECAR_TOKEN ??
                process.env.SIDECAR_TOKEN ??
                process.env.SIDECAR_API_KEY ??
                process.env.BEARER_TOKEN;
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
    }
    getActiveRun() {
        if (!this.activeRun)
            return null;
        return {
            id: this.activeRun.id,
            modelId: this.activeRun.modelId,
            startedAt: this.activeRun.startedAt,
        };
    }
    authenticate(req, res) {
        const authHeader = req.headers.authorization;
        if (this.configuredToken) {
            if (!authHeader || authHeader !== `Bearer ${this.configuredToken}`) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: { message: "Unauthorized: Invalid or missing bearer token", type: "auth_error" } }));
                return false;
            }
            return true;
        }
        // If no specific token configured in env/config, require a non-empty Bearer token
        if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7).trim().length === 0) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Unauthorized: Bearer token required", type: "auth_error" } }));
            return false;
        }
        return true;
    }
    async readBoundedBody(req, res, maxBytes) {
        const contentLength = req.headers["content-length"];
        if (contentLength && parseInt(contentLength, 10) > maxBytes) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: `Payload too large (max ${maxBytes} bytes)`, code: "payload_too_large" } }));
            return null;
        }
        return new Promise((resolve) => {
            let totalBytes = 0;
            const chunks = [];
            let exceeded = false;
            req.on("data", (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    exceeded = true;
                    req.destroy();
                    res.writeHead(413, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: { message: `Payload too large (max ${maxBytes} bytes)`, code: "payload_too_large" } }));
                    resolve(null);
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", () => {
                if (!exceeded) {
                    resolve(Buffer.concat(chunks).toString("utf-8"));
                }
            });
            req.on("error", () => {
                if (!exceeded) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: { message: "Error reading request body", code: "bad_request" } }));
                    resolve(null);
                }
            });
        });
    }
    handleHealth(req, res) {
        if (!this.authenticate(req, res))
            return;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            service: "bazaarlink-probe-engine-sidecar",
            version: exports.SIDECAR_VERSION,
            license: exports.SIDECAR_LICENSE,
            source: exports.SIDECAR_SOURCE,
            activeRun: this.getActiveRun(),
        }));
    }
    async handleRuns(req, res) {
        if (!this.authenticate(req, res))
            return;
        // Check concurrency: only one active run allowed
        if (this.activeRun !== null) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                error: {
                    message: "Another probe run is currently active",
                    code: "concurrency_limit",
                    activeRunId: this.activeRun.id,
                },
            }));
            return;
        }
        const maxBytes = this.config.maxBodyBytes ?? 1048576; // 1MB
        const rawBody = await this.readBoundedBody(req, res, maxBytes);
        if (rawBody === null)
            return;
        let body;
        try {
            body = JSON.parse(rawBody);
        }
        catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Invalid JSON request body", code: "bad_request" } }));
            return;
        }
        // Required fields
        if (!body.baseUrl || !body.apiKey || !body.modelId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Missing required fields: baseUrl, apiKey, modelId", code: "bad_request" } }));
            return;
        }
        // Egress verification for target and optional external endpoints
        const egressOpts = this.config.egressOptions;
        try {
            (0, egress_guard_js_1.validateUrl)(body.baseUrl, egressOpts);
            if (body.judge?.baseUrl)
                (0, egress_guard_js_1.validateUrl)(body.judge.baseUrl, egressOpts);
            if (body.identityJudge?.baseUrl)
                (0, egress_guard_js_1.validateUrl)(body.identityJudge.baseUrl, egressOpts);
            if (body.embeddingEndpoint?.baseUrl)
                (0, egress_guard_js_1.validateUrl)(body.embeddingEndpoint.baseUrl, egressOpts);
        }
        catch (e) {
            const egressErr = e;
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: `Egress blocked: ${egressErr.message}`, code: "egress_blocked" } }));
            return;
        }
        const runId = body.id || body.runId || (0, crypto_1.randomUUID)();
        const abortController = new AbortController();
        this.activeRun = {
            id: runId,
            modelId: body.modelId,
            startedAt: new Date().toISOString(),
            abortController,
        };
        // Gather secrets for redaction
        const secrets = [
            body.apiKey,
            body.judge?.apiKey,
            body.identityJudge?.apiKey,
            body.embeddingEndpoint?.apiKey,
            this.configuredToken,
        ].filter((s) => typeof s === "string" && s.length > 0);
        // Setup SSE response
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        });
        let finished = false;
        const sendSse = (event, data) => {
            if (res.writableEnded)
                return;
            const raw = typeof data === "string" ? data : JSON.stringify(data);
            const redacted = (0, redaction_js_1.truncateString)((0, redaction_js_1.redactSecrets)(raw, secrets), 32768);
            res.write(`event: ${event}\ndata: ${redacted}\n\n`);
        };
        // Abort if client drops HTTP connection
        req.on("close", () => {
            if (!finished && !abortController.signal.aborted) {
                abortController.abort("Client disconnected");
            }
        });
        sendSse("start", { runId, modelId: body.modelId, startedAt: this.activeRun.startedAt });
        try {
            const report = await (0, runner_js_1.runProbes)({
                ...body,
                signal: abortController.signal,
                egressOptions: egressOpts,
                onProgress: (result, index, total) => {
                    sendSse("progress", {
                        runId,
                        index,
                        total,
                        result: (0, redaction_js_1.sanitizeProbeResult)(result, secrets),
                    });
                },
            });
            if (abortController.signal.aborted) {
                sendSse("canceled", { runId, reason: abortController.signal.reason || "Canceled" });
            }
            else {
                sendSse("complete", { runId, report: (0, redaction_js_1.sanitizeReport)(report, secrets) });
            }
        }
        catch (err) {
            if (abortController.signal.aborted) {
                sendSse("canceled", { runId, reason: abortController.signal.reason || "Canceled" });
            }
            else {
                sendSse("error", { runId, error: (0, redaction_js_1.boundError)(err, 1000, secrets) });
            }
        }
        finally {
            finished = true;
            if (this.activeRun?.id === runId) {
                this.activeRun = null;
            }
            res.end();
        }
    }
    handleCancel(req, res, id) {
        if (!this.authenticate(req, res))
            return;
        if (!this.activeRun || this.activeRun.id !== id) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: `Run '${id}' not found or not active`, code: "not_found" } }));
            return;
        }
        this.activeRun.abortController.abort("Canceled via API");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, runId: id, status: "canceling" }));
    }
    handleRequest(req, res) {
        const rawUrl = req.url ?? "/";
        const [path] = rawUrl.split("?");
        if (req.method === "GET" && (path === "/health" || path === "/_probe_health")) {
            this.handleHealth(req, res);
            return;
        }
        if (req.method === "POST" && path === "/v1/runs") {
            this.handleRuns(req, res).catch(() => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: { message: "Internal server error", code: "server_error" } }));
                }
            });
            return;
        }
        const cancelMatch = path.match(/^\/v1\/runs\/([^/]+)\/cancel$/);
        if (req.method === "POST" && cancelMatch) {
            const runId = cancelMatch[1];
            this.handleCancel(req, res, runId);
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `Route '${req.method} ${path}' not found`, code: "not_found" } }));
    }
    listen(port, host) {
        const listenPort = port ?? this.config.port ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : 3001);
        const listenHost = host ?? this.config.host ?? process.env.HOST ?? "0.0.0.0";
        return new Promise((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(listenPort, listenHost, () => {
                this.server.removeListener("error", reject);
                const addr = this.server.address();
                const actualPort = typeof addr === "object" && addr ? addr.port : listenPort;
                resolve({ port: actualPort, host: listenHost });
            });
        });
    }
    close() {
        if (this.activeRun) {
            this.activeRun.abortController.abort("Server closing");
            this.activeRun = null;
        }
        return new Promise((resolve, reject) => {
            this.server.close((err) => (err ? reject(err) : resolve()));
        });
    }
}
exports.SidecarServer = SidecarServer;
function createSidecarServer(config) {
    return new SidecarServer(config);
}
//# sourceMappingURL=sidecar.js.map