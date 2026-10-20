"use strict";
// src/egress-guard.ts — SSRF & Egress Defense with DNS Pinning (AGPL-3.0-only)
// Part of @bazaarlink/probe-engine
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
exports.DEFAULT_ALLOWED_PORTS = exports.EgressError = void 0;
exports.combineSignals = combineSignals;
exports.resolveAllowedPorts = resolveAllowedPorts;
exports.isPrivateOrReservedIPv4 = isPrivateOrReservedIPv4;
exports.isPrivateOrReservedIPv6 = isPrivateOrReservedIPv6;
exports.isPrivateOrReservedIp = isPrivateOrReservedIp;
exports.isBlockedHostname = isBlockedHostname;
exports.validateUrl = validateUrl;
exports.createSafeAgent = createSafeAgent;
exports.createSafeFetch = createSafeFetch;
const net = __importStar(require("net"));
const dns = __importStar(require("dns"));
const tls = __importStar(require("tls"));
const undici_1 = require("undici");
class EgressError extends Error {
    constructor(message) {
        super(message);
        this.name = "EgressError";
    }
}
exports.EgressError = EgressError;
exports.DEFAULT_ALLOWED_PORTS = [80, 443, 8443];
/**
 * Combines a timeout with an optional external AbortSignal.
 */
function combineSignals(timeoutMs, signal) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!signal)
        return timeoutSignal;
    if (typeof AbortSignal.any === "function") {
        return AbortSignal.any([signal, timeoutSignal]);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    const onTimeout = () => controller.abort(timeoutSignal.reason);
    if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    return controller.signal;
}
function resolveAllowedPorts(options) {
    if (options?.allowedPorts && options.allowedPorts.length > 0) {
        return options.allowedPorts;
    }
    const envPorts = process.env.ALLOWED_PUBLIC_PORTS || process.env.ALLOWED_PORTS;
    if (envPorts) {
        const parsed = envPorts
            .split(",")
            .map(p => parseInt(p.trim(), 10))
            .filter(p => !isNaN(p) && p > 0 && p <= 65535);
        if (parsed.length > 0)
            return parsed;
    }
    return exports.DEFAULT_ALLOWED_PORTS;
}
/**
 * Checks whether an IPv4 address is in private, loopback, link-local, multicast or reserved ranges.
 */
function isPrivateOrReservedIPv4(parts) {
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
        return true; // Malformed = reject
    }
    const [b0, b1, b2] = parts;
    // 0.0.0.0/8 (Current network / "this" network)
    if (b0 === 0)
        return true;
    // 10.0.0.0/8 (Private network RFC 1918)
    if (b0 === 10)
        return true;
    // 100.64.0.0/10 (Carrier-grade NAT RFC 6598)
    if (b0 === 100 && b1 >= 64 && b1 <= 127)
        return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127)
        return true;
    // 169.254.0.0/16 (Link-local / cloud metadata service e.g. 169.254.169.254)
    if (b0 === 169 && b1 === 254)
        return true;
    // 172.16.0.0/12 (Private network RFC 1918)
    if (b0 === 172 && b1 >= 16 && b1 <= 31)
        return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && b2 === 0)
        return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && b2 === 2)
        return true;
    // 192.88.99.0/24 (6to4 Relay Anycast RFC 7526)
    if (b0 === 192 && b1 === 88 && b2 === 99)
        return true;
    // 192.168.0.0/16 (Private network RFC 1918)
    if (b0 === 192 && b1 === 168)
        return true;
    // 198.18.0.0/15 (Network benchmark tests RFC 2544)
    if (b0 === 198 && (b1 === 18 || b1 === 19))
        return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && b2 === 100)
        return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && b2 === 113)
        return true;
    // 224.0.0.0/4 (Multicast RFC 5771)
    if (b0 >= 224 && b0 <= 239)
        return true;
    // 240.0.0.0/4 (Reserved / Future use RFC 1112 + 255.255.255.255 broadcast)
    if (b0 >= 240)
        return true;
    return false;
}
/**
 * Parse an IPv6 address string into 8 16-bit words.
 */
function parseIPv6Words(ip) {
    let clean = ip.replace(/^\[|\]$/g, "").trim().toLowerCase();
    // Check for IPv4 suffix (e.g. ::ffff:192.168.1.1)
    let ipv4Tail;
    const lastColon = clean.lastIndexOf(":");
    if (lastColon !== -1) {
        const potentialIpv4 = clean.slice(lastColon + 1);
        if (net.isIPv4(potentialIpv4)) {
            const parts = potentialIpv4.split(".").map(Number);
            ipv4Tail = parts;
            const hex1 = ((parts[0] << 8) | parts[1]).toString(16);
            const hex2 = ((parts[2] << 8) | parts[3]).toString(16);
            clean = clean.slice(0, lastColon) + ":" + hex1 + ":" + hex2;
        }
    }
    const parts = clean.split("::");
    if (parts.length > 2)
        return null; // Invalid multiple "::"
    let segments = [];
    if (parts.length === 2) {
        const head = parts[0] ? parts[0].split(":") : [];
        const tail = parts[1] ? parts[1].split(":") : [];
        const missing = 8 - (head.length + tail.length);
        if (missing < 0)
            return null;
        segments = [...head, ...Array(missing).fill("0"), ...tail];
    }
    else {
        segments = parts[0].split(":");
        if (segments.length !== 8)
            return null;
    }
    const words = segments.map(s => parseInt(s || "0", 16));
    if (words.some(w => isNaN(w) || w < 0 || w > 0xffff))
        return null;
    return { words, ipv4Tail };
}
/**
 * Checks whether an IPv6 address is loopback, unique local, link-local, multicast, or reserved.
 */
function isPrivateOrReservedIPv6(ip) {
    const parsed = parseIPv6Words(ip);
    if (!parsed)
        return true; // Malformed = reject
    const { words, ipv4Tail } = parsed;
    // :: (Unspecified)
    if (words.every(w => w === 0))
        return true;
    // ::1 (Loopback)
    if (words.slice(0, 7).every(w => w === 0) && words[7] === 1)
        return true;
    // ::ffff:0:0/96 (IPv4-mapped) or ::ffff:0:0:0/96
    if (words.slice(0, 5).every(w => w === 0) && words[5] === 0xffff) {
        const ip4 = ipv4Tail ?? [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
        return isPrivateOrReservedIPv4(ip4);
    }
    // ::/96 (IPv4-compatible IPv6 — deprecated)
    if (words.slice(0, 6).every(w => w === 0)) {
        const ip4 = ipv4Tail ?? [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
        return isPrivateOrReservedIPv4(ip4);
    }
    // 64:ff9b::/96 (IPv4/IPv6 translation)
    if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every(w => w === 0)) {
        const ip4 = ipv4Tail ?? [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
        return isPrivateOrReservedIPv4(ip4);
    }
    // 100::/64 (Discard prefix RFC 6666)
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0)
        return true;
    // 2001::/23 (IETF Protocol Assignments)
    if (words[0] === 0x2001 && (words[1] & 0xfe00) === 0)
        return true;
    // 2001:db8::/32 (Documentation RFC 3849)
    if (words[0] === 0x2001 && words[1] === 0x0db8)
        return true;
    // 2002::/16 (6to4 Relay)
    if (words[0] === 0x2002) {
        const ip4 = [words[1] >> 8, words[1] & 0xff, words[2] >> 8, words[2] & 0xff];
        return isPrivateOrReservedIPv4(ip4);
    }
    // fc00::/7 (Unique Local Address / Private RFC 4193)
    if ((words[0] & 0xfe00) === 0xfc00)
        return true;
    // fe80::/10 (Link-Local Unicast RFC 4291)
    if ((words[0] & 0xffc0) === 0xfe80)
        return true;
    // ff00::/8 (Multicast RFC 4291)
    if ((words[0] & 0xff00) === 0xff00)
        return true;
    return false;
}
/**
 * Checks whether an IP address (v4 or v6) is private or reserved.
 */
function isPrivateOrReservedIp(ip) {
    const clean = ip.replace(/^\[|\]$/g, "").trim();
    if (net.isIPv4(clean)) {
        return isPrivateOrReservedIPv4(clean.split(".").map(Number));
    }
    if (net.isIPv6(clean)) {
        return isPrivateOrReservedIPv6(clean);
    }
    return true; // Not an IP = unknown
}
const BLOCKED_HOSTNAME_SUFFIXES = [
    "localhost",
    ".localhost",
    ".local",
    ".internal",
    ".lan",
    ".home.arpa",
    ".corp",
    ".intranet",
];
const BLOCKED_EXACT_HOSTNAMES = new Set([
    "localhost",
    "metadata.google.internal",
    "instance-data",
    "metadata",
]);
/**
 * Checks whether a hostname is internal, private, or reserved.
 */
function isBlockedHostname(hostname) {
    if (!hostname)
        return true;
    const lower = hostname.toLowerCase().replace(/\.+$/, ""); // strip trailing dots
    if (BLOCKED_EXACT_HOSTNAMES.has(lower))
        return true;
    for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
        if (lower === suffix || lower.endsWith(suffix)) {
            return true;
        }
    }
    // If hostname is directly an IP literal (strip brackets for IPv6)
    const unbracketed = lower.replace(/^\[|\]$/g, "");
    if (net.isIP(unbracketed)) {
        return isPrivateOrReservedIp(unbracketed);
    }
    return false;
}
/**
 * Validates a URL against arbitrary-target egress defense rules:
 * - Scheme must be http: or https:
 * - Rejects URL credentials (user:pass)
 * - Port must be in allowed public ports list (default 80, 443, 8443)
 * - Rejects internal, private, loopback, or reserved hostnames/IPs
 */
function validateUrl(urlInput, options) {
    let url;
    try {
        url = typeof urlInput === "string" ? new URL(urlInput) : urlInput;
    }
    catch (err) {
        throw new EgressError(`Invalid URL format: ${err.message}`);
    }
    // 1. Only http and https allowed
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new EgressError(`Forbidden protocol '${url.protocol}'. Only http: and https: are allowed.`);
    }
    // 2. Reject embedded URL credentials
    if (url.username || url.password) {
        throw new EgressError("URL credentials (username/password) are forbidden.");
    }
    // 3. Port check
    const allowedPorts = resolveAllowedPorts(options);
    const defaultPort = url.protocol === "https:" ? 443 : 80;
    const port = url.port ? parseInt(url.port, 10) : defaultPort;
    if (isNaN(port) || !allowedPorts.includes(port)) {
        throw new EgressError(`Port ${port} is not allowed. Allowed public ports: [${allowedPorts.join(", ")}].`);
    }
    // 4. Hostname check
    const hostname = url.hostname;
    if (!options?.allowPrivate && isBlockedHostname(hostname)) {
        throw new EgressError(`Hostname '${hostname}' is an internal, private, or reserved target.`);
    }
    return url;
}
/**
 * Creates an Undici Agent that performs DNS resolution and connect-time pinning.
 * Prevents DNS rebinding (TOCTOU) by resolving DNS once, checking all IP addresses,
 * and opening the TCP/TLS socket directly to the validated IP while preserving SNI.
 */
function createSafeAgent(options) {
    const allowedPorts = resolveAllowedPorts(options);
    const lookup = options?.lookupFn ?? dns.lookup;
    return new undici_1.Agent({
        connect(opts, callback) {
            const { hostname, port, protocol, servername } = opts;
            const numPort = Number(port) || (protocol === "https:" ? 443 : 80);
            // Verify port
            if (!allowedPorts.includes(numPort)) {
                return callback(new EgressError(`Connect to port ${numPort} blocked by egress policy.`), null);
            }
            // If already an IP address
            if (net.isIP(hostname)) {
                if (!options?.allowPrivate && isPrivateOrReservedIp(hostname)) {
                    return callback(new EgressError(`Direct connection to private/reserved IP '${hostname}' blocked.`), null);
                }
                if (protocol === "https:") {
                    const socket = tls.connect({
                        host: hostname,
                        port: numPort,
                        servername: servername || hostname,
                    });
                    socket.once("secureConnect", () => callback(null, socket));
                    socket.once("error", err => callback(err, null));
                    return socket;
                }
                else {
                    const socket = net.connect({
                        host: hostname,
                        port: numPort,
                    });
                    socket.once("connect", () => callback(null, socket));
                    socket.once("error", err => callback(err, null));
                    return socket;
                }
            }
            // Hostname check
            if (!options?.allowPrivate && isBlockedHostname(hostname)) {
                return callback(new EgressError(`Hostname '${hostname}' blocked by egress policy.`), null);
            }
            // Resolve DNS and check all IPs
            lookup(hostname, { all: true }, (err, addresses) => {
                if (err)
                    return callback(err, null);
                if (!addresses || addresses.length === 0) {
                    return callback(new EgressError(`DNS lookup returned no addresses for '${hostname}'.`), null);
                }
                // Validate EVERY address to prevent DNS rebinding / round-robin to private IPs
                if (!options?.allowPrivate) {
                    for (const addr of addresses) {
                        if (isPrivateOrReservedIp(addr.address)) {
                            return callback(new EgressError(`DNS rebinding / SSRF blocked: '${hostname}' resolved to private/reserved IP '${addr.address}'.`), null);
                        }
                    }
                }
                // Pin to the first verified address
                const pinnedIp = addresses[0].address;
                if (protocol === "https:") {
                    const socket = tls.connect({
                        host: pinnedIp,
                        port: numPort,
                        servername: servername || hostname, // Preserves TLS SNI & certificate validation
                    });
                    socket.once("secureConnect", () => callback(null, socket));
                    socket.once("error", err => callback(err, null));
                    return socket;
                }
                else {
                    const socket = net.connect({
                        host: pinnedIp,
                        port: numPort,
                    });
                    socket.once("connect", () => callback(null, socket));
                    socket.once("error", err => callback(err, null));
                    return socket;
                }
            });
        },
    });
}
/**
 * Creates a safe fetch function with:
 * - URL and port validation upfront
 * - Undici Agent with DNS pinning + TLS SNI preservation
 * - Manual redirect handling with validation on every hop
 */
function createSafeFetch(options) {
    const safeAgent = createSafeAgent(options);
    const maxRedirects = options?.maxRedirects ?? 5;
    return async function safeFetch(input, init) {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        let currentUrl = validateUrl(rawUrl, options);
        let redirectCount = 0;
        let currentMethod = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        let currentBody = init?.body;
        const currentHeaders = new Headers(init?.headers);
        while (true) {
            let res;
            try {
                // Dispatch request via safeAgent
                res = await fetch(currentUrl.href, {
                    ...init,
                    method: currentMethod,
                    headers: currentHeaders,
                    body: currentBody,
                    redirect: "manual",
                    // @ts-expect-error Node.js undici dispatcher property
                    dispatcher: safeAgent,
                });
            }
            catch (err) {
                if (err &&
                    typeof err === "object" &&
                    "cause" in err &&
                    err.cause instanceof EgressError) {
                    throw err.cause;
                }
                throw err;
            }
            // Check if redirect
            if ([301, 302, 303, 307, 308].includes(res.status)) {
                redirectCount++;
                if (redirectCount > maxRedirects) {
                    throw new EgressError(`Too many redirects (max ${maxRedirects}).`);
                }
                const location = res.headers.get("location");
                if (!location) {
                    return res;
                }
                // Resolve redirect URL and validate against egress rules
                const previousOrigin = currentUrl.origin;
                const nextUrl = validateUrl(new URL(location, currentUrl), options);
                // Adjust method according to HTTP specs
                if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
                    currentMethod = "GET";
                    currentBody = undefined;
                    currentHeaders.delete("content-type");
                    currentHeaders.delete("content-length");
                }
                // Cross-origin redirect: never leak the caller's Authorization header
                if (previousOrigin !== nextUrl.origin) {
                    currentHeaders.delete("authorization");
                }
                currentUrl = nextUrl;
                continue;
            }
            return res;
        }
    };
}
//# sourceMappingURL=egress-guard.js.map