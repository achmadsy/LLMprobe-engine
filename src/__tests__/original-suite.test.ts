import { describe, expect, it } from "vitest";
import { PROBE_SUITE } from "../probe-suite.js";
import {
  ORIGINAL_PROBE_SUITE,
  ORIGINAL_SUITE_GROUPS,
  ORIGINAL_SUITE_IDS,
  originalSuiteGroupOf,
} from "../original-suite.js";

describe("original public suite", () => {
  it("matches the authoritative 86-probe membership, order, and section counts", () => {
    expect(ORIGINAL_SUITE_IDS).toHaveLength(86);
    expect(new Set(ORIGINAL_SUITE_IDS).size).toBe(86);
    expect(ORIGINAL_SUITE_GROUPS.identity).toHaveLength(29);
    expect(ORIGINAL_SUITE_GROUPS.submodel).toHaveLength(29);
    expect(ORIGINAL_SUITE_GROUPS.security).toHaveLength(16);
    expect(ORIGINAL_SUITE_GROUPS.integrity).toHaveLength(12);
    expect(ORIGINAL_PROBE_SUITE.map((probe) => probe.id)).toEqual(ORIGINAL_SUITE_IDS);
  });

  it("includes the three Chinese-axis identity probes with English UI metadata", () => {
    for (const id of [
      "zh_creator_plain",
      "zh_region_boundary_taiwan",
      "zh_who_built_pressure",
    ]) {
      const probe = ORIGINAL_PROBE_SUITE.find((item) => item.id === id);
      expect(probe).toBeDefined();
      expect(probe?.group).toBe("identity");
      expect(probe?.label).toMatch(/^Chinese axis/);
      expect(probe?.description).toMatch(/Chinese/);
      expect(originalSuiteGroupOf(id)).toBe("identity");
    }
  });

  it("excludes evaluator and experimental probes from public sidecar runs", () => {
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

    expect(PROBE_SUITE.length).toBeGreaterThan(ORIGINAL_SUITE_IDS.length);
    expect(excluded.every((id) => !ORIGINAL_SUITE_IDS.includes(id))).toBe(true);
  });
});
