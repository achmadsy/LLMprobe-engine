import * as dns from "dns";
import { Agent } from "undici";
export declare class EgressError extends Error {
    constructor(message: string);
}
export interface EgressOptions {
    /** Configurable allowed public ports. Default: [80, 443, 8443] */
    allowedPorts?: number[];
    /** Allow internal/private networks (for tests only). Default: false */
    allowPrivate?: boolean;
    /** Maximum redirect hops. Default: 5 */
    maxRedirects?: number;
    /** Custom DNS lookup implementation (useful for testing DNS rebinding) */
    lookupFn?: (hostname: string, options: {
        all: boolean;
    }, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;
}
export declare const DEFAULT_ALLOWED_PORTS: number[];
/**
 * Combines a timeout with an optional external AbortSignal.
 */
export declare function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal;
export declare function resolveAllowedPorts(options?: EgressOptions): number[];
/**
 * Checks whether an IPv4 address is in private, loopback, link-local, multicast or reserved ranges.
 */
export declare function isPrivateOrReservedIPv4(parts: number[]): boolean;
/**
 * Checks whether an IPv6 address is loopback, unique local, link-local, multicast, or reserved.
 */
export declare function isPrivateOrReservedIPv6(ip: string): boolean;
/**
 * Checks whether an IP address (v4 or v6) is private or reserved.
 */
export declare function isPrivateOrReservedIp(ip: string): boolean;
/**
 * Checks whether a hostname is internal, private, or reserved.
 */
export declare function isBlockedHostname(hostname: string): boolean;
/**
 * Validates a URL against arbitrary-target egress defense rules:
 * - Scheme must be http: or https:
 * - Rejects URL credentials (user:pass)
 * - Port must be in allowed public ports list (default 80, 443, 8443)
 * - Rejects internal, private, loopback, or reserved hostnames/IPs
 */
export declare function validateUrl(urlInput: string | URL, options?: EgressOptions): URL;
/**
 * Creates an Undici Agent that performs DNS resolution and connect-time pinning.
 * Prevents DNS rebinding (TOCTOU) by resolving DNS once, checking all IP addresses,
 * and opening the TCP/TLS socket directly to the validated IP while preserving SNI.
 */
export declare function createSafeAgent(options?: EgressOptions): Agent;
/**
 * Creates a safe fetch function with:
 * - URL and port validation upfront
 * - Undici Agent with DNS pinning + TLS SNI preservation
 * - Manual redirect handling with validation on every hop
 */
export declare function createSafeFetch(options?: EgressOptions): typeof fetch;
//# sourceMappingURL=egress-guard.d.ts.map