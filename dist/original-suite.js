"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORIGINAL_PROBE_SUITE = exports.ORIGINAL_SUITE_IDS = exports.ORIGINAL_SUITE_GROUPS = void 0;
exports.originalSuiteGroupOf = originalSuiteGroupOf;
const probe_suite_js_1 = require("./probe-suite.js");
/**
 * Canonical BazaarLink public probe suite, in report display order.
 *
 * Keep this explicit. Group-based filtering is not equivalent: the engine also
 * exposes evaluator and experimental probes that must not silently enter a
 * public relay-integrity run.
 */
exports.ORIGINAL_SUITE_GROUPS = {
    identity: [
        "identity_style_en",
        "identity_style_zh_tw",
        "identity_reasoning_shape",
        "identity_self_knowledge",
        "identity_list_format",
        "identity_refusal_pattern",
        "identity_json_discipline",
        "identity_capability_claim",
        "ling_kr_num",
        "ling_jp_pm",
        "ling_fr_pm",
        "ling_ru_pres",
        "tok_count_num",
        "tok_split_word",
        "tok_self_knowledge",
        "code_reverse_list",
        "code_comment_lang",
        "code_error_style",
        "meta_context_len",
        "meta_thinking_mode",
        "meta_creator",
        "zh_creator_plain",
        "zh_region_boundary_taiwan",
        "zh_who_built_pressure",
        "ling_uk_pm",
        "ling_kr_crisis",
        "ling_de_chan",
        "comp_py_float",
        "comp_large_exp",
    ],
    submodel: [
        "cap_tower_of_hanoi",
        "cap_letter_count",
        "cap_reverse_words",
        "cap_needle_tiny",
        "verb_explain_photosynthesis",
        "perf_bulk_echo",
        "tok_edge_zwj",
        "submodel_cutoff",
        "submodel_capability",
        "submodel_selfspec",
        "submodel_refusal",
        "v3e_refusal_l1_tame",
        "v3e_refusal_l2_mild",
        "v3e_refusal_l3_borderline_a",
        "v3e_refusal_l4_borderline_b",
        "v3e_refusal_l5_borderline_c",
        "v3e_refusal_l6_sensitive",
        "v3e_refusal_l7_strong",
        "v3e_refusal_l8_hard",
        "v3e_fmt_bullets",
        "v3e_fmt_explain_depth",
        "v3e_fmt_code_lang_tag",
        "v3e_uncertainty_estimate",
        "pi_fingerprint",
        "ikp_t3_domain_fact",
        "ikp_t4_obscure_fact",
        "ikp_t4_bio_fact",
        "ikp_t5_deep_fact",
        "ikp_t5_codegen_edge",
    ],
    security: [
        "bedrock_probe",
        "channel_signature",
        "data_exfil_url",
        "markdown_exfil",
        "code_inject",
        "dependency_hijack",
        "npm_supply_chain",
        "pip_git_url_attack",
        "pip_bundled_extra",
        "pip_shell_chain",
        "npm_registry_injection",
        "npm_git_url_attack",
        "uv_install",
        "cargo_add",
        "go_install",
        "brew_install",
    ],
    integrity: [
        "response_augmentation",
        "knowledge_cutoff",
        "symbol_exact",
        "cache_detection",
        "token_inflation",
        "sse_compliance",
        "thinking_block",
        "consistency_check",
        "adaptive_injection",
        "context_length",
        "multimodal_image",
        "multimodal_pdf",
    ],
};
exports.ORIGINAL_SUITE_IDS = [
    ...exports.ORIGINAL_SUITE_GROUPS.identity,
    ...exports.ORIGINAL_SUITE_GROUPS.submodel,
    ...exports.ORIGINAL_SUITE_GROUPS.security,
    ...exports.ORIGINAL_SUITE_GROUPS.integrity,
];
const ORIGINAL_SUITE_ID_SET = new Set(exports.ORIGINAL_SUITE_IDS);
const PROBE_BY_ID = new Map(probe_suite_js_1.PROBE_SUITE.map((probe) => [probe.id, probe]));
if (ORIGINAL_SUITE_ID_SET.size !== 86 || exports.ORIGINAL_SUITE_IDS.length !== 86) {
    throw new Error("Original suite must contain 86 unique probe IDs");
}
const missing = exports.ORIGINAL_SUITE_IDS.filter((id) => !PROBE_BY_ID.has(id));
if (missing.length > 0) {
    throw new Error(`Original suite references missing probes: ${missing.join(", ")}`);
}
/** Exact ordered definitions used by the public probe page and sidecar runs. */
exports.ORIGINAL_PROBE_SUITE = exports.ORIGINAL_SUITE_IDS.map((id) => PROBE_BY_ID.get(id));
function originalSuiteGroupOf(probeId) {
    for (const [group, ids] of Object.entries(exports.ORIGINAL_SUITE_GROUPS)) {
        if (ids.includes(probeId))
            return group;
    }
    return null;
}
//# sourceMappingURL=original-suite.js.map