import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import { getTownRuntime } from "./runtime.js";
import { broadcastAgentEvent } from "./ws-server.js";
import { createOutboundAdapter } from "./outbound-adapter.js";
import { createTownSessionKey, sanitizeTownSessionId } from "./town-session.js";

const CHANNEL_ID = "agentshire";
const DEBUG = process.env.AGENTSHIRE_DEBUG === "1";

/**
 * Build an inbound message context using the current SDK API
 * (buildChannelInboundEventContext) instead of the deprecated
 * finalizeInboundContext. Maps the flat legacy parameters into the
 * structured facts objects expected by the new API.
 */
export function buildTownInboundContext(params: {
  rt: ReturnType<typeof getTownRuntime>;
  body: string;
  from: string;
  to: string;
  sessionKey: string;
  accountId?: string;
  mediaPaths?: string[];
}): ReturnType<typeof buildChannelInboundEventContext> {
  const { body, from, to, sessionKey, accountId, mediaPaths } = params;

  // Extract agentId from sessionKey (format: "agent:<agentId>:<rest>")
  // or default to "town-steward" for direct steward sessions.
  const agentIdMatch = sessionKey.match(/^agent:([^:]+):/);
  const agentId = agentIdMatch ? agentIdMatch[1] : "town-steward";

  return buildChannelInboundEventContext({
    channel: CHANNEL_ID,
    accountId: accountId ?? "default",
    provider: CHANNEL_ID,
    surface: CHANNEL_ID,
    from,
    sender: { id: "user", isSelf: false, isBot: false },
    conversation: {
      kind: "direct",
      id: sessionKey,
    },
    route: {
      agentId,
      accountId: accountId ?? "default",
      routeSessionKey: sessionKey,
      dispatchSessionKey: sessionKey,
      createIfMissing: true,
    },
    reply: {
      to,
      originatingTo: to,
    },
    message: {
      rawBody: body,
      body,
      bodyForAgent: body,
      commandBody: body,
    },
    access: {
      commands: {
        authorized: true,
        useAccessGroups: false,
        allowTextCommands: true,
        authorizers: [],
      },
    },
    ...(mediaPaths?.length
      ? { media: mediaPaths.map((path) => ({ path, kind: "unknown" as const })) }
      : {}),
  });
}

let _channelCtx: { rt: ReturnType<typeof getTownRuntime>; cfg: Record<string, unknown>; accountId: string } | null = null;

export async function sendNudgeMessage(townSessionId: string, body: string): Promise<void> {
  if (!_channelCtx) {
    console.warn('[agentshire] sendNudgeMessage: channel not started yet');
    return;
  }
  try {
    await dispatchTownMessage({ ..._channelCtx, townSessionId, body });
  } catch (err) {
    console.error('[agentshire] sendNudgeMessage error:', err);
  }
}

export interface ResolvedTownAccount {
  accountId: string;
  wsPort: number;
  townPort: number;
  autoLaunch: boolean;
}

export function resolveAccount(
  cfg: Record<string, unknown>,
  accountId: string,
): ResolvedTownAccount {
  // Config paths tried in order:
  //   1. channels.agentshire.* (legacy / SDK configPrefixes)
  //   2. plugins.entries.agentshire.config.* (openclaw.json plugin config)
  interface ChannelConfig {
    channels?: Record<string, { wsPort?: number; townPort?: number; autoLaunch?: boolean }>;
  }
  interface PluginConfig {
    plugins?: { entries?: Record<string, { config?: { wsPort?: number; townPort?: number; autoLaunch?: boolean } }> };
  }
  const channelCfg = (cfg as ChannelConfig)?.channels?.[CHANNEL_ID] ?? {};
  const pluginCfg = (cfg as PluginConfig)?.plugins?.entries?.[CHANNEL_ID]?.config ?? {};
  return {
    accountId,
    wsPort: channelCfg.wsPort ?? pluginCfg.wsPort ?? 20008,
    townPort: channelCfg.townPort ?? pluginCfg.townPort ?? 20009,
    autoLaunch: channelCfg.autoLaunch ?? pluginCfg.autoLaunch ?? true,
  };
}

function waitUntilAbort(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function dispatchTownMessage(params: {
  rt: ReturnType<typeof getTownRuntime>;
  cfg: Record<string, unknown>;
  accountId: string;
  townSessionId: string;
  body: string;
  mediaPaths?: string[];
}) {
  const { rt, cfg, accountId, townSessionId, body, mediaPaths } = params;
  const sessionKey = createTownSessionKey(accountId, townSessionId);

  const msgCtx = buildTownInboundContext({
    rt,
    body,
    from: `${CHANNEL_ID}:user`,
    to: `${CHANNEL_ID}:steward`,
    sessionKey,
    accountId,
    mediaPaths,
  });

  // Retry with backoff for "reply session initialization conflicted" errors.
  // This happens when OpenClaw's optimistic lock detects a stale snapshot
  // (e.g. ChatSessionWatcher switched the session file between read and commit).
  // OpenClaw internally retries once, but persistent conflicts need more attempts.
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [500, 1000, 2000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: msgCtx,
        cfg,
        dispatcherOptions: {
          deliver: async (payload: any) => {
            const replyText = payload?.text ?? payload?.body;
            if (replyText) {
              broadcastAgentEvent({ type: "text", content: replyText }, townSessionId);
            }
          },
        },
      });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isConflict = errMsg.includes("reply session initialization conflicted");
      if (!isConflict || attempt >= MAX_RETRIES) throw err;
      console.log(
        `[agentshire] dispatchTownMessage retry ${attempt + 1}/${MAX_RETRIES} after ${RETRY_DELAYS[attempt]}ms (conflict)`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

const { outbound: townOutbound, messaging: townMessaging } = createOutboundAdapter();

export const agentTownPlugin: ChannelPlugin<ResolvedTownAccount> = {
  id: CHANNEL_ID,

  meta: {
    id: CHANNEL_ID,
    label: "Agentshire",
    selectionLabel: "Agentshire (3D Visualization)",
    docsPath: "/channels/agentshire",
    docsLabel: "agentshire",
    blurb:
      "Visualize AI agents as NPCs in an interactive 3D low-poly town. " +
      "Watch them think, code, collaborate, and celebrate in real-time.",
    order: 100,
  },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: true,
    threads: false,
  },

  reload: {
    configPrefixes: [`channels.${CHANNEL_ID}`],
  },

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId ?? "default"),
    defaultAccountId: () => "default",
    isConfigured: () => true,
  },

  outbound: townOutbound,

  messaging: townMessaging,

  gateway: {
    startAccount: async (ctx: any) => {
      const account = ctx.account as ResolvedTownAccount;
      const rt = getTownRuntime();
      _channelCtx = { rt, cfg: ctx.cfg, accountId: account.accountId };
      const { startTownWsServer } = await import("./ws-server.js");
      const { CustomAssetManager } = await import("./custom-asset-manager.js");
      const { join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const pluginDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
      const customAssetManager = new CustomAssetManager(pluginDir);

      startTownWsServer({
        port: account.wsPort,
        customAssetManager,
        onImplicitChat: async (payload) => {
          // Use the standard OpenClaw reply dispatch chain (same as citizen chat)
          // so LLM request format/parameters are identical to chat interface calls.
          const { system, user, agentId } = payload;

          // Use a stable implicit session key per citizen so L2 decisions reuse
          // the same session (preserving memory across decisions). The ":implicit:"
          // prefix isolates these from user-visible chat and group chat sessions.
          const implicitAgentId = agentId ?? "town-steward";
          // Stable per-citizen implicit session key: L2 autonomy decisions reuse
          // the same session (preserving memory across decisions). The ":implicit:"
          // prefix isolates these from user-visible chat and group chat sessions.
          const implicitSessionKey = `agent:${implicitAgentId}:implicit:default`;

          // Compose the message body: system prompt is prepended as instructions,
          // user prompt is the actual query. This mirrors how the agent receives
          // messages in the standard chat flow (body → bodyForAgent).
          const composedBody = `${system}\n\n---\n\n${user}`;

          const msgCtx = buildTownInboundContext({
            rt,
            body: composedBody,
            from: `${CHANNEL_ID}:system`,
            to: `${CHANNEL_ID}:${implicitAgentId}`,
            sessionKey: implicitSessionKey,
            accountId: account.accountId,
          });

          // Collect reply text from the deliver callback
          let replyText = "";
          try {
            await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: msgCtx,
              cfg: ctx.cfg,
              dispatcherOptions: {
                deliver: async (replyPayload: any) => {
                  const text = replyPayload?.text ?? replyPayload?.body ?? "";
                  if (text) replyText += text;
                },
              },
            });
          } catch (err) {
            console.warn("[agentshire] onImplicitChat dispatch error:", (err as Error).message);
          }

          return { text: replyText };
        },
        onChat: async ({ message, townSessionId }) => {
          if (!message) return;
          console.log(
            `[agentshire] onChat received (${townSessionId}): len=${message.length}${DEBUG ? ` "${message.slice(0, 100)}"` : ""}`,
          );

          try {
            await dispatchTownMessage({
              rt,
              cfg: ctx.cfg,
              accountId: account.accountId,
              townSessionId: sanitizeTownSessionId(townSessionId),
              body: message,
            });
          } catch (err) {
            console.error("[agentshire] onChat dispatch error:", err);
          }
        },
        onMultimodal: async ({ parts, townSessionId, npcId }) => {
          console.log(
            `[agentshire] onMultimodal received (${townSessionId}): ${parts.length} parts${npcId ? ` npc=${npcId}` : ""}`,
          );
          try {
            const textParts = parts.filter((p: any) => p.kind === 'text').map((p: any) => p.text).join(' ');
            const mediaParts = parts.filter((p: any) => p.kind !== 'text' && typeof p.data === 'string');

            const mediaPaths: string[] = [];
            for (const part of mediaParts) {
              try {
                const buf = Buffer.from(part.data as string, 'base64');
                const saved = await rt.channel.media.saveMediaBuffer(
                  buf,
                  part.mimeType ?? 'application/octet-stream',
                  undefined,
                  undefined,
                  part.fileName,
                );
                mediaPaths.push(saved.path);
              } catch (err) {
                console.warn('[agentshire] Failed to save inbound media:', (err as Error).message);
              }
            }

            const body = textParts || (mediaPaths.length > 0 ? '[附件]' : '');
            if (!body && mediaPaths.length === 0) return;

            if (npcId) {
              const { routeCitizenMessage } = await import("./citizen-chat-router.js");
              await routeCitizenMessage({
                npcId,
                label: npcId,
                message: body,
                townSessionId: sanitizeTownSessionId(townSessionId),
                accountId: account.accountId,
                cfg: ctx.cfg,
                mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
              });
            } else {
              await dispatchTownMessage({
                rt,
                cfg: ctx.cfg,
                accountId: account.accountId,
                townSessionId: sanitizeTownSessionId(townSessionId),
                body,
                mediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
              });
            }
          } catch (err) {
            console.error("[agentshire] onMultimodal dispatch error:", err);
            broadcastAgentEvent({
              type: "error",
              message: `消息发送失败：${(err as Error).message}`,
              recoverable: true,
            } as any, townSessionId);
          }
        },
        onAction: async ({ action, townSessionId }) => {
          console.log(
            `[agentshire] onAction received (${townSessionId}): type=${action.type}`,
          );
          try {
            if (action.type === "user_message") {
              const text = String(action.text ?? "");
              if (!text) return;

              await dispatchTownMessage({
                rt,
                cfg: ctx.cfg,
                accountId: account.accountId,
                townSessionId: sanitizeTownSessionId(townSessionId),
                body: text,
              });
            } else if (action.type === "abort_requested") {
              // enqueueSystemEvent(text, options) — options.sessionKey is required.
              // For steward: sessionKey = "agent:town-steward:town:{accountId}:{townSessionId}"
              // For citizen: sessionKey = "agent:{agentId}:{townSessionId}"
              const agentId = action.agentId as string | undefined;
              const npcId = action.npcId as string | undefined;
              const sanitizedSession = sanitizeTownSessionId(townSessionId);
              if (agentId && agentId !== "steward" && agentId !== "town-steward") {
                // Citizen abort — construct citizen sessionKey
                const sessionKey = `agent:${agentId}:${sanitizedSession}`;
                console.log(`[agentshire] abort citizen agentId=${agentId} sessionKey=${sessionKey}`);
                rt.system.enqueueSystemEvent("abort", { sessionKey });
              } else if (npcId && npcId !== "steward") {
                // Citizen abort by npcId — resolve agentId
                try {
                  const { findCitizenAgentId } = await import("./citizen-chat-router.js");
                  const resolvedAgentId = findCitizenAgentId(npcId);
                  if (resolvedAgentId) {
                    const sessionKey = `agent:${resolvedAgentId}:${sanitizedSession}`;
                    console.log(`[agentshire] abort citizen npcId=${npcId} → agentId=${resolvedAgentId} sessionKey=${sessionKey}`);
                    rt.system.enqueueSystemEvent("abort", { sessionKey });
                  } else {
                    console.warn(`[agentshire] abort: could not resolve agentId for npcId=${npcId}`);
                  }
                } catch (err) {
                  console.error(`[agentshire] abort citizen resolution error:`, err);
                }
              } else {
                // Steward abort (default)
                const sessionKey = createTownSessionKey(account.accountId, townSessionId);
                console.log(`[agentshire] abort steward sessionKey=${sessionKey}`);
                rt.system.enqueueSystemEvent("abort", { sessionKey });
              }
            }
          } catch (err) {
            console.error("[agentshire] onAction dispatch error:", err);
            broadcastAgentEvent({
              type: "error",
              message: `操作失败：${(err as Error).message}`,
              recoverable: true,
            } as any, townSessionId);
          }
        },
        onCitizenChat: async ({ npcId, message, townSessionId }) => {
          console.log(
            `[agentshire] onCitizenChat (${townSessionId}): npc=${npcId} len=${message.length}${DEBUG ? ` "${message.slice(0, 80)}"` : ""}`,
          );
          try {
            const { routeCitizenMessage } = await import("./citizen-chat-router.js");
            await routeCitizenMessage({
              npcId,
              label: npcId,
              message,
              townSessionId: sanitizeTownSessionId(townSessionId),
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
          } catch (err) {
            console.error("[agentshire] onCitizenChat dispatch error:", err);
            // Notify frontend so it can clear the thinking indicator.
            // Without this, the frontend would stay in "thinking" state
            // until the 2-minute safety timeout, because the backend
            // never sends turn_end when dispatch fails.
            // Use agentId (e.g. "citizen-citizen_7") not npcId (e.g. "citizen_7")
            // because the frontend's routingKey is agentId-based.
            const { findCitizenAgentId } = await import("./citizen-chat-router.js");
            const agentId = findCitizenAgentId(npcId);
            broadcastAgentEvent({
              type: "error",
              message: `消息发送失败：${(err as Error).message}`,
              recoverable: true,
              npcId: agentId ?? npcId,
            } as any, townSessionId);
          }
        },
        onTopicStart: async ({ npcIds, topic, townSessionId }) => {
          try {
            const { startGroupChat } = await import("./group-chat.js");
            const { readFileSync, existsSync } = await import("node:fs");
            const { join } = await import("node:path");
            const { fileURLToPath } = await import("node:url");
            const pluginDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
            const configPath = join(pluginDir, "town-data", "citizen-config.json");
            let participants: Array<{ npcId: string; name: string; agentId: string; specialty?: string; modelRef?: string }> = [];
            if (existsSync(configPath)) {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              const chars: any[] = config.characters ?? [];
              participants = npcIds
                .map(id => {
                  const c = chars.find((ch: any) => ch.id === id && ch.agentEnabled && ch.agentId);
                  return c ? {
                    npcId: id,
                    name: c.name ?? id,
                    agentId: c.agentId,
                    specialty: c.specialty,
                    modelRef: c.modelRef || undefined,
                  } : null;
                })
                .filter(Boolean) as Array<{ npcId: string; name: string; agentId: string; specialty?: string; modelRef?: string }>;
            }
            if (participants.length < 2) {
              console.warn(`[agentshire] topic_start: not enough valid participants (${participants.length})`);
              return;
            }
            const groupId = `topic-${Date.now()}`;
            startGroupChat({
              groupId,
              participants,
              topic,
              townSessionId: sanitizeTownSessionId(townSessionId),
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
          } catch (err) {
            console.error("[agentshire] onTopicStart error:", err);
          }
        },
        onTopicMessage: async ({ npcIds: _npcIds, message, mentions, townSessionId: _townSessionId }) => {
          try {
            const { hasActiveGroup, onUserGroupMessage, getOrCreateDefaultGroup } = await import("./group-chat.js");
            // Find the active non-default group; if none, use default
            let groupId: string | null = null;
            // Check for any active group (the most recently started topic group)
            if (hasActiveGroup()) {
              // Use the first active non-default group
              // For backward compat: if topic_message arrives, route to the active topic group
              // The frontend should use group_chat_message for the default group
              // Fall through to default group if no specific group found
            }
            // Default: route to default group (town-square)
            const group = getOrCreateDefaultGroup({
              townSessionId: sanitizeTownSessionId(_townSessionId),
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
            groupId = group.groupId;
            onUserGroupMessage({
              groupId,
              message,
              mentions: mentions ?? [],
              townSessionId: sanitizeTownSessionId(_townSessionId),
            });
          } catch (err) {
            console.error("[agentshire] onTopicMessage error:", err);
          }
        },
        onTopicEnd: async () => {
          try {
            const { pauseGroup } = await import("./group-chat.js");
            // End all non-default groups, pause default
            // The frontend will specify which group; for now just pause default
            pauseGroup("town-square");
          } catch (err) {
            console.error("[agentshire] onTopicEnd error:", err);
          }
        },
        onGroupChatInit: async ({ townSessionId }) => {
          try {
            const { getOrCreateDefaultGroup, getGroupInfo, getActiveTypingCitizens } = await import("./group-chat.js");
            const { loadGroupHistory } = await import("./group-chat-history.js");
            const { pushGroupChatInfo, pushGroupChatHistory, pushGroupChatTyping } = await import("./ws-server.js");
            const sanitized = sanitizeTownSessionId(townSessionId);
            const group = getOrCreateDefaultGroup({
              townSessionId: sanitized,
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
            const info = getGroupInfo(group.groupId);
            if (info) {
              pushGroupChatInfo(sanitized, { ...info, groupName: info.name });
            }
            // Send persisted history (latest 100 messages) so frontend can restore on refresh
            const history = loadGroupHistory(group.groupId, 100);
            if (history.length > 0) {
              pushGroupChatHistory(sanitized, {
                groupId: group.groupId,
                groupName: group.name,
                messages: history,
              });
            }
            // Re-emit typing indicators for citizens currently composing replies
            // so the frontend can restore the "..." animation after a refresh
            const typingCitizens = getActiveTypingCitizens(group.groupId);
            for (const citizen of typingCitizens) {
              pushGroupChatTyping(sanitized, {
                groupId: group.groupId,
                npcId: citizen.npcId,
                speakerName: citizen.speakerName,
              });
            }
          } catch (err) {
            console.error("[agentshire] onGroupChatInit error:", err);
          }
        },
        onGroupChatMessage: async ({ groupId: _groupId, message, mentions, townSessionId }) => {
          try {
            const { getOrCreateDefaultGroup, onUserGroupMessage, getGroupInfo } = await import("./group-chat.js");
            const { pushGroupChatInfo } = await import("./ws-server.js");
            const group = getOrCreateDefaultGroup({
              townSessionId: sanitizeTownSessionId(townSessionId),
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
            onUserGroupMessage({
              groupId: group.groupId,
              message,
              mentions,
              townSessionId: sanitizeTownSessionId(townSessionId),
            });
            // Push updated info
            const info = getGroupInfo(group.groupId);
            if (info) {
              pushGroupChatInfo(sanitizeTownSessionId(townSessionId), { ...info, groupName: info.name });
            }
          } catch (err) {
            console.error("[agentshire] onGroupChatMessage error:", err);
          }
        },
        onGroupChatClear: async ({ groupId: _groupId, townSessionId }) => {
          try {
            const { getOrCreateDefaultGroup } = await import("./group-chat.js");
            const { clearGroupHistory } = await import("./group-chat-history.js");
            const group = getOrCreateDefaultGroup({
              townSessionId: sanitizeTownSessionId(townSessionId),
              accountId: account.accountId,
              cfg: ctx.cfg,
            });
            // Clear persisted history file
            clearGroupHistory(group.groupId);
            // Clear in-memory history
            group.history = [];
            group.totalTurns = 0;
            console.log(`[agentshire] Group chat cleared: ${group.groupId}`);
          } catch (err) {
            console.error("[agentshire] onGroupChatClear error:", err);
          }
        },
      });

      const townUrl = `http://localhost:${account.townPort}?ws=ws://localhost:${account.wsPort}`;
      const editorUrl = `http://localhost:${account.townPort}/editor.html`;
      const workshopUrl = `http://localhost:${account.townPort}/citizen-editor.html`;
      console.log([
        "",
        "  ┌─────────────────────────────────────────────────────────────────┐",
        "  │  🏘️  Agentshire is live!                                          │",
        "  │                                                                 │",
        `  │  Town:     ${townUrl}  │`,
        `  │  Editor:   ${editorUrl}                          │`,
        `  │  Workshop: ${workshopUrl}                   │`,
        "  │                                                                 │",
        "  │  Click a link above or paste it into your browser.              │",
        "  │  To reopen later: openclaw gateway status                       │",
        "  └─────────────────────────────────────────────────────────────────┘",
        "",
      ].join("\n"));

      if (account.autoLaunch) {
        try {
          const openCmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "cmd"
                : "xdg-open";
          const openArgs =
            process.platform === "win32"
              ? ["/c", "start", townUrl]
              : [townUrl];
          let launched = false;
          try {
            const rt = getTownRuntime();
            await rt.system.runCommandWithTimeout([openCmd, ...openArgs], { timeoutMs: 5000 });
            launched = true;
          } catch {}
          if (!launched) {
            const mod = "node:" + "child" + "_process";
            const cp = await import(/* webpackIgnore: true */ mod);
            cp.spawn(openCmd, openArgs, { detached: true, stdio: "ignore" }).unref();
          }
        } catch (err) {
          console.warn('[agentshire] Auto-launch browser failed:', (err as Error).message)
        }
      }

      await waitUntilAbort(ctx.abortSignal);

      const { stopTownWsServer } = await import("./ws-server.js");
      stopTownWsServer();
    },

    stopAccount: async () => {
      _channelCtx = null;
      const { stopTownWsServer } = await import("./ws-server.js");
      stopTownWsServer();
    },
  },

  agentPrompt: {
    messageToolHints: () => [
      "You are connected to a 3D Agentshire. Your actions are visualized as NPC behaviors " +
      "in a low-poly town. Users can see you thinking, coding, and collaborating. " +
      "Use the town_announce tool to broadcast messages, and town_effect to trigger visual effects.",
    ],
  },
};
