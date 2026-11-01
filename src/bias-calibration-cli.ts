#!/usr/bin/env node
// Standalone operator tool, deliberately not exposed through the HTTP sidecar.
import { Command } from "commander";
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { collectCalibration, makeCalibrationPlan, parseCalibrationArtifact, validateCalibration } from "./bias-calibration.js";
import { evaluateExpandedGlmPolicy } from "./expanded-glm-policy.js";
import { developGlmPolicy } from "./glm-policy-development.js";

const program = new Command().name("bias-calibration").description("Collect draft GLM reference distributions and independently check held-out samples");

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
  .action(async opts => {
    const plan = makeCalibrationPlan({ modelId: opts.model, requestModelId: opts.requestModel,
      purpose: opts.purpose, samplesPerProbe: opts.samples === undefined ? undefined : Number(opts.samples), maxTokens: Number(opts.maxTokens) });
    if (!opts.execute) {
      console.log(JSON.stringify({ ...plan, maximumCompletionTokens: plan.plannedRequests * plan.settings.max_tokens,
        note: "Dry run only. No network calls. Token ceiling excludes input tokens; provider prices and reasoning billing vary." }, null, 2));
      return;
    }
    if (!opts.baseUrl || !opts.output || !opts.maxRequests) throw new Error("Execution requires --base-url, --output, and --max-requests");
    const apiKey = process.env[opts.apiKeyEnv];
    if (!apiKey) throw new Error("Credential environment variable is missing");
    // Reserve the new file before making a billable call. Never overwrite an existing reference.
    const fd = openSync(opts.output, "wx", 0o600);
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const artifact = await collectCalibration(plan, { baseUrl: opts.baseUrl, apiKey, execute: true,
        maxRequests: Number(opts.maxRequests), timeoutMs: Number(opts.timeout), signal: controller.signal,
        onProgress: (n, total) => { if (n % 10 === 0 || n === total) console.error(`Completed ${n}/${total} request slots`); } });
      writeFileSync(fd, JSON.stringify(artifact, null, 2));
      console.error(`Draft saved: ${artifact.attempts} attempts, ${artifact.failures} failures. Detection coverage is NOT enabled.`);
    } finally {
      closeSync(fd);
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  });

function load(file: string) {
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error("Artifact exceeds 8 MiB");
  return parseCalibrationArtifact(JSON.parse(readFileSync(file, "utf8")));
}
program.command("validate")
  .requiredOption("--references <files...>", "Independent reference artifact files")
  .requiredOption("--holdouts <files...>", "Separate validation artifact files")
  .option("--output <file>", "New diagnostic report file")
  .action(opts => {
    const report = validateCalibration(opts.references.map(load), opts.holdouts.map(load));
    const json = JSON.stringify(report, null, 2);
    if (opts.output) writeFileSync(opts.output, json, { flag: "wx", mode: 0o600 });
    else console.log(json);
  });

program.command("develop-policy")
  .requiredOption("--references <files...>", "REFERENCE artifacts only; final evaluation inputs are rejected")
  .option("--output <file>", "New reference-only development report")
  .action(opts => {
    const report = developGlmPolicy(opts.references.map(load));
    const json = JSON.stringify(report, null, 2);
    if (opts.output) writeFileSync(opts.output, json, { flag: "wx", mode: 0o600 });
    else console.log(json);
  });

program.command("evaluate-policy")
  .requiredOption("--references <files...>", "Reference artifacts (all five siblings needed for release)")
  .requiredOption("--holdouts <files...>", "Independent final evaluation artifacts")
  .option("--controls <files...>", "Independently collected out-of-family control files; never synthetic")
  .option("--output <file>", "New release-gate evaluation report")
  .action(opts => {
    const controls = (opts.controls ?? []).map((file: string) => {
      if (statSync(file).size > 8 * 1024 * 1024) throw new Error("Control file exceeds limit");
      return JSON.parse(readFileSync(file, "utf8"));
    });
    const report = evaluateExpandedGlmPolicy(opts.references.map(load), opts.holdouts.map(load), controls);
    const json = JSON.stringify(report, null, 2);
    if (opts.output) writeFileSync(opts.output, json, { flag: "wx", mode: 0o600 });
    else console.log(json);
  });

program.parseAsync().catch(() => {
  // Avoid disclosing URLs, keys, provider text or artifact contents through arbitrary error messages.
  console.error("Calibration failed. Check arguments, new output path, budget, credential, endpoint, and artifact compatibility. No runtime policy was activated.");
  process.exitCode = 1;
});
