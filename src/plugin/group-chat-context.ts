/**
 * Group chat context manager.
 * Handles sliding window, summary generation, and @-relevance filtering
 * to keep per-citizen context within token budget.
 */

import { chat as llmChat } from "./llm-agent-proxy.js";
import { loadSummary, saveSummary, loadFullGroupHistory, type PersistedGroupMessage } from "./group-chat-history.js";

export interface GroupMessage {
  sequenceId: number;
  timestamp: number;
  speakerNpcId: string;
  speakerName: string;
  text: string;
  mentions: string[];
  usage?: { input: number; output: number; totalTokens?: number };
  contextBudget?: number;
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
    const result = await llmChat({
      system,
      user: transcript,
      maxTokens: MAX_SUMMARY_TOKENS,
      temperature: 0.3,
      stop: [],
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
    console.log(`[group-chat-context] Generated summary for ${groupId}, covering ${toSummarize.length} messages`);
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
