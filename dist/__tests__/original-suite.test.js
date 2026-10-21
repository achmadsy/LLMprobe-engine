"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const probe_suite_js_1 = require("../probe-suite.js");
const original_suite_js_1 = require("../original-suite.js");
(0, vitest_1.describe)("original public suite", () => {
    (0, vitest_1.it)("matches the authoritative 86-probe membership, order, and section counts", () => {
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_SUITE_IDS).toHaveLength(86);
        (0, vitest_1.expect)(new Set(original_suite_js_1.ORIGINAL_SUITE_IDS).size).toBe(86);
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_SUITE_GROUPS.identity).toHaveLength(29);
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_SUITE_GROUPS.submodel).toHaveLength(29);
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_SUITE_GROUPS.security).toHaveLength(16);
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_SUITE_GROUPS.integrity).toHaveLength(12);
        (0, vitest_1.expect)(original_suite_js_1.ORIGINAL_PROBE_SUITE.map((probe) => probe.id)).toEqual(original_suite_js_1.ORIGINAL_SUITE_IDS);
    });
    (0, vitest_1.it)("includes the three Chinese-axis identity probes with English UI metadata", () => {
        for (const id of [
            "zh_creator_plain",
            "zh_region_boundary_taiwan",
            "zh_who_built_pressure",
        ]) {
            const probe = original_suite_js_1.ORIGINAL_PROBE_SUITE.find((item) => item.id === id);
            (0, vitest_1.expect)(probe).toBeDefined();
            (0, vitest_1.expect)(probe?.group).toBe("identity");
            (0, vitest_1.expect)(probe?.label).toMatch(/^Chinese axis/);
            (0, vitest_1.expect)(probe?.description).toMatch(/Chinese/);
            (0, vitest_1.expect)((0, original_suite_js_1.originalSuiteGroupOf)(id)).toBe("identity");
        }
    });
    (0, vitest_1.it)("excludes evaluator and experimental probes from public sidecar runs", () => {
        const excluded = [
            "zh_reasoning",
            "code_gen",
            "instruction_follow",
            "en_reasoning",
            "math_logic",
            "hallucination",
            "censorship",
            "json_output",
            "prompt_injection",
            "prompt_injection_hard",
            "infra_probe",
            "identity_leak",
            "pip_index_url_injection",
            "ac5_signature_verify",
        ];
        (0, vitest_1.expect)(probe_suite_js_1.PROBE_SUITE.length).toBeGreaterThan(original_suite_js_1.ORIGINAL_SUITE_IDS.length);
        (0, vitest_1.expect)(excluded.every((id) => !original_suite_js_1.ORIGINAL_SUITE_IDS.includes(id))).toBe(true);
    });
});
//# sourceMappingURL=original-suite.test.js.map