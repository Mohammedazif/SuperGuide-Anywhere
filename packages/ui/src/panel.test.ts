// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createPanel, type PanelCallbacks } from "./panel";

const callbacks: PanelCallbacks = {
  onTask: () => undefined,
  onStop: () => undefined,
};

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("the overlay panel", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("class");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    document.documentElement.style.backgroundColor = "";
    document.body.replaceChildren();
    document.body.removeAttribute("class");
    document.body.style.backgroundColor = "";
  });

  it("puts the stacking context on the host so a page modal cannot cover the panel", () => {
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.style.position).toBe("fixed");
    expect(panel.host.style.zIndex).toBe("2147483647");
    expect(panel.host.style.pointerEvents).toBe("none");
    if (typeof panel.host.showPopover === "function") {
      expect(panel.host.getAttribute("popover")).toBe("manual");
    }
    panel.remove();
  });

  it("enters the top layer after it is attached, so a native dialog cannot bury it", () => {
    const panel = createPanel(document, "sga-root", callbacks);
    document.documentElement.append(panel.host);
    panel.setTier("control");
    if (typeof panel.host.showPopover === "function") {
      expect(panel.host.matches(":popover-open")).toBe(true);
    }
    panel.remove();
  });

  it("follows an explicit dark class on the page", async () => {
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaTheme).toBe("light");
    document.documentElement.className = "dark";
    await flush();
    expect(panel.host.dataset.sgaTheme).toBe("dark");
    expect(panel.host.style.colorScheme).toBe("dark");
    panel.remove();
  });

  it("follows data-theme attributes and switches live", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaTheme).toBe("dark");
    document.documentElement.setAttribute("data-theme", "light");
    await flush();
    expect(panel.host.dataset.sgaTheme).toBe("light");
    expect(panel.host.style.colorScheme).toBe("light");
    panel.remove();
  });

  it("treats a dark page background as dark when no class is set", () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaTheme).toBe("dark");
    panel.remove();
  });

  it("treats a nested dark surface as dark when html and body are transparent", () => {
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    const shell = document.createElement("div");
    shell.style.backgroundColor = "rgb(18, 18, 18)";
    document.body.append(shell);
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaTheme).toBe("dark");
    panel.remove();
  });

  it("does not throw when matchMedia reports the isolated world is gone", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("Extension context invalidated.");
      },
    });
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaTheme).toBe("light");
    panel.remove();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("locks the page only while control is running", () => {
    const panel = createPanel(document, "sga-root", callbacks);
    expect(panel.host.dataset.sgaLocked).toBe("false");
    panel.setActivity("running");
    expect(panel.host.dataset.sgaLocked).toBe("false");
    panel.setTier("control");
    panel.setActivity("running");
    expect(panel.host.dataset.sgaLocked).toBe("true");
    panel.setActivity("paused");
    expect(panel.host.dataset.sgaLocked).toBe("false");
    panel.remove();
  });

  it("keeps the chat open while the agent is running", () => {
    const panel = createPanel(document, "sga-root", callbacks);
    panel.setTier("control");
    panel.setActivity("running");
    panel.appendLine("you: change theme");
    panel.setThinking("Working on this page");
    panel.recordStep("Clicked Settings", true);
    panel.appendLine("you: connect slack");
    panel.recordStep("Clicked Slack", true);
    panel.setActivity("running");
    panel.remove();
  });

  it("blocks page keystrokes while locked", () => {
    const panel = createPanel(document, "sga-root", callbacks);
    document.documentElement.append(panel.host);
    panel.setTier("control");
    panel.setActivity("running");
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    panel.remove();
  });

  it("stops watching the page after remove", async () => {
    const panel = createPanel(document, "sga-root", callbacks);
    panel.remove();
    document.documentElement.className = "dark";
    await flush();
    expect(panel.host.isConnected).toBe(false);
  });
});
