// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AgentAction } from "@sga/contract/public";
import { diffDigests, observe } from "../../observer/src/index";
import { executeAction, type ExecutorDeps } from "./executor";

function setBody(html: string): void {
  document.body.innerHTML = html;
  (document.activeElement as HTMLElement | null)?.blur();
}

function deps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps & { navigated: string[] } {
  const navigated: string[] = [];
  return {
    document,
    observe: () => observe(document),
    diff: diffDigests,
    navigate: (path) => {
      navigated.push(path);
    },
    delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(ms, 5))),
    navigated,
    ...overrides,
  };
}

function idOf(role: string, name: string): string {
  const node = observe(document).digest.nodes.find(
    (candidate) => candidate.role === role && candidate.name === name,
  );
  if (node === undefined) throw new Error(`no ${role} named ${name}`);
  return node.id;
}

describe("the observe grant, client side", () => {
  it("refuses a state-changing action before touching the page, whatever the server said", async () => {
    setBody(`<button id="b">Delete workspace</button>`);
    let clicked = false;
    document.getElementById("b")?.addEventListener("click", () => {
      clicked = true;
    });
    const action: AgentAction = { kind: "click", target: { id: idOf("button", "Delete workspace") } };
    const result = await executeAction(action, "observe", deps());
    expect(result).toMatchObject({ status: "refused", reason: "grant_insufficient" });
    expect(clicked).toBe(false);
  });

  it("still answers readBack under observe", async () => {
    setBody(`<p role="status">All systems normal</p>`);
    const action: AgentAction = { kind: "readBack", target: { id: idOf("status", "All systems normal") } };
    const result = await executeAction(action, "observe", deps());
    expect(result).toMatchObject({ status: "completed", readBack: "All systems normal" });
  });
});

describe("password refusals", () => {
  it("refuses to type into a password field, unconditionally", async () => {
    setBody(`<label>Passphrase <input type="password"></label>`);
    const target = observe(document).digest.nodes.find((node) => node.role === "textbox");
    expect(target).toBeDefined();
    const result = await executeAction(
      { kind: "type", target: { id: target!.id }, value: "hunter" },
      "control",
      deps(),
    );
    expect(result).toMatchObject({ status: "refused", reason: "password_field" });
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("refuses to act at all while a password field is focused", async () => {
    setBody(`<input type="password" id="pw"><button id="b">Continue</button>`);
    (document.getElementById("pw") as HTMLInputElement).focus();
    const result = await executeAction(
      { kind: "click", target: { id: idOf("button", "Continue") } },
      "control",
      deps(),
    );
    expect(result).toMatchObject({ status: "refused", reason: "password_field" });
  });
});

describe("dispatch", () => {
  it("clicks with a real user-like event sequence and activation", async () => {
    setBody(`<button>Save</button>`);
    const seen: string[] = [];
    const button = document.querySelector("button") as HTMLButtonElement;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      button.addEventListener(type, () => seen.push(type));
    }
    const result = await executeAction(
      { kind: "click", target: { id: idOf("button", "Save") } },
      "control",
      deps(),
    );
    expect(result.status).toBe("completed");
    expect(seen).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("submits a form through a button click", async () => {
    setBody(`<form><button type="submit">Send</button></form>`);
    let submitted = false;
    document.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitted = true;
    });
    await executeAction({ kind: "click", target: { id: idOf("button", "Send") } }, "control", deps());
    expect(submitted).toBe(true);
  });

  it("types through the realm's native setter and fires input and change", async () => {
    setBody(`<label>Email <input type="text"></label>`);
    const input = document.querySelector("input") as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    const result = await executeAction(
      { kind: "type", target: { id: idOf("textbox", "Email") }, value: "kim@example.com" },
      "control",
      deps(),
    );
    expect(result.status).toBe("completed");
    expect(input.value).toBe("kim@example.com");
    expect(events).toEqual(["input", "change"]);
  });

  it("checks a checkbox and reports the state change in the delta", async () => {
    setBody(`<label>Updates <input type="checkbox"></label>`);
    const result = await executeAction(
      { kind: "check", target: { id: idOf("checkbox", "Updates") }, checked: true },
      "control",
      deps(),
    );
    expect(result.status).toBe("completed");
    expect((document.querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect(result.status === "completed" && result.delta.changed.length).toBeGreaterThan(0);
  });

  it("selects an option by its label", async () => {
    setBody(
      `<label>Plan <select><option value="g">Growth</option><option value="s">Scale</option></select></label>`,
    );
    const result = await executeAction(
      { kind: "select", target: { id: idOf("combobox", "Plan") }, optionLabel: "Scale" },
      "control",
      deps(),
    );
    expect(result.status).toBe("completed");
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("s");
  });

  it("refuses a stale id rather than guessing a similar element", async () => {
    setBody(`<button>Only button</button>`);
    const result = await executeAction(
      { kind: "click", target: { id: "e00000000" } },
      "control",
      deps(),
    );
    expect(result).toMatchObject({ status: "refused", reason: "stale_target" });
  });

  it("posts the navigation and leaves the page load to the browser", async () => {
    setBody(`<p>anything</p>`);
    const executorDeps = deps();
    const result = await executeAction(
      { kind: "navigate", path: "/settings/team" },
      "control",
      executorDeps,
    );
    expect(result.status).toBe("completed");
    expect(executorDeps.navigated).toEqual(["/settings/team"]);
  });

  it("waitFor resolves when the predicate becomes true and fails honestly on timeout", async () => {
    setBody(`<div id="mount"></div>`);
    setTimeout(() => {
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = "Invitation sent";
      document.getElementById("mount")?.append(status);
    }, 60);
    const success = await executeAction(
      {
        kind: "waitFor",
        predicate: { kind: "element-present", target: { role: "status", name: "Invitation sent" } },
        timeoutMs: 3000,
      },
      "control",
      deps(),
    );
    expect(success.status).toBe("completed");
    expect(success.status === "completed" && success.delta.added.map((node) => node.name)).toContain(
      "Invitation sent",
    );

    const failure = await executeAction(
      {
        kind: "waitFor",
        predicate: { kind: "element-present", target: { role: "status", name: "Never appears" } },
        timeoutMs: 250,
      },
      "control",
      deps(),
    );
    expect(failure.status).toBe("failed");
    expect(failure.status === "failed" && failure.error).toContain("timed out");
  });
});
