const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider"]);

export interface ValueCandidate {
  role: string;
  inputType: string | null;
  name: string;
  value: string;
}

// The allowlist is matched on the field's accessible name, lowercased. The default
// allowlist is empty: no field value leaves the page unless a caller asked for that
// field by name. A password field's value never leaves, allowlisted or not.
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
