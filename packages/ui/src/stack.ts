import { isOrphanedWorld, runOrphanSafe } from "./orphan";

export const HOST_STACK =
  "position:fixed;inset:auto;right:0;bottom:0;width:0;height:0;margin:0;padding:0;" +
  "border:none;overflow:visible;background:transparent;pointer-events:none;z-index:2147483647";

export function styleHost(host: HTMLElement): void {
  host.style.cssText = HOST_STACK;
  if (popoverSupported(host)) host.setAttribute("popover", "manual");
}

export function popoverSupported(host: HTMLElement): boolean {
  return typeof host.showPopover === "function";
}

export function isPopoverOpen(host: HTMLElement): boolean {
  try {
    return host.matches(":popover-open");
  } catch (error) {
    if (error instanceof DOMException || error instanceof SyntaxError || isOrphanedWorld(error)) {
      return false;
    }
    throw error;
  }
}

function tryPopover(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof DOMException || isOrphanedWorld(error)) return;
    throw error;
  }
}

function openedInTopLayer(event: Event): boolean {
  return "newState" in event && (event as ToggleEvent).newState === "open";
}

// The closed shadow tree paints atomically with the host. z-index on badge/panel
// cannot escape that, so the host itself must sit at the top of the page stack.
// Native dialogs still win via the top layer; popover puts us in that layer too.
export function promoteHost(host: HTMLElement, forceRestack: boolean): void {
  if (!host.isConnected || !popoverSupported(host)) return;
  tryPopover(() => {
    const open = isPopoverOpen(host);
    if (open && !forceRestack) return;
    if (open) host.hidePopover();
    host.showPopover();
  });
}

export function hideHostPopover(host: HTMLElement): void {
  if (popoverSupported(host) && isPopoverOpen(host)) {
    tryPopover(() => {
      host.hidePopover();
    });
  }
}

export function whenConnected(
  doc: Document,
  host: HTMLElement,
  onConnected: () => void,
): () => void {
  if (host.isConnected) {
    onConnected();
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    runOrphanSafe(
      () => {
        if (!host.isConnected) return;
        observer.disconnect();
        onConnected();
      },
      () => {
        observer.disconnect();
      },
    );
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}

export function stayOnTop(doc: Document, host: HTMLElement): () => void {
  const onToggle = (event: Event): void => {
    runOrphanSafe(() => {
      if (event.target === host || !openedInTopLayer(event)) return;
      promoteHost(host, true);
    }, disconnect);
  };
  const disconnect = (): void => {
    doc.removeEventListener("toggle", onToggle, true);
  };
  doc.addEventListener("toggle", onToggle, true);
  return disconnect;
}
