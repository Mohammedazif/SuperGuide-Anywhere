import { describe, expect, it } from "vitest";
import type { DigestNode, PageDigest } from "@sga/contract/public";
import { diffDigests } from "./differ";

function node(id: string, name: string, checked?: boolean): DigestNode {
  return {
    id,
    parentId: null,
    role: "checkbox",
    name,
    state: { disabled: false, ...(checked === undefined ? {} : { checked }) },
    inViewport: true,
  };
}

function digest(url: string, title: string, nodes: DigestNode[]): PageDigest {
  return { url, title, nodes };
}

describe("the digest differ", () => {
  const before = digest("https://x.example/a", "A", [
    node("e00000001", "one", false),
    node("e00000002", "two"),
  ]);

  it("reports nothing for identical digests", () => {
    expect(diffDigests(before, structuredClone(before))).toEqual({
      added: [],
      removed: [],
      changed: [],
      urlChanged: null,
      titleChanged: null,
    });
  });

  it("reports added, removed, and changed nodes minimally", () => {
    const after = digest("https://x.example/a", "A", [
      node("e00000001", "one", true),
      node("e00000003", "three"),
    ]);
    const delta = diffDigests(before, after);
    expect(delta.added.map((entry) => entry.id)).toEqual(["e00000003"]);
    expect(delta.removed).toEqual(["e00000002"]);
    expect(delta.changed.map((entry) => entry.id)).toEqual(["e00000001"]);
  });

  it("reports url and title transitions", () => {
    const after = digest("https://x.example/b", "B", before.nodes);
    const delta = diffDigests(before, after);
    expect(delta.urlChanged).toEqual({ from: "https://x.example/a", to: "https://x.example/b" });
    expect(delta.titleChanged).toEqual({ from: "A", to: "B" });
  });
});
