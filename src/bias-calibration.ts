// Offline-first GLM distribution calibration. Draft artifacts never enable detection.
import { createHash, randomUUID } from "node:crypto";
import { BIAS_PROBES, normalizeBiasAnswer, type BiasProbe } from "./sub-model-bias-probes.js";
import { BIAS_BASELINES } from "./sub-model-bias-baselines.js";
import { scoreV3HDistributionFingerprint, V3H_ACTIVE_PROMPT_POLICIES, type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";

export const GLM_CALIBRATION_MODELS = ["z-ai/glm-5.3", "z-ai/glm-5.3-flash"] as const;
const glmPolicy = V3H_ACTIVE_PROMPT_POLICIES.find(p => p.id === "zhipu-glm-cluster")!;
export const GLM_CALIBRATION_PROBES = glmPolicy.activeProbeIds.map(id => BIAS_PROBES.find(p => p.id === id)!);
const MAX_BODY_BYTES = 65536;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface CalibrationPlan {
  version: 1;
  purpose: "reference" | "validation";
  modelId: string;
  requestModelId: string;
  samplesPerProbe: number;
  plannedRequests: number;
  settings: { temperature: 1; max_tokens: number; stream: false };
  probes: BiasProbe[];
  protocolHash: string;
}
export interface CalibrationArtifact {
  version: 1;
  kind: "glm-bias-calibration";
  state: "draft";
  collectionId: string;
  startedAt: string;
  completedAt: string;
  endpoint: string;
  plan: CalibrationPlan;
  observations: BiasObservation[];
  attempts: number;
  failures: number;
  failureKinds: Record<string, number>;
  usage: { promptTokens: number; completionTokens: number };
  baseline: BiasBaseline;
}

function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
}
export function makeCalibrationPlan(options: {
  modelId: string; requestModelId?: string; purpose: "reference" | "validation";
  samplesPerProbe?: number; maxTokens?: number;
}): CalibrationPlan {
  if (!["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", ...GLM_CALIBRATION_MODELS].includes(options.modelId)) throw new Error("Use a supported canonical z-ai/glm model ID");
  if (!["reference", "validation"].includes(options.purpose)) throw new Error("Invalid collection purpose");
  const samplesPerProbe = options.samplesPerProbe ?? (options.purpose === "reference" ? 60 : 50);
  const maxTokens = options.maxTokens ?? 128;
  integer(samplesPerProbe, 6, 1000, "samplesPerProbe");
  integer(maxTokens, 16, 4096, "maxTokens");
  const requestModelId = options.requestModelId ?? options.modelId.slice("z-ai/".length);
  if (!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(requestModelId)) throw new Error("Invalid request model ID");
  const probes = GLM_CALIBRATION_PROBES.map(p => ({ ...p }));
  const settings = { temperature: 1 as const, max_tokens: maxTokens, stream: false as const };
  return {
    version: 1, purpose: options.purpose, modelId: options.modelId, requestModelId,
    samplesPerProbe, plannedRequests: probes.length * samplesPerProbe, settings, probes,
    // Purpose/count deliberately excluded: independently collected reference/validation must share a protocol.
    protocolHash: hash({ probes: probes.map(p => ({ id: p.id, prompt: p.prompt })), settings }),
  };
}

function chatEndpoint(baseUrl: string, allowLocalGateway = false) {
  const url = new URL(baseUrl);
  const localGateway = allowLocalGateway && url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!localGateway && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("Calibration requires an explicit trusted HTTPS base URL without credentials, query, or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.toString();
}
async function readBoundedJson(response: Response): Promise<any> {
  if (!response.body) throw new Error("empty-body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("response-too-large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function collectCalibration(plan: CalibrationPlan, options: {
  baseUrl: string; apiKey: string; maxRequests: number; execute: boolean;
  timeoutMs?: number; signal?: AbortSignal; fetchFn?: typeof fetch;
  allowLocalGateway?: boolean;
  onProgress?: (completed: number, total: number) => void;
}): Promise<CalibrationArtifact> {
  // Rebuild to reject mutated or caller-forged plans before spending any requests.
  if (JSON.stringify(plan) !== JSON.stringify(makeCalibrationPlan({ ...plan, maxTokens: plan.settings.max_tokens }))) throw new Error("Invalid collection plan");
  if (!options.execute) throw new Error("Explicit execution approval is required");
  integer(options.maxRequests, 1, 9000, "maxRequests");
  if (options.maxRequests < plan.plannedRequests) throw new Error(`Budget too small: ${plan.plannedRequests} requests required`);
  if (!options.apiKey || /[\r\n]/.test(options.apiKey)) throw new Error("Invalid API key");
  const timeoutMs = options.timeoutMs ?? 60000;
  integer(timeoutMs, 100, 180000, "timeoutMs");
  const endpoint = chatEndpoint(options.baseUrl, options.allowLocalGateway);
  const fetchFn = options.fetchFn ?? fetch;
  const startedAt = new Date().toISOString();
  const observations: BiasObservation[] = [];
  const failureKinds: Record<string, number> = {};
  const probes: BiasBaseline["probes"] = {};
  const usage = { promptTokens: 0, completionTokens: 0 };
  let attempts = 0, failures = 0;
  // Sequential, no retries: exactly one attempt per planned slot. No hidden billing multiplier.
  for (const probe of plan.probes) {
    const answers: string[] = [];
    const counts: Record<string, number> = Object.create(null);
    for (let slot = 0; slot < plan.samplesPerProbe; slot++) {
      if (options.signal?.aborted) throw new Error("Calibration canceled");
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      attempts++;
      try {
        const response = await fetchFn(endpoint, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({ model: plan.requestModelId, messages: [{ role: "user", content: probe.prompt }], ...plan.settings }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new Error(`http-${response.status}`);
        }
        const data = await readBoundedJson(response);
        const u = data?.usage;
        if (Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0) usage.promptTokens += u.prompt_tokens;
        if (Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0) usage.completionTokens += u.completion_tokens;
        const choice = data?.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason === "length") throw new Error("truncated-answer");
        if (typeof content !== "string" || choice?.message?.tool_calls?.length) throw new Error("invalid-answer");
        // Never save raw content/errors/headers or returned model claims. Only compact answer tokens.
        if (content.includes(options.apiKey)) throw new Error("credential-in-answer");
        const answer = normalizeBiasAnswer(content) || "(blank)";
        answers.push(answer);
        counts[answer] = (counts[answer] ?? 0) + 1;
      } catch (error) {
        if (options.signal?.aborted) throw new Error("Calibration canceled");
        const message = error instanceof Error ? error.message : "";
        const kind = /^(http-\d{3}|response-too-large|empty-body|truncated-answer|invalid-answer|credential-in-answer)$/.test(message)
          ? message : controller.signal.aborted ? "timeout" : "transport-or-json";
        failures++;
        failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
        // Do not burn the remainder of the budget on a broken credential/model.
        if (/^http-(400|401|403|404)$/.test(kind)) throw new Error(`Calibration stopped: ${kind}`);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      }
      options.onProgress?.(attempts, plan.plannedRequests);
    }
    observations.push({ probeId: probe.id, answers });
    probes[probe.id] = counts;
  }
  const completedAt = new Date().toISOString();
  return {
    version: 1, kind: "glm-bias-calibration", state: "draft", collectionId: randomUUID(), startedAt, completedAt,
    endpoint, plan, observations, attempts, failures, failureKinds, usage,
    baseline: { modelId: plan.modelId, capturedAt: completedAt, sampleCount: observations.reduce((n, o) => n + o.answers.length, 0), probes },
  };
}

export function parseCalibrationArtifact(input: unknown): CalibrationArtifact {
  const a = input as CalibrationArtifact;
  if (!a || a.version !== 1 || a.kind !== "glm-bias-calibration" || a.state !== "draft" ||
      typeof a.collectionId !== "string" || !a.collectionId || !a.plan || !a.baseline || !Array.isArray(a.observations)) {
    throw new Error("Invalid calibration artifact");
  }
  const expected = makeCalibrationPlan({ ...a.plan, maxTokens: a.plan.settings?.max_tokens });
  if (JSON.stringify(expected) !== JSON.stringify(a.plan)) throw new Error("Invalid artifact plan");
  if (a.attempts !== a.plan.plannedRequests || !Number.isSafeInteger(a.failures) || a.failures < 0 ||
      !Number.isFinite(Date.parse(a.startedAt)) || !Number.isFinite(Date.parse(a.completedAt)) ||
      Date.parse(a.completedAt) < Date.parse(a.startedAt)) throw new Error("Invalid collection metadata");
  const rebuilt: BiasBaseline["probes"] = {};
  let total = 0;
  if (a.observations.length !== expected.probes.length) throw new Error("Incomplete probe coverage");
  for (let i = 0; i < expected.probes.length; i++) {
    const o = a.observations[i];
    if (o.probeId !== expected.probes[i].id || !Array.isArray(o.answers) || o.answers.length > expected.samplesPerProbe) throw new Error("Invalid observations");
    const counts: Record<string, number> = Object.create(null);
    for (const answer of o.answers) {
      if (typeof answer !== "string" || !(answer === "(blank)" || /^[a-z0-9]{1,16}$/.test(answer))) throw new Error("Invalid normalized answer");
      counts[answer] = (counts[answer] ?? 0) + 1;
      total++;
    }
    rebuilt[o.probeId] = counts;
  }
  if (a.failures !== a.attempts - total || a.baseline.modelId !== expected.modelId ||
      a.baseline.sampleCount !== total || a.baseline.capturedAt !== a.completedAt ||
      hash(rebuilt) !== hash(a.baseline.probes)) throw new Error("Artifact counts do not match observations");
  return a;
}

export function validateCalibration(references: CalibrationArtifact[], holdouts: CalibrationArtifact[]) {
  references.forEach(parseCalibrationArtifact);
  holdouts.forEach(parseCalibrationArtifact);
  if (!references.length || !holdouts.length) throw new Error("Reference and independent validation artifacts required");
  if (references.some(a => a.plan.purpose !== "reference") || holdouts.some(a => a.plan.purpose !== "validation")) throw new Error("Wrong artifact purpose");
  const ids = [...references, ...holdouts].map(a => a.collectionId);
  if (new Set(ids).size !== ids.length) throw new Error("Reference/validation collections must be independent");
  if (holdouts.some(h => !references.some(r => r.plan.modelId === h.plan.modelId) &&
      !BIAS_BASELINES.some(b => b.modelId === h.plan.modelId))) throw new Error("Validation model has no reference distribution");
  // Disallow overlapping collection windows at the same endpoint/model (including relabelled copies).
  for (const r of references) for (const h of holdouts) {
    if (r.plan.modelId === h.plan.modelId && r.endpoint === h.endpoint &&
        Date.parse(r.startedAt) <= Date.parse(h.completedAt) && Date.parse(h.startedAt) <= Date.parse(r.completedAt)) {
      throw new Error("Reference/validation collection windows overlap");
    }
  }
  const protocols = new Set([...references, ...holdouts].map(a => a.plan.protocolHash));
  if (protocols.size !== 1) throw new Error("Sampling protocols differ");
  if (new Set(references.map(a => a.plan.modelId)).size !== references.length) throw new Error("Duplicate reference model");
  if (references.some(a => a.failures || a.plan.samplesPerProbe < 60) || holdouts.some(a => a.failures || a.plan.samplesPerProbe < 50)) {
    throw new Error("Validation requires complete reference >=60 and holdout >=50 samples per probe");
  }
  const newIds = new Set(references.map(a => a.plan.modelId));
  const bundled = BIAS_BASELINES.filter(b => b.modelId.startsWith("z-ai/") && !newIds.has(b.modelId));
  const candidates = [...bundled, ...references.map(a => a.baseline)];
  const diagnostics = holdouts.map(h => {
    const byId = new Map(h.observations.map(o => [o.probeId, o.answers]));
    const batches = Math.min(...GLM_CALIBRATION_PROBES.map(p => Math.floor((byId.get(p.id)?.length ?? 0) / p.samples)));
    let correct = 0, wrong = 0, abstained = 0;
    const decisions = [];
    for (let i = 0; i < batches; i++) {
      const obs = GLM_CALIBRATION_PROBES.map(p => ({ probeId: p.id, answers: byId.get(p.id)!.slice(i * p.samples, (i + 1) * p.samples) }));
      // Provisional old thresholds ONLY; no old policy/accuracy claim is attached to the expanded set.
      const r = scoreV3HDistributionFingerprint(obs, candidates, {
        minConfidence: glmPolicy.minConfidence, minLogLikelihoodGap: glmPolicy.minLogLikelihoodGap,
        minProbeVoteMargin: glmPolicy.minProbeVoteMargin, minAvgLogLikelihood: glmPolicy.minAvgLogLikelihood,
      });
      if (r.abstained) abstained++;
      else if (r.topModel === h.plan.modelId) correct++;
      else wrong++;
      decisions.push({ topModel: r.topModel, abstained: r.abstained, posterior: r.confidence, avgLogLikelihood: r.avgLogLikelihood, gap: r.logLikelihoodGap });
    }
    return { modelId: h.plan.modelId, batches, correct, wrong, abstained, decisions };
  });
  return {
    version: 1, state: "experimental-not-validated", eligibleForPromotion: false,
    candidateModels: candidates.map(b => b.modelId), protocolHash: references[0].plan.protocolHash,
    referenceCollectionIds: references.map(a => a.collectionId), validationCollectionIds: holdouts.map(a => a.collectionId),
    missingNewReferences: GLM_CALIBRATION_MODELS.filter(id => !newIds.has(id)),
    missingCandidateHoldouts: candidates.map(b => b.modelId).filter(id => !holdouts.some(h => h.plan.modelId === id)),
    limitations: ["Bundled sibling sampling settings are not fully documented", "Inherited thresholds are provisional, not calibrated for the expanded model set", "Independent out-of-family controls and noise/relay testing still required", "Few disjoint holdout batches cannot establish a high accuracy bound", "Artifacts record operator-supplied provenance, not proof of upstream identity", "This report never activates a runtime policy"],
    diagnostics,
  };
}
