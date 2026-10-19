#!/usr/bin/env node
"use strict";
// src/sidecar-cli.ts — CLI Launcher for BazaarLink Probe Engine Sidecar
// Part of @bazaarlink/probe-engine (AGPL-3.0-only)
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const sidecar_js_1 = require("./sidecar.js");
const program = new commander_1.Command();
program
    .name("bazaarlink-probe-sidecar")
    .description("BazaarLink Probe Engine AGPL-3.0 HTTP API Sidecar")
    .version(sidecar_js_1.SIDECAR_VERSION)
    .option("-p, --port <port>", "Port to listen on (default: 3001 or $PORT)", process.env.PORT || "3001")
    .option("-h, --host <host>", "Host to listen on (default: 0.0.0.0 or $HOST)", process.env.HOST || "0.0.0.0")
    .option("-t, --token <token>", "Bearer token for authorization (default: $PROBE_SIDECAR_TOKEN)")
    .option("--allowed-ports <ports>", "Comma-separated list of allowed public ports (default: 80,443,8443)")
    .action(async (opts) => {
    const port = parseInt(opts.port, 10) || 3001;
    const host = opts.host || "0.0.0.0";
    const allowedPorts = opts.allowedPorts
        ? opts.allowedPorts.split(",").map((p) => parseInt(p.trim(), 10)).filter((p) => !isNaN(p))
        : undefined;
    const server = (0, sidecar_js_1.createSidecarServer)({
        port,
        host,
        bearerToken: opts.token,
        egressOptions: { allowedPorts },
    });
    try {
        const bound = await server.listen(port, host);
        console.log(`BazaarLink Probe Engine Sidecar v${sidecar_js_1.SIDECAR_VERSION} (${sidecar_js_1.SIDECAR_LICENSE})`);
        console.log(`Source code: ${sidecar_js_1.SIDECAR_SOURCE}`);
        console.log(`Listening on http://${bound.host}:${bound.port}`);
        const shutdown = async () => {
            console.log("\nShutting down sidecar...");
            await server.close();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
    }
    catch (err) {
        console.error("Failed to start sidecar:", err.message);
        process.exit(1);
    }
});
program.parse(process.argv);
//# sourceMappingURL=sidecar-cli.js.map