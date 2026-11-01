"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const calibration_journal_js_1 = require("../calibration-journal.js");
(0, vitest_1.describe)("durable calibration journal", () => {
    (0, vitest_1.it)("reuses completed slots without paying again and enforces total budget", async () => {
        const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "calibration-journal-"));
        try {
            let j = new calibration_journal_js_1.CalibrationJournal((0, node_path_1.join)(dir, "calls.jsonl"), 1);
            const call = vitest_1.vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "Diamond!" } }], usage: { prompt_tokens: 12 } }));
            await j.request("model/reference/gem/0", "body", call, "test-secret");
            j.close();
            j = new calibration_journal_js_1.CalibrationJournal((0, node_path_1.join)(dir, "calls.jsonl"), 1);
            const replay = await (await j.request("model/reference/gem/0", "body", call, "test-secret")).json();
            (0, vitest_1.expect)(replay.choices[0].message.content).toBe("diamond");
            (0, vitest_1.expect)(call).toHaveBeenCalledTimes(1);
            await (0, vitest_1.expect)(j.request("new", "body", call, "test-secret")).rejects.toThrow("budget");
            await (0, vitest_1.expect)(j.request("model/reference/gem/0", "different", call, "test-secret")).rejects.toThrow("protocol");
            j.close();
        }
        finally {
            (0, node_fs_1.rmSync)(dir, { recursive: true });
        }
    });
    (0, vitest_1.it)("never resends uncertain attempts after transport or response validation failures", async () => {
        const dir = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "calibration-journal-"));
        try {
            let j = new calibration_journal_js_1.CalibrationJournal((0, node_path_1.join)(dir, "calls.jsonl"), 2);
            const call = vitest_1.vi.fn(async () => { throw new Error("timeout"); });
            await (0, vitest_1.expect)(j.request("slot", "body", call, "test-secret")).rejects.toThrow("timeout");
            j.close();
            j = new calibration_journal_js_1.CalibrationJournal((0, node_path_1.join)(dir, "calls.jsonl"), 2);
            await (0, vitest_1.expect)(j.request("slot", "body", call, "test-secret")).rejects.toThrow("Uncertain");
            (0, vitest_1.expect)(call).toHaveBeenCalledTimes(1);
            (0, vitest_1.expect)(j.uncertain).toEqual(["slot"]);
            j.close();
        }
        finally {
            (0, node_fs_1.rmSync)(dir, { recursive: true });
        }
    });
});
//# sourceMappingURL=calibration-journal.test.js.map