import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalibrationJournal } from "../calibration-journal.js";

describe("durable calibration journal", () => {
  it("reuses completed slots without paying again and enforces total budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calibration-journal-"));
    try {
      let j = new CalibrationJournal(join(dir, "calls.jsonl"), 1);
      const call = vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "Diamond!" } }], usage: { prompt_tokens: 12 } }));
      await j.request("model/reference/gem/0", "body", call, "test-secret");
      j.close();
      j = new CalibrationJournal(join(dir, "calls.jsonl"), 1);
      const replay: any = await (await j.request("model/reference/gem/0", "body", call, "test-secret")).json();
      expect(replay.choices[0].message.content).toBe("diamond");
      expect(call).toHaveBeenCalledTimes(1);
      await expect(j.request("new", "body", call, "test-secret")).rejects.toThrow("budget");
      await expect(j.request("model/reference/gem/0", "different", call, "test-secret")).rejects.toThrow("protocol");
      j.close();
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("never resends uncertain attempts after transport or response validation failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calibration-journal-"));
    try {
      let j = new CalibrationJournal(join(dir, "calls.jsonl"), 2);
      const call = vi.fn(async () => { throw new Error("timeout"); });
      await expect(j.request("slot", "body", call, "test-secret")).rejects.toThrow("timeout");
      j.close();
      j = new CalibrationJournal(join(dir, "calls.jsonl"), 2);
      await expect(j.request("slot", "body", call, "test-secret")).rejects.toThrow("Uncertain");
      expect(call).toHaveBeenCalledTimes(1);
      expect(j.uncertain).toEqual(["slot"]);
      j.close();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
