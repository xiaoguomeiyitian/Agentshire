const LEGACY_TOWN_SESSION_ID = "default";
const STEWARD_AGENT_ID = "town-steward";

export function sanitizeTownSessionId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return LEGACY_TOWN_SESSION_ID;
  return trimmed.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

export function createTownSessionKey(accountId: string, townSessionId: string): string {
  return `agent:${STEWARD_AGENT_ID}:town:${accountId}:${sanitizeTownSessionId(townSessionId)}`;
}

export function extractTownSessionId(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const raw = rawValue.trim();
  if (!raw) return null;

  // New format: agent:town-steward:town:{accountId}:{townSessionId}
  const agentMatch = /^agent:[^:]+:town:[^:]+:(.+)$/.exec(raw);
  if (agentMatch?.[1]) {
    return sanitizeTownSessionId(agentMatch[1]);
  }

  // Legacy format: town:{accountId}:{townSessionId}
  const scopedMatch = /^town:[^:]+:(.+)$/.exec(raw);
  if (scopedMatch?.[1]) {
    return sanitizeTownSessionId(scopedMatch[1]);
  }

  if (/^town-[^:]+$/.test(raw)) {
    return LEGACY_TOWN_SESSION_ID;
  }

  return null;
}

