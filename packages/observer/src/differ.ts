import type { DigestDelta, DigestNode, PageDigest } from "@sga/contract/public";

function nodeEquals(a: DigestNode, b: DigestNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffDigests(before: PageDigest, after: PageDigest): DigestDelta {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));

  const added: DigestNode[] = [];
  const changed: DigestNode[] = [];
  for (const node of after.nodes) {
    const previous = beforeById.get(node.id);
    if (previous === undefined) added.push(node);
    else if (!nodeEquals(previous, node)) changed.push(node);
  }
  const removed = before.nodes
    .filter((node) => !afterById.has(node.id))
    .map((node) => node.id);

  return {
    added,
    removed,
    changed,
    urlChanged: before.url === after.url ? null : { from: before.url, to: after.url },
    titleChanged: before.title === after.title ? null : { from: before.title, to: after.title },
  };
}
