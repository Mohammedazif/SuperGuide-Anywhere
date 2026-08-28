import {
  evaluatePredicate,
  isPermittedUnderObserve,
  type ActionResult,
  type AgentAction,
  type DigestDelta,
  type GrantTier,
  type PageDigest,
} from "@sga/contract/public";

export interface ObservationLike {
  digest: PageDigest;
  resolve(id: string): Element | null;
}

export interface ExecutorDeps {
  document: Document;
  observe(): ObservationLike;
  diff(before: PageDigest, after: PageDigest): DigestDelta;
  navigate(path: string): void;
  delay(ms: number): Promise<void>;
  preview?(element: Element): Promise<void>;
}

const SETTLE_MS = 30;
const POLL_MS = 150;

type RealmWindow = Window & typeof globalThis;

function realmOf(element: Element): RealmWindow | null {
  return element.ownerDocument.defaultView;
}

function isPasswordField(element: Element | null): boolean {
  if (element === null) return false;
  return (
    element.tagName.toLowerCase() === "input" &&
    (element.getAttribute("type") ?? "").toLowerCase() === "password"
  );
}

function emptyDelta(): DigestDelta {
  return { added: [], removed: [], changed: [], urlChanged: null, titleChanged: null };
}

function refusal(
  reason: "grant_insufficient" | "password_field" | "stale_target" | "unknown_action",
  detail: string,
): ActionResult {
  return { status: "refused", reason, detail };
}

function dispatchPointerSequence(element: Element): void {
  const win = realmOf(element);
  if (win === null) throw new Error("element has no window");
  const options = { bubbles: true, cancelable: true, composed: true };
  const Pointer = (win as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? win.MouseEvent;
  element.dispatchEvent(new Pointer("pointerdown", options));
  element.dispatchEvent(new win.MouseEvent("mousedown", options));
  element.dispatchEvent(new Pointer("pointerup", options));
  element.dispatchEvent(new win.MouseEvent("mouseup", options));
  (element as HTMLElement).click();
}

function setNativeValue(element: Element, value: string): void {
  const win = realmOf(element);
  if (win === null) throw new Error("element has no window");
  const prototype =
    element instanceof win.HTMLTextAreaElement
      ? win.HTMLTextAreaElement.prototype
      : element instanceof win.HTMLSelectElement
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}

function dispatchValueEvents(element: Element, data: string): void {
  const win = realmOf(element);
  if (win === null) throw new Error("element has no window");
  const InputCtor = (win as { InputEvent?: typeof InputEvent }).InputEvent ?? win.Event;
  element.dispatchEvent(
    new InputCtor("input", {
      bubbles: true,
      composed: true,
      ...(InputCtor === win.Event ? {} : { data }),
    }),
  );
  element.dispatchEvent(new win.Event("change", { bubbles: true }));
}

async function settleAndDiff(
  before: PageDigest,
  deps: ExecutorDeps,
  readBack?: string,
): Promise<ActionResult> {
  await deps.delay(SETTLE_MS);
  const after = deps.observe().digest;
  return {
    status: "completed",
    delta: deps.diff(before, after),
    ...(readBack === undefined ? {} : { readBack }),
  };
}

export async function executeAction(
  action: AgentAction,
  tier: GrantTier,
  deps: ExecutorDeps,
): Promise<ActionResult> {
  if (tier === "observe" && !isPermittedUnderObserve(action.kind)) {
    return refusal(
      "grant_insufficient",
      `${action.kind} is a state-changing action and this site is activated for observation only`,
    );
  }
  if (isPasswordField(deps.document.activeElement)) {
    return refusal("password_field", "a password field is focused; the agent will not act");
  }

  try {
    return await dispatch(action, deps);
  } catch (cause) {
    return {
      status: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
      delta: null,
    };
  }
}

async function dispatch(action: AgentAction, deps: ExecutorDeps): Promise<ActionResult> {
  const observation = deps.observe();
  const before = observation.digest;

  if (action.kind === "navigate") {
    deps.navigate(action.path);
    return { status: "completed", delta: emptyDelta() };
  }

  if (action.kind === "waitFor") {
    const started = Date.now();
    for (;;) {
      const current = deps.observe();
      if (evaluatePredicate(action.predicate, current.digest)) {
        return { status: "completed", delta: deps.diff(before, current.digest) };
      }
      if (Date.now() - started >= action.timeoutMs) {
        return {
          status: "failed",
          error: `waitFor timed out after ${action.timeoutMs}ms`,
          delta: deps.diff(before, current.digest),
        };
      }
      await deps.delay(POLL_MS);
    }
  }

  const element = observation.resolve(action.target.id);
  if (element === null) {
    return refusal(
      "stale_target",
      `${action.target.id} is not present in the current page; a stale id is never re-guessed`,
    );
  }
  if (isPasswordField(element)) {
    return refusal("password_field", "the agent never operates a password field");
  }

  if (deps.preview !== undefined && action.kind !== "readBack") {
    await deps.preview(element);
  }

  switch (action.kind) {
    case "click": {
      dispatchPointerSequence(element);
      return settleAndDiff(before, deps);
    }
    case "type": {
      (element as HTMLElement).focus();
      setNativeValue(element, action.value);
      dispatchValueEvents(element, action.value);
      return settleAndDiff(before, deps);
    }
    case "select": {
      const select = element as HTMLSelectElement;
      const option = Array.from(select.options).find(
        (candidate) =>
          candidate.label.trim() === action.optionLabel ||
          candidate.text.trim() === action.optionLabel,
      );
      if (option === undefined) {
        return {
          status: "failed",
          error: `no option labelled "${action.optionLabel}"`,
          delta: null,
        };
      }
      setNativeValue(select, option.value);
      dispatchValueEvents(select, option.value);
      return settleAndDiff(before, deps);
    }
    case "check": {
      const input = element as HTMLInputElement;
      if (input.checked !== action.checked) {
        dispatchPointerSequence(input);
        if (input.checked !== action.checked) {
          input.checked = action.checked;
          dispatchValueEvents(input, String(action.checked));
        }
      }
      return settleAndDiff(before, deps);
    }
    case "focus": {
      (element as HTMLElement).focus();
      return settleAndDiff(before, deps);
    }
    case "scrollIntoView": {
      (element as HTMLElement).scrollIntoView({ block: "center" });
      return settleAndDiff(before, deps);
    }
    case "readBack": {
      const text = element.textContent.replaceAll(/\s+/g, " ").trim().slice(0, 500);
      return settleAndDiff(before, deps, text);
    }
    default: {
      const exhausted: never = action;
      return refusal("unknown_action", `unrecognised action ${JSON.stringify(exhausted)}`);
    }
  }
}
