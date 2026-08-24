import { describe, expect, it } from "vitest";
import { SseParser } from "./sse";
import { StreamSequencer } from "./sequencer";

describe("sse parser", () => {
  it("parses a complete frame with id and data", () => {
    const parser = new SseParser();
    expect(parser.push('id: 3\ndata: {"a":1}\n\n')).toEqual([{ id: 3, data: '{"a":1}' }]);
  });

  it("holds partial frames across pushes", () => {
    const parser = new SseParser();
    expect(parser.push("id: 0\nda")).toEqual([]);
    expect(parser.push("ta: hello\n")).toEqual([]);
    expect(parser.push("\nid: 1\ndata: again\n\n")).toEqual([
      { id: 0, data: "hello" },
      { id: 1, data: "again" },
    ]);
  });

  it("ignores comments and heartbeats", () => {
    const parser = new SseParser();
    expect(parser.push(":ok\n\n:hb\n\ndata: real\n\n")).toEqual([{ id: null, data: "real" }]);
  });

  it("joins multi-line data", () => {
    const parser = new SseParser();
    expect(parser.push("data: one\ndata: two\n\n")).toEqual([{ id: null, data: "one\ntwo" }]);
  });
});

describe("stream sequencer", () => {
  it("delivers a contiguous sequence and tracks the last seq", () => {
    const sequencer = new StreamSequencer();
    expect(sequencer.classify(0)).toBe("deliver");
    expect(sequencer.classify(1)).toBe("deliver");
    expect(sequencer.lastSeq).toBe(1);
  });

  it("flags a replayed event as a duplicate and does not advance", () => {
    const sequencer = new StreamSequencer(4);
    expect(sequencer.classify(3)).toBe("duplicate");
    expect(sequencer.classify(4)).toBe("duplicate");
    expect(sequencer.lastSeq).toBe(4);
  });

  it("flags a gap and does not advance past it", () => {
    const sequencer = new StreamSequencer(1);
    expect(sequencer.classify(3)).toBe("gap");
    expect(sequencer.lastSeq).toBe(1);
    expect(sequencer.classify(2)).toBe("deliver");
    expect(sequencer.classify(3)).toBe("deliver");
  });
});
