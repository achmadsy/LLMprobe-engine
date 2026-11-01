"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLM_DISTRIBUTION_PROBE_IDS = exports.GLM_DISTRIBUTION_MODELS = void 0;
exports.supportsGlmDistribution = supportsGlmDistribution;
// Route selection controls sampling only; it is never identity evidence.
exports.GLM_DISTRIBUTION_MODELS = ["z-ai/glm-5", "z-ai/glm-5.1", "z-ai/glm-5.2", "z-ai/glm-5.3", "z-ai/glm-5.3-flash"];
exports.GLM_DISTRIBUTION_PROBE_IDS = ["day", "rand_dwarf", "rand_gem", "rand_month", "rand_city", "rand_bird", "rand_element", "rand_bignum", "rand_fruit"];
function supportsGlmDistribution(modelId) {
    return typeof modelId === "string" && /^(?:[^/]+\/)?glm-5(?:\.[12]|\.3(?:-flash)?)?$/i.test(modelId);
}
//# sourceMappingURL=glm-distribution-models.js.map