# Local Testing Guide for SuperGuide Anywhere

This repo is the Chrome extension. The backend is SuperGuide.

Full walkthrough (backend + widget + extension):  
`../superguide/LOCAL_TESTING.md`

Short version:

```bash
# Terminal 1 — SuperGuide backend
cd /home/spidewol/Documents/Support-agent/superguide
pnpm env:init                 # once; then put a model key in .env
pnpm db:start && pnpm db:migrate
# After you load the extension, set:
# SG_ALLOWED_EXTENSION_IDS=chrome-extension://<id from chrome://extensions>
pnpm --filter @superguide/control-plane run dev
```

```bash
# Terminal 2 — this repo
cd /home/spidewol/Documents/Support-agent/superguide-anywhere
pnpm install
pnpm run build
```

Load unpacked: `apps/extension/dist`.

Service-worker console (only if needed):

```javascript
chrome.storage.local.set({ 'sga.apiBase': 'http://127.0.0.1:8080' })
```

`apiBase` is the origin only. The client adds `/v1/anywhere` itself.

Hosted API: bake the public origin into the bundle, then load unpacked as usual.

```bash
SGA_API_BASE=https://YOUR_SERVICE.onrender.com pnpm run build
```

`chrome.storage.local.set({ 'sga.apiBase': 'https://YOUR_SERVICE.onrender.com' })` still overrides the baked default. The backend allowlist is `chrome-extension://ghdcebndlanhmdeajdbbemcaihpenhoj` (from this repo's manifest `key`).
