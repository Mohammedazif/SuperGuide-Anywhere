import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(REPO_ROOT, "apps/extension/dist");

function distManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as Record<string, unknown>;
}

function bundles(): { name: string; text: string }[] {
  return readdirSync(DIST)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, text: readFileSync(join(DIST, name), "utf8") }));
}

describe("15.4 static surface (build the extension first: pnpm build)", () => {
  it("no blanket host access: no <all_urls>, no host_permissions key", () => {
    const manifest = distManifest();
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
    expect(manifest["host_permissions"]).toBeUndefined();
    expect(manifest["permissions"]).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest["optional_host_permissions"]).toEqual(["*://*/*"]);
  });

  it("nothing runs before activation: no static content_scripts entry", () => {
    expect(distManifest()["content_scripts"]).toBeUndefined();
  });

  it("no main-world execution in any bundle", () => {
    for (const bundle of bundles()) {
      expect(bundle.text, bundle.name).not.toMatch(/world\s*:\s*["']MAIN["']/);
    }
  });

  it("no remote or dynamic code in any bundle", () => {
    for (const bundle of bundles()) {
      expect(bundle.text, bundle.name).not.toMatch(/importScripts\s*\(/);
      expect(bundle.text, bundle.name).not.toMatch(/import\s*\(\s*["']https?:/);
      expect(bundle.text, bundle.name).not.toMatch(/new Function\s*\(/);
    }
  });

  it("the forbidden-pattern grep set returns nothing", () => {
    const result = spawnSync("node", [join(REPO_ROOT, "tools/scripts/check-forbidden.mjs")], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it("the built bundle carries no contract/internal marker and no unbundled require", () => {
    const result = spawnSync(
      "node",
      [join(REPO_ROOT, "tools/scripts/check-bundle-boundary.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
