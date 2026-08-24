import { PORT_NAME, workerToContentMessageSchema, type GrantTier } from "@sga/contract/public";

const HOST_ID = "sga-root";
const WIDGET_HOST_ID = "sg-root";

function mountIndicator(tier: GrantTier): void {
  if (document.getElementById(HOST_ID) !== null) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const badge = document.createElement("div");
  badge.textContent =
    tier === "control" ? "SuperGuide Anywhere: can act here" : "SuperGuide Anywhere: observing";
  badge.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "z-index:2147483647",
    "padding:6px 10px",
    "border-radius:8px",
    "font:12px/1.4 system-ui,sans-serif",
    tier === "control" ? "background:#2b3a67;color:#fff" : "background:#e8ecf7;color:#1a1a2e",
    "box-shadow:0 2px 8px rgba(0,0,0,0.2)",
  ].join(";");
  shadow.append(badge);
  document.documentElement.append(host);
}

function main(): void {
  if (document.getElementById(HOST_ID) !== null) return;
  if (document.getElementById(WIDGET_HOST_ID) !== null) return;

  const port = chrome.runtime.connect({ name: PORT_NAME });
  port.onMessage.addListener((raw: unknown) => {
    const parsed = workerToContentMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case "sw:status":
        mountIndicator(message.tier);
        return;
      case "sw:event":
      case "sw:execute":
      case "sw:observe":
      case "sw:error":
        return;
      default: {
        const exhausted: never = message;
        throw new Error(`unreachable message ${JSON.stringify(exhausted)}`);
      }
    }
  });
  port.postMessage({ type: "cs:hello", origin: location.origin, url: location.href });
}

main();
