# Local Testing Guide for SuperGuide Anywhere

To test the SuperGuide Anywhere extension locally in your Chrome browser, you'll need to load the extension itself and spin up the local control plane (backend) that it talks to.

Here is the step-by-step guide to get everything running:

## 1. Build the Extension
First, make sure the extension code is built into the `dist` directory:

```bash
cd /home/spidewol/Documents/Support-agent/superguide-anywhere
pnpm install
pnpm run build
```

## 2. Load the Extension into Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** on in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the built directory located at: `/home/spidewol/Documents/Support-agent/superguide-anywhere/apps/extension/dist`.
5. Once loaded, you will see a new extension card for "SuperGuide Anywhere". **Copy the extension ID** from this card (a long string like `ghdcebndlanhmdeajdbbemcaihpenhoj`).

## 3. Start the Local Control Plane
The extension requires the backend service to make decisions and track quota.

1. Open your `.env` file at the root of the project and add your new extension ID (using the format `chrome-extension://<YOUR_ID>`) so the server allows it to connect:
   ```env
   SGA_ALLOWED_EXTENSION_IDS=chrome-extension://your_copied_extension_id_here
   ```
2. Start the local PostgreSQL database using Docker:
   ```bash
   # If docker is not installed, install it first: sudo apt update && sudo apt install -y docker.io docker-compose-v2
   docker compose up -d
   ```
3. Run the database migrations to set up the schema:
   ```bash
   pnpm run db:migrate
   ```
4. Start the control plane server:
   ```bash
   node --env-file-if-exists=.env --import tsx apps/control-plane/src/main.ts
   ```

## 4. Point the Extension to your Local Server
By default, the extension points to the production URL (`https://api.superguideanywhere.com`). To point it to your local server instead:

1. Go back to `chrome://extensions/`.
2. Find the SuperGuide Anywhere card and click **service worker** to open its DevTools console.
3. Run this snippet in the console to configure the local API URL:
   ```javascript
   chrome.storage.local.set({ 'sga.apiBase': 'http://127.0.0.1:8080' })
   ```
4. Reload the extension using the refresh icon on its card in `chrome://extensions/`.

You should now be able to click on the SuperGuide Anywhere extension icon on any webpage to interact with it, with everything running entirely on your machine!

