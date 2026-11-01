// Explicitly budgeted, sequential distribution sampling. No implicit transport retries.
import { BIAS_PROBES } from "./sub-model-bias-probes.js";
import { normalizeBiasAnswer } from "./sub-model-bias-probes.js";
import type { BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";
import { mergeCustomHeaders } from "./custom-headers.js";
import { readBoundedResponse } from "./signature-probe.js";

import { GLM_DISTRIBUTION_PROBE_IDS as ids, supportsGlmDistribution } from "./glm-distribution-models.js";
export const DISTRIBUTION_SAMPLE_CALLS = 51;
export interface DistributionEvidence {
  version: 1;
  modelId: string;
  protocolId: "glm-nine-temperature1-max128-v1";
  observations: BiasObservation[];
  attempts: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  collectedAt: string;
}
export function validateDistributionEvidence(input: unknown): DistributionEvidence {
  const e = input as DistributionEvidence;
  if (!e || e.version !== 1 || typeof e.modelId !== "string" || !supportsGlmDistribution(e.modelId) || e.protocolId !== "glm-nine-temperature1-max128-v1" || !Array.isArray(e.observations) ||
      e.observations.length !== ids.length || !Number.isFinite(Date.parse(e.collectedAt)) ||
      !Number.isSafeInteger(e.attempts) || e.attempts < 0 || e.attempts > 51 ||
      !Number.isSafeInteger(e.failures) || e.failures < 0 || e.failures > e.attempts ||
      ![e.inputTokens, e.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9)) throw new Error("Invalid saved distribution evidence");
  let samples = 0;
  const observations = ids.map((id, i) => {
    const o = e.observations[i];
    const max = id === "day" ? 3 : 6;
    if (!o || o.probeId !== id || !Array.isArray(o.answers) || o.answers.length > max ||
        o.answers.some(a => typeof a !== "string" || !/^(?:[a-z0-9]{1,16}|\(blank\))$/.test(a))) throw new Error("Invalid saved distribution evidence");
    samples += o.answers.length;
    return { probeId: id, answers: [...o.answers] };
  });
  if (samples !== e.attempts - e.failures) throw new Error("Distribution evidence counts disagree");
  // Whitelist fields: never echo arbitrary input or endpoint credentials into report metadata.
  return { version: 1, modelId: e.modelId, protocolId: e.protocolId, observations, attempts: e.attempts, failures: e.failures,
    inputTokens: e.inputTokens, outputTokens: e.outputTokens, collectedAt: e.collectedAt };
}
export async function collectDistributionEvidence(options: {
  baseUrl: string; apiKey: string; modelId: string; fetchFn: typeof fetch; customHeaders?: Record<string, string>;
  signal?: AbortSignal; timeoutMs?: number; maxCalls: 51;
  onProgress?: (progress: { attempts: number; failures: number; total: 51 }) => void;
}): Promise<DistributionEvidence> {
  if (options.maxCalls !== 51) throw new Error("Explicit 51-call sampling budget required");
  if (!supportsGlmDistribution(options.modelId)) throw new Error("Distribution sampling supports only GLM-5 / 5.1 / 5.2 / 5.3 / 5.3-Flash");
  const headers: Record<string, string> = { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" };
  mergeCustomHeaders(headers, options.customHeaders);
  const e: DistributionEvidence = { version: 1, modelId: options.modelId, protocolId: "glm-nine-temperature1-max128-v1", observations: [],
    attempts: 0, failures: 0, inputTokens: 0, outputTokens: 0, collectedAt: new Date().toISOString() };
  const secrets = [options.apiKey, ...Object.values(options.customHeaders ?? {})].filter(Boolean);
  let stop = false;
  for (const id of ids) {
    const probe = BIAS_PROBES.find(p => p.id === id)!;
    const answers: string[] = [];
    for (let slot = 0; slot < probe.samples && !stop; slot++) {
      if (options.signal?.aborted) throw new Error("Probe run canceled");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, Math.min(options.timeoutMs ?? 60000, 90000));
      e.attempts++;
      try {
        const response = await options.fetchFn(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST", redirect: "error", headers, signal: controller.signal,
          body: JSON.stringify({ model: options.modelId, messages: [{ role: "user", content: probe.prompt }], temperature: 1, max_tokens: 128, stream: false }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          stop = true; throw new Error("Sampling HTTP failure");
        }
        const data = JSON.parse(await readBoundedResponse(response, 65536));
        for (const [source, target] of [["prompt_tokens", "inputTokens"], ["completion_tokens", "outputTokens"]] as const) {
          const n = data?.usage?.[source];
          if (Number.isSafeInteger(n) && n >= 0 && n <= 1e7) e[target] += n;
        }
        const choice = data?.choices?.[0], content = choice?.message?.content;
        if (choice?.finish_reason !== "stop" || typeof content !== "string" || choice?.message?.tool_calls?.length ||
            secrets.some(s => content.includes(s))) { stop = true; throw new Error("Invalid sampling answer"); }
        answers.push(normalizeBiasAnswer(content) || "(blank)");
      } catch {
        if (options.signal?.aborted) throw new Error("Probe run canceled");
        e.failures++;
        // A broken route must not burn the whole budget; retain partial evidence, never fake blanks.
        stop = true;
      } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
      options.onProgress?.({ attempts: e.attempts, failures: e.failures, total: 51 });
    }
    e.observations.push({ probeId: id, answers });
  }
  e.collectedAt = new Date().toISOString();
  return validateDistributionEvidence(e);
}
