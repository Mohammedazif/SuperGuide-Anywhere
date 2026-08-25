import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAdapterDirectory } from "./adapters-fs";

const ADAPTERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../adapters");

describe("the shipped adapter directory", () => {
  it("parses cleanly and carries the fixture-app adapter", () => {
    const set = loadAdapterDirectory(ADAPTERS_DIR);
    expect(set.version).toBeGreaterThanOrEqual(1);
    const fixture = set.adapters.find((adapter) => adapter.host === "127.0.0.1");
    expect(fixture).toBeDefined();
    expect(fixture?.capabilities.map((capability) => capability.id)).toEqual([
      "seat.invite",
      "billing.update-address",
    ]);
    for (const adapter of set.adapters) {
      for (const capability of adapter.capabilities) {
        expect(capability.expect.length).toBeGreaterThan(0);
      }
    }
  });
});
