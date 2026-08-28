const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);

export interface ValueCandidate {
  role: string;
  inputType: string | null;
  name: string;
  value: string;
}

// Allowlist matches accessible name (lowercase, empty by default); password values never leave.
export function redactedValue(
  candidate: ValueCandidate,
  allowlist: ReadonlySet<string>,
): string | undefined {
  if (candidate.inputType === "password") return undefined;
  if (!VALUE_ROLES.has(candidate.role)) return undefined;
  if (candidate.value.length === 0) return undefined;
  const key = candidate.name.trim().toLowerCase();
  if (key.length === 0 || !allowlist.has(key)) return undefined;
  return candidate.value;
}
