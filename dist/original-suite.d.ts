import { type ProbeDefinition } from "./probe-suite.js";
/**
 * Canonical BazaarLink public probe suite, in report display order.
 *
 * Keep this explicit. Group-based filtering is not equivalent: the engine also
 * exposes evaluator and experimental probes that must not silently enter a
 * public relay-integrity run.
 */
export declare const ORIGINAL_SUITE_GROUPS: {
    readonly identity: readonly ["identity_style_en", "identity_style_zh_tw", "identity_reasoning_shape", "identity_self_knowledge", "identity_list_format", "identity_refusal_pattern", "identity_json_discipline", "identity_capability_claim", "ling_kr_num", "ling_jp_pm", "ling_fr_pm", "ling_ru_pres", "tok_count_num", "tok_split_word", "tok_self_knowledge", "code_reverse_list", "code_comment_lang", "code_error_style", "meta_context_len", "meta_thinking_mode", "meta_creator", "zh_creator_plain", "zh_region_boundary_taiwan", "zh_who_built_pressure", "ling_uk_pm", "ling_kr_crisis", "ling_de_chan", "comp_py_float", "comp_large_exp"];
    readonly submodel: readonly ["cap_tower_of_hanoi", "cap_letter_count", "cap_reverse_words", "cap_needle_tiny", "verb_explain_photosynthesis", "perf_bulk_echo", "tok_edge_zwj", "submodel_cutoff", "submodel_capability", "submodel_selfspec", "submodel_refusal", "v3e_refusal_l1_tame", "v3e_refusal_l2_mild", "v3e_refusal_l3_borderline_a", "v3e_refusal_l4_borderline_b", "v3e_refusal_l5_borderline_c", "v3e_refusal_l6_sensitive", "v3e_refusal_l7_strong", "v3e_refusal_l8_hard", "v3e_fmt_bullets", "v3e_fmt_explain_depth", "v3e_fmt_code_lang_tag", "v3e_uncertainty_estimate", "pi_fingerprint", "ikp_t3_domain_fact", "ikp_t4_obscure_fact", "ikp_t4_bio_fact", "ikp_t5_deep_fact", "ikp_t5_codegen_edge"];
    readonly security: readonly ["bedrock_probe", "channel_signature", "data_exfil_url", "markdown_exfil", "code_inject", "dependency_hijack", "npm_supply_chain", "pip_git_url_attack", "pip_bundled_extra", "pip_shell_chain", "npm_registry_injection", "npm_git_url_attack", "uv_install", "cargo_add", "go_install", "brew_install"];
    readonly integrity: readonly ["response_augmentation", "knowledge_cutoff", "symbol_exact", "cache_detection", "token_inflation", "sse_compliance", "thinking_block", "consistency_check", "adaptive_injection", "context_length", "multimodal_image", "multimodal_pdf"];
};
export type OriginalSuiteGroup = keyof typeof ORIGINAL_SUITE_GROUPS;
export declare const ORIGINAL_SUITE_IDS: readonly string[];
/** Exact ordered definitions used by the public probe page and sidecar runs. */
export declare const ORIGINAL_PROBE_SUITE: readonly ProbeDefinition[];
export declare function originalSuiteGroupOf(probeId: string): OriginalSuiteGroup | null;
//# sourceMappingURL=original-suite.d.ts.map