"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_child_process_1 = require("node:child_process");
(0, vitest_1.describe)("runtime reference assets", () => {
    (0, vitest_1.it)("copies every required identity reference into a clean dist-only runtime", () => {
        const root = (0, node_path_1.resolve)(__dirname, "../..");
        const pkg = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(root, "package.json"), "utf8"));
        const scratch = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "probe-assets-"));
        try {
            (0, node_fs_1.mkdirSync)((0, node_path_1.join)(scratch, "src"));
            for (const name of ["baselines-v3e-snapshot.json", "glm53-bias-reference-pack.json"])
                (0, node_fs_1.copyFileSync)((0, node_path_1.join)(root, "src", name), (0, node_path_1.join)(scratch, "src", name));
            // tsc does not emit JSON. Execute the actual post-compile build command,
            // starting with an empty output directory rather than the tracked dist snapshot.
            (0, node_fs_1.mkdirSync)((0, node_path_1.join)(scratch, "dist"));
            const postCompile = pkg.scripts.build.split("tsc && ")[1];
            (0, vitest_1.expect)(postCompile).toBeTruthy();
            (0, node_child_process_1.execFileSync)("sh", ["-c", postCompile], { cwd: scratch, stdio: "pipe" });
            for (const name of ["baselines-v3e-snapshot.json", "glm53-bias-reference-pack.json"])
                (0, vitest_1.expect)((0, node_fs_1.readFileSync)((0, node_path_1.join)(scratch, "dist", name), "utf8")).toBe((0, node_fs_1.readFileSync)((0, node_path_1.join)(root, "src", name), "utf8"));
        }
        finally {
            (0, node_fs_1.rmSync)(scratch, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=build-runtime-assets.test.js.map