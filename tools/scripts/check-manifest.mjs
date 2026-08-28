import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Permission set is a product commitment; adding one must edit this list in the same change.
const EXPECTED_PERMISSIONS = ["activeTab", "scripting", "storage"];
const EXPECTED_OPTIONAL_HOSTS = ["*://*/*"];
const FORBIDDEN_KEYS = ["host_permissions", "content_scripts", "web_accessible_resources"];

function fail(target, problems) {
  for (const problem of problems) {
    console.error(`${target}: ${problem}`);
  }
}

function checkManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const problems = [];

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
  }
  const permissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(permissions) !== JSON.stringify(EXPECTED_PERMISSIONS)) {
    problems.push(
      `permissions are [${permissions.join(", ")}], expected exactly [${EXPECTED_PERMISSIONS.join(", ")}]`,
    );
  }
  const optionalHosts = manifest.optional_host_permissions ?? [];
  if (JSON.stringify(optionalHosts) !== JSON.stringify(EXPECTED_OPTIONAL_HOSTS)) {
    problems.push(
      `optional_host_permissions are [${optionalHosts.join(", ")}], expected exactly [${EXPECTED_OPTIONAL_HOSTS.join(", ")}]`,
    );
  }
  for (const key of FORBIDDEN_KEYS) {
    if (key in manifest) problems.push(`forbidden key present: ${key}`);
  }
  if (manifest.background?.service_worker !== "service-worker.js") {
    problems.push("background.service_worker must be service-worker.js");
  }
  return problems;
}

const explicit = process.argv[2];
const targets =
  explicit !== undefined
    ? [isAbsolute(explicit) ? explicit : join(REPO_ROOT, explicit)]
    : [
        join(REPO_ROOT, "apps/extension/manifest.json"),
        join(REPO_ROOT, "apps/extension/dist/manifest.json"),
      ].filter((path) => existsSync(path));

if (targets.length === 0) {
  console.error("no manifest found to check");
  process.exit(1);
}

let failed = false;
for (const target of targets) {
  const problems = checkManifest(target);
  if (problems.length > 0) {
    failed = true;
    fail(target, problems);
  } else {
    console.log(`${target}: permission set matches the specification exactly`);
  }
}
process.exit(failed ? 1 : 0);
