// src/sidecar.ts — Internal Bearer-Auth HTTP API Sidecar
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)

import * as http from "http";
import { randomUUID } from "crypto";
import { runProbes, type RunOptions, type RunReport, type ProbeResult } from "./runner.js";
import { combineSignals, createSafeFetch, validateUrl, type EgressOptions, EgressError } from "./egress-guard.js";
import { normalizeCustomHeaders, customHeaderSecrets, mergeCustomHeaders, CustomHeadersError } from "./custom-headers.js";
import { redactSecrets, truncateString, boundError, sanitizeProbeResult, sanitizeReport } from "./redaction.js";
import { ORIGINAL_PROBE_SUITE, ORIGINAL_SUITE_IDS } from "./original-suite.js";

export interface SidecarConfig {
  port?: number;
  host?: string;
  bearerToken?: string;
  egressOptions?: EgressOptions;
  maxBodyBytes?: number; // Default: 1MB (1_048_576)
}

export interface ActiveRunState {
  id: string;
  modelId: string;
  startedAt: string;
  abortController: AbortController;
}

export const SIDECAR_VERSION = "0.14.0";
export const SIDECAR_LICENSE = "AGPL-3.0-only";
export const SIDECAR_SOURCE = "https://github.com/achmadsy/LLMprobe-engine";

export class SidecarServer {
  private server: http.Server;
  private activeRun: ActiveRunState | null = null;
  private config: SidecarConfig;
  private configuredToken: string | undefined;

  constructor(config: SidecarConfig = {}) {
    this.config = config;
    this.configuredToken =
      config.bearerToken ??
      process.env.PROBE_SIDECAR_TOKEN ??
      process.env.SIDECAR_TOKEN ??
      process.env.SIDECAR_API_KEY ??
      process.env.BEARER_TOKEN;

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public getActiveRun(): { id: string; modelId: string; startedAt: string } | null {
    if (!this.activeRun) return null;
    return {
      id: this.activeRun.id,
      modelId: this.activeRun.modelId,
      startedAt: this.activeRun.startedAt,
    };
  }

  private authenticate(req: http.IncomingMessage, res: http.ServerResponse): boolean {
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

  private async readBoundedBody(req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number): Promise<string | null> {
    const contentLength = req.headers["content-length"];
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Payload too large (max ${maxBytes} bytes)`, code: "payload_too_large" } }));
      return null;
    }

    return new Promise((resolve) => {
      let totalBytes = 0;
      const chunks: Buffer[] = [];
      let exceeded = false;

      req.on("data", (chunk: Buffer) => {
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

  private handleHealth(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.authenticate(req, res)) return;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "bazaarlink-probe-engine-sidecar",
        version: SIDECAR_VERSION,
        license: SIDECAR_LICENSE,
        source: SIDECAR_SOURCE,
        activeRun: this.getActiveRun(),
      })
    );
  }

  private async readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel("Response body too large");
          throw new Error(`Models response too large (max ${maxBytes} bytes)`);
        }
        chunks.push(value);
      }
    } finally {
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

  private handleProbes(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.authenticate(req, res)) return;

    const probes = ORIGINAL_PROBE_SUITE.map(({ id, label, group, description, optional, isNew, neutral, scoring, prompt, expectedExact, expectedContains, passIfContains }) => ({
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
    res.end(JSON.stringify({ version: SIDECAR_VERSION, probes }));
  }

  private async handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authenticate(req, res)) return;

    const maxBytes = this.config.maxBodyBytes ?? 1_048_576;
    const rawBody = await this.readBoundedBody(req, res, maxBytes);
    if (rawBody === null) return;

    let body: { baseUrl?: unknown; apiKey?: unknown; customHeaders?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
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
    let customHeaders: Record<string, string> | undefined;
    try {
      const normalized = normalizeCustomHeaders(body.customHeaders);
      if (Object.keys(normalized).length > 0) customHeaders = normalized;
    } catch (err) {
      if (!(err instanceof CustomHeadersError)) throw err;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
      return;
    }

    const secrets = [apiKey, this.configuredToken, ...customHeaderSecrets(body.customHeaders)]
      .filter((secret): secret is string => typeof secret === "string" && secret.length > 0);

    try {
      const parsed = validateUrl(baseUrl, this.config.egressOptions);
      const basePath = parsed.pathname.replace(/\/+$/, "");
      parsed.pathname = basePath.endsWith("/models") ? basePath : `${basePath}/models`;
      parsed.search = "";
      parsed.hash = "";

      const headerRecord: Record<string, string> = { "accept": "application/json" };
      if (apiKey) headerRecord["authorization"] = `Bearer ${apiKey}`;
      mergeCustomHeaders(headerRecord, customHeaders);
      const headers = new Headers(headerRecord);
      const safeFetch = createSafeFetch(this.config.egressOptions);
      const response = await safeFetch(parsed, {
        method: "GET",
        headers,
        signal: combineSignals(10_000),
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

      const responseText = await this.readBoundedResponse(response, 1_048_576);
      const payload = JSON.parse(responseText) as unknown;
      const container = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const rawModels = Array.isArray(payload)
        ? payload
        : [container.data, container.models, container.results].find(Array.isArray) ?? [];
      const seen = new Set<string>();
      const models: Array<{ id: string; name?: string }> = [];

      for (const item of rawModels as unknown[]) {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
        const rawId = record?.id ?? record?.model ?? record?.name ?? item;
        const id = typeof rawId === "string" ? rawId.trim() : "";
        if (!id || id.length > 512 || seen.has(id)) continue;
        seen.add(id);
        const rawName = record?.name;
        const name = typeof rawName === "string" ? rawName.trim().slice(0, 512) : "";
        models.push(name && name !== id ? { id, name } : { id });
        if (models.length >= 10_000) break;
      }

      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ models }));
    } catch (err) {
      const status = err instanceof EgressError ? 400 : 502;
      const code = err instanceof EgressError ? "egress_blocked" : "models_fetch_failed";
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: boundError(err, 1000, secrets), code } }));
    }
  }

  private async handleRuns(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authenticate(req, res)) return;

    // Check concurrency: only one active run allowed
    if (this.activeRun !== null) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Another probe run is currently active",
            code: "concurrency_limit",
            activeRunId: this.activeRun.id,
          },
        })
      );
      return;
    }

    const maxBytes = this.config.maxBodyBytes ?? 1_048_576; // 1MB
    const rawBody = await this.readBoundedBody(req, res, maxBytes);
    if (rawBody === null) return;

    let body: (RunOptions & { id?: string; runId?: string });
    try {
      body = JSON.parse(rawBody);
    } catch {
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
    if (typeof body.apiKey !== "string") body.apiKey = "";
    if (body.apiKey.length > 8192 || body.baseUrl.length > 4096) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid baseUrl or apiKey length", code: "bad_request" } }));
      return;
    }

    // Egress verification for target and optional external endpoints
    const egressOpts = this.config.egressOptions;
    try {
      validateUrl(body.baseUrl, egressOpts);
      if (body.judge?.baseUrl) validateUrl(body.judge.baseUrl, egressOpts);
      if (body.identityJudge?.baseUrl) validateUrl(body.identityJudge.baseUrl, egressOpts);
      if (body.embeddingEndpoint?.baseUrl) validateUrl(body.embeddingEndpoint.baseUrl, egressOpts);
    } catch (e) {
      const egressErr = e as EgressError;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Egress blocked: ${egressErr.message}`, code: "egress_blocked" } }));
      return;
    }

    // User-supplied additional headers: validate target and judge sets
    // independently before the run starts (400 with exact validator message).
    let targetCustomHeaders: Record<string, string> | undefined;
    let judgeCustomHeaders: Record<string, string> | undefined;
    try {
      const normalizedTarget = normalizeCustomHeaders(body.customHeaders);
      if (Object.keys(normalizedTarget).length > 0) targetCustomHeaders = normalizedTarget;
    } catch (err) {
      if (!(err instanceof CustomHeadersError)) throw err;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
      return;
    }
    try {
      const normalizedJudge = normalizeCustomHeaders(body.judge?.customHeaders);
      if (Object.keys(normalizedJudge).length > 0) judgeCustomHeaders = normalizedJudge;
    } catch (err) {
      if (!(err instanceof CustomHeadersError)) throw err;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message, code: "bad_request" } }));
      return;
    }

    const runId = body.id || body.runId || randomUUID();
    const abortController = new AbortController();

    this.activeRun = {
      id: runId,
      modelId: body.modelId,
      startedAt: new Date().toISOString(),
      abortController,
    };

    // Gather secrets for redaction (including custom header values)
    const secrets: string[] = [
      body.apiKey,
      body.judge?.apiKey,
      body.identityJudge?.apiKey,
      body.embeddingEndpoint?.apiKey,
      this.configuredToken,
      ...customHeaderSecrets(body.customHeaders),
      ...customHeaderSecrets(body.judge?.customHeaders),
    ].filter((s): s is string => typeof s === "string" && s.length > 0);

    // Setup SSE response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let finished = false;

    const sendSse = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      const raw = typeof data === "string" ? data : JSON.stringify(data);
      // The complete event carries the full sanitized report (identity
      // assessment included); truncating it corrupts the JSON and silently
      // destroys the verdict on the consumer. Everything is redacted, and
      // per-result payloads are bounded upstream, so only debug-sized raw
      // strings get the 32 KiB cap.
      const redacted = event === "complete"
        ? redactSecrets(raw, secrets)
        : truncateString(redactSecrets(raw, secrets), 32768);
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
      const report = await runProbes({
        ...body,
        // Public sidecar runs always use the server-authoritative original
        // 86-probe contract. Never trust a caller-supplied selector here.
        probeIds: [...ORIGINAL_SUITE_IDS],
        // Pass validated maps explicitly: the raw body spread may carry
        // unvalidated row arrays that the runner would not honor.
        customHeaders: targetCustomHeaders,
        judge: body.judge ? { ...body.judge, customHeaders: judgeCustomHeaders } : undefined,
        signal: abortController.signal,
        egressOptions: egressOpts,
        onProgress: (result: ProbeResult, index: number, total: number) => {
          sendSse("progress", {
            runId,
            index,
            total,
            result: sanitizeProbeResult(result, secrets),
          });
        },
      });

      if (abortController.signal.aborted) {
        sendSse("canceled", { runId, reason: abortController.signal.reason || "Canceled" });
      } else {
        sendSse("complete", { runId, report: sanitizeReport(report, secrets) });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        sendSse("canceled", { runId, reason: abortController.signal.reason || "Canceled" });
      } else {
        sendSse("error", { runId, error: boundError(err, 1000, secrets) });
      }
    } finally {
      finished = true;
      if (this.activeRun?.id === runId) {
        this.activeRun = null;
      }
      res.end();
    }
  }

  private handleCancel(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
    if (!this.authenticate(req, res)) return;

    if (!this.activeRun || this.activeRun.id !== id) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Run '${id}' not found or not active`, code: "not_found" } }));
      return;
    }

    this.activeRun.abortController.abort("Canceled via API");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, runId: id, status: "canceling" }));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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

  public listen(port?: number, host?: string): Promise<{ port: number; host: string }> {
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

  public close(): Promise<void> {
    if (this.activeRun) {
      this.activeRun.abortController.abort("Server closing");
      this.activeRun = null;
    }
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

export function createSidecarServer(config?: SidecarConfig): SidecarServer {
  return new SidecarServer(config);
}
