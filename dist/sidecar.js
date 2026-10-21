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
const custom_headers_js_1 = require("./custom-headers.js");
const redaction_js_1 = require("./redaction.js");
const original_suite_js_1 = require("./original-suite.js");
exports.SIDECAR_VERSION = "0.14.0";
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
    async readBoundedResponse(response, maxBytes) {
        if (!response.body)
            return "";
        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                totalBytes += value.byteLength;
                if (totalBytes > maxBytes) {
                    await reader.cancel("Response body too large");
                    throw new Error(`Models response too large (max ${maxBytes} bytes)`);
                }
                chunks.push(value);
            }
        }
        finally {
            reader.releaseLock();
        }
        const body = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return new TextDecoder().decode(body);
    }
    handleProbes(req, res) {
        if (!this.authenticate(req, res))
            return;
        const probes = original_suite_js_1.ORIGINAL_PROBE_SUITE.map(({ id, label, group, description, optional, isNew, neutral, scoring, prompt, expectedExact, expectedContains, passIfContains }) => ({
            id,
            label,
            group,
            description,
            scoring,
            // Bounded question/reference text for the detail drawer (About/Question/Expected).
            prompt: prompt?.slice(0, 500) ?? null,
            expected: expectedExact ?? expectedContains
                ?? (passIfContains?.length ? passIfContains.join(" | ") : null),
            ...(optional ? { optional: true } : {}),
            ...(isNew ? { isNew: true } : {}),
            ...(neutral ? { neutral: true } : {}),
        }));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ version: exports.SIDECAR_VERSION, probes }));
    }
    async handleModels(req, res) {
        if (!this.authenticate(req, res))
            return;
        const maxBytes = this.config.maxBodyBytes ?? 1048576;
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
        const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
        if (!baseUrl || baseUrl.length > 4096 || apiKey.length > 8192) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Invalid baseUrl or apiKey", code: "bad_request" } }));
            return;
        }
        // User-supplied additional headers: validate before anything else runs
        let customHeaders;
        try {
            const normalized = (0, custom_headers_js_1.normalizeCustomHeaders)(body.customHeaders);
            if (Object.keys(normalized).length > 0)
                customHeaders = normalized;
        }
        catch (err) {
            if (!(err instanceof custom_headers_js_1.CustomHeadersError))
                throw err;
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
            return;
        }
        const secrets = [apiKey, this.configuredToken, ...(0, custom_headers_js_1.customHeaderSecrets)(body.customHeaders)]
            .filter((secret) => typeof secret === "string" && secret.length > 0);
        try {
            const parsed = (0, egress_guard_js_1.validateUrl)(baseUrl, this.config.egressOptions);
            const basePath = parsed.pathname.replace(/\/+$/, "");
            parsed.pathname = basePath.endsWith("/models") ? basePath : `${basePath}/models`;
            parsed.search = "";
            parsed.hash = "";
            const headerRecord = { "accept": "application/json" };
            if (apiKey)
                headerRecord["authorization"] = `Bearer ${apiKey}`;
            (0, custom_headers_js_1.mergeCustomHeaders)(headerRecord, customHeaders);
            const headers = new Headers(headerRecord);
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)(this.config.egressOptions);
            const response = await safeFetch(parsed, {
                method: "GET",
                headers,
                signal: (0, egress_guard_js_1.combineSignals)(10000),
            });
            if (!response.ok) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: {
                        message: `Upstream models endpoint returned HTTP ${response.status}`,
                        code: "upstream_error",
                    },
                }));
                return;
            }
            const responseText = await this.readBoundedResponse(response, 1048576);
            const payload = JSON.parse(responseText);
            const container = payload && typeof payload === "object" ? payload : {};
            const rawModels = Array.isArray(payload)
                ? payload
                : [container.data, container.models, container.results].find(Array.isArray) ?? [];
            const seen = new Set();
            const models = [];
            for (const item of rawModels) {
                const record = item && typeof item === "object" ? item : null;
                const rawId = record?.id ?? record?.model ?? record?.name ?? item;
                const id = typeof rawId === "string" ? rawId.trim() : "";
                if (!id || id.length > 512 || seen.has(id))
                    continue;
                seen.add(id);
                const rawName = record?.name;
                const name = typeof rawName === "string" ? rawName.trim().slice(0, 512) : "";
                models.push(name && name !== id ? { id, name } : { id });
                if (models.length >= 10000)
                    break;
            }
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ models }));
        }
        catch (err) {
            const status = err instanceof egress_guard_js_1.EgressError ? 400 : 502;
            const code = err instanceof egress_guard_js_1.EgressError ? "egress_blocked" : "models_fetch_failed";
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: (0, redaction_js_1.boundError)(err, 1000, secrets), code } }));
        }
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
        // Required fields — apiKey may be omitted for endpoints that require no auth
        if (!body.baseUrl || !body.modelId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Missing required fields: baseUrl, modelId", code: "bad_request" } }));
            return;
        }
        if (typeof body.apiKey !== "string")
            body.apiKey = "";
        if (body.apiKey.length > 8192 || body.baseUrl.length > 4096) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Invalid baseUrl or apiKey length", code: "bad_request" } }));
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
        // User-supplied additional headers: validate target and judge sets
        // independently before the run starts (400 with exact validator message).
        let targetCustomHeaders;
        let judgeCustomHeaders;
        try {
            const normalizedTarget = (0, custom_headers_js_1.normalizeCustomHeaders)(body.customHeaders);
            if (Object.keys(normalizedTarget).length > 0)
                targetCustomHeaders = normalizedTarget;
        }
        catch (err) {
            if (!(err instanceof custom_headers_js_1.CustomHeadersError))
                throw err;
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
            return;
        }
        try {
            const normalizedJudge = (0, custom_headers_js_1.normalizeCustomHeaders)(body.judge?.customHeaders);
            if (Object.keys(normalizedJudge).length > 0)
                judgeCustomHeaders = normalizedJudge;
        }
        catch (err) {
            if (!(err instanceof custom_headers_js_1.CustomHeadersError))
                throw err;
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
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
        // Gather secrets for redaction (including custom header values)
        const secrets = [
            body.apiKey,
            body.judge?.apiKey,
            body.identityJudge?.apiKey,
            body.embeddingEndpoint?.apiKey,
            this.configuredToken,
            ...(0, custom_headers_js_1.customHeaderSecrets)(body.customHeaders),
            ...(0, custom_headers_js_1.customHeaderSecrets)(body.judge?.customHeaders),
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
            // The complete event carries the full sanitized report (identity
            // assessment included); truncating it corrupts the JSON and silently
            // destroys the verdict on the consumer. Everything is redacted, and
            // per-result payloads are bounded upstream, so only debug-sized raw
            // strings get the 32 KiB cap.
            const redacted = event === "complete"
                ? (0, redaction_js_1.redactSecrets)(raw, secrets)
                : (0, redaction_js_1.truncateString)((0, redaction_js_1.redactSecrets)(raw, secrets), 32768);
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
                // Public sidecar runs always use the server-authoritative original
                // 86-probe contract. Never trust a caller-supplied selector here.
                probeIds: [...original_suite_js_1.ORIGINAL_SUITE_IDS],
                // Pass validated maps explicitly: the raw body spread may carry
                // unvalidated row arrays that the runner would not honor.
                customHeaders: targetCustomHeaders,
                judge: body.judge ? { ...body.judge, customHeaders: judgeCustomHeaders } : undefined,
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
        if (req.method === "GET" && path === "/v1/probes") {
            this.handleProbes(req, res);
            return;
        }
        if (req.method === "POST" && path === "/v1/models") {
            this.handleModels(req, res).catch(() => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: { message: "Internal server error", code: "server_error" } }));
                }
            });
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