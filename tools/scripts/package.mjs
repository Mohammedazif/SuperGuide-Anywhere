import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(REPO_ROOT, "apps/extension/dist");
const OUT_DIR = join(REPO_ROOT, "dist-package");
const OUT = join(OUT_DIR, "superguide-anywhere.zip");

if (!existsSync(join(DIST, "manifest.json"))) {
  console.error("apps/extension/dist is not built: run pnpm build first");
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync("zip", ["-r", "-X", OUT, "."], {
  cwd: DIST,
  encoding: "utf8",
});
if (result.status !== 0) {
  console.error(result.stderr || "zip failed");
  process.exit(1);
}
console.log(`packaged ${OUT}`);
