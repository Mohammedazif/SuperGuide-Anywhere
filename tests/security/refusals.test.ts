// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type ActionResult,
  type AgentAction,
  type Confirmation,
} from "@sga/contract/public";
import { executeAction, type ExecutorDeps } from "../../packages/executor/src/executor";
import { observe } from "../../packages/observer/src/observe";
import { evaluatePolicy } from "../../packages/policy/src/policy";

const ACTION_ID = "6b3a1a51-52a5-4d11-9f5a-1a3a35a3a001";
const OTHER_ACTION_ID = "6b3a1a51-52a5-4d11-9f5a-1a3a35a3a002";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function pageWith(html: string): { deps: ExecutorDeps; idOf: (selector: string) => string } {
  document.body.innerHTML = html;
  const observation = observe(document);
  return {
    deps: {
      document,
      observe: () => observe(document),
      diff: () => ({ added: [], removed: [], changed: [], urlChanged: null, titleChanged: null }),
      navigate: () => undefined,
      delay: () => Promise.resolve(),
    },
    idOf: (selector: string) => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`no element for ${selector}`);
      const resolvedId = observation.digest.nodes.find(
        (node) => observation.resolve(node.id) === element,
      )?.id;
      if (resolvedId === undefined) throw new Error(`no digest node for ${selector}`);
      return resolvedId;
    },
  };
}

describe("15.4 password field", () => {
  it("refuses to type into a password field", async () => {
    const { deps, idOf } = pageWith(
      '<label>Password <input type="password" value="hunter2"></label>',
    );
    const result = await executeAction(
      { kind: "type", target: { id: idOf("input") }, value: "x" },
      "control",
      deps,
    );
    expect(result).toMatchObject({ status: "refused", reason: "password_field" });
  });

  it("refuses to act at all while a password field is focused", async () => {
    const { deps, idOf } = pageWith(
      '<label>Password <input type="password"></label><button>Save</button>',
    );
    (document.querySelector("input") as HTMLInputElement).focus();
    const result = await executeAction(
      { kind: "click", target: { id: idOf("button") } },
      "control",
      deps,
    );
    expect(result).toMatchObject({ status: "refused", reason: "password_field" });
  });
});

describe("15.4 observe grant, server", () => {
  const targetArb = fc
    .integer({ min: 0, max: 0xffffffff })
    .map((value) => ({ id: `e${value.toString(16).padStart(8, "0")}` }));
  const stateChangingActionArb: fc.Arbitrary<AgentAction> = fc.oneof(
    targetArb.map((target): AgentAction => ({ kind: "click", target })),
    fc
      .record({ target: targetArb, value: fc.string({ maxLength: 40 }) })
      .map((parts): AgentAction => ({ kind: "type", ...parts })),
    fc
      .record({ target: targetArb, checked: fc.boolean() })
      .map((parts): AgentAction => ({ kind: "check", ...parts })),
    targetArb.map((target): AgentAction => ({ kind: "focus", target })),
    targetArb.map((target): AgentAction => ({ kind: "scrollIntoView", target })),
    fc.string({ maxLength: 30 }).map((suffix): AgentAction => ({ kind: "navigate", path: `/${suffix}` })),
  );
  const confirmationArb: fc.Arbitrary<Confirmation | null> = fc.option(
    fc.record({
      actionId: fc.constantFrom(ACTION_ID, OTHER_ACTION_ID),
      paramsHash: fc.constantFrom(HASH, OTHER_HASH),
      approved: fc.boolean(),
    }),
    { nil: null },
  );

  it("refuses every write and sensitive action under tier observe, whatever else is true", () => {
    fc.assert(
      fc.property(
        stateChangingActionArb,
        fc.constantFrom("read" as const, "write" as const, "sensitive" as const),
        fc.boolean(),
        confirmationArb,
        (action, risk, adapterMatched, confirmation) => {
          const verdict = evaluatePolicy({
            actionId: ACTION_ID,
            action,
            paramsHash: HASH,
            risk,
            adapterMatched,
            siteActivated: true,
            tier: "observe",
            confirmation,
          });
          expect(verdict).toEqual({ kind: "refuse", reason: "grant_insufficient" });
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("15.4 observe grant, client", () => {
  it("the executor refuses a state-changing action on an observe turn even when the server wrongly permits it", async () => {
    const { deps, idOf } = pageWith("<button>Delete account</button>");
    const result = await executeAction(
      { kind: "click", target: { id: idOf("button") } },
      "observe",
      deps,
    );
    expect(result).toMatchObject({ status: "refused", reason: "grant_insufficient" });
  });
});

describe("15.4 closed vocabulary", () => {
  it("rejects an unknown action type before dispatch", async () => {
    const { deps, idOf } = pageWith("<button>Save</button>");
    const forged = {
      kind: "detonate",
      target: { id: idOf("button") },
    } as unknown as AgentAction;
    const result: ActionResult = await executeAction(forged, "control", deps);
    expect(result).toMatchObject({ status: "refused", reason: "unknown_action" });
  });
});

describe("15.4 digest redaction", () => {
  it("no serialized digest contains a password value or a non-allowlisted field value", () => {
    const { deps } = pageWith(
      '<label>Password <input type="password" value="hunter2"></label>' +
        '<label>Card number <input type="text" value="4111111111111111"></label>',
    );
    const digest = deps.observe().digest;
    const serialized = JSON.stringify(digest);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("4111111111111111");
  });
});

describe("15.4 confirmation scope and params tampering", () => {
  const click: AgentAction = { kind: "click", target: { id: "e00000001" } };
  const base = {
    action: click,
    risk: "write" as const,
    adapterMatched: true,
    siteActivated: true,
    tier: "control" as const,
  };

  it("approving action A does not authorise action B", () => {
    const confirmation: Confirmation = { actionId: ACTION_ID, paramsHash: HASH, approved: true };
    expect(
      evaluatePolicy({ ...base, actionId: OTHER_ACTION_ID, paramsHash: HASH, confirmation }),
    ).toEqual({ kind: "refuse", reason: "confirmation_mismatch" });
  });

  it("a confirm with a mismatched paramsHash is rejected", () => {
    const confirmation: Confirmation = {
      actionId: ACTION_ID,
      paramsHash: OTHER_HASH,
      approved: true,
    };
    expect(evaluatePolicy({ ...base, actionId: ACTION_ID, paramsHash: HASH, confirmation })).toEqual(
      { kind: "refuse", reason: "confirmation_mismatch" },
    );
  });
});
