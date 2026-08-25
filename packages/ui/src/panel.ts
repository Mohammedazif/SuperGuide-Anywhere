import type { GrantTier, Quota } from "@sga/contract/public";

export type ActivityState = "idle" | "running" | "paused";

export interface PanelCallbacks {
  onTask(text: string): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

export interface PanelHandle {
  host: HTMLDivElement;
  setTier(tier: GrantTier): void;
  setActivity(state: ActivityState): void;
  setQuota(quota: Quota | null): void;
  appendLine(text: string): void;
  showConfirmation(decide: (approved: boolean) => void): void;
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

export function createPanel(doc: Document, hostId: string, callbacks: PanelCallbacks): PanelHandle {
  const host = doc.createElement("div");
  host.id = hostId;
  const shadow = host.attachShadow({ mode: "closed" });

  let tier: GrantTier = "observe";
  let activity: ActivityState = "idle";

  const badge = doc.createElement("button");
  badge.textContent = "SG";
  badge.style.cssText =
    "position:fixed;right:12px;bottom:12px;width:40px;height:40px;border-radius:20px;" +
    "z-index:2147483647;border:none;color:#fff;cursor:pointer;" +
    "font:600 13px/40px system-ui,sans-serif;text-align:center;padding:0";

  const panel = doc.createElement("div");
  panel.style.cssText =
    "position:fixed;right:12px;bottom:64px;width:280px;height:200px;z-index:2147483647;" +
    "background:#fff;border:1px solid #c8c8d8;border-radius:10px;display:none;" +
    "box-shadow:0 4px 16px rgba(0,0,0,0.25);font:12px/1.4 system-ui,sans-serif;color:#1a1a2e";

  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "What are you stuck on?";
  input.style.cssText =
    "position:absolute;top:8px;left:8px;right:8px;height:28px;box-sizing:border-box;" +
    "width:calc(100% - 16px);border:1px solid #c8c8d8;border-radius:6px;padding:0 8px;font:inherit";

  const controls = doc.createElement("div");
  controls.style.cssText =
    "position:absolute;top:44px;left:8px;right:8px;height:20px;display:flex;gap:8px;" +
    "align-items:center";
  const stop = doc.createElement("button");
  stop.textContent = "Stop";
  const pause = doc.createElement("button");
  pause.textContent = "Pause";
  for (const button of [stop, pause]) {
    button.style.cssText =
      "width:60px;height:20px;border-radius:5px;border:1px solid #c8c8d8;background:#f2f3f8;" +
      "font:11px system-ui,sans-serif;cursor:pointer;padding:0";
  }
  const quotaText = doc.createElement("span");
  quotaText.style.cssText = "margin-left:auto;color:#666;font-size:11px";
  controls.append(stop, pause, quotaText);

  const log = doc.createElement("div");
  log.style.cssText =
    "position:absolute;top:68px;left:8px;right:8px;bottom:8px;overflow-y:auto;" +
    "white-space:pre-wrap;word-break:break-word";

  panel.append(input, controls, log);
  shadow.append(badge, panel);

  const paint = (): void => {
    badge.style.background = TIER_COLOR[tier];
    badge.style.boxShadow = ACTIVITY_RING[activity];
    badge.title =
      activity === "paused"
        ? `${TIER_TITLE[tier]} (paused)`
        : activity === "running"
          ? `${TIER_TITLE[tier]} (working)`
          : TIER_TITLE[tier];
    pause.textContent = activity === "paused" ? "Resume" : "Pause";
  };
  paint();

  badge.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });
  stop.addEventListener("click", () => {
    callbacks.onStop();
  });
  pause.addEventListener("click", () => {
    if (activity === "paused") callbacks.onResume();
    else callbacks.onPause();
  });

  const appendLine = (text: string): void => {
    const line = doc.createElement("div");
    line.textContent = text;
    line.style.marginBottom = "4px";
    log.append(line);
    log.scrollTop = log.scrollHeight;
  };

  input.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" && input.value.trim().length > 0) {
      callbacks.onTask(input.value.trim());
      appendLine(`you: ${input.value.trim()}`);
      input.value = "";
    }
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
    // The decision bar sits at a fixed position inside the panel so the person
    // always finds it in the same place, however long the conversation is.
    showConfirmation: (decide) => {
      panel.style.display = "block";
      const bar = doc.createElement("div");
      bar.style.cssText =
        "position:absolute;left:8px;right:8px;bottom:8px;height:26px;display:flex;gap:8px;" +
        "background:#fff;border-top:1px solid #c8c8d8;padding-top:4px";
      const approve = doc.createElement("button");
      approve.textContent = "Approve";
      const decline = doc.createElement("button");
      decline.textContent = "Decline";
      for (const button of [approve, decline]) {
        button.style.cssText =
          "flex:1;border-radius:6px;border:1px solid #c8c8d8;background:#f2f3f8;" +
          "font:inherit;cursor:pointer;padding:0";
      }
      const settle = (approved: boolean): void => {
        bar.remove();
        appendLine(approved ? "you approved" : "you declined");
        decide(approved);
      };
      approve.addEventListener("click", () => {
        settle(true);
      });
      decline.addEventListener("click", () => {
        settle(false);
      });
      bar.append(approve, decline);
      panel.append(bar);
    },
    open: () => {
      panel.style.display = "block";
    },
    remove: () => {
      host.remove();
    },
  };
}
