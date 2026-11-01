import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

describe("runtime reference assets", () => {
  it("copies every required identity reference into a clean dist-only runtime", () => {
    const root = resolve(__dirname, "../..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const scratch = mkdtempSync(join(tmpdir(), "probe-assets-"));
    try {
      mkdirSync(join(scratch, "src"));
      for (const name of ["baselines-v3e-snapshot.json", "glm53-bias-reference-pack.json"])
        copyFileSync(join(root, "src", name), join(scratch, "src", name));
      // tsc does not emit JSON. Execute the actual post-compile build command,
      // starting with an empty output directory rather than the tracked dist snapshot.
      mkdirSync(join(scratch, "dist"));
      const postCompile = pkg.scripts.build.split("tsc && ")[1];
      expect(postCompile).toBeTruthy();
      execFileSync("sh", ["-c", postCompile], { cwd: scratch, stdio: "pipe" });
      for (const name of ["baselines-v3e-snapshot.json", "glm53-bias-reference-pack.json"])
        expect(readFileSync(join(scratch, "dist", name), "utf8")).toBe(readFileSync(join(root, "src", name), "utf8"));
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
});
