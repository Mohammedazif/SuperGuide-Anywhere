export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function syntheticId(role: string, name: string, treePath: string, salt = 0): string {
  const hash = fnv1a(`${role}|${name}|${treePath}|${salt}`);
  return `e${hash.toString(16).padStart(8, "0")}`;
}
