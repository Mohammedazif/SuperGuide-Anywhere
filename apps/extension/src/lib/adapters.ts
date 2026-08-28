// Cache-only import: YAML loader is Node/CJS and dies in a service worker.
import { pickAdapterSet } from "@sga/adapters/cache";
import { STORAGE_KEYS, adapterCacheSchema, type AdapterSet } from "@sga/contract/public";
import { createApiClient } from "./api";

async function readCache(): Promise<AdapterSet | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.adapterCache);
  const parsed = adapterCacheSchema.safeParse(stored[STORAGE_KEYS.adapterCache]);
  return parsed.success ? parsed.data : null;
}

export async function refreshAdapterCache(): Promise<AdapterSet | null> {
  const cached = await readCache();
  const fetched = await createApiClient()
    .then((client) => client.fetchAdapters())
    .catch(() => null);
  const picked = pickAdapterSet(cached, fetched);
  if (picked !== null) {
    await chrome.storage.local.set({ [STORAGE_KEYS.adapterCache]: picked });
  }
  return picked;
}

export async function cachedAdapterVersion(): Promise<number | null> {
  return (await readCache())?.version ?? null;
}
