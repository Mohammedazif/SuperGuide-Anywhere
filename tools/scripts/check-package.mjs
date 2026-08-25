import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ZIP = join(REPO_ROOT, "dist-package/superguide-anywhere.zip");

if (!existsSync(ZIP)) {
  console.error("dist-package/superguide-anywhere.zip does not exist: run pnpm package first");
  process.exit(1);
}

const failures = [];

const listing = spawnSync("unzip", ["-Z1", ZIP], { encoding: "utf8" });
if (listing.status !== 0) {
  console.error(listing.stderr || "unzip failed");
  process.exit(1);
}
const entries = listing.stdout.split("\n").filter((line) => line.length > 0);

const FORBIDDEN_ENTRIES = [
  [/\.map$/, "a source map"],
  [/(^|\/)\.env/, "an environment file"],
  [/\.test\./, "a test file"],
  [/(^|\/)fixture/, "a test fixture"],
  [/\.ya?ml$/, "an adapter or config file"],
  [/\.pem$/, "a private key"],
  [/(^|\/)node_modules\//, "node_modules"],
];
for (const entry of entries) {
  for (const [pattern, label] of FORBIDDEN_ENTRIES) {
    if (pattern.test(entry)) failures.push(`${entry}: the package must not contain ${label}`);
  }
}

const REQUIRED = [
  "manifest.json",
  "service-worker.js",
  "content-script.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
];
for (const name of REQUIRED) {
  if (!entries.includes(name)) failures.push(`${name} is missing from the package`);
}

const work = mkdtempSync(join(tmpdir(), "sga-package-"));
try {
  const extract = spawnSync("unzip", ["-q", ZIP, "-d", work], { encoding: "utf8" });
  if (extract.status !== 0) {
    console.error(extract.stderr || "unzip extract failed");
    process.exit(1);
  }

  const manifestCheck = spawnSync(
    "node",
    [join(REPO_ROOT, "tools/scripts/check-manifest.mjs"), join(work, "manifest.json")],
    { encoding: "utf8" },
  );
  if (manifestCheck.status !== 0) {
    failures.push(`packaged manifest failed the permission check:\n${manifestCheck.stderr}${manifestCheck.stdout}`);
  }

  for (const html of ["popup.html", "options.html"]) {
    const text = readFileSync(join(work, html), "utf8");
    if (/<script[^>]+src=["']https?:/.test(text)) {
      failures.push(`${html} loads a remote script`);
    }
  }
  for (const entry of entries.filter((name) => name.endsWith(".js"))) {
    const text = readFileSync(join(work, entry), "utf8");
    if (/importScripts\s*\(\s*["']https?:/.test(text) || /import\s*\(\s*["']https?:/.test(text)) {
      failures.push(`${entry} loads remote code`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`check:package verified ${entries.length} entries: store-ready`);
