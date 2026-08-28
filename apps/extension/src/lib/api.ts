import { ControlPlaneClient, registerDevice } from "@sga/transport";
import { ensureDeviceId } from "./storage";

declare const __SGA_API_BASE__: string;

const BAKED_API_BASE = (typeof __SGA_API_BASE__ === "string" ? __SGA_API_BASE__ : "").replace(
  /\/$/,
  "",
);
const DEFAULT_API_BASE = BAKED_API_BASE.length > 0 ? BAKED_API_BASE : "http://127.0.0.1:8080";
const API_BASE_KEY = "sga.apiBase";
const TOKEN_KEY = "sga.deviceToken";

export async function resolveApiBase(): Promise<string> {
  const stored = await chrome.storage.local.get(API_BASE_KEY);
  const value = stored[API_BASE_KEY];
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_API_BASE;
}

function extensionOrigin(): string {
  return `chrome-extension://${chrome.runtime.id}`;
}

async function refreshToken(baseUrl: string): Promise<string> {
  const deviceId = await ensureDeviceId();
  const registered = await registerDevice(baseUrl, deviceId, extensionOrigin());
  await chrome.storage.session.set({ [TOKEN_KEY]: registered.sessionToken });
  return registered.sessionToken;
}

export async function createApiClient(): Promise<ControlPlaneClient> {
  const baseUrl = await resolveApiBase();
  return new ControlPlaneClient({
    baseUrl,
    extensionOrigin: extensionOrigin(),
    getToken: async () => {
      const stored = await chrome.storage.session.get(TOKEN_KEY);
      const token = stored[TOKEN_KEY];
      if (typeof token === "string" && token.length > 0) return token;
      return refreshToken(baseUrl);
    },
    refreshToken: () => refreshToken(baseUrl),
  });
}
