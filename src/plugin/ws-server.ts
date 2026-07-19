import { WebSocketServer, WebSocket } from "ws";
import type { AgentEvent } from "../contracts/events.js";
import { sanitizeTownSessionId } from "./town-session.js";
import { getActivityLogForAgent } from "./subagent-tracker.js";
import type { CustomAssetManager } from "./custom-asset-manager.js";
import { loadChatHistory, loadNewMessages, invalidateSessionCache, loadCitizenHistory, loadCitizenNewMessages, loadSubagentFinalMessage, loadChatItemHistory, loadCitizenItemHistory } from "./session-history.js";
import { ChatSessionWatcher } from "./chat-session-watcher.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";
import { getTownRuntime } from "./runtime.js";
import { parseSessionToken, isValidSession, isPasswordAuthEnabled } from "./auth.js";
import {
  appendMemoryEntry,
  saveActivityJournalSnapshot,
  saveClockState,
  loadAllActivityJournalSnapshots,
  loadClockState,
  clearAllMemories,
} from "./animal-memory.js";
import type { MemoryEntry, ClockState } from "./animal-memory.js";
import type { ActivityJournalSnapshot } from "./animal-snapshot-types.js";
import {
  saveTownRuntimeState,
  loadTownRuntimeState,
} from "./town-runtime-state.js";
import type { TownRuntimeState } from "./town-runtime-state.js";
import {
  saveEconomyState,
  loadEconomyState,
} from "./economy-state.js";
import type { EconomyState } from "./economy-state.js";

export interface TownWsServerOptions {
  port: number;
  customAssetManager?: CustomAssetManager;
  onAction?: (payload: {
    action: Record<string, unknown>;
    townSessionId: string;
  }) => void;
  onChat?: (payload: { message: string; townSessionId: string }) => void;
  onMultimodal?: (payload: {
    parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string; fileName?: string }>;
    townSessionId: string;
    agentId?: string;
    npcId?: string;
  }) => void;
  onImplicitChat?: (payload: {
    id: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
    stop: string[];
    agentId?: string;
  }) => Promise<{ text: string; usage?: { input: number; output: number } }>;
  onCitizenChat?: (payload: { npcId: string; message: string; townSessionId: string }) => void;
  onCompactCitizen?: (payload: { npcId: string; townSessionId: string }) => void;
  onTopicStart?: (payload: { npcIds: string[]; topic?: string; townSessionId: string }) => void;
  onTopicMessage?: (payload: { npcIds: string[]; message: string; mentions?: string[]; townSessionId: string }) => void;
  onTopicEnd?: (payload: { townSessionId: string }) => void;
  onGroupChatInit?: (payload: { townSessionId: string }) => void;
  onGroupChatMessage?: (payload: { groupId: string; message: string; mentions: string[]; townSessionId: string }) => void;
  onGroupChatClear?: (payload: { groupId: string; townSessionId: string }) => void;
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
const clientSessions = new Map<WebSocket, string>();
// Clients that have a 3D scene (town.html iframe). Chat-only UIs (#chat React)
// are NOT scene-capable and cannot respond to NPC spatial queries.
const sceneCapableClients = new Set<WebSocket>();
const clientChatWatchers = new Map<WebSocket, ChatSessionWatcher>();
const clientChatBindings = new Map<WebSocket, { townSessionId: string; agentId: string }>();
const clientChatRetryTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
const coldStartBindings = new Set<WebSocket>();
let activeTownSessionId: string | undefined;
let customAssetMgr: CustomAssetManager | undefined;

function getPublishedConfigPath(): string {
  const pluginDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
  return join(pluginDir, "town-data", "citizen-config.json");
}

export function findCitizenNpcId(agentId: string): string | null {
  return findCitizenNpcIdByAgentId(agentId);
}

function findCitizenNpcIdByAgentId(agentId: string): string | null {
  try {
    const configPath = getPublishedConfigPath();
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const characters: any[] = config.characters ?? [];
      const citizen = characters.find(
        (entry: any) => entry?.role === "citizen" && entry?.agentEnabled && entry?.agentId === agentId,
      );
      if (citizen?.id) return citizen.id;
    }

    // Fallback: derive npcId from agentId pattern "citizen-{npcId}"
    if (agentId.startsWith("citizen-")) {
      const npcId = agentId.slice("citizen-".length).replace(/-/g, "_");
      // Verify the agent exists in openclaw.json
      const openclawConfigPath = join(stateDir(), "openclaw.json");
      if (existsSync(openclawConfigPath)) {
        try {
          const ocConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
          const agents: any[] = ocConfig.agents?.list ?? [];
          if (agents.some((a: any) => a.id === agentId)) return npcId;
        } catch {}
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function getActiveTownSessionId(): string | undefined {
  return activeTownSessionId;
}

interface WorkSnapshotAgent {
  id: string;
  displayName: string;
  task: string;
  status: "pending" | "working" | "completed" | "failed";
}

interface WorkSnapshot {
  phase: "working";
  stewardPersona?: string;
  agents: WorkSnapshotAgent[];
}

const workSnapshots = new Map<string, WorkSnapshot>();

function sessionLogPrefix(townSessionId: string): string {
  return `[agentshire][session:${townSessionId}]`;
}

function cloneWorkSnapshot(snapshot: WorkSnapshot): WorkSnapshot {
  return {
    phase: snapshot.phase,
    stewardPersona: snapshot.stewardPersona,
    agents: snapshot.agents.map((agent) => ({ ...agent })),
  };
}

function normalizeDoneStatus(status: string): WorkSnapshotAgent["status"] {
  if (status === "completed") return "completed";
  return "failed";
}

function getWorkSnapshot(townSessionId: string): WorkSnapshot | null {
  return workSnapshots.get(townSessionId) ?? null;
}

function setWorkSnapshot(townSessionId: string, snapshot: WorkSnapshot | null): void {
  if (!snapshot) {
    workSnapshots.delete(townSessionId);
    return;
  }
  workSnapshots.set(townSessionId, snapshot);
}

function updateWorkSnapshot(townSessionId: string, event: AgentEvent): void {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        const existing = getWorkSnapshot(townSessionId);
        if (!existing?.agents.some(a => a.status === "working")) {
          setWorkSnapshot(townSessionId, null);
        }
      } else if (event.subtype === "done") {
        setWorkSnapshot(townSessionId, null);
      }
      return;

    case "sub_agent":
      if (event.subtype === "started") {
        const snapshot = getWorkSnapshot(townSessionId)
          ? cloneWorkSnapshot(getWorkSnapshot(townSessionId)!)
          : { phase: "working" as const, agents: [] };
        const existingIdx = snapshot.agents.findIndex((agent) => agent.id === event.agentId);
        const nextAgent: WorkSnapshotAgent = {
          id: event.agentId,
          displayName: event.displayName ?? event.agentId,
          task: event.task,
          status: "working",
        };
        if (existingIdx >= 0) snapshot.agents[existingIdx] = nextAgent;
        else snapshot.agents.push(nextAgent);
        setWorkSnapshot(townSessionId, snapshot);
        return;
      }

      if (event.subtype === "done" && getWorkSnapshot(townSessionId)) {
        const snapshot = cloneWorkSnapshot(getWorkSnapshot(townSessionId)!);
        const agent = snapshot.agents.find((item) => item.id === event.agentId);
        if (!agent) return;
        agent.status = normalizeDoneStatus(event.status);
        setWorkSnapshot(townSessionId, snapshot);
      }
      return;

    default:
      return;
  }
}

function getClientSessionId(ws: WebSocket): string {
  return clientSessions.get(ws) ?? "default";
}

function sendWorkSnapshot(ws: WebSocket, townSessionId: string): void {
  const snapshot = getWorkSnapshot(townSessionId);
  if (ws.readyState !== WebSocket.OPEN) return;

  let enrichedSnapshot: any = snapshot ?? null;
  if (snapshot?.agents.length) {
    enrichedSnapshot = {
      ...snapshot,
      agents: snapshot.agents.map((agent) => ({
        ...agent,
        activityLog: getActivityLogForAgent(agent.id),
      })),
    };
  }

  ws.send(
    JSON.stringify({
      type: "work_snapshot",
      townSessionId,
      snapshot: enrichedSnapshot,
    }),
  );
  if (snapshot?.agents.length) {
    console.log(
      `[agentshire] Sent work snapshot (${snapshot.agents.length} agents) for ${townSessionId}`,
    );
  }
}

function handleCustomAssetMessage(ws: WebSocket, msg: any): boolean {
  if (!customAssetMgr) return false;
  const send = (data: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };

  switch (msg.type) {
    case "custom_asset_list": {
      const assets = customAssetMgr.listAssets(msg.kind);
      send({ type: "custom_asset_catalog", assets });
      return true;
    }
    case "custom_asset_upload": {
      const result = customAssetMgr.saveAsset({
        kind: msg.kind ?? "model",
        name: msg.name ?? "未命名",
        data: msg.data,
        cells: msg.cells,
        scale: msg.scale,
        assetType: msg.assetType,
        fixRotationX: msg.fixRotationX,
        fixRotationY: msg.fixRotationY,
        fixRotationZ: msg.fixRotationZ,
        thumbnail: msg.thumbnail,
      });
      if ("error" in result) {
        send({ type: "custom_asset_error", message: result.error });
      } else {
        send({ type: "custom_asset_saved", asset: result });
      }
      return true;
    }
    case "custom_asset_update": {
      const result = customAssetMgr.updateAsset(msg.id, {
        name: msg.name,
        cells: msg.cells,
        scale: msg.scale,
        assetType: msg.assetType,
        fixRotationX: msg.fixRotationX,
        fixRotationY: msg.fixRotationY,
        fixRotationZ: msg.fixRotationZ,
        thumbnail: msg.thumbnail,
      });
      if ("error" in result) {
        send({ type: "custom_asset_error", message: result.error });
      } else {
        send({ type: "custom_asset_saved", asset: result });
      }
      return true;
    }
    case "custom_asset_delete": {
      const result = customAssetMgr.deleteAsset(msg.id);
      if (result.success) {
        send({ type: "custom_asset_deleted", id: msg.id });
      } else {
        send({ type: "custom_asset_error", message: result.error ?? "删除失败" });
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Find the newest .jsonl session file in a sessions directory, excluding
 * trajectory files, reset archives, and optionally a specific session ID.
 * Used as a fallback when sessions.json index is stale (runtime created a
 * new session without updating the index).
 */
function findLatestSessionFile(storeDir: string, excludeSessionId?: string): string | null {
  try {
    const files = readdirSync(storeDir);
    let best: { path: string; mtime: number } | null = null;
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      if (f.includes(".trajectory.") || f.includes(".reset.")) continue;
      const sessionId = f.replace(/\.jsonl$/, "");
      if (excludeSessionId && sessionId === excludeSessionId) continue;
      const fp = join(storeDir, f);
      try {
        const st = statSync(fp);
        if (!best || st.mtimeMs > best.mtime) {
          best = { path: fp, mtime: st.mtimeMs };
        }
      } catch { /* skip */ }
    }
    return best?.path ?? null;
  } catch {
    return null;
  }
}

function resolveChatTranscriptPath(townSessionId: string, agentId: string): string | null {
  try {
    if (agentId === "steward") {
      const storeDir = join(stateDir(), "agents", "town-steward", "sessions");
      const indexPath = join(storeDir, "sessions.json");
      if (!existsSync(indexPath)) return null;
      const index = JSON.parse(readFileSync(indexPath, "utf-8"));
      const newKey = `agent:town-steward:town:default:${townSessionId}`;
      const legacyKey = `town:default:${townSessionId}`;
      const entry = (index[newKey] ?? index[legacyKey]) as any;
      if (entry?.sessionId) {
        const fp = join(storeDir, `${entry.sessionId}.jsonl`);
        if (existsSync(fp)) return fp;
      }
      // Fallback: find the newest unindexed .jsonl session file
      return findLatestSessionFile(storeDir, entry?.sessionId);
    }
    const storeDir = join(stateDir(), "agents", agentId, "sessions");
    const indexPath = join(storeDir, "sessions.json");
    if (!existsSync(indexPath)) return null;
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    const exactKey = `agent:${agentId}:${townSessionId}`;
    const exactEntry = index[exactKey] as any;
    if (exactEntry?.sessionId) {
      const fp = join(storeDir, `${exactEntry.sessionId}.jsonl`);
      if (existsSync(fp)) return fp;
    }
    // Fallback: find the newest unindexed .jsonl session file
    return findLatestSessionFile(storeDir, exactEntry?.sessionId);
  } catch {
    return null;
  }
}

function clearChatWatcherRetry(ws: WebSocket): void {
  const timer = clientChatRetryTimers.get(ws);
  if (timer) {
    clearTimeout(timer);
    clientChatRetryTimers.delete(ws);
  }
  chatWatcherRetryCounts.delete(ws);
}

/** Max retry attempts for cold-start chat watcher (transcript file not yet created) */
const CHAT_WATCHER_MAX_RETRIES = 15;
/** Initial retry delay in ms; doubles each attempt up to CHAT_WATCHER_MAX_DELAY */
const CHAT_WATCHER_INITIAL_DELAY = 400;
const CHAT_WATCHER_MAX_DELAY = 5000;
/** Per-WS retry counter for cold-start chat watcher */
const chatWatcherRetryCounts = new Map<WebSocket, number>();

function scheduleChatWatcherRetry(ws: WebSocket): void {
  clearChatWatcherRetry(ws);
  const binding = clientChatBindings.get(ws);
  if (!binding) return;

  const attempt = chatWatcherRetryCounts.get(ws) ?? 0;
  if (attempt >= CHAT_WATCHER_MAX_RETRIES) {
    console.log(
      `${sessionLogPrefix(binding.townSessionId)} Chat watcher: gave up after ${attempt} retries for ${binding.agentId} (transcript never appeared)`,
    );
    chatWatcherRetryCounts.delete(ws);
    return;
  }

  // Exponential backoff: 400, 800, 1600, 3200, 5000, 5000, ...
  const delay = Math.min(CHAT_WATCHER_INITIAL_DELAY * Math.pow(2, attempt), CHAT_WATCHER_MAX_DELAY);
  chatWatcherRetryCounts.set(ws, attempt + 1);

  const timer = setTimeout(() => {
    clientChatRetryTimers.delete(ws);
    const current = clientChatBindings.get(ws);
    if (!current || clientChatWatchers.has(ws)) return;
    tryStartChatWatcher(ws, current.townSessionId, current.agentId);
  }, delay);
  clientChatRetryTimers.set(ws, timer);
}

function tryStartChatWatcher(ws: WebSocket, townSessionId: string, agentId: string): boolean {
  const transcriptPath = resolveChatTranscriptPath(townSessionId, agentId);
  if (!transcriptPath) {
    console.log(`${sessionLogPrefix(townSessionId)} Chat watcher: no transcript yet for ${agentId}`);
    coldStartBindings.add(ws);
    scheduleChatWatcherRetry(ws);
    return false;
  }
  clearChatWatcherRetry(ws);
  chatWatcherRetryCounts.delete(ws); // Reset on successful start
  const isColdStart = coldStartBindings.has(ws);
  coldStartBindings.delete(ws);
  const existing = clientChatWatchers.get(ws);
  if (existing) existing.stop();
  const storeDir = agentId === "steward"
    ? join(stateDir(), "agents", "town-steward", "sessions")
    : join(stateDir(), "agents", agentId, "sessions");
  const watcher = new ChatSessionWatcher(
    transcriptPath,
    agentId,
    (items) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat_delta", agentId, items }));
      }
    },
    // resolveLatestFile: re-resolve the transcript path to detect session switches
    () => {
      try {
        const indexPath = join(storeDir, "sessions.json");
        if (!existsSync(indexPath)) return null;
        const index = JSON.parse(readFileSync(indexPath, "utf-8"));
        if (agentId === "steward") {
          const newKey = `agent:town-steward:town:default:${townSessionId}`;
          const legacyKey = `town:default:${townSessionId}`;
          const entry = (index[newKey] ?? index[legacyKey]) as any;
          if (entry?.sessionId) {
            const fp = join(storeDir, `${entry.sessionId}.jsonl`);
            if (existsSync(fp)) return fp;
          }
        } else {
          const exactKey = `agent:${agentId}:${townSessionId}`;
          const exactEntry = index[exactKey] as any;
          if (exactEntry?.sessionId) {
            const fp = join(storeDir, `${exactEntry.sessionId}.jsonl`);
            if (existsSync(fp)) return fp;
          }
        }
        // Fallback to newest unindexed file
        return findLatestSessionFile(storeDir);
      } catch {
        return null;
      }
    },
  );
  clientChatWatchers.set(ws, watcher);
  watcher.start(isColdStart);
  console.log(`${sessionLogPrefix(townSessionId)} Chat watcher started for ${agentId} (coldStart=${isColdStart})`);
  return true;
}

export function retryChatWatchersForBinding(townSessionId: string, agentId: string): void {
  for (const [ws, binding] of clientChatBindings) {
    if (binding.townSessionId !== townSessionId || binding.agentId !== agentId) continue;
    const existing = clientChatWatchers.get(ws);
    if (existing) continue;
    tryStartChatWatcher(ws, townSessionId, agentId);
  }
}

export function startTownWsServer(opts: TownWsServerOptions): void {
  if (wss) return;
  customAssetMgr = opts.customAssetManager;

  wss = new WebSocketServer({
    port: opts.port,
    verifyClient: (info, cb) => {
      if (!isPasswordAuthEnabled()) return cb(true); // 免密直接放行
      const token = parseSessionToken(info.req);
      if (isValidSession(token)) cb(true);
      else cb(false, 401, "Unauthorized");
    },
  });
  console.log(`[agentshire] WebSocket server listening on ws://localhost:${opts.port}`);

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[agentshire] ❌ WebSocket port ${opts.port} is already in use.`);
      console.error(`[agentshire]    Fix: stop the process using this port, or change wsPort in openclaw.json:`);
      console.error(`[agentshire]    { "plugins": { "entries": { "agentshire": { "config": { "wsPort": ${opts.port + 1} } } } } }`);
    } else {
      console.error("[agentshire] WebSocket server error:", err);
    }
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[agentshire] Town frontend connected (${clients.size} total)`);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));

        if (msg.type === "town_session_init" && typeof msg.townSessionId === "string") {
          const townSessionId = sanitizeTownSessionId(msg.townSessionId);
          clientSessions.set(ws, townSessionId);
          activeTownSessionId = townSessionId;
          // Track scene-capable clients (town.html iframe sends sceneCapable: true)
          if (msg.sceneCapable === true) {
            sceneCapableClients.add(ws);
          }
          console.log(`${sessionLogPrefix(townSessionId)} WS bound to frontend connection${msg.sceneCapable === true ? " (scene)" : " (chat-only)"}`);
          if (ws.readyState === WebSocket.OPEN) {
            let modelName: string | undefined;
            try {
              const rt = getTownRuntime();
              const cfg = rt.config.current() as any;
              modelName = cfg?.agents?.defaults?.model?.primary;
            } catch {}
            ws.send(JSON.stringify({ type: "town_session_bound", townSessionId, ...(modelName ? { model: modelName } : {}) }));
          }
          sendWorkSnapshot(ws, townSessionId);
        } else if (msg.type === "chat_agent_bind" && typeof msg.agentId === "string") {
          const townSessionId = getClientSessionId(ws);
          const agentId = msg.agentId;
          console.log(`${sessionLogPrefix(townSessionId)} WS ← chat_agent_bind agentId=${agentId}`);

          const oldWatcher = clientChatWatchers.get(ws);
          if (oldWatcher) { oldWatcher.stop(); clientChatWatchers.delete(ws); }
          clearChatWatcherRetry(ws);

          clientChatBindings.set(ws, { townSessionId, agentId });

          tryStartChatWatcher(ws, townSessionId, agentId);
        } else if (msg.type === "chat") {
          const townSessionId = getClientSessionId(ws);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← chat ${JSON.stringify(msg).slice(0, 200)}`,
          );
          // DirectorBridge sends { type:'chat', body:[{kind:'text',text:'...'}] }
          // InputBar may also send { type:'chat', message:'...' }
          if (Array.isArray(msg.body)) {
            const textParts = msg.body
              .filter((p: any) => p.kind === "text" && p.text)
              .map((p: any) => p.text)
              .join(" ");
            if (textParts) opts.onChat?.({ message: textParts, townSessionId });
          } else if (typeof msg.message === "string") {
            opts.onChat?.({ message: msg.message, townSessionId });
          }
        } else if (msg.type === "multimodal" && Array.isArray(msg.parts)) {
          const townSessionId = getClientSessionId(ws);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← multimodal parts=${msg.parts.length}`,
          );
          opts.onMultimodal?.({
            parts: msg.parts,
            townSessionId,
            ...(typeof msg.agentId === "string" ? { agentId: msg.agentId } : {}),
            ...(typeof msg.npcId === "string" ? { npcId: msg.npcId } : {}),
          });
        } else if (handleCustomAssetMessage(ws, msg)) {
          // handled by custom asset manager
        } else if (msg.type === "citizen_chat" && typeof msg.npcId === "string" && typeof msg.message === "string") {
          const townSessionId = getClientSessionId(ws);
          const _debug = process.env.AGENTSHIRE_DEBUG === "1";
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← citizen_chat npc=${msg.npcId} len=${String(msg.message).length}${_debug ? ` "${String(msg.message).slice(0, 80)}"` : ""}`,
          );
          opts.onCitizenChat?.({ npcId: msg.npcId, message: msg.message, townSessionId });
        } else if (msg.type === "compact_citizen" && typeof msg.npcId === "string") {
          const townSessionId = getClientSessionId(ws);
          console.log(`${sessionLogPrefix(townSessionId)} WS ← compact_citizen npc=${msg.npcId}`);
          opts.onCompactCitizen?.({ npcId: msg.npcId, townSessionId });
        } else if (msg.type === "topic_start" && Array.isArray(msg.npcIds)) {
          const townSessionId = getClientSessionId(ws);
          const topic = typeof msg.topic === "string" ? msg.topic : undefined;
          console.log(`${sessionLogPrefix(townSessionId)} WS ← topic_start npcIds=[${msg.npcIds.join(",")}] topic=${topic ?? "none"}`);
          opts.onTopicStart?.({ npcIds: msg.npcIds, topic, townSessionId });
        } else if (msg.type === "topic_message" && Array.isArray(msg.npcIds) && typeof msg.message === "string") {
          const townSessionId = getClientSessionId(ws);
          const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : [];
          console.log(`${sessionLogPrefix(townSessionId)} WS ← topic_message npcIds=[${msg.npcIds.join(",")}] len=${msg.message.length} mentions=[${mentions.join(",")}]`);
          opts.onTopicMessage?.({ npcIds: msg.npcIds, message: msg.message, mentions, townSessionId });
        } else if (msg.type === "topic_end") {
          const townSessionId = getClientSessionId(ws);
          console.log(`${sessionLogPrefix(townSessionId)} WS ← topic_end`);
          opts.onTopicEnd?.({ townSessionId });
        } else if (msg.type === "group_chat_init") {
          const townSessionId = getClientSessionId(ws);
          console.log(`${sessionLogPrefix(townSessionId)} WS ← group_chat_init`);
          opts.onGroupChatInit?.({ townSessionId });
        } else if (msg.type === "group_chat_message" && typeof msg.message === "string") {
          const townSessionId = getClientSessionId(ws);
          const groupId = typeof msg.groupId === "string" ? msg.groupId : "town-square";
          const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : [];
          console.log(`${sessionLogPrefix(townSessionId)} WS ← group_chat_message groupId=${groupId} len=${msg.message.length} mentions=[${mentions.join(",")}]`);
          opts.onGroupChatMessage?.({ groupId, message: msg.message, mentions, townSessionId });
        } else if (msg.type === "group_chat_end" && typeof msg.groupId === "string") {
          const townSessionId = getClientSessionId(ws);
          console.log(`${sessionLogPrefix(townSessionId)} WS ← group_chat_end groupId=${msg.groupId}`);
          opts.onTopicEnd?.({ townSessionId });
        } else if (msg.type === "group_chat_clear") {
          const townSessionId = getClientSessionId(ws);
          const groupId = typeof msg.groupId === "string" ? msg.groupId : "town-square";
          console.log(`${sessionLogPrefix(townSessionId)} WS ← group_chat_clear groupId=${groupId}`);
          opts.onGroupChatClear?.({ groupId, townSessionId });
        } else if (msg.type === "implicit_chat_request" && typeof msg.id === "string" && opts.onImplicitChat) {
          const townSessionId = getClientSessionId(ws);
          opts.onImplicitChat({
            id: msg.id,
            system: String(msg.system ?? ""),
            user: String(msg.user ?? ""),
            maxTokens: Number(msg.maxTokens ?? 200),
            temperature: Number(msg.temperature ?? 0.85),
            stop: Array.isArray(msg.stop) ? msg.stop.map(String) : [],
            ...(typeof msg.agentId === "string" ? { agentId: msg.agentId } : {}),
          }).then((result) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "implicit_chat_response", id: msg.id, text: result.text, usage: result.usage }));
            }
          }).catch((err) => {
            console.warn(`${sessionLogPrefix(townSessionId)} implicit_chat error:`, (err as Error).message);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "implicit_chat_response", id: msg.id, text: "", error: (err as Error).message }));
            }
          });
        } else if (msg.type === "chat_history_request") {
          const townSessionId = getClientSessionId(ws);
          const limit = typeof msg.limit === "number" ? msg.limit : 50;
          const cursor = typeof msg.cursor === "string" ? msg.cursor : undefined;
          const agentId = typeof msg.agentId === "string" ? msg.agentId : undefined;
          const format = typeof msg.format === "string" ? msg.format : "messages";
          console.log(`${sessionLogPrefix(townSessionId)} WS ← chat_history_request agentId=${agentId ?? "steward"} limit=${limit} format=${format} cursor=${cursor ?? "latest"}`);

          if (format === "items") {
            const result = (agentId && agentId !== "steward")
              ? loadCitizenItemHistory(agentId, limit)
              : loadChatItemHistory(limit, cursor);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "chat_history",
                agentId: agentId ?? "steward",
                format: "items",
                items: result.items,
                hasMore: result.hasMore,
                cursor: result.cursor,
                agentActive: isAgentTurnActive(agentId ?? "steward"),
              }));
            }
          } else {
            const result = (agentId && agentId !== "steward")
              ? loadCitizenHistory(agentId, limit)
              : loadChatHistory(limit, cursor);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "chat_history",
                agentId: agentId ?? "steward",
                messages: result.messages,
                hasMore: result.hasMore,
                cursor: result.cursor,
                agentActive: isAgentTurnActive(agentId ?? "steward"),
              }));
            }
          }
        } else if (msg.type === "command" && typeof msg.command === "string") {
          const townSessionId = getClientSessionId(ws);
          // Map /clear → /new: /clear is not an OpenClaw reset trigger, would be treated as text
          const effectiveCommand = msg.command === "clear" ? "new" : msg.command;
          const slashText = `/${effectiveCommand}${msg.args ? " " + msg.args : ""}`;
          console.log(`${sessionLogPrefix(townSessionId)} WS ← command "${slashText}"${effectiveCommand !== msg.command ? ` (mapped from /${msg.command})` : ""}`);
          // Route to bound agent: if citizen selected, route via onCitizenChat
          const binding = clientChatBindings.get(ws);
          const boundAgentId = binding?.agentId;
          if (boundAgentId && boundAgentId !== "steward" && opts.onCitizenChat) {
            const npcId = findCitizenNpcId(boundAgentId) ?? boundAgentId;
            console.log(`${sessionLogPrefix(townSessionId)} command routed to citizen npc=${npcId}`);
            opts.onCitizenChat?.({ npcId, message: slashText, townSessionId });
          } else {
            opts.onChat?.({ message: slashText, townSessionId });
          }
        } else if (msg.type === "abort") {
          const townSessionId = getClientSessionId(ws);
          const agentId = typeof msg.agentId === "string" ? msg.agentId : undefined;
          const npcId = typeof msg.npcId === "string" ? msg.npcId : undefined;
          console.log(`${sessionLogPrefix(townSessionId)} WS ← abort${agentId ? ` agentId=${agentId}` : ""}${npcId ? ` npcId=${npcId}` : ""}`);
          opts.onAction?.({
            action: { type: "abort_requested", ...(agentId ? { agentId } : {}), ...(npcId ? { npcId } : {}) },
            townSessionId,
          });
        } else if (msg.type === "npc_query_result" && typeof msg.requestId === "string") {
          const townSessionId = getClientSessionId(ws);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← npc_query_result requestId=${msg.requestId}`,
          );
          resolveNpcQuery(msg.requestId, msg.data);
        } else if (msg.type === "sync_request") {
          // Frontend reconnected and requests full state resync.
          // town_session_init already triggers sendWorkSnapshot, but if the
          // frontend sends sync_request after binding, re-send the snapshot.
          const townSessionId = getClientSessionId(ws);
          console.log(`${sessionLogPrefix(townSessionId)} WS ← sync_request (reconnect resync)`);
          sendWorkSnapshot(ws, townSessionId);
        } else if (msg.type === "animal_memory_event" && typeof msg.npcId === "string" && msg.entry) {
          // Frontend reports a citizen memory event (dialogue or activity).
          // Persisted to stateDir/agents/animal-memories/{npcId}.jsonl
          const townSessionId = getClientSessionId(ws);
          const entry = msg.entry as MemoryEntry;
          appendMemoryEntry(msg.npcId, entry);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← animal_memory_event npcId=${msg.npcId} type=${entry.type}`,
          );
        } else if (msg.type === "animal_snapshot_save" && typeof msg.npcId === "string" && msg.snapshot) {
          // Frontend reports a full ActivityJournal snapshot (relationships, reflections, plan).
          // Persisted to stateDir/agents/animal-memories/{npcId}.snapshot.json
          const townSessionId = getClientSessionId(ws);
          const snapshot = msg.snapshot as ActivityJournalSnapshot;
          saveActivityJournalSnapshot(msg.npcId, snapshot);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← animal_snapshot_save npcId=${msg.npcId}`,
          );
        } else if (msg.type === "animal_clock_save" && typeof msg.state === "object") {
          // Frontend reports GameClock state (dayCount, gameSeconds).
          // Persisted to stateDir/agents/animal-clock.json
          const townSessionId = getClientSessionId(ws);
          const state = msg.state as ClockState;
          saveClockState(state);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← animal_clock_save day=${state.dayCount}`,
          );
        } else if (msg.type === "town_runtime_save" && typeof msg.state === "object") {
          // Frontend reports town runtime state (NPC positions, scene type,
          // topic state, indoor citizens). Persisted to
          // stateDir/agents/town-runtime-state.json so it survives openclaw
          // restart, page refresh, and device switching.
          const townSessionId = getClientSessionId(ws);
          const state = msg.state as TownRuntimeState;
          saveTownRuntimeState(state);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← town_runtime_save scene=${state.sceneType} npcs=${Object.keys(state.npcPositions ?? {}).length}`,
          );
        } else if (msg.type === "economy_state_save" && typeof msg.state === "object") {
          // Frontend reports citizen economy state (coins, reputation, savings).
          // Persisted to stateDir/agents/animal-economy.json
          const townSessionId = getClientSessionId(ws);
          const state = msg.state as EconomyState;
          saveEconomyState(state);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← economy_state_save citizens=${Object.keys(state.citizens ?? {}).length}`,
          );
        } else if (msg.type === "animal_state_load") {
          // Frontend requests all persisted state (snapshots + clock + runtime + economy) on reconnect.
          const townSessionId = getClientSessionId(ws);
          const snapshots = loadAllActivityJournalSnapshots();
          const clock = loadClockState();
          const runtime = loadTownRuntimeState();
          const economy = loadEconomyState();
          const payload = JSON.stringify({
            type: "animal_state",
            snapshots,
            clock,
            runtime,
            economy,
          });
          if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS → animal_state snapshots=${snapshots.length} clock=${clock ? "yes" : "no"} runtime=${runtime ? "yes" : "no"} economy=${economy ? "yes" : "no"}`,
          );
        } else if (msg.type === "animal_memory_clear_all") {
          // Frontend requests clearing all memories (e.g., Animal Mode disabled).
          const townSessionId = getClientSessionId(ws);
          clearAllMemories();
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← animal_memory_clear_all`,
          );
        } else {
          const townSessionId = getClientSessionId(ws);
          console.log(
            `${sessionLogPrefix(townSessionId)} WS ← action type=${String(msg?.type ?? "unknown")}`,
          );
          opts.onAction?.({ action: msg, townSessionId });
        }
      } catch (err) {
        console.error("[agentshire] WS message parse error:", err);
      }
    });

    ws.on("close", () => {
      const watcher = clientChatWatchers.get(ws);
      if (watcher) { watcher.stop(); clientChatWatchers.delete(ws); }
      clearChatWatcherRetry(ws);
      coldStartBindings.delete(ws);
      clientChatBindings.delete(ws);
      clientSessions.delete(ws);
      sceneCapableClients.delete(ws);
      clients.delete(ws);
      console.log(`[agentshire] Town frontend disconnected (${clients.size} remaining)`);
    });
  });
}

export function stopTownWsServer(): void {
  if (!wss) return;
  for (const watcher of clientChatWatchers.values()) watcher.stop();
  clientChatWatchers.clear();
  for (const timer of clientChatRetryTimers.values()) clearTimeout(timer);
  clientChatRetryTimers.clear();
  clientChatBindings.clear();
  for (const ws of clients) ws.close();
  clients.clear();
  clientSessions.clear();
  workSnapshots.clear();
  citizenMessageCounts.clear();
  lastPushHash = "";
  wss.close();
  wss = null;
  console.log("[agentshire] WebSocket server stopped");
}

/**
 * Track which agents currently have an active turn (between before_model_resolve
 * and agent_end). Used to restore the thinking indicator after a page refresh.
 * Key: agentId (or "steward"), Value: true if turn is in progress.
 */
const activeAgentTurns = new Map<string, boolean>();

export function isAgentTurnActive(agentId: string): boolean {
  return activeAgentTurns.get(agentId) === true;
}

/**
 * Broadcast an AgentEvent to all connected town frontends.
 * Wraps in `{ type: 'agent_event', event }` for the frontend WS protocol.
 */
export function broadcastAgentEvent(event: AgentEvent, townSessionId?: string): void {
  if (townSessionId) {
    updateWorkSnapshot(townSessionId, event);
    // Track active agent turns for thinking indicator restoration
    const agentId = (event as any).npcId as string | undefined;
    const routingKey = agentId ?? "steward";
    if (event.type === "system" && (event as any).subtype === "init") {
      activeAgentTurns.set(routingKey, true);
    } else if (event.type === "turn_end") {
      activeAgentTurns.delete(routingKey);
    } else if (event.type === "system" && (event as any).subtype === "done") {
      activeAgentTurns.delete(routingKey);
    } else if (event.type === "error") {
      activeAgentTurns.delete(routingKey);
    }
    console.log(
      `${sessionLogPrefix(townSessionId)} WS → agent_event type=${event.type}${"subtype" in event ? `/${String((event as { subtype: string }).subtype)}` : ""}`,
    );
  }

  if (clients.size === 0) return;
  const payload = JSON.stringify({ type: "agent_event", event });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && (!townSessionId || getClientSessionId(ws) === townSessionId)) {
      ws.send(payload);
    }
  }
}


export function getConnectedClientCount(): number {
  return clients.size;
}

/** Number of connected clients with a 3D scene (town.html iframe). */
export function getSceneCapableClientCount(): number {
  return sceneCapableClients.size;
}

/** Broadcast an AgentEvent only to scene-capable clients (town.html iframe). */
export function broadcastAgentEventToScene(event: AgentEvent): void {
  if (sceneCapableClients.size === 0) return;
  const payload = JSON.stringify({ type: "agent_event", event });
  for (const ws of sceneCapableClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

// ── NPC spatial query: plugin tools → frontend → result back ──

interface PendingNpcQuery {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingNpcQueries = new Map<string, PendingNpcQuery>();
const NPC_QUERY_TIMEOUT_MS = 5000;

/** Resolve a pending NPC query by requestId (called when frontend sends npc_query_result). */
function resolveNpcQuery(requestId: string, data: unknown): void {
  const pending = pendingNpcQueries.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingNpcQueries.delete(requestId);
  pending.resolve(data);
}

/**
 * Send a spatial query to all connected frontends and return a Promise that
 * resolves with the first frontend's response (or rejects after timeout).
 * `query` shape matches the `world_control.target='query_npc'` AgentEvent variant.
 */
export function requestNpcQuery(
  query:
    | { kind: "self"; npcId: string }
    | { kind: "nearby"; radius: number; origin?: { x: number; z: number }; callerNpcId?: string }
    | { kind: "citizen_status"; npcId: string }
    | { kind: "citizen_memory"; npcId: string; topic?: string }
    | { kind: "place_occupants"; buildingKey: string }
    | { kind: "festival_status" },
): Promise<unknown> {
  const requestId = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<unknown>((resolve, reject) => {
    // Only scene-capable clients (town.html iframe with 3D scene) can respond
    // to NPC spatial queries. Chat-only UIs (#chat React) cannot.
    if (sceneCapableClients.size === 0) {
      reject(new Error("3D 场景未连接（请先打开 Town 标签页加载场景），无法查询 NPC 状态"));
      return;
    }
    const timer = setTimeout(() => {
      pendingNpcQueries.delete(requestId);
      reject(new Error("前端响应超时"));
    }, NPC_QUERY_TIMEOUT_MS);
    pendingNpcQueries.set(requestId, { resolve, reject, timer });
    const payload = JSON.stringify({
      type: "agent_event",
      event: { type: "world_control", target: "query_npc", requestId, query },
    });
    for (const ws of sceneCapableClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  });
}

let lastPushHash = "";

export function pushNewChatMessages(townSessionId: string): void {
  invalidateSessionCache();
  const messages = loadNewMessages();
  if (messages.length === 0) return;

  const latest = messages.slice(-10);
  const hash = latest.map(m => `${m.role}:${m.timestamp}:${m.text.slice(0, 50)}`).join("|");
  if (hash === lastPushHash) return;
  lastPushHash = hash;
  console.log(`${sessionLogPrefix(townSessionId)} WS → chat_new_messages agentId=steward count=${latest.length}`);

  const payload = JSON.stringify({
    type: "chat_new_messages",
    agentId: "steward",
    messages: latest,
  });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(payload);
    }
  }
}

const citizenMessageCounts = new Map<string, number>();

export function pushCitizenMessages(agentId: string, townSessionId: string): void {
  const messages = loadCitizenNewMessages(agentId);
  if (messages.length === 0) return;
  const countKey = `${townSessionId}:${agentId}`;
  const prevCount = citizenMessageCounts.get(countKey) ?? 0;
  if (messages.length === prevCount) return;

  const nextMessages =
    messages.length > prevCount
      ? messages.slice(prevCount)
      : messages.slice(-5);
  citizenMessageCounts.set(countKey, messages.length);

  const npcId = findCitizenNpcIdByAgentId(agentId) ?? undefined;
  console.log(
    `${sessionLogPrefix(townSessionId)} WS → chat_new_messages agentId=${agentId} npcId=${npcId ?? "unknown"} count=${nextMessages.length}`,
  );

  const payload = JSON.stringify({
    type: "chat_new_messages",
    agentId,
    ...(npcId ? { npcId } : {}),
    messages: nextMessages,
  });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(payload);
    }
  }
}

/** Broadcast a group chat message to all connected frontends. */
export function pushGroupChatMessage(townSessionId: string, payload: {
  groupId: string;
  groupName: string;
  sequenceId: number;
  timestamp: number;
  speakerNpcId: string;
  speakerName: string;
  text: string;
  mentions: string[];
  usage?: { input: number; output: number; totalTokens?: number };
  contextBudget?: number;
  model?: string;
  reasoning?: string;
}): void {
  const msg = JSON.stringify({
    type: "group_chat_message",
    ...payload,
  });
  console.log(
    `${sessionLogPrefix(townSessionId)} WS → group_chat_message groupId=${payload.groupId} speaker=${payload.speakerName} len=${payload.text.length}`,
  );
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(msg);
    }
  }
}

/** Broadcast group chat history to a frontend (on init / reconnect). */
export function pushGroupChatHistory(townSessionId: string, payload: {
  groupId: string;
  groupName: string;
  messages: Array<{
    sequenceId: number;
    timestamp: number;
    speakerNpcId: string;
    speakerName: string;
    text: string;
    mentions: string[];
    groupId: string;
    usage?: { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number };
    contextBudget?: number;
    model?: string;
    reasoning?: string;
  }>;
}): void {
  const msg = JSON.stringify({
    type: "group_chat_history",
    ...payload,
  });
  console.log(
    `${sessionLogPrefix(townSessionId)} WS → group_chat_history groupId=${payload.groupId} count=${payload.messages.length}`,
  );
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(msg);
    }
  }
}

/** Broadcast group chat info (participants, etc.) to frontends. */
export function pushGroupChatInfo(townSessionId: string, info: {
  groupId: string;
  groupName: string;
  isDefault: boolean;
  participants: Array<{ npcId: string; name: string; specialty?: string }>;
  topic?: string;
  messageCount: number;
  compactionCount?: number;
}): void {
  const msg = JSON.stringify({
    type: "group_chat_info",
    ...info,
  });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(msg);
    }
  }
}

/**
 * Broadcast a group chat typing indicator to frontends.
 * Sent when a citizen starts composing a reply (dispatched) so the UI can show
 * the citizen's avatar with an animated "..." bubble.
 */
export function pushGroupChatTyping(townSessionId: string, payload: {
  groupId: string;
  npcId: string;
  speakerName: string;
  avatarUrl?: string;
}): void {
  const msg = JSON.stringify({
    type: "group_chat_typing",
    ...payload,
  });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(msg);
    }
  }
}

/**
 * Broadcast a group chat typing-done indicator to frontends.
 * Sent when a citizen finishes its turn (response delivered or skipped/timeout).
 */
export function pushGroupChatTypingDone(townSessionId: string, payload: {
  groupId: string;
  npcId: string;
}): void {
  const msg = JSON.stringify({
    type: "group_chat_typing_done",
    ...payload,
  });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
      ws.send(msg);
    }
  }
}

export function pushSubagentCompletion(childSessionKey: string, townSessionId: string): void {
  try {
    const msg = loadSubagentFinalMessage(childSessionKey);
    if (!msg || !msg.text) return;

    console.log(`${sessionLogPrefix(townSessionId)} WS → chat_new_messages (subagent completion) text="${msg.text.slice(0, 60)}"`);

    invalidateSessionCache();
    const allMessages = loadNewMessages();
    allMessages.push(msg);
    allMessages.sort((a, b) => a.timestamp - b.timestamp);
    const latest = allMessages.slice(-10);
    const hash = latest.map(m => `${m.role}:${m.timestamp}:${m.text.slice(0, 50)}`).join("|");
    lastPushHash = hash;

    const payload = JSON.stringify({
      type: "chat_new_messages",
      agentId: "steward",
      messages: latest,
    });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN && getClientSessionId(ws) === townSessionId) {
        ws.send(payload);
      }
    }
  } catch (err) {
    console.warn(`[agentshire] pushSubagentCompletion error:`, (err as Error).message);
  }
}

export function clearEventBuffer(townSessionId?: string): void {
  if (townSessionId) {
    workSnapshots.delete(townSessionId);
    return;
  }
  workSnapshots.clear();
}
