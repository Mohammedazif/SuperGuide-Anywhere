import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAdapter } from "@sga/adapters";
import type { AdapterSet, SiteAdapter } from "@sga/contract/public";

export function loadAdapterDirectory(directory: string): AdapterSet {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
  const adapters: SiteAdapter[] = files.map((name) =>
    parseAdapter(name, readFileSync(join(directory, name), "utf8")),
  );
  const version = adapters.reduce((highest, adapter) => Math.max(highest, adapter.version), 1);
  return { version, adapters };
}
