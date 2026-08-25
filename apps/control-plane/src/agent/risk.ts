import type { AgentAction, PageDigest, RiskClass } from "@sga/contract/public";

const SENSITIVE_NAME =
  /\b(delete|remove|pay|payment|purchase|buy|checkout|transfer|invite|revoke|grant|cancel|deactivate|close|terminate|password|permission|billing|refund|subscribe|unsubscribe|plan|card|bank|wire)\b/i;

function targetName(id: string, digest: PageDigest | null): string | null {
  if (digest === null) return null;
  const name = digest.nodes.find((candidate) => candidate.id === id)?.name.trim();
  return name === undefined || name.length === 0 ? null : name;
}

export function classifyRisk(action: AgentAction, digest: PageDigest | null): RiskClass {
  switch (action.kind) {
    case "readBack":
    case "waitFor":
    case "focus":
    case "scrollIntoView":
      return "read";
    case "navigate":
      return "write";
    case "click":
    case "type":
    case "select":
    case "check": {
      const name = targetName(action.target.id, digest);
      // A target the digest cannot name is unclassifiable, and unclassified means
      // sensitive, never read. Page-derived names may only raise risk, never lower
      // it below the write floor.
      if (name === null) return "sensitive";
      return SENSITIVE_NAME.test(name) ? "sensitive" : "write";
    }
    default: {
      const exhausted: never = action;
      void exhausted;
      return "sensitive";
    }
  }
}
