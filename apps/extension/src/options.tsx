import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { GrantsRecord } from "@sga/contract/public";
import { requestWorker } from "./lib/ui-messages";

function Options(): JSX.Element {
  const [grants, setGrants] = useState<GrantsRecord>([]);
  const [armedControl, setArmedControl] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const reply = await requestWorker({ type: "ui:list-grants" });
    if (reply.type === "reply:grants") setGrants(reply.grants);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setTier = (origin: string, tier: "observe" | "control"): void => {
    setArmedControl(null);
    void requestWorker({ type: "ui:set-tier", origin, tier }).then(refresh);
  };

  const deactivate = (origin: string): void => {
    void requestWorker({ type: "ui:deactivate", origin }).then(refresh);
  };

  return (
    <div>
      <h1>SuperGuide Anywhere — activated sites</h1>
      {grants.length === 0 ? (
        <p class="empty">
          No sites are activated. Open a site and use the toolbar popup to activate it.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Access</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.origin}>
                <td>{grant.origin}</td>
                <td>{grant.tier === "control" ? "observe + act" : "observe only"}</td>
                <td>
                  {grant.tier === "observe" ? (
                    armedControl === grant.origin ? (
                      <button onClick={() => { setTier(grant.origin, "control"); }}>
                        Confirm control
                      </button>
                    ) : (
                      <button onClick={() => { setArmedControl(grant.origin); }}>
                        Enable control…
                      </button>
                    )
                  ) : (
                    <button onClick={() => { setTier(grant.origin, "observe"); }}>
                      Drop to observe
                    </button>
                  )}
                </td>
                <td>
                  <button class="danger" onClick={() => { deactivate(grant.origin); }}>
                    Deactivate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) render(<Options />, root);
