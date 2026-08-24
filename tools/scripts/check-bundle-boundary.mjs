import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKER = "sga-contract-internal";
const BUNDLE_DIR = join(REPO_ROOT, "apps/extension/dist");
const MARKER_SOURCE = join(REPO_ROOT, "packages/contract/dist/internal/index.js");

if (!existsSync(BUNDLE_DIR)) {
  console.error("apps/extension/dist does not exist: run pnpm build first");
  process.exit(1);
}
if (!existsSync(MARKER_SOURCE) || !readFileSync(MARKER_SOURCE, "utf8").includes(MARKER)) {
  console.error("the internal marker is missing from the built contract; the probe is dead");
  process.exit(1);
}

const bundles = readdirSync(BUNDLE_DIR).filter((file) => file.endsWith(".js"));
const leaks = bundles.filter((file) => readFileSync(join(BUNDLE_DIR, file), "utf8").includes(MARKER));

if (leaks.length > 0) {
  for (const file of leaks) {
    console.error(`apps/extension/dist/${file} contains the contract/internal marker`);
  }
  process.exit(1);
}
console.log(`check:bundle-boundary scanned ${bundles.length} bundles: no internal marker`);
