export interface SseFrame {
  id: number | null;
  data: string;
}

export class SseParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary === -1) break;
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const frame = parseBlock(block);
      if (frame !== null) frames.push(frame);
    }
    return frames;
  }
}

function parseBlock(block: string): SseFrame | null {
  let id: number | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator);
    const value = line.startsWith(`${field}: `)
      ? line.slice(separator + 2)
      : line.slice(separator + 1);
    if (field === "id" && /^\d+$/.test(value)) id = Number(value);
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { id, data: data.join("\n") };
}
