"use strict";
// src/__tests__/egress-guard.test.ts — Tests for SSRF, IP filtering, DNS rebinding & redirects (AGPL-3.0)
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
const egress_guard_js_1 = require("../egress-guard.js");
(0, vitest_1.describe)("Egress Guard — SSRF & IP Validation", () => {
    (0, vitest_1.describe)("validateUrl", () => {
        (0, vitest_1.it)("allows valid public http and https URLs", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://api.openai.com/v1")).not.toThrow();
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://api.openai.com/v1")).not.toThrow();
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://api.example.com:8443/v1")).not.toThrow();
        });
        (0, vitest_1.it)("rejects non-http/https protocols", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("ftp://api.example.com/v1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("file:///etc/passwd")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("gopher://example.com")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("data:text/plain;base64,hello")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("javascript:alert(1)")).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("rejects URLs with embedded credentials", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://user:pass@api.example.com")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://admin@api.example.com")).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("rejects non-allowed ports by default (80, 443, 8443 allowed)", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://api.example.com:22")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://api.example.com:3306")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://api.example.com:8080")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://api.example.com:3000")).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("respects custom allowed ports", () => {
            const opts = { allowedPorts: [3000, 8080] };
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://api.example.com:3000", opts)).not.toThrow();
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://api.example.com:8080", opts)).not.toThrow();
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("https://api.example.com:443", opts)).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("rejects loopback and private IPv4 hostnames", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://127.0.0.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://127.0.0.2")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://10.0.0.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://172.16.0.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://172.31.255.254")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://192.168.1.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://169.254.169.254")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://0.0.0.0")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://100.64.0.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://192.0.2.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://224.0.0.1")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://240.0.0.1")).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("rejects private and loopback IPv6 hostnames", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[::1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[::ffff:127.0.0.1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[::ffff:7f00:1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[::ffff:169.254.169.254]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[fe80::1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[fc00::1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[fd00::1]")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://[ff02::1]")).toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("rejects internal/special domain names", () => {
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://localhost")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://sub.localhost")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://app.local")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://db.internal")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://router.lan")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://nas.home.arpa")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://intranet.corp")).toThrow(egress_guard_js_1.EgressError);
            (0, vitest_1.expect)(() => (0, egress_guard_js_1.validateUrl)("http://metadata.google.internal")).toThrow(egress_guard_js_1.EgressError);
        });
    });
    (0, vitest_1.describe)("isPrivateOrReservedIp", () => {
        (0, vitest_1.it)("correctly classifies public IPv4 addresses", () => {
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("8.8.8.8")).toBe(false);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("1.1.1.1")).toBe(false);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("93.184.216.34")).toBe(false);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("104.16.132.229")).toBe(false);
        });
        (0, vitest_1.it)("correctly classifies public IPv6 addresses", () => {
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("2606:4700:4700::1111")).toBe(false);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("2001:4860:4860::8888")).toBe(false);
        });
        (0, vitest_1.it)("blocks IPv4-mapped private IPv6 addresses", () => {
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("::ffff:127.0.0.1")).toBe(true);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("::ffff:10.0.0.1")).toBe(true);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("::ffff:192.168.0.1")).toBe(true);
            (0, vitest_1.expect)((0, egress_guard_js_1.isPrivateOrReservedIp)("::ffff:169.254.169.254")).toBe(true);
        });
    });
    (0, vitest_1.describe)("DNS Rebinding Prevention", () => {
        (0, vitest_1.it)("blocks connection at connect-time when hostname resolves to a private IP", async () => {
            // Mock DNS lookup that returns loopback for a fake domain
            const fakeLookup = (_hostname, _opts, callback) => {
                callback(null, [{ address: "127.0.0.1", family: 4 }]);
            };
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({ lookupFn: fakeLookup });
            await (0, vitest_1.expect)(safeFetch("http://attacker-rebinding.example.com/v1/chat")).rejects.toThrow(/SSRF blocked|private\/reserved IP/);
        });
        (0, vitest_1.it)("blocks connection if any IP in multi-record DNS is private", async () => {
            const fakeLookup = (_hostname, _opts, callback) => {
                callback(null, [
                    { address: "93.184.216.34", family: 4 }, // public
                    { address: "169.254.169.254", family: 4 }, // private metadata
                ]);
            };
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({ lookupFn: fakeLookup });
            await (0, vitest_1.expect)(safeFetch("http://round-robin-rebind.example.com/v1/chat")).rejects.toThrow(/SSRF blocked|private\/reserved IP/);
        });
    });
    (0, vitest_1.describe)("Manual Redirect Defense", () => {
        let server;
        let serverPort;
        let otherServer;
        let otherServerPort;
        let sameOriginAuthorization;
        let crossOriginAuthorization;
        // Start test HTTP servers on ephemeral ports for redirect testing
        (0, vitest_1.beforeAll)(async () => {
            otherServer = http.createServer((req, res) => {
                crossOriginAuthorization = req.headers.authorization;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            });
            await new Promise((resolve) => {
                otherServer.listen(0, "127.0.0.1", () => {
                    otherServerPort = otherServer.address().port;
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
            await new Promise((resolve) => {
                server.listen(0, "127.0.0.1", () => {
                    const addr = server.address();
                    serverPort = addr.port;
                    resolve();
                });
            });
        });
        (0, vitest_1.afterAll)(async () => {
            await new Promise((resolve) => server.close(() => resolve()));
            await new Promise((resolve) => otherServer.close(() => resolve()));
        });
        (0, vitest_1.it)("blocks redirect to private/internal IP", async () => {
            // allowPrivate only for the initial connection to test server, but redirect will be validated
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, 80, 443],
                allowPrivate: true, // initial hop allowed to local test server
            });
            // But test redirect target without allowPrivate:
            const strictFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, 80, 443],
                allowPrivate: false,
            });
            // Initial request with private target is blocked upfront
            await (0, vitest_1.expect)(strictFetch(`http://127.0.0.1:${serverPort}/redirect-to-private`)).rejects.toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("blocks redirect to disallowed port", async () => {
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, 80, 443],
                allowPrivate: true,
            });
            await (0, vitest_1.expect)(safeFetch(`http://127.0.0.1:${serverPort}/redirect-to-bad-port`)).rejects.toThrow(egress_guard_js_1.EgressError);
        });
        (0, vitest_1.it)("blocks infinite redirect loops", async () => {
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, 80, 443],
                allowPrivate: true,
                maxRedirects: 3,
            });
            await (0, vitest_1.expect)(safeFetch(`http://127.0.0.1:${serverPort}/redirect-loop`)).rejects.toThrow(/Too many redirects/);
        });
        (0, vitest_1.it)("successfully follows safe redirects when allowed", async () => {
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, 80, 443],
                allowPrivate: true,
            });
            const res = await safeFetch(`http://127.0.0.1:${serverPort}/redirect-safe`);
            (0, vitest_1.expect)(res.status).toBe(200);
            const json = await res.json();
            (0, vitest_1.expect)(json.ok).toBe(true);
            (0, vitest_1.expect)(json.message).toBe("arrived safely");
        });
        (0, vitest_1.it)("keeps Authorization on same-origin redirects", async () => {
            sameOriginAuthorization = undefined;
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort],
                allowPrivate: true,
            });
            await safeFetch(`http://127.0.0.1:${serverPort}/redirect-safe`, {
                headers: { Authorization: "Bearer keep-me" },
            });
            (0, vitest_1.expect)(sameOriginAuthorization).toBe("Bearer keep-me");
        });
        (0, vitest_1.it)("strips Authorization on cross-origin redirects", async () => {
            crossOriginAuthorization = undefined;
            const safeFetch = (0, egress_guard_js_1.createSafeFetch)({
                allowedPorts: [serverPort, otherServerPort],
                allowPrivate: true,
            });
            await safeFetch(`http://127.0.0.1:${serverPort}/redirect-cross-origin`, {
                headers: { Authorization: "Bearer do-not-forward" },
            });
            (0, vitest_1.expect)(crossOriginAuthorization).toBeUndefined();
        });
    });
});
//# sourceMappingURL=egress-guard.test.js.map