export type ControlPlaneError =
  | { kind: "environment"; issues: readonly string[] }
  | { kind: "database"; detail: string }
  | { kind: "auth"; detail: string }
  | { kind: "not_found"; what: string };

export class ControlPlaneFailure extends Error {
  constructor(readonly error: ControlPlaneError) {
    super(`${error.kind}: ${JSON.stringify(error)}`);
    this.name = "ControlPlaneFailure";
  }
}
