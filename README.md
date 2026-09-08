# SuperGuide Anywhere

Chrome extension that finishes a task on a site the person already uses: it reads the page, acts on the UI when allowed, asks one question when it must, and reports when it cannot.

This repo is the **extension only**. The backend is [SuperGuide](https://github.com/Mohammedazif/SuperGuide) (`/v1/anywhere`). Model keys, Postgres, and quota live there.

Access is per origin, in two tiers: `observe` (read and explain) and `control` (act, under confirmation). The server decides entitlement.

## Stack

- TypeScript, Preact, tsup IIFE bundles
- Chrome extension (service worker, content script, popup)
- Talks to SuperGuide over HTTP + SSE

## Quickstart

The SuperGuide control plane must already be running on `http://127.0.0.1:8080`.

```bash
pnpm install
pnpm build
```

1. Open `chrome://extensions/`, turn on Developer mode, **Load unpacked** → `apps/extension/dist`.
2. Copy the extension ID from the card.
3. In SuperGuide `.env`, set `SG_ALLOWED_EXTENSION_IDS=chrome-extension://<that-id>` and restart the control plane.
4. Open a site (the SuperGuide fixture at `http://127.0.0.1:8099` works), click the extension icon, activate the origin, and type a task.

Default API origin is `http://127.0.0.1:8080`. Do not put `/v1/anywhere` in `apiBase`; the client adds that path.

To override locally, from the extension's service-worker console:

```js
chrome.storage.local.set({ "sga.apiBase": "http://127.0.0.1:8080" });
```

Then reload the extension.

## Hosted API

Bake the public SuperGuide origin into the bundle:

```bash
SGA_API_BASE=https://YOUR_SERVICE.onrender.com pnpm build
```

`sga.apiBase` in `chrome.storage.local` still overrides the baked default.

The store / unpacked ID from this repo's manifest key is `chrome-extension://ghdcebndlanhmdeajdbbemcaihpenhoj`. SuperGuide must list that origin in `SG_ALLOWED_EXTENSION_IDS`.

## Layout

```
apps/extension     Chrome extension (load apps/extension/dist unpacked)
apps/fixture-app   small host page for local checks
packages/contract  Zod schemas shared with SuperGuide
packages/policy    allow / deny verdicts
packages/adapters  per-site adapters
packages/observer  DOM → accessibility digest (read only)
packages/executor  closed action vocabulary
packages/transport HTTP + SSE client
packages/ui        Preact panel
```

Privacy policy: [PRIVACY.md](PRIVACY.md).
