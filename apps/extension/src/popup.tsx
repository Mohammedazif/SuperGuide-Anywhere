import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { Quota, SiteGrant } from "@sga/contract/public";
import { originPattern } from "./lib/registration";
import { requestWorker } from "./lib/ui-messages";

interface Target {
  origin: string;
  tabId: number | null;
}

async function resolveTarget(): Promise<Target | null> {
  const ownPrefix = chrome.runtime.getURL("");
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (
    active?.url !== undefined &&
    /^https?:/.test(active.url) &&
    !active.url.startsWith(ownPrefix)
  ) {
    return { origin: new URL(active.url).origin, tabId: active.id ?? null };
  }
  const explicit = new URLSearchParams(location.search).get("target");
  if (explicit !== null) {
    const origin = new URL(explicit).origin;
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => tab.url !== undefined && new URL(tab.url).origin === origin);
    return { origin, tabId: match?.id ?? null };
  }
  return null;
}

function Popup(): JSX.Element {
  const [target, setTarget] = useState<Target | null>(null);
  const [grant, setGrant] = useState<SiteGrant | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [armedControl, setArmedControl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const resolved = await resolveTarget();
    setTarget(resolved);
    if (resolved !== null) {
      const reply = await requestWorker({ type: "ui:status", origin: resolved.origin });
      const currentGrant = reply.type === "reply:status" ? reply.grant : null;
      setGrant(currentGrant);
      if (currentGrant !== null) {
        const quotaReply = await requestWorker({ type: "ui:quota" }).catch(() => null);
        setQuota(quotaReply?.type === "reply:quota" ? quotaReply.quota : null);
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    (work: () => Promise<void>): void => {
      setError(null);
      void work()
        .then(refresh)
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    },
    [refresh],
  );

  if (!loaded) return <p>…</p>;
  if (target === null) {
    return (
      <div>
        <h1>SuperGuide Anywhere</h1>
        <p class="note">Open the site you want help with, then open this popup again.</p>
      </div>
    );
  }

  const activate = (): void => {
    act(async () => {
      const granted = await chrome.permissions.request({
        origins: [originPattern(target.origin)],
      });
      if (!granted) throw new Error("permission was not granted");
      await requestWorker({ type: "ui:activated", origin: target.origin, tabId: target.tabId });
    });
  };

  const setTier = (tier: "observe" | "control"): void => {
    setArmedControl(false);
    act(async () => {
      await requestWorker({ type: "ui:set-tier", origin: target.origin, tier });
    });
  };

  const deactivate = (): void => {
    act(async () => {
      await requestWorker({ type: "ui:deactivate", origin: target.origin });
    });
  };

  return (
    <div>
      <h1>SuperGuide Anywhere</h1>
      <div class="origin">{target.origin}</div>
      {grant === null ? (
        <div>
          <button class="primary" data-testid="activate" onClick={activate}>
            Activate on this site (observe only)
          </button>
          <p class="note">
            The agent will be able to read this site and explain what to do. It will not be able to
            click, type, or change anything unless you enable control separately.
          </p>
        </div>
      ) : (
        <div>
          <div class="tier" data-testid="tier">
            {grant.tier === "control" ? "Can observe and act" : "Observing only"}
          </div>
          {grant.tier === "observe" ? (
            armedControl ? (
              <button
                class="primary"
                data-testid="confirm-control"
                onClick={() => {
                  setTier("control");
                }}
              >
                Confirm: allow acting on this site
              </button>
            ) : (
              <button
                data-testid="enable-control"
                onClick={() => {
                  setArmedControl(true);
                }}
              >
                Enable control…
              </button>
            )
          ) : (
            <button
              data-testid="drop-observe"
              onClick={() => {
                setTier("observe");
              }}
            >
              Drop to observe only
            </button>
          )}
          {armedControl ? (
            <p class="note">
              With control enabled the agent can click, type, and navigate on this site. Risky
              actions still ask you first. Confirm above to proceed.
            </p>
          ) : null}
          <button class="danger" data-testid="deactivate" onClick={deactivate}>
            Deactivate this site
          </button>
          {quota !== null ? (
            <p class="note" data-testid="quota">
              {quota.used} of {quota.limit} tasks used today
            </p>
          ) : null}
        </div>
      )}
      {error !== null ? <p class="note">{error}</p> : null}
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) render(<Popup />, root);
