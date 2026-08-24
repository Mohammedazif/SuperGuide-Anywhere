import {
  STORAGE_KEYS,
  deviceIdSchema,
  grantsRecordSchema,
  type GrantsRecord,
  type SiteGrant,
} from "@sga/contract/public";

export async function readGrants(): Promise<GrantsRecord> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.grants);
  const parsed = grantsRecordSchema.safeParse(stored[STORAGE_KEYS.grants]);
  return parsed.success ? parsed.data : [];
}

export async function writeGrants(grants: GrantsRecord): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.grants]: grants });
}

export async function grantFor(origin: string): Promise<SiteGrant | null> {
  const grants = await readGrants();
  return grants.find((grant) => grant.origin === origin) ?? null;
}

export async function upsertGrant(grant: SiteGrant): Promise<GrantsRecord> {
  const grants = (await readGrants()).filter((entry) => entry.origin !== grant.origin);
  const next = [...grants, grant];
  await writeGrants(next);
  return next;
}

export async function removeGrant(origin: string): Promise<GrantsRecord> {
  const next = (await readGrants()).filter((entry) => entry.origin !== origin);
  await writeGrants(next);
  return next;
}

export async function ensureDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.deviceId);
  const parsed = deviceIdSchema.safeParse(stored[STORAGE_KEYS.deviceId]);
  if (parsed.success) return parsed.data;
  const generated = crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceId]: generated });
  return generated;
}
