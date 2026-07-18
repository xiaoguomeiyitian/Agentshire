/**
 * Group chat context manager.
 * Handles sliding window, summary generation, and @-relevance filtering
 * to keep per-citizen context within token budget.
 */

import { chatViaAgent } from "./llm-via-agent.js";
import { loadSummary, saveSummary } from "./group-chat-history.js";

export interface GroupMessage {
  sequenceId: number;
  timestamp: number;
  speakerNpcId: string;
  speakerName: string;
  text: string;
  mentions: string[];
  usage?: { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number };
  contextBudget?: number;
  /** Model id used for this citizen response */
  model?: string;
  /** Reasoning/thinking text extracted from the citizen response (if present). */
  reasoning?: string;
}

export interface Participant {
  npcId: string;
  name: string;
  agentId: string;
  specialty?: string;
  modelRef?: string;
}

const RECENT_WINDOW = 240;
const SUMMARY_TRIGGER_INTERVAL = 80;
const SUMMARY_TRIGGER_THRESHOLD = 120;
const MAX_SUMMARY_TOKENS = 6400;
const MAX_CONTEXT_TOKENS = 96000;

/** Rough token estimate: ~1.5 chars per CJK char, ~4 chars per Latin word. */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.5 + other / 4);
}

/**
 * Issue 4/5: Build a compact map-location summary so citizens know where every
 * place is (buildings, plaza, sculptures). Cached after first load. Injected
 * into group-chat context so citizens can act on "来中心广场集合" requests.
 */
let _mapInfoCache: string | null = null;
function buildMapInfoForChat(): string {
  if (_mapInfoCache !== null) return _mapInfoCache;
  try {
    const { readFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const { fileURLToPath } = require("node:url");
    const pluginDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
    const mapPath = join(pluginDir, "town-data", "town-map.json");
    if (!existsSync(mapPath)) { _mapInfoCache = ""; return _mapInfoCache; }
    const config = JSON.parse(readFileSync(mapPath, "utf-8"));
    const lines: string[] = ["【小镇地图】"];
    // Buildings
    const bNames: Record<string, string> = {
      building_A: "办公室", building_B: "住宅", building_C: "住宅",
      building_D: "住宅", building_E: "市场", building_F: "咖啡店",
      building_G: "玩家家", building_H: "博物馆",
    };
    lines.push("建筑：");
    for (const b of config.buildings ?? []) {
      const baseName = bNames[b.modelKey] ?? b.modelKey;
      lines.push(`  ${baseName}(${b.id}) 坐标(${b.gridX},${b.gridZ})`);
    }
    // Props grouped by modelKey (sculptures, benches, etc.)
    const propGroups = new Map<string, Array<{ x: number; z: number }>>();
    for (const p of config.props ?? []) {
      if (!propGroups.has(p.modelKey)) propGroups.set(p.modelKey, []);
      propGroups.get(p.modelKey)!.push({ x: p.gridX, z: p.gridZ });
    }
    if (propGroups.size > 0) {
      lines.push("物件/雕塑：");
      for (const [key, cells] of propGroups) {
        const xs = cells.map(c => c.x);
        const zs = cells.map(c => c.z);
        const cx = xs.reduce((a: number, b: number) => a + b, 0) / cells.length;
        const cz = zs.reduce((a: number, b: number) => a + b, 0) / cells.length;
        lines.push(`  ${key} ×${cells.length} 中心约(${cx.toFixed(0)},${cz.toFixed(0)})`);
      }
    }
    // Detect plaza area: cluster of benches / bushes → center plaza
    const benches = propGroups.get("bench") ?? [];
    if (benches.length >= 2) {
      const cx = benches.reduce((a, c) => a + c.x, 0) / benches.length;
      const cz = benches.reduce((a, c) => a + c.z, 0) / benches.length;
      lines.push(`中心广场：约(${cx.toFixed(0)},${cz.toFixed(0)})（长椅聚集处，居民集合/散步的社交中心）`);
    }
    _mapInfoCache = lines.join("\n");
  } catch {
    _mapInfoCache = "";
  }
  return _mapInfoCache;
}

/** Build the context message for a specific citizen. */
export function buildContextForCitizen(
  groupId: string,
  history: GroupMessage[],
  participants: Participant[],
  targetNpcId: string,
  topic?: string,
  isDirectlyMentioned = false,
): string {
  const storedSummary = loadSummary(groupId);
  const summaryUpTo = storedSummary?.summaryUpToIndex ?? 0;

  // Filter relevant messages for this citizen
  const relevant = filterRelevantHistory(history, targetNpcId);

  // Determine recent window start
  const recentStart = Math.max(summaryUpTo, history.length - RECENT_WINDOW);
  const recentMessages = history.slice(recentStart);

  // Merge: relevant messages from before recent window + recent window
  const relevantBeforeRecent = relevant.filter(m => m.sequenceId < history[recentStart]?.sequenceId);
  const contextMessages = [...relevantBeforeRecent, ...recentMessages];

  // Token budget check
  let totalTokens = 0;
  const finalMessages: GroupMessage[] = [];
  for (let i = contextMessages.length - 1; i >= 0; i--) {
    const msg = contextMessages[i];
    const msgTokens = estimateTokens(`${msg.speakerName}：${msg.text}`);
    if (totalTokens + msgTokens > MAX_CONTEXT_TOKENS && finalMessages.length >= 5) break;
    totalTokens += msgTokens;
    finalMessages.unshift(msg);
  }

  // Build context string
  let context = "";

  // Participant list
  const otherParticipants = participants.filter(p => p.npcId !== targetNpcId);
  const participantList = otherParticipants
    .map(p => `${p.name}${p.specialty ? `(${p.specialty})` : ""}`)
    .join("、");
  context += `你正在参加一个群聊，参与者有：${participantList}\n`;
  context += `你可以用 @居民名 来指定回复对象。可用 @ 的居民：${otherParticipants.map(p => p.name).join("、")}\n`;
  context += `用 @所有人 可以呼叫所有居民。不必要时请勿 @，避免打扰他人。\n`;
  if (topic) {
    context += `话题：${topic}\n`;
  }
  // Issue 4/5: inject map info so citizens know where every place is and
  // can act on "来中心广场集合" type requests instead of just replying.
  const mapInfo = buildMapInfoForChat();
  if (mapInfo) {
    context += `${mapInfo}\n`;
    context += `如果有人喊大家去某个地点（如"来中心广场集合"），请回复表示你会前往，并在日常自主行动中前往该地点。\n`;
  }
  context += `\n`;

  // Summary
  if (storedSummary?.summary) {
    context += `【之前对话摘要】\n${storedSummary.summary}\n\n`;
  }

  // Recent messages
  context += `【对话记录】\n`;
  for (const msg of finalMessages) {
    const mentionTag = msg.mentions.length > 0
      ? ` (提及: ${msg.mentions.map(m => m === "all" ? "所有人" : participants.find(p => p.npcId === m)?.name ?? m).join(", ")})`
      : "";
    context += `${msg.speakerName}${mentionTag}：${msg.text}\n`;
  }

  context += `\n轮到你了，请简短回复（不超过200字）。${isDirectlyMentioned ? "有人@你，请务必回复。" : '如果不需要你发言可以回复"[skip]"。'}`;

  return context;
}

/** Filter messages relevant to a specific citizen. */
function filterRelevantHistory(history: GroupMessage[], targetNpcId: string): GroupMessage[] {
  return history.filter(msg => {
    // 1. Self → always include
    if (msg.speakerNpcId === targetNpcId) return true;
    // 2. @self → include
    if (msg.mentions.includes(targetNpcId)) return true;
    // 3. @all → include
    if (msg.mentions.includes("all")) return true;
    // 4. User messages → include
    if (msg.speakerNpcId === "user") return true;
    // 5. Last 5 messages → include for coherence
    if (history.indexOf(msg) >= history.length - 5) return true;
    // 6. Other citizens' non-@ messages → exclude
    return false;
  });
}

/** Check if a summary should be generated and generate it if needed. */
export async function maybeGenerateSummary(
  groupId: string,
  history: GroupMessage[],
  participants: Participant[],
): Promise<void> {
  const storedSummary = loadSummary(groupId);
  const summaryUpTo = storedSummary?.summaryUpToIndex ?? 0;
  const unsummarizedCount = history.length - summaryUpTo;

  if (unsummarizedCount < SUMMARY_TRIGGER_THRESHOLD + SUMMARY_TRIGGER_INTERVAL) return;
  if (unsummarizedCount % SUMMARY_TRIGGER_INTERVAL !== 0) return;

  await generateSummary(groupId, history, participants, summaryUpTo);
}

/** Generate a summary for the unsummarized portion of history. */
async function generateSummary(
  groupId: string,
  history: GroupMessage[],
  participants: Participant[],
  summaryUpTo: number,
): Promise<void> {
  const toSummarize = history.slice(summaryUpTo, history.length - RECENT_WINDOW);
  if (toSummarize.length === 0) return;

  const transcript = toSummarize.map(msg => `${msg.speakerName}：${msg.text}`).join("\n");
  const participantNames = participants.map(p => p.name).join("、");

  const system = `你是一个群聊摘要助手。请将以下群聊对话压缩为简洁摘要，保留：
1. 讨论的主要话题和结论
2. 每个居民的关键观点（用居民名标注）
3. 未解决的问题
4. 重要的 @ 和决策

参与者：${participantNames}

输出格式：
[话题1] 摘要... (参与者: A, B)
[话题2] 摘要... (参与者: B, C)
未决问题: ...`;

  try {
    const result = await chatViaAgent({
      system,
      user: transcript,
      sessionScope: `summary:${groupId}`,
      timeoutMs: 60_000,
    });

    if (!result.text) return;

    const existingSummary = loadSummary(groupId);
    const combinedSummary = existingSummary?.summary
      ? `${existingSummary.summary}\n\n${result.text}`
      : result.text;

    saveSummary(groupId, {
      summary: combinedSummary,
      summaryUpToIndex: history.length - RECENT_WINDOW,
      updatedAt: Date.now(),
    });
    console.log(`[group-chat-context] Generated summary for ${groupId}, covering ${toSummarize.length} messages (via OpenClaw agent, ${result.latencyMs}ms)`);
  } catch (err) {
    console.warn(`[group-chat-context] Summary generation failed for ${groupId}:`, (err as Error).message);
  }
}

/** Parse @mentions from citizen LLM output text. */
export function parseMentionsFromText(text: string, participants: Participant[]): string[] {
  const mentions: string[] = [];

  // @所有人 / @all / @全体
  if (/@(所有人|all|全体)/i.test(text)) {
    mentions.push("all");
  }

  // @居民名 (exact match with word boundary)
  for (const p of participants) {
    const pattern = new RegExp(`@${escapeRegExp(p.name)}(?=\\s|$|[,，。.!！?？])`, "g");
    if (pattern.test(text)) {
      mentions.push(p.npcId);
    }
  }

  return [...new Set(mentions)];
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Check if a citizen's response is a skip. */
export function isSkipResponse(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed === "[skip]" || trimmed === "skip" || trimmed === "跳过";
}
