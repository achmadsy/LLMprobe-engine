// Conservative local orchestration guards. These are not the SaaS implementation.
import { canonicalFamily } from "./model-id-normalize.js";
import { scoreV3HDistributionFingerprint, type BiasBaseline, type BiasObservation } from "./sub-model-v3g-bias-fingerprint.js";

export interface CreatorGuardResult {
  family: string | null;
  confidence: number;
  hardOverride: boolean;
  evidence: string[];
  supportingProbeIds: string[];
  contradictory: boolean;
}
const CREATOR_PROBES = ["zh_creator_plain", "zh_who_built_pressure", "meta_creator", "identity_self_knowledge"];
// Only explicit maker assertions, not a bare vendor name, geopolitical answer, or route label.
const MAKERS: Array<[string, RegExp]> = [
  ["zhipu", /(?:由\s*(?:智谱|智譜|zhipu)|(?:开发者|開發者|开发公司|開發公司|creator|developer)\s*(?:是|为|為|:|is)?\s*(?:智谱|智譜|zhipu)|(?:developed|created|built)\s+by\s+zhipu)/i],
  ["deepseek", /(?:由\s*(?:深度求索|deepseek)|(?:developed|created|built)\s+by\s+deepseek)/i],
  ["qwen", /(?:由\s*(?:阿里巴巴|阿里云|阿里雲|alibaba)|(?:developed|created|built)\s+by\s+alibaba)/i],
  ["anthropic", /(?:由\s*anthropic|(?:developed|created|built)\s+by\s+anthropic)/i],
  ["openai", /(?:由\s*openai|(?:developed|created|built)\s+by\s+openai)/i],
  ["google", /(?:由\s*google|(?:developed|created|built)\s+by\s+google)/i],
];
export function guardCreatorEvidence(responses: Record<string, string>, behaviorScores: Record<string, number>): CreatorGuardResult {
  const votes = new Map<string, string[]>();
  for (const id of CREATOR_PROBES) {
    const text = responses[id];
    if (!text?.trim()) continue;
    // Negated, hypothetical, or quoted assertions are not reliable affirmative self-identification.
    if (/(?:not|never|isn't|wasn't|不是|并非|並非|并不|並不|假设|假設|如果|\bif\b|["“”「」])/i.test(text)) continue;
    const matches = MAKERS.filter(([, pattern]) => pattern.test(text));
    if (matches.length !== 1) continue;
    const family = matches[0][0];
    votes.set(family, [...(votes.get(family) ?? []), id]);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const winner = ranked[0];
  if (!winner) return { family: null, confidence: 0, hardOverride: false, supportingProbeIds: [], contradictory: false, evidence: ["No unambiguous affirmative creator evidence"] };
  const [family, supportingProbeIds] = winner;
  const contradictory = ranked.length > 1;
  const chinese = supportingProbeIds.some(id => id.startsWith("zh_"));
  const corroborated = !contradictory && chinese && supportingProbeIds.length >= 2 && (behaviorScores[family] ?? 0) >= 0.4;
  return { family, supportingProbeIds, contradictory, hardOverride: corroborated,
    // A local rule confidence, not the probability that the endpoint is authentic.
    confidence: corroborated ? 0.95 : 0,
    evidence: [corroborated ? `Creator assertions for ${family} corroborated across prompts and behavioral evidence` :
      contradictory ? "Creator assertions contradict one another; no self-ID override applied" : "Creator assertion lacks cross-prompt/behavioral corroboration; no override applied",
      "Self-identification can be imitated; this guard is not proof of maker or exact model"],
  };
}

export function compareDistributionClusters(observations: BiasObservation[], references: BiasBaseline[]) {
  // Compare identical observations and require complete per-probe reference support. Otherwise
  // a shorter baseline/probe set or missing frequency table can make avgLL incomparable.
  const usable = observations.filter(o => o.answers.length > 0);
  const groups = new Map<string, BiasBaseline[]>();
  for (const ref of references) {
    const family = canonicalFamily(ref.modelId.split("/")[0]);
    groups.set(family, [...(groups.get(family) ?? []), ref]);
  }
  const clusters = [...groups.entries()].map(([family, pool]) => {
    const complete = pool.filter(b => usable.every(o => b.probes[o.probeId] && Object.values(b.probes[o.probeId]).some(n => n > 0)));
    if (!usable.length || complete.length < 2 || complete.length !== pool.length) {
      return { family, comparable: false, reason: "Incomplete equal-probe reference coverage", fit: null as number | null, topModel: null as string | null, sampleCount: 0 };
    }
    // Score the same full probe set even if a historical family policy normally selects fewer.
    // Add no policy: this comparison is fit diagnostics only, never a calibrated override.
    const scored = scoreV3HDistributionFingerprint(usable, complete, { minConfidence: 0, minLogLikelihoodGap: 0, minProbeVoteMargin: -100, minAvgLogLikelihood: -100 });
    const sampleCount = usable.reduce((n, o) => n + o.answers.length, 0);
    const rawScores = Object.entries(scored.scores).sort((a, b) => b[1] - a[1]);
    // The scorer may scope observations under a matched historical policy. Never compare that
    // shorter likelihood to a full-set likelihood; mark it ineligible instead.
    if (scored.sampleCount !== sampleCount) return { family, comparable: false, reason: "Historical policy selects a different probe set", fit: null, topModel: null, sampleCount: scored.sampleCount };
    return { family, comparable: true, reason: "Equal observations; diagnostic only", fit: rawScores[0]?.[1] / sampleCount, topModel: rawScores[0]?.[0] ?? null, sampleCount };
  });
  const valid = clusters.filter(c => c.comparable && Number.isFinite(c.fit)).sort((a, b) => b.fit! - a.fit!);
  return { clusters, bestFamily: valid[0]?.family ?? null,
    fitMargin: valid.length >= 2 ? valid[0].fit! - valid[1].fit! : null,
    canOverrideVerdict: false as const,
    limitations: ["Equal-probe fit is not independently calibrated cross-family evidence", "Incomplete clusters excluded rather than penalized for missing distributions"] };
}
