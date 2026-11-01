// Route selection controls sampling only; it is never identity evidence.
export const GLM_DISTRIBUTION_MODELS = ["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"] as const;
export const GLM_DISTRIBUTION_PROBE_IDS = ["day", "rand_dwarf", "rand_gem", "rand_month", "rand_city", "rand_bird", "rand_element", "rand_bignum", "rand_fruit"] as const;
export function supportsGlmDistribution(modelId: unknown): modelId is string {
  return typeof modelId === "string" && /^(?:[^/]+\/)?glm-5(?:\.[12]|\.3(?:-flash)?)?$/i.test(modelId);
}
