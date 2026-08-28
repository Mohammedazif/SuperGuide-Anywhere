import type { AdapterSet } from "@sga/contract/public";

export function pickAdapterSet(
  cached: AdapterSet | null,
  fetched: AdapterSet | null,
): AdapterSet | null {
  // Fetched always wins, even over a higher cached version; cache is fetch-failure fallback only.
  return fetched ?? cached;
}
