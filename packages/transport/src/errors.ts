export type TransportError =
  | { kind: "network"; detail: string }
  | { kind: "http"; status: number; code: string; message: string; resetsAt?: string }
  | { kind: "protocol"; detail: string };

export class TransportFailure extends Error {
  constructor(readonly error: TransportError) {
    super(
      error.kind === "http"
        ? `http ${error.status}: ${error.code}: ${error.message}`
        : `${error.kind}: ${error.detail}`,
    );
    this.name = "TransportFailure";
  }
}
