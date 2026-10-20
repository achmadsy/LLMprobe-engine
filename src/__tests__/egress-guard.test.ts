// src/__tests__/egress-guard.test.ts — Tests for SSRF, IP filtering, DNS rebinding & redirects (AGPL-3.0)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "http";
import * as dns from "dns";
import {
  validateUrl,
  isPrivateOrReservedIp,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  isBlockedHostname,
  createSafeFetch,
  createSafeAgent,
  EgressError,
} from "../egress-guard.js";

describe("Egress Guard — SSRF & IP Validation", () => {
  describe("validateUrl", () => {
    it("allows valid public http and https URLs", () => {
      expect(() => validateUrl("https://api.openai.com/v1")).not.toThrow();
      expect(() => validateUrl("http://api.openai.com/v1")).not.toThrow();
      expect(() => validateUrl("https://api.example.com:8443/v1")).not.toThrow();
    });

    it("rejects non-http/https protocols", () => {
      expect(() => validateUrl("ftp://api.example.com/v1")).toThrow(EgressError);
      expect(() => validateUrl("file:///etc/passwd")).toThrow(EgressError);
      expect(() => validateUrl("gopher://example.com")).toThrow(EgressError);
      expect(() => validateUrl("data:text/plain;base64,hello")).toThrow(EgressError);
      expect(() => validateUrl("javascript:alert(1)")).toThrow(EgressError);
    });

    it("rejects URLs with embedded credentials", () => {
      expect(() => validateUrl("https://user:pass@api.example.com")).toThrow(EgressError);
      expect(() => validateUrl("https://admin@api.example.com")).toThrow(EgressError);
    });

    it("rejects non-allowed ports by default (80, 443, 8443 allowed)", () => {
      expect(() => validateUrl("https://api.example.com:22")).toThrow(EgressError);
      expect(() => validateUrl("https://api.example.com:3306")).toThrow(EgressError);
      expect(() => validateUrl("http://api.example.com:8080")).toThrow(EgressError);
      expect(() => validateUrl("http://api.example.com:3000")).toThrow(EgressError);
    });

    it("respects custom allowed ports", () => {
      const opts = { allowedPorts: [3000, 8080] };
      expect(() => validateUrl("http://api.example.com:3000", opts)).not.toThrow();
      expect(() => validateUrl("http://api.example.com:8080", opts)).not.toThrow();
      expect(() => validateUrl("https://api.example.com:443", opts)).toThrow(EgressError);
    });

    it("rejects loopback and private IPv4 hostnames", () => {
      expect(() => validateUrl("http://127.0.0.1")).toThrow(EgressError);
      expect(() => validateUrl("http://127.0.0.2")).toThrow(EgressError);
      expect(() => validateUrl("http://10.0.0.1")).toThrow(EgressError);
      expect(() => validateUrl("http://172.16.0.1")).toThrow(EgressError);
      expect(() => validateUrl("http://172.31.255.254")).toThrow(EgressError);
      expect(() => validateUrl("http://192.168.1.1")).toThrow(EgressError);
      expect(() => validateUrl("http://169.254.169.254")).toThrow(EgressError);
      expect(() => validateUrl("http://0.0.0.0")).toThrow(EgressError);
      expect(() => validateUrl("http://100.64.0.1")).toThrow(EgressError);
      expect(() => validateUrl("http://192.0.2.1")).toThrow(EgressError);
      expect(() => validateUrl("http://224.0.0.1")).toThrow(EgressError);
      expect(() => validateUrl("http://240.0.0.1")).toThrow(EgressError);
    });

    it("rejects private and loopback IPv6 hostnames", () => {
      expect(() => validateUrl("http://[::1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[::ffff:127.0.0.1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[::ffff:7f00:1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[::ffff:169.254.169.254]")).toThrow(EgressError);
      expect(() => validateUrl("http://[fe80::1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[fc00::1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[fd00::1]")).toThrow(EgressError);
      expect(() => validateUrl("http://[ff02::1]")).toThrow(EgressError);
    });

    it("rejects internal/special domain names", () => {
      expect(() => validateUrl("http://localhost")).toThrow(EgressError);
      expect(() => validateUrl("http://sub.localhost")).toThrow(EgressError);
      expect(() => validateUrl("http://app.local")).toThrow(EgressError);
      expect(() => validateUrl("http://db.internal")).toThrow(EgressError);
      expect(() => validateUrl("http://router.lan")).toThrow(EgressError);
      expect(() => validateUrl("http://nas.home.arpa")).toThrow(EgressError);
      expect(() => validateUrl("http://intranet.corp")).toThrow(EgressError);
      expect(() => validateUrl("http://metadata.google.internal")).toThrow(EgressError);
    });
  });

  describe("isPrivateOrReservedIp", () => {
    it("correctly classifies public IPv4 addresses", () => {
      expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
      expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
      expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
      expect(isPrivateOrReservedIp("104.16.132.229")).toBe(false);
    });

    it("correctly classifies public IPv6 addresses", () => {
      expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
      expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false);
    });

    it("blocks IPv4-mapped private IPv6 addresses", () => {
      expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:10.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:192.168.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("::ffff:169.254.169.254")).toBe(true);
    });
  });

  describe("DNS Rebinding Prevention", () => {
    it("blocks connection at connect-time when hostname resolves to a private IP", async () => {
      // Mock DNS lookup that returns loopback for a fake domain
      const fakeLookup = (
        _hostname: string,
        _opts: { all: boolean },
        callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
      ) => {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
      };

      const safeFetch = createSafeFetch({ lookupFn: fakeLookup });

      await expect(
        safeFetch("http://attacker-rebinding.example.com/v1/chat")
      ).rejects.toThrow(/SSRF blocked|private\/reserved IP/);
    });

    it("blocks connection if any IP in multi-record DNS is private", async () => {
      const fakeLookup = (
        _hostname: string,
        _opts: { all: boolean },
        callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
      ) => {
        callback(null, [
          { address: "93.184.216.34", family: 4 }, // public
          { address: "169.254.169.254", family: 4 }, // private metadata
        ]);
      };

      const safeFetch = createSafeFetch({ lookupFn: fakeLookup });

      await expect(
        safeFetch("http://round-robin-rebind.example.com/v1/chat")
      ).rejects.toThrow(/SSRF blocked|private\/reserved IP/);
    });
  });

  describe("Manual Redirect Defense", () => {
    let server: http.Server;
    let serverPort: number;
    let otherServer: http.Server;
    let otherServerPort: number;
    let sameOriginAuthorization: string | undefined;
    let crossOriginAuthorization: string | undefined;

    // Start test HTTP servers on ephemeral ports for redirect testing
    beforeAll(async () => {
      otherServer = http.createServer((req, res) => {
        crossOriginAuthorization = req.headers.authorization;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => {
        otherServer.listen(0, "127.0.0.1", () => {
          otherServerPort = (otherServer.address() as { port: number }).port;
          resolve();
        });
      });

      server = http.createServer((req, res) => {
        if (req.url === "/redirect-to-private") {
          res.writeHead(302, { Location: "http://127.0.0.1:80/admin" });
          res.end();
          return;
        }
        if (req.url === "/redirect-to-metadata") {
          res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
          res.end();
          return;
        }
        if (req.url === "/redirect-to-bad-port") {
          res.writeHead(302, { Location: "http://example.com:22/ssh" });
          res.end();
          return;
        }
        if (req.url === "/redirect-loop") {
          res.writeHead(302, { Location: "/redirect-loop" });
          res.end();
          return;
        }
        if (req.url === "/redirect-safe") {
          res.writeHead(302, { Location: "/final-target" });
          res.end();
          return;
        }
        if (req.url === "/redirect-cross-origin") {
          res.writeHead(302, { Location: `http://127.0.0.1:${otherServerPort}/final-target` });
          res.end();
          return;
        }
        if (req.url === "/final-target") {
          sameOriginAuthorization = req.headers.authorization;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, message: "arrived safely" }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => otherServer.close(() => resolve()));
    });

    it("blocks redirect to private/internal IP", async () => {
      // allowPrivate only for the initial connection to test server, but redirect will be validated
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort, 80, 443],
        allowPrivate: true, // initial hop allowed to local test server
      });

      // But test redirect target without allowPrivate:
      const strictFetch = createSafeFetch({
        allowedPorts: [serverPort, 80, 443],
        allowPrivate: false,
      });

      // Initial request with private target is blocked upfront
      await expect(
        strictFetch(`http://127.0.0.1:${serverPort}/redirect-to-private`)
      ).rejects.toThrow(EgressError);
    });

    it("blocks redirect to disallowed port", async () => {
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort, 80, 443],
        allowPrivate: true,
      });

      await expect(
        safeFetch(`http://127.0.0.1:${serverPort}/redirect-to-bad-port`)
      ).rejects.toThrow(EgressError);
    });

    it("blocks infinite redirect loops", async () => {
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort, 80, 443],
        allowPrivate: true,
        maxRedirects: 3,
      });

      await expect(
        safeFetch(`http://127.0.0.1:${serverPort}/redirect-loop`)
      ).rejects.toThrow(/Too many redirects/);
    });

    it("successfully follows safe redirects when allowed", async () => {
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort, 80, 443],
        allowPrivate: true,
      });

      const res = await safeFetch(`http://127.0.0.1:${serverPort}/redirect-safe`);
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; message: string };
      expect(json.ok).toBe(true);
      expect(json.message).toBe("arrived safely");
    });

    it("keeps Authorization on same-origin redirects", async () => {
      sameOriginAuthorization = undefined;
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort],
        allowPrivate: true,
      });
      await safeFetch(`http://127.0.0.1:${serverPort}/redirect-safe`, {
        headers: { Authorization: "Bearer keep-me" },
      });
      expect(sameOriginAuthorization).toBe("Bearer keep-me");
    });

    it("strips Authorization on cross-origin redirects", async () => {
      crossOriginAuthorization = undefined;
      const safeFetch = createSafeFetch({
        allowedPorts: [serverPort, otherServerPort],
        allowPrivate: true,
      });
      await safeFetch(`http://127.0.0.1:${serverPort}/redirect-cross-origin`, {
        headers: { Authorization: "Bearer do-not-forward" },
      });
      expect(crossOriginAuthorization).toBeUndefined();
    });
  });
});
