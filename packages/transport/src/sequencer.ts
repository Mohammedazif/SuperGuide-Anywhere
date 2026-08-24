export type SequenceVerdict = "deliver" | "duplicate" | "gap";

export class StreamSequencer {
  constructor(private last: number = -1) {}

  get lastSeq(): number {
    return this.last;
  }

  classify(seq: number): SequenceVerdict {
    if (seq <= this.last) return "duplicate";
    if (seq > this.last + 1) return "gap";
    this.last = seq;
    return "deliver";
  }
}
