// src/sidecar.ts — Internal Bearer-Auth HTTP API Sidecar
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)

import * as http from "http";
import { randomUUID } from "crypto";
import { runProbes, type RunOptions, type RunReport, type ProbeResult } from "./runner.js";
import { validateUrl, type EgressOptions, EgressError } from "./egress-guard.js";
import { redactSecrets, truncateString, boundError, sanitizeProbeResult, sanitizeReport } from "./redaction.js";

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

export const SIDECAR_VERSION = "0.11.0";
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

    // Required fields
    if (!body.baseUrl || !body.apiKey || !body.modelId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Missing required fields: baseUrl, apiKey, modelId", code: "bad_request" } }));
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

    const runId = body.id || body.runId || randomUUID();
    const abortController = new AbortController();

    this.activeRun = {
      id: runId,
      modelId: body.modelId,
      startedAt: new Date().toISOString(),
      abortController,
    };

    // Gather secrets for redaction
    const secrets: string[] = [
      body.apiKey,
      body.judge?.apiKey,
      body.identityJudge?.apiKey,
      body.embeddingEndpoint?.apiKey,
      this.configuredToken,
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
      const redacted = truncateString(redactSecrets(raw, secrets), 32768);
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
