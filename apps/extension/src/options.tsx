import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { GrantsRecord } from "@sga/contract/public";
import { requestWorker } from "./lib/ui-messages";

function Options(): JSX.Element {
  const [grants, setGrants] = useState<GrantsRecord>([]);
  const [globalOff, setGlobalOff] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [armedControl, setArmedControl] = useState<string | null>(null);
  const [armedErase, setArmedErase] = useState(false);
  const [eraseNote, setEraseNote] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const reply = await requestWorker({ type: "ui:list-grants" });
    if (reply.type === "reply:grants") {
      setGrants(reply.grants);
      setGlobalOff(reply.globalOff);
      setDeviceId(reply.deviceId);
    }
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

  const toggleGlobal = (): void => {
    void requestWorker({ type: "ui:set-global", off: !globalOff }).then(refresh);
  };

  return (
    <div>
      <h1>SuperGuide Anywhere — activated sites</h1>
      <p>
        <button class={globalOff ? "" : "danger"} data-testid="global-off" onClick={toggleGlobal}>
          {globalOff ? "Turn the agent back on" : "Turn the agent off everywhere"}
        </button>
        {globalOff ? (
          <span class="empty"> The agent is off on every site until you turn it back on.</span>
        ) : null}
      </p>
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
      <h1>Your data</h1>
      <p class="empty">
        Anonymous device id: <code>{deviceId}</code>
      </p>
      <p>
        {armedErase ? (
          <button
            class="danger"
            data-testid="confirm-erase"
            onClick={() => {
              setArmedErase(false);
              void requestWorker({ type: "ui:erase" })
                .then((reply) => {
                  setEraseNote(
                    reply.type === "reply:ok"
                      ? "Deleted. A new anonymous id will be generated next time."
                      : reply.type === "reply:error"
                        ? reply.detail
                        : null,
                  );
                })
                .then(refresh);
            }}
          >
            Confirm: delete everything the server holds for this device
          </button>
        ) : (
          <button
            class="danger"
            data-testid="erase-data"
            onClick={() => {
              setArmedErase(true);
            }}
          >
            Delete my data…
          </button>
        )}
        {eraseNote !== null ? <span class="empty"> {eraseNote}</span> : null}
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) render(<Options />, root);
