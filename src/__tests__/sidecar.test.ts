// src/__tests__/sidecar.test.ts — Tests for sidecar API (auth, SSE, cancel, concurrency, redaction)
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { createSidecarServer, SidecarServer, SIDECAR_VERSION, SIDECAR_LICENSE, SIDECAR_SOURCE } from "../sidecar.js";
import { redactSecrets, truncateString, boundError } from "../redaction.js";

describe("BazaarLink Probe Engine Sidecar API", () => {
  const TEST_TOKEN = "secret-sidecar-token-12345";
  let sidecar: SidecarServer;
  let sidecarPort: number;

  let mockUpstream: http.Server;
  let mockUpstreamPort: number;
  let delayUpstream = false;
  let modelsAuthorization: string | undefined;

  beforeAll(async () => {
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
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          const bodyStr = Buffer.concat(chunks).toString("utf-8");
          let body: { stream?: boolean } = {};
          try {
            body = JSON.parse(bodyStr);
          } catch { /* ok */ }

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
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { content: "probe test response" } }] }));
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      mockUpstream.listen(0, "127.0.0.1", () => {
        const addr = mockUpstream.address() as { port: number };
        mockUpstreamPort = addr.port;
        resolve();
      });
    });

    // 2. Start sidecar server
    sidecar = createSidecarServer({
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

  afterAll(async () => {
    await sidecar.close();
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
  });

  describe("Authentication", () => {
    it("rejects GET /health with 401 when Authorization header is missing", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toContain("Unauthorized");
    });

    it("rejects GET /health with 401 when Bearer token is invalid", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects GET /health with 401 when scheme is not Bearer", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(res.status).toBe(401);
    });

    it("accepts GET /health with 200 and AGPL metadata when Bearer token is valid", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const json = await res.json() as {
        status: string;
        service: string;
        version: string;
        license: string;
        source: string;
      };
      expect(json.status).toBe("ok");
      expect(json.service).toBe("bazaarlink-probe-engine-sidecar");
      expect(json.version).toBe(SIDECAR_VERSION);
      expect(json.license).toBe(SIDECAR_LICENSE);
      expect(json.source).toBe(SIDECAR_SOURCE);
    });

    it("rejects GET /v1/probes with 401 when unauthenticated", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/probes`);
      expect(res.status).toBe(401);
    });

    it("rejects POST /v1/models with 401 when unauthenticated", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "https://api.openai.com/v1" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects POST /v1/runs with 401 when unauthenticated", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: "https://api.openai.com/v1" }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects POST /v1/runs/:id/cancel with 401 when unauthenticated", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/test-123/cancel`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Probe Catalog", () => {
    it("returns the authoritative probe suite without prompts or scoring rules", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/probes`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as {
        version: string;
        probes: Array<Record<string, unknown>>;
      };
      expect(json.version).toBe(SIDECAR_VERSION);
      expect(json.probes.length).toBeGreaterThan(0);
      expect(json.probes[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        label: expect.any(String),
        group: expect.any(String),
        description: expect.any(String),
      }));
      expect(json.probes[0]).not.toHaveProperty("prompt");
      expect(json.probes[0]).not.toHaveProperty("scoring");
    });
  });

  describe("Model Discovery", () => {
    it("fetches, normalizes, and deduplicates OpenAI-compatible models", async () => {
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

      expect(res.status).toBe(200);
      expect(modelsAuthorization).toBe("Bearer sk-model-catalog-secret");
      expect(await res.json()).toEqual({
        models: [{ id: "model-a", name: "Model A" }, { id: "model-b" }],
      });
    });

    it("blocks private model endpoints under strict egress policy", async () => {
      const strictSidecar = createSidecarServer({
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
        expect(res.status).toBe(400);
        const json = await res.json() as { error: { code: string } };
        expect(json.error.code).toBe("egress_blocked");
      } finally {
        await strictSidecar.close();
      }
    });
  });

  describe("Bounded Request Body", () => {
    it("returns 413 Payload Too Large when request body exceeds maxBodyBytes", async () => {
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

      expect(res.status).toBe(413);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe("payload_too_large");
    });

    it("accepts keyless runs against endpoints that do not require auth", async () => {
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

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("event: start");
    });

    it("rejects oversized apiKey values", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: `http://127.0.0.1:${mockUpstreamPort}`,
          apiKey: "k".repeat(10_000),
          modelId: "test-model",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("Secret Redaction", () => {
    it("redacts explicit secrets and common token patterns", () => {
      const raw = "Error calling https://api.openai.com with Bearer secret-token-abc and sk-proj-1234567890abcdef";
      const redacted = redactSecrets(raw, ["secret-token-abc", "sk-proj-1234567890abcdef"]);
      expect(redacted).not.toContain("secret-token-abc");
      expect(redacted).not.toContain("sk-proj-1234567890abcdef");
      expect(redacted).toContain("[REDACTED]");
    });

    it("redacts URL basic auth credentials", () => {
      const raw = "Failed to connect to https://alice:supersecret@api.example.com/v1";
      const redacted = redactSecrets(raw);
      expect(redacted).not.toContain("alice");
      expect(redacted).not.toContain("supersecret");
      expect(redacted).toBe("Failed to connect to https://[REDACTED]:[REDACTED]@api.example.com/v1");
    });

    it("truncates long strings cleanly", () => {
      const long = "A".repeat(50);
      expect(truncateString(long, 20)).toBe("AAAAAAAAAAAAAAAAAAAA…[truncated]");
    });

    it("bounds and redacts error objects", () => {
      const err = new Error("Connection failed with Bearer secret-tok-123456");
      const bounded = boundError(err, 50, ["secret-tok-123456"]);
      expect(bounded).not.toContain("secret-tok-123456");
      expect(bounded.length).toBeLessThanOrEqual(65);
    });
  });

  describe("SSE Streaming & Run Lifecycle", () => {
    it("streams start, progress, and complete events over SSE", async () => {
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

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      expect(text).toContain("event: start");
      expect(text).toContain("event: progress");
      expect(text).toContain("event: complete");

      // Verify that the secret apiKey was NOT leaked into the SSE stream
      expect(text).not.toContain("sk-super-secret-key-12345");
    });
  });

  describe("Concurrency Control (One Active Run)", () => {
    it("returns 409 Conflict when another run is already in progress", async () => {
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

      expect(secondRunRes.status).toBe(409);
      const json = await secondRunRes.json() as { error: { code: string; activeRunId: string } };
      expect(json.error.code).toBe("concurrency_limit");
      expect(json.error.activeRunId).toBe("run-first");

      // Cancel first run to unblock
      await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/run-first/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });

      const firstRes = await firstRunPromise;
      const text = await firstRes.text();
      expect(text).toContain("event: canceled");

      delayUpstream = false;
    });
  });

  describe("Cancellation", () => {
    it("returns 404 when canceling an inactive or unknown run", async () => {
      const res = await fetch(`http://127.0.0.1:${sidecarPort}/v1/runs/non-existent-id/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.status).toBe(404);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe("not_found");
    });

    it("successfully cancels an active run via POST /v1/runs/:id/cancel", async () => {
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

      expect(cancelRes.status).toBe(200);
      const cancelJson = await cancelRes.json() as { ok: boolean; status: string };
      expect(cancelJson.ok).toBe(true);
      expect(cancelJson.status).toBe("canceling");

      const runRes = await runPromise;
      const text = await runRes.text();
      expect(text).toContain("event: canceled");

      delayUpstream = false;
    });
  });
});
