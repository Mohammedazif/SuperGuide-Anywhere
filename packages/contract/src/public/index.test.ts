import { describe, expect, it } from "vitest";
import {
  OBSERVE_PERMITTED_ACTIONS,
  actionSchema,
  adapterCapabilitySchema,
  contentToWorkerMessageSchema,
  isPermittedUnderObserve,
  originSchema,
  paramsHashOf,
  sha256Hex,
  siteAdapterSchema,
  stableStringify,
  turnEventSchema,
} from "./index";

describe("canonical serialisation", () => {
  it("sorts object keys at every depth", () => {
    const a = stableStringify({ b: { d: 1, c: [{ z: 1, a: 2 }] }, a: 3 });
    const b = stableStringify({ a: 3, b: { c: [{ a: 2, z: 1 }], d: 1 } });
    expect(a).toBe(b);
    expect(a).toBe('{"a":3,"b":{"c":[{"a":2,"z":1}],"d":1}}');
  });

  it("hashes to the SHA-256 test vector", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces one hash for one meaning regardless of key order", async () => {
    const first = await paramsHashOf({ kind: "type", value: "x", target: { id: "e00000001" } });
    const second = await paramsHashOf({ target: { id: "e00000001" }, value: "x", kind: "type" });
    expect(first).toBe(second);
  });
});

describe("action union", () => {
  it("rejects an unknown action kind before anything else sees it", () => {
    const parsed = actionSchema.safeParse({ kind: "executeScript", target: { id: "e12345678" } });
    expect(parsed.success).toBe(false);
  });

  it("rejects a navigate outside the site", () => {
    expect(actionSchema.safeParse({ kind: "navigate", path: "https://elsewhere.example" }).success).toBe(
      false,
    );
    expect(actionSchema.safeParse({ kind: "navigate", path: "/settings/team" }).success).toBe(true);
  });

  it("permits exactly waitFor and readBack under observe", () => {
    expect([...OBSERVE_PERMITTED_ACTIONS].sort()).toEqual(["readBack", "waitFor"]);
    expect(isPermittedUnderObserve("click")).toBe(false);
    expect(isPermittedUnderObserve("readBack")).toBe(true);
  });
});

describe("adapter schema", () => {
  const capability = {
    id: "seat.invite",
    description: "Invite a member by email",
    risk: "write",
    route: "/settings/team",
    params: [{ name: "email", description: "Address to invite" }],
    steps: [
      { action: "click", target: { role: "button", name: "Invite member" } },
      {
        action: "type",
        target: { role: "textbox", name: "Email" },
        value: { from: "param", name: "email" },
      },
    ],
    expect: [{ kind: "element-present", target: { role: "status", name: "Invitation sent" } }],
  };

  it("accepts a complete capability", () => {
    expect(adapterCapabilitySchema.safeParse(capability).success).toBe(true);
  });

  it("rejects a capability without a success predicate", () => {
    expect(adapterCapabilitySchema.safeParse({ ...capability, expect: [] }).success).toBe(false);
  });

  it("rejects an adapter step carrying executable content", () => {
    const withScript = {
      ...capability,
      steps: [{ action: "script", source: "window.close()" }],
    };
    expect(adapterCapabilitySchema.safeParse(withScript).success).toBe(false);
  });

  it("rejects an unknown top-level adapter key", () => {
    const adapter = {
      host: "app.example.com",
      version: 1,
      routes: [],
      capabilities: [],
      onLoad: "javascript:alert(1)",
    };
    expect(siteAdapterSchema.safeParse(adapter).success).toBe(false);
  });
});

describe("origins", () => {
  it("accepts only a canonical origin", () => {
    expect(originSchema.safeParse("https://app.example.com").success).toBe(true);
    expect(originSchema.safeParse("https://app.example.com/").success).toBe(false);
    expect(originSchema.safeParse("https://app.example.com/path").success).toBe(false);
  });
});

describe("wire discrimination", () => {
  it("parses a turn event by kind", () => {
    const event = turnEventSchema.parse({ kind: "assistant-text", seq: 0, text: "hello" });
    expect(event.kind).toBe("assistant-text");
    expect(turnEventSchema.safeParse({ kind: "eval", seq: 0 }).success).toBe(false);
  });

  it("parses a port message by type", () => {
    const message = contentToWorkerMessageSchema.parse({
      type: "cs:hello",
      origin: "https://app.example.com",
      url: "https://app.example.com/settings",
    });
    expect(message.type).toBe("cs:hello");
  });
});
