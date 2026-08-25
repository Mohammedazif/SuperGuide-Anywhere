import { describe, expect, it } from "vitest";
import type { PageDigest } from "./index";
import { evaluatePredicate } from "./predicate-eval";

const digest: PageDigest = {
  url: "https://app.example.com/settings/team?saved=1",
  title: "Team",
  nodes: [
    {
      id: "e00000001",
      parentId: null,
      role: "status",
      name: "Invitation sent",
      state: { disabled: false },
      inViewport: true,
    },
    {
      id: "e00000002",
      parentId: null,
      role: "checkbox",
      name: "Product updates",
      state: { disabled: false, checked: true },
      inViewport: true,
    },
    {
      id: "e00000003",
      parentId: null,
      role: "textbox",
      name: "City",
      value: "Rotterdam",
      state: { disabled: true },
      inViewport: false,
    },
  ],
};

describe("the predicate evaluator", () => {
  it("element-present and element-absent", () => {
    expect(
      evaluatePredicate(
        { kind: "element-present", target: { role: "status", name: "Invitation sent" } },
        digest,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { kind: "element-present", target: { role: "status", name: "Invitation failed" } },
        digest,
      ),
    ).toBe(false);
    expect(
      evaluatePredicate(
        { kind: "element-absent", target: { role: "status", name: "Invitation failed" } },
        digest,
      ),
    ).toBe(true);
  });

  it("text-matches with and without a target", () => {
    expect(evaluatePredicate({ kind: "text-matches", target: null, contains: "sent" }, digest)).toBe(
      true,
    );
    expect(
      evaluatePredicate(
        {
          kind: "text-matches",
          target: { role: "status", name: "Invitation sent" },
          contains: "Invitation",
        },
        digest,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate({ kind: "text-matches", target: null, contains: "no such words" }, digest),
    ).toBe(false);
  });

  it("url-matches", () => {
    expect(evaluatePredicate({ kind: "url-matches", contains: "saved=1" }, digest)).toBe(true);
    expect(evaluatePredicate({ kind: "url-matches", contains: "/billing" }, digest)).toBe(false);
  });

  it("value-equals", () => {
    expect(
      evaluatePredicate(
        { kind: "value-equals", target: { role: "textbox", name: "City" }, value: "Rotterdam" },
        digest,
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { kind: "value-equals", target: { role: "textbox", name: "City" }, value: "Delft" },
        digest,
      ),
    ).toBe(false);
  });

  it("state-is across every state", () => {
    const checkbox = { role: "checkbox", name: "Product updates" };
    const city = { role: "textbox", name: "City" };
    expect(evaluatePredicate({ kind: "state-is", target: checkbox, state: "checked" }, digest)).toBe(true);
    expect(evaluatePredicate({ kind: "state-is", target: checkbox, state: "unchecked" }, digest)).toBe(false);
    expect(evaluatePredicate({ kind: "state-is", target: city, state: "disabled" }, digest)).toBe(true);
    expect(evaluatePredicate({ kind: "state-is", target: checkbox, state: "enabled" }, digest)).toBe(true);
    expect(evaluatePredicate({ kind: "state-is", target: checkbox, state: "expanded" }, digest)).toBe(false);
    expect(evaluatePredicate({ kind: "state-is", target: checkbox, state: "collapsed" }, digest)).toBe(false);
    expect(
      evaluatePredicate({ kind: "state-is", target: { role: "x", name: "y" }, state: "checked" }, digest),
    ).toBe(false);
  });
});
