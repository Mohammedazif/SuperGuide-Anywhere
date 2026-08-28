import type { GrantsRecord } from "@sga/contract/public";

const SCRIPT_ID_PREFIX = "sga-cs-";

// Chrome match patterns omit ports, so registration is host-wide; CS still confirms origin.
export function originPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function originFromPattern(pattern: string): string | null {
  if (!pattern.endsWith("/*")) return null;
  try {
    const url = new URL(pattern.slice(0, -2));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname.includes("*")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function scriptId(origin: string): string {
  return `${SCRIPT_ID_PREFIX}${origin.replaceAll(/[^a-z0-9]/gi, "-")}`;
}

export async function syncContentScripts(grants: GrantsRecord): Promise<void> {
  const desired = new Map(grants.map((grant) => [scriptId(grant.origin), grant]));
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ours = existing.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX));

  const stale = ours.filter((script) => !desired.has(script.id)).map((script) => script.id);
  if (stale.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: stale });
  }

  const present = new Set(ours.map((script) => script.id));
  const missing = [...desired.entries()].filter(([id]) => !present.has(id));
  if (missing.length > 0) {
    await chrome.scripting.registerContentScripts(
      missing.map(([id, grant]) => ({
        id,
        js: ["content-script.js"],
        matches: [originPattern(grant.origin)],
        runAt: "document_idle",
      })),
    );
  }
}
