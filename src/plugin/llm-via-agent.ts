/**
 * Unified LLM call layer via OpenClaw agent runtime.
 *
 * Replaces the direct-API llm-agent-proxy.ts. All LLM calls now go through
 * OpenClaw's `rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher`,
 * which means they enjoy the full hook system (before_model_resolve,
 * llm_input, llm_output, agent_end), token accounting, context compaction,
 * per-agent model routing, and the global fallback model mechanism.
 *
 * Uses a dedicated utility agent "town-utility" (registered in openclaw.json
 * agents.list) so utility calls (summary generation, soul generation) are
 * isolated from steward/citizen sessions and inherit the global default model
 * + fallbacks configured in agents.defaults.model.
 *
 * If the OpenClaw runtime is not yet initialized (early startup), calls fall
 * back to returning an empty result — callers should handle this gracefully.
 */

import { getTownRuntime } from "./runtime.js";
import { buildTownInboundContext } from "./channel.js";

const CHANNEL_ID = "agentshire";
const UTILITY_AGENT_ID = "town-utility";
const DEFAULT_TIMEOUT_MS = 90_000;

export interface AgentLLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
  /** Override the agent id (default: town-utility) */
  agentId?: string;
  /** Session key suffix for isolation (default: "default") */
  sessionScope?: string;
  /** Timeout in ms (default: 90000) */
  timeoutMs?: number;
}

export interface AgentLLMResult {
  text: string;
  usage?: { input: number; output: number };
  fallback: boolean;
  latencyMs: number;
}

/**
 * Call LLM via OpenClaw agent runtime.
 *
 * The system prompt is prepended to the user message as a composed body,
 * mirroring how implicit_chat works in channel.ts. The utility agent
 * inherits the global default model + fallbacks from agents.defaults.model.
 */
export async function chatViaAgent(req: AgentLLMRequest): Promise<AgentLLMResult> {
  const start = performance.now();
  const rt = getTownRuntime();
  if (!rt) {
    console.warn("[llm-via-agent] runtime not initialized, returning empty");
    return { text: "", fallback: true, latencyMs: 0 };
  }

  const cfg = rt.config.current() as any;
  const agentId = req.agentId ?? UTILITY_AGENT_ID;
  const scope = req.sessionScope ?? "default";
  const sessionKey = `agent:${agentId}:${scope}`;

  // Compose message: system prompt as instructions, user as the query
  const composedBody = `${req.system}\n\n---\n\n${req.user}`;

  const msgCtx = buildTownInboundContext({
    rt,
    body: composedBody,
    from: `${CHANNEL_ID}:system`,
    to: `${CHANNEL_ID}:${agentId}`,
    sessionKey,
    accountId: "default",
  });

  let responseText = "";
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const dispatchPromise = rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: any) => {
          const text = payload?.text ?? payload?.body ?? "";
          if (text) responseText += text;
        },
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("llm-via-agent timeout")), timeoutMs),
    );

    await Promise.race([dispatchPromise, timeoutPromise]);
  } catch (err) {
    console.warn(`[llm-via-agent] call failed (${agentId}/${scope}):`, (err as Error).message);
    return { text: "", fallback: true, latencyMs: Math.round(performance.now() - start) };
  }

  const latencyMs = Math.round(performance.now() - start);
  return {
    text: responseText,
    fallback: !responseText,
    latencyMs,
  };
}

/**
 * Check if the agent-based LLM is available (runtime initialized).
 */
export function isAgentLLMAvailable(): boolean {
  return getTownRuntime() !== null;
}
