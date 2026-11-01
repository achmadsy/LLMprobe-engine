#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Standalone operator tool, deliberately not exposed through the HTTP sidecar.
const commander_1 = require("commander");
const node_fs_1 = require("node:fs");
const bias_calibration_js_1 = require("./bias-calibration.js");
const expanded_glm_policy_js_1 = require("./expanded-glm-policy.js");
const glm_policy_development_js_1 = require("./glm-policy-development.js");
const program = new commander_1.Command().name("bias-calibration").description("Collect draft GLM reference distributions and independently check held-out samples");
program.command("collect")
    .requiredOption("--model <canonical-id>", "Reference identity: z-ai/glm-5.3 or z-ai/glm-5.3-flash (older siblings also supported)")
    .requiredOption("--purpose <purpose>", "reference or validation; use separate collections")
    .option("--request-model <id>", "Actual model selector sent to the trusted endpoint")
    .option("--samples <n>", "Samples per probe; defaults to reference=60, validation=50")
    .option("--max-tokens <n>", "Explicit output cap; keep identical across collections", "128")
    .option("--base-url <https-url>", "Trusted endpoint API base; required only for execution")
    .option("--api-key-env <name>", "Environment variable containing the credential", "PROBE_CALIBRATION_API_KEY")
    .option("--output <file>", "New private artifact file; never overwrites")
    .option("--max-requests <n>", "Explicit request budget; required for execution")
    .option("--timeout <ms>", "Per-request timeout", "60000")
    .option("--execute", "Actually make paid requests; without this flag only print the plan", false)
    .action(async (opts) => {
    const plan = (0, bias_calibration_js_1.makeCalibrationPlan)({ modelId: opts.model, requestModelId: opts.requestModel,
        purpose: opts.purpose, samplesPerProbe: opts.samples === undefined ? undefined : Number(opts.samples), maxTokens: Number(opts.maxTokens) });
    if (!opts.execute) {
        console.log(JSON.stringify({ ...plan, maximumCompletionTokens: plan.plannedRequests * plan.settings.max_tokens,
            note: "Dry run only. No network calls. Token ceiling excludes input tokens; provider prices and reasoning billing vary." }, null, 2));
        return;
    }
    if (!opts.baseUrl || !opts.output || !opts.maxRequests)
        throw new Error("Execution requires --base-url, --output, and --max-requests");
    const apiKey = process.env[opts.apiKeyEnv];
    if (!apiKey)
        throw new Error("Credential environment variable is missing");
    // Reserve the new file before making a billable call. Never overwrite an existing reference.
    const fd = (0, node_fs_1.openSync)(opts.output, "wx", 0o600);
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
        const artifact = await (0, bias_calibration_js_1.collectCalibration)(plan, { baseUrl: opts.baseUrl, apiKey, execute: true,
            maxRequests: Number(opts.maxRequests), timeoutMs: Number(opts.timeout), signal: controller.signal,
            onProgress: (n, total) => { if (n % 10 === 0 || n === total)
                console.error(`Completed ${n}/${total} request slots`); } });
        (0, node_fs_1.writeFileSync)(fd, JSON.stringify(artifact, null, 2));
        console.error(`Draft saved: ${artifact.attempts} attempts, ${artifact.failures} failures. Detection coverage is NOT enabled.`);
    }
    finally {
        (0, node_fs_1.closeSync)(fd);
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
    }
});
function load(file) {
    if ((0, node_fs_1.statSync)(file).size > 8 * 1024 * 1024)
        throw new Error("Artifact exceeds 8 MiB");
    return (0, bias_calibration_js_1.parseCalibrationArtifact)(JSON.parse((0, node_fs_1.readFileSync)(file, "utf8")));
}
program.command("validate")
    .requiredOption("--references <files...>", "Independent reference artifact files")
    .requiredOption("--holdouts <files...>", "Separate validation artifact files")
    .option("--output <file>", "New diagnostic report file")
    .action(opts => {
    const report = (0, bias_calibration_js_1.validateCalibration)(opts.references.map(load), opts.holdouts.map(load));
    const json = JSON.stringify(report, null, 2);
    if (opts.output)
        (0, node_fs_1.writeFileSync)(opts.output, json, { flag: "wx", mode: 0o600 });
    else
        console.log(json);
});
program.command("develop-policy")
    .requiredOption("--references <files...>", "REFERENCE artifacts only; final evaluation inputs are rejected")
    .option("--output <file>", "New reference-only development report")
    .action(opts => {
    const report = (0, glm_policy_development_js_1.developGlmPolicy)(opts.references.map(load));
    const json = JSON.stringify(report, null, 2);
    if (opts.output)
        (0, node_fs_1.writeFileSync)(opts.output, json, { flag: "wx", mode: 0o600 });
    else
        console.log(json);
});
program.command("evaluate-policy")
    .requiredOption("--references <files...>", "Reference artifacts (all five siblings needed for release)")
    .requiredOption("--holdouts <files...>", "Independent final evaluation artifacts")
    .option("--controls <files...>", "Independently collected out-of-family control files; never synthetic")
    .option("--output <file>", "New release-gate evaluation report")
    .action(opts => {
    const controls = (opts.controls ?? []).map((file) => {
        if ((0, node_fs_1.statSync)(file).size > 8 * 1024 * 1024)
            throw new Error("Control file exceeds limit");
        return JSON.parse((0, node_fs_1.readFileSync)(file, "utf8"));
    });
    const report = (0, expanded_glm_policy_js_1.evaluateExpandedGlmPolicy)(opts.references.map(load), opts.holdouts.map(load), controls);
    const json = JSON.stringify(report, null, 2);
    if (opts.output)
        (0, node_fs_1.writeFileSync)(opts.output, json, { flag: "wx", mode: 0o600 });
    else
        console.log(json);
});
program.parseAsync().catch(() => {
    // Avoid disclosing URLs, keys, provider text or artifact contents through arbitrary error messages.
    console.error("Calibration failed. Check arguments, new output path, budget, credential, endpoint, and artifact compatibility. No runtime policy was activated.");
    process.exitCode = 1;
});
//# sourceMappingURL=bias-calibration-cli.js.map