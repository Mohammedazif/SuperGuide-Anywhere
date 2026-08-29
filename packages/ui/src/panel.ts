import type { GrantTier, Quota } from "@sga/contract/public";
import { createActLayer } from "./act";
import { hideHostPopover, promoteHost, stayOnTop, styleHost, whenConnected } from "./stack";
import { paintBubble, paintTheme, THEMES, watchTheme } from "./theme";

export type ActivityState = "idle" | "running" | "paused";

export interface PanelCallbacks {
  onTask(text: string): void;
  onStop(): void;
}

export interface PanelHandle {
  host: HTMLDivElement;
  setTier(tier: GrantTier): void;
  setActivity(state: ActivityState): void;
  setQuota(quota: Quota | null): void;
  appendLine(text: string): void;
  setThinking(text: string | null): void;
  recordStep(label: string, ok: boolean): void;
  showConfirmation(decide: (approved: boolean) => void, summary?: string): void;
  highlightTarget(element: Element): Promise<void>;
  open(): void;
  remove(): void;
}

const TIER_COLOR: Record<GrantTier, string> = { observe: "#5a6b94", control: "#2b3a67" };
const TIER_TITLE: Record<GrantTier, string> = {
  observe: "SuperGuide Anywhere: observing this site",
  control: "SuperGuide Anywhere: can act on this site",
};
const ACTIVITY_RING: Record<ActivityState, string> = {
  idle: "0 0 0 0 transparent",
  running: "0 0 0 3px #3f9d63",
  paused: "0 0 0 3px #c98a1b",
};
const PAGE_EVENTS = [
  "keydown",
  "keypress",
  "keyup",
  "paste",
  "beforeinput",
  "compositionstart",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "touchstart",
  "touchend",
  "contextmenu",
  "focusin",
  "focusout",
  "wheel",
  "touchmove",
] as const;

function stopPagePropagation(event: Event): void {
  event.stopPropagation();
}

function isolateFromPage(node: EventTarget): void {
  for (const name of PAGE_EVENTS) {
    node.addEventListener(name, stopPagePropagation);
  }
}

export function createPanel(doc: Document, hostId: string, callbacks: PanelCallbacks): PanelHandle {
  const host = doc.createElement("div");
  host.id = hostId;
  styleHost(host);
  // Closed shadow retargets keys to this host. GitHub (and others) skip shortcuts on contenteditable.
  host.setAttribute("contenteditable", "true");
  host.setAttribute("spellcheck", "false");
  host.tabIndex = -1;
  host.style.outline = "none";
  host.style.caretColor = "transparent";
  const shadow = host.attachShadow({ mode: "closed" });
  isolateFromPage(shadow);
  isolateFromPage(host);
  host.addEventListener("beforeinput", (event) => {
    const origin = typeof event.composedPath === "function" ? event.composedPath()[0] : event.target;
    if (origin === host) event.preventDefault();
  });

  let tier: GrantTier = "observe";
  let activity: ActivityState = "idle";
  let decisionBar: HTMLDivElement | null = null;
  let panelOpen = false;
  let thinking: HTMLDivElement | null = null;
  let stepsFold: HTMLDetailsElement | null = null;
  let stepsList: HTMLUListElement | null = null;
  let completedCount = 0;
  let failedCount = 0;

  const badge = doc.createElement("button");
  badge.textContent = "SG";
  badge.style.cssText =
    "position:fixed;right:16px;bottom:16px;width:44px;height:44px;border-radius:22px;" +
    "z-index:2147483647;border:none;color:#fff;cursor:pointer;pointer-events:auto;" +
    "font:650 13px/44px system-ui,sans-serif;text-align:center;padding:0";

  const panel = doc.createElement("div");
  panel.style.cssText =
    "position:fixed;right:16px;bottom:72px;width:min(380px,calc(100vw - 32px));" +
    "height:min(480px,calc(100vh - 104px));z-index:2147483647;border-radius:16px;" +
    "display:none;flex-direction:column;overflow:hidden;pointer-events:auto;" +
    "font:13px/1.45 system-ui,sans-serif";

  const header = doc.createElement("div");
  header.style.cssText =
    "display:flex;align-items:center;gap:8px;flex-shrink:0;height:48px;padding:0 12px";

  const titleWrap = doc.createElement("div");
  titleWrap.style.cssText = "flex:1;min-width:0";
  const title = doc.createElement("div");
  title.textContent = "SuperGuide";
  title.style.cssText = "font:650 13px/1.2 system-ui,sans-serif";
  const status = doc.createElement("div");
  status.textContent = "Ready";
  status.style.cssText = "font:12px/1.2 system-ui,sans-serif;margin-top:2px";
  titleWrap.append(title, status);

  const quotaText = doc.createElement("span");
  quotaText.style.cssText = "font:11px/1 system-ui,sans-serif;white-space:nowrap";
  header.append(titleWrap, quotaText);

  const log = doc.createElement("div");
  log.style.cssText =
    "flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px";

  const emptyHint = doc.createElement("div");
  emptyHint.textContent = "Describe the task. SuperGuide will work through it on this page.";
  emptyHint.style.cssText =
    "margin:auto;text-align:center;max-width:260px;font:12px/1.5 system-ui,sans-serif";
  log.append(emptyHint);

  const composer = doc.createElement("div");
  composer.style.cssText =
    "display:flex;align-items:center;gap:8px;flex-shrink:0;padding:10px 12px";

  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "What are you stuck on?";
  input.style.cssText =
    "flex:1;height:36px;box-sizing:border-box;border:1px solid;border-radius:18px;" +
    "padding:0 14px;font:13px/36px system-ui,sans-serif;outline:none;min-width:0";

  const send = doc.createElement("button");
  send.textContent = "Send";
  send.style.cssText =
    "height:36px;padding:0 14px;border-radius:18px;border:1px solid;cursor:pointer;" +
    "font:650 12px/36px system-ui,sans-serif";
  composer.append(input, send);

  panel.append(header, log, composer);
  shadow.append(badge, panel);

  const focusComposer = (): void => {
    if (typeof input.focus === "function") input.focus();
  };

  const setPanelOpen = (open: boolean): void => {
    panelOpen = open;
    panel.style.display = open ? "flex" : "none";
    if (open) focusComposer();
  };

  const act = createActLayer(doc, shadow, host, () => {
    callbacks.onStop();
  });

  const syncLock = (): void => {
    act.setLocked(tier === "control" && activity === "running");
  };

  const paintChrome = (): void => {
    paintTheme(doc, {
      host,
      panel,
      header,
      composer,
      input,
      send,
      log,
      title,
      status,
      quotaText,
      controls: [],
      decisionBar,
      emptyHint: emptyHint.isConnected ? emptyHint : null,
    });
    act.paint(host.dataset.sgaTheme === "dark" ? "dark" : "light");
    const muted = host.dataset.sgaTheme === "dark" ? "#9a9aa8" : "#6b7280";
    if (thinking !== null) thinking.style.color = muted;
    if (stepsFold !== null) {
      const summary = stepsFold.querySelector("summary");
      if (summary instanceof HTMLElement) summary.style.color = muted;
    }
    if (activity === "running") status.style.color = "#3f9d63";
    else if (activity === "paused") status.style.color = "#c98a1b";
  };

  const paint = (): void => {
    badge.style.background = TIER_COLOR[tier];
    badge.style.boxShadow = ACTIVITY_RING[activity];
    badge.title =
      activity === "paused"
        ? `${TIER_TITLE[tier]} (paused)`
        : activity === "running"
          ? `${TIER_TITLE[tier]} (working)`
          : TIER_TITLE[tier];
    status.textContent =
      activity === "paused" ? "Paused" : activity === "running" ? "Working" : "Ready";
    if (activity === "running") status.style.color = "#3f9d63";
    else if (activity === "paused") status.style.color = "#c98a1b";
    if (activity === "running") setPanelOpen(true);
    syncLock();
    promoteHost(host, false);
    if (panelOpen) panel.style.display = "flex";
  };

  paintChrome();
  paint();

  const stopTheme = watchTheme(doc, paintChrome);
  const stopLayer = stayOnTop(doc, host);
  const stopAttach = whenConnected(doc, host, () => {
    paintChrome();
    promoteHost(host, false);
    if (panelOpen) panel.style.display = "flex";
  });
  const detach = (): void => {
    stopTheme();
    stopLayer();
    stopAttach();
  };

  badge.addEventListener("click", () => {
    setPanelOpen(!panelOpen);
  });
  panel.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement) return;
    focusComposer();
  });
  host.addEventListener("focusin", () => {
    if (!panelOpen) return;
    const active = shadow.activeElement;
    if (active === null || active === host) focusComposer();
  });

  const placeBeforeTail = (node: HTMLElement): void => {
    if (thinking !== null) log.insertBefore(node, thinking);
    else log.append(node);
  };

  const beginTask = (): void => {
    setThinking(null);
    stepsFold = null;
    stepsList = null;
    completedCount = 0;
    failedCount = 0;
  };

  const appendLine = (text: string): void => {
    if (activity === "running") setPanelOpen(true);
    if (emptyHint.isConnected) emptyHint.remove();
    const kind =
      text.startsWith("you:") || text.startsWith("you ")
        ? "user"
        : text.startsWith("error:")
          ? "error"
          : "agent";
    if (kind === "user") beginTask();
    const bubble = doc.createElement("div");
    bubble.dataset.kind = kind;
    bubble.textContent = text.startsWith("you: ")
      ? text.slice(5)
      : text.startsWith("error:")
        ? text.slice("error:".length).trim()
        : text;
    bubble.style.cssText =
      "max-width:86%;padding:8px 11px;border-radius:14px;white-space:pre-wrap;word-break:break-word;" +
      "font:13px/1.45 system-ui,sans-serif";
    if (kind === "user") {
      bubble.style.alignSelf = "flex-end";
      bubble.style.borderBottomRightRadius = "4px";
    } else {
      bubble.style.alignSelf = "flex-start";
      bubble.style.borderBottomLeftRadius = "4px";
    }
    const scheme = host.dataset.sgaTheme === "dark" ? "dark" : "light";
    paintBubble(bubble, THEMES[scheme]);
    placeBeforeTail(bubble);
    log.scrollTop = log.scrollHeight;
  };

  const setThinking = (text: string | null): void => {
    if (text === null || text.length === 0) {
      thinking?.remove();
      thinking = null;
      return;
    }
    if (emptyHint.isConnected) emptyHint.remove();
    if (thinking === null) {
      thinking = doc.createElement("div");
      thinking.style.cssText =
        "align-self:flex-start;font:12px/1.45 system-ui,sans-serif;font-style:italic";
      log.append(thinking);
    }
    thinking.textContent = text;
    paintChrome();
    log.scrollTop = log.scrollHeight;
  };

  const stepsSummaryText = (): string => {
    if (failedCount === 0) return `${String(completedCount)} completed`;
    if (completedCount === 0) return `${String(failedCount)} failed`;
    return `${String(completedCount)} completed, ${String(failedCount)} failed`;
  };

  const recordStep = (label: string, ok: boolean): void => {
    if (emptyHint.isConnected) emptyHint.remove();
    if (ok) completedCount += 1;
    else failedCount += 1;
    if (stepsFold === null || stepsList === null) {
      stepsFold = doc.createElement("details");
      stepsFold.style.cssText = "align-self:stretch;font:12px/1.45 system-ui,sans-serif";
      const summary = doc.createElement("summary");
      summary.style.cssText = "cursor:pointer;user-select:none";
      stepsFold.append(summary);
      stepsList = doc.createElement("ul");
      stepsList.style.cssText = "margin:6px 0 0;padding-left:18px";
      stepsFold.append(stepsList);
      if (thinking !== null) log.insertBefore(stepsFold, thinking);
      else log.append(stepsFold);
    }
    const item = doc.createElement("li");
    item.textContent = ok ? label : `${label} (failed)`;
    stepsList.append(item);
    const summary = stepsFold.querySelector("summary");
    if (summary !== null) summary.textContent = stepsSummaryText();
    paintChrome();
    log.scrollTop = log.scrollHeight;
  };

  const submit = (): void => {
    const text = input.value.trim();
    if (text.length === 0) return;
    callbacks.onTask(text);
    appendLine(`you: ${text}`);
    input.value = "";
  };

  input.addEventListener("keydown", (keyEvent) => {
    keyEvent.stopPropagation();
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      submit();
    }
  });
  send.addEventListener("click", () => {
    submit();
  });

  return {
    host,
    setTier: (next) => {
      tier = next;
      paint();
    },
    setActivity: (next) => {
      activity = next;
      paint();
    },
    setQuota: (quota) => {
      quotaText.textContent =
        quota === null ? "" : `${String(quota.used)} of ${String(quota.limit)} today`;
    },
    appendLine,
    setThinking,
    recordStep,
    highlightTarget: (element) => act.highlight(element),
    showConfirmation: (decide, _summary) => {
      setPanelOpen(true);
      promoteHost(host, false);
      setThinking(null);
      decisionBar?.remove();
      const bar = doc.createElement("div");
      decisionBar = bar;
      bar.style.cssText =
        "display:flex;flex-direction:column;gap:8px;flex-shrink:0;padding:8px 12px";
      const preview = doc.createElement("div");
      preview.textContent = "SuperGuide wants approval to take action.";
      preview.style.cssText = "font:650 13px/1.4 system-ui,sans-serif";
      bar.append(preview);
      const actions = doc.createElement("div");
      actions.style.cssText = "display:flex;gap:8px";
      const approve = doc.createElement("button");
      approve.textContent = "Approve";
      const decline = doc.createElement("button");
      decline.textContent = "Decline";
      for (const button of [approve, decline]) {
        button.style.cssText =
          "flex:1;height:32px;border-radius:8px;border:1px solid;cursor:pointer;" +
          "font:650 12px/32px system-ui,sans-serif";
      }
      const settle = (approved: boolean): void => {
        bar.remove();
        if (decisionBar === bar) decisionBar = null;
        decide(approved);
      };
      approve.addEventListener("click", () => {
        settle(true);
      });
      decline.addEventListener("click", () => {
        settle(false);
      });
      actions.append(approve, decline);
      bar.append(actions);
      paintChrome();
      panel.insertBefore(bar, composer);
    },
    open: () => {
      setPanelOpen(true);
      promoteHost(host, false);
    },
    remove: () => {
      detach();
      act.remove();
      hideHostPopover(host);
      host.remove();
    },
  };
}
