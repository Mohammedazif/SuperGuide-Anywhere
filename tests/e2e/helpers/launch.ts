import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Worker } from "@playwright/test";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const EXTENSION_ID = "ghdcebndlanhmdeajdbbemcaihpenhoj";
export const DIST_DIR = join(REPO_ROOT, "apps/extension/dist");

export function stageExtension(preHeldHosts: readonly string[]): string {
  if (!existsSync(join(DIST_DIR, "manifest.json"))) {
    throw new Error("extension is not built: run pnpm build first");
  }
  const staged = mkdtempSync(join(tmpdir(), "sga-ext-"));
  cpSync(DIST_DIR, staged, { recursive: true });
  if (preHeldHosts.length > 0) {
    // Chrome's optional-permission dialog is native UI no automation can reach, so the
    // staged test copy pre-holds the fixture hosts; permissions.request then resolves
    // without a prompt and everything downstream of the dialog runs for real. The
    // shipped manifest in dist/ is untouched and asserted separately.
    const manifest = JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    manifest["host_permissions"] = [...preHeldHosts];
    writeFileSync(join(staged, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  return staged;
}

export async function launchWithExtension(staged: string): Promise<BrowserContext> {
  const profile = mkdtempSync(join(tmpdir(), "sga-profile-"));
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${staged}`, `--load-extension=${staged}`],
  });
}

export async function serviceWorkerOf(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  return existing ?? (await context.waitForEvent("serviceworker"));
}
