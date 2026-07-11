/**
 * Routes user messages to independent citizen agents.
 * Reads agentId from citizen-config.json (published) and dispatches
 * to the citizen's own session via SessionKey = "agent:{agentId}:{townSessionId}".
 */

import { getTownRuntime } from "./runtime.js";
import { pushCitizenMessages } from "./ws-server.js";
import { sanitizeTownSessionId } from "./town-session.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";

const CHANNEL_ID = "agentshire";

function getPublishedConfigPath(): string {
  const pluginDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
  return join(pluginDir, "town-data", "citizen-config.json");
}

function findCitizenAgentId(npcId: string): string | null {
  try {
    const configPath = getPublishedConfigPath();
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const characters: any[] = config.characters ?? [];

    // Check steward first (role === "steward", agentId is always "town-steward")
    const steward = characters.find((c: any) => c.id === npcId && c.role === "steward");
    if (steward) {
      // Verify town-steward is registered in openclaw.json
      const openclawConfigPath = join(stateDir(), "openclaw.json");
      if (existsSync(openclawConfigPath)) {
        try {
          const ocConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
          const agents: any[] = ocConfig.agents?.list ?? [];
          if (agents.some((a: any) => a.id === "town-steward")) {
            return "town-steward";
          }
        } catch {}
      }
    }

    // Check citizen
    const citizen = characters.find((c: any) => c.id === npcId && c.role === "citizen");
    if (citizen?.agentEnabled && citizen?.agentId) return citizen.agentId;

    // Fallback: check openclaw.json agents.list for matching citizen agent
    const expectedAgentId = `citizen-${npcId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const openclawConfigPath = join(stateDir(), "openclaw.json");
    if (existsSync(openclawConfigPath)) {
      try {
        const ocConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
        const agents: any[] = ocConfig.agents?.list ?? [];
        const found = agents.find((a: any) => a.id === expectedAgentId);
        if (found) return found.id;
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

export async function routeCitizenMessage(params: {
  npcId: string;
  label: string;
  message: string;
  townSessionId: string;
  accountId: string;
  cfg: Record<string, unknown>;
  mediaPaths?: string[];
  /** Optional session key prefix for group chat isolation (e.g. "group:town-square") */
  sessionKeyPrefix?: string;
}): Promise<void> {
  const { npcId, label, message, townSessionId, accountId, cfg, mediaPaths, sessionKeyPrefix } = params;

  const agentId = findCitizenAgentId(npcId);
  if (!agentId) {
    console.log(`[citizen-chat] No active agent for ${label} (${npcId}), message dropped`);
    return;
  }

  const rt = getTownRuntime();
  const sanitizedSession = sanitizeTownSessionId(townSessionId);
  const sessionKey = sessionKeyPrefix
    ? `agent:${agentId}:${sessionKeyPrefix}:${sanitizedSession}`
    : `agent:${agentId}:${sanitizedSession}`;

  console.log(`[citizen-chat] Routing to ${agentId} (${label}), sessionKey=${sessionKey}`);

  const msgCtx = rt.channel.reply.finalizeInboundContext({
    Body: message,
    RawBody: message,
    CommandBody: message,
    From: `${CHANNEL_ID}:user`,
    To: `${CHANNEL_ID}:${npcId}`,
    SessionKey: sessionKey,
    AccountId: accountId,
    OriginatingChannel: CHANNEL_ID,
    ChatType: "direct",
    SenderId: "user",
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    ...(mediaPaths?.length ? { MediaPaths: mediaPaths } : {}),
  });

  await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: msgCtx,
    cfg,
    dispatcherOptions: {
      deliver: async (_payload: any) => {
        // Only push to single-chat view for direct (non-group) conversations.
        // Group chat messages are broadcast separately via pushGroupChatMessage.
        if (!sessionKeyPrefix) {
          setTimeout(() => pushCitizenMessages(agentId, townSessionId), 500);
        }
      },
    },
  });
}
