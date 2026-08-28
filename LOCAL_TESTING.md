# Local Testing Guide for SuperGuide Anywhere

The extension is a client. The backend is SuperGuide’s control plane, on
`/v1/anywhere`. Run the two from adjacent checkouts.

## 1. SuperGuide control plane

```bash
cd /home/spidewol/Documents/Support-agent/superguide
pnpm install
pnpm env:init                 # generates SG_* keys; fill the model provider key
# Add your unpacked extension origin, e.g.:
# SG_ALLOWED_EXTENSION_IDS=chrome-extension://<id from chrome://extensions>
pnpm db:start                 # or: docker compose up -d
pnpm db:migrate
pnpm --filter @superguide/control-plane run dev
```

The server listens on `http://127.0.0.1:8080`. Widget routes stay on `/v1`.
Extension routes are `/v1/anywhere/*`.

## 2. Build and load the extension

```bash
cd /home/spidewol/Documents/Support-agent/superguide-anywhere
pnpm install
pnpm run build
```

1. Open Chrome at `chrome://extensions/`.
2. Enable **Developer mode**.
3. **Load unpacked** → `apps/extension/dist`.
4. Copy the extension ID (for `SG_ALLOWED_EXTENSION_IDS` above). Reload the
   control plane after you add it.

## 3. Point the extension at SuperGuide

Default `sga.apiBase` is `http://127.0.0.1:8080`. Paths are prefixed
`/v1/anywhere` in the client, so you do **not** put `/v1/anywhere` in
`apiBase`.

If you need to set it by hand, open the service-worker DevTools and run:

```javascript
chrome.storage.local.set({ 'sga.apiBase': 'http://127.0.0.1:8080' })
```

Then reload the extension.

## Playwright e2e

E2E spawns SuperGuide from `../superguide` (override with `SUPERGUIDE_ROOT`)
and talks to SuperGuide’s Postgres (`SG_DATABASE_URL`, default
`postgres://sg_app:sg_app_dev@127.0.0.1:55432/superguide`). Start SuperGuide’s
database and migrate before `pnpm test:e2e`.
