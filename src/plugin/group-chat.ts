/**
 * Group chat engine — manages multi-citizen group conversations.
 *
 * Features:
 *   - Default "town-square" group containing all enabled citizens
 *   - Ad-hoc temporary groups (user-initiated)
 *   - @mention parsing and routing (user → citizen, citizen → citizen)
 *   - Concurrent dispatch with per-agent serial queue
 *   - Context compression via group-chat-context
 *   - History persistence via group-chat-history
 *   - Anti-spam: cooldown, max concurrent speakers, max turns, idle timeout
 *
 * Replaces the old round-robin group-discussion.ts.
 */

import { routeCitizenMessage } from "./citizen-chat-router.js";
import { broadcastAgentEvent, pushGroupChatMessage, pushGroupChatTyping, pushGroupChatTypingDone } from "./ws-server.js";
import {
  buildContextForCitizen,
  maybeGenerateSummary,
  parseMentionsFromText,
  isSkipResponse,
  type GroupMessage,
  type Participant,
} from "./group-chat-context.js";
import {
  appendGroupMessage,
  loadGroupHistory,
  type PersistedGroupMessage,
} from "./group-chat-history.js";
import { extractReasoning } from "./session-history.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir } from "./paths.js";

const DEFAULT_GROUP_ID = "town-square";
const DEFAULT_GROUP_NAME = "小镇广场";

const TURN_TIMEOUT_MS = 60_000;
const MAX_TOTAL_TURNS = 120;
const MAX_CONCURRENT_SPEAKERS = 2; // 降低并发避免 session 冲突（OpenClaw session settle ~15s）
const SPEAKER_COOLDOWN_MS = 10_000; // 增大冷却，OpenClaw session 释放很慢
const IDLE_TIMEOUT_MS = 120_000; // 增大 idle 超时，管家需要时间处理夜行动/投票
const MAX_MENTION_CHAIN = 3; // max A↔B ping-pong before auto-break
const MAX_ALL_BROADCAST_CHAIN = 12; // @所有人 广播链上限（裁判/管家需反复广播，单独放宽）
const SESSION_CONFLICT_RETRY_MS = 8_000; // session 冲突后初始延迟重试间隔（指数退避基数）
const SESSION_CONFLICT_MAX_RETRIES = 10; // session 冲突最大重试次数（agent 可能正在执行 subagent，需等几分钟）

interface ActiveGroupChat {
  groupId: string;
  name: string;
  isDefault: boolean;
  participants: Participant[];
  history: GroupMessage[];
  pendingMentions: Array<{ npcId: string; isDirectlyMentioned: boolean }>;
  activeSpeakers: Set<string>;
  turnTimers: Map<string, ReturnType<typeof setTimeout>>;
  speakerCooldowns: Map<string, number>;
  mentionChainCount: Map<string, number>; // key: "npcA→npcB" → count
  totalTurns: number;
  stopped: boolean;
  topic: string | undefined;
  townSessionId: string;
  accountId: string;
  cfg: Record<string, unknown>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  responseBuffers: Map<string, string>;
  contextBudgets: Map<string, number>;
  usageMap: Map<string, { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number }>;
  modelMap: Map<string, string>;
  sessionConflictRetries: Map<string, number>;
  finalizedSpeakers: Set<string>; // speakers whose response is finalized but routeCitizenMessage await hasn't returned
  compactionCount: number; // max compaction count across all citizen turns
}

const activeGroups = new Map<string, ActiveGroupChat>();
let globalSequence = 0;

function nextSequenceId(): number {
  return ++globalSequence;
}

function getPluginDir(): string {
  return join(fileURLToPath(import.meta.url), "..", "..", "..");
}

function getPublishedConfigPath(): string {
  return join(getPluginDir(), "town-data", "citizen-config.json");
}

/** Load all agent-enabled citizens (and steward) from citizen-config.json + openclaw.json. */
export function loadAllEnabledCitizens(): Participant[] {
  try {
    const configPath = getPublishedConfigPath();
    if (!existsSync(configPath)) return [];

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const characters: any[] = config.characters ?? [];

    // Also load agents from openclaw.json (source of truth for agent registration)
    const openclawConfigPath = join(stateDir(), "openclaw.json");
    let openclawAgents: any[] = [];
    if (existsSync(openclawConfigPath)) {
      try {
        const ocConfig = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
        openclawAgents = ocConfig.agents?.list ?? [];
      } catch {}
    }

    // Build a set of citizen agent IDs from openclaw.json
    const citizenAgentIds = new Set(
      openclawAgents
        .filter((a: any) => a.id?.startsWith("citizen-"))
        .map((a: any) => a.id),
    );

    const participants: Participant[] = [];

    // Add steward first (if registered in openclaw.json)
    const stewardChar = characters.find((c: any) => c.role === "steward");
    const stewardAgent = openclawAgents.find((a: any) => a.id === "town-steward");
    if (stewardChar && stewardAgent) {
      participants.push({
        npcId: stewardChar.id,
        name: stewardChar.name,
        agentId: "town-steward",
        specialty: stewardChar.specialty || "管家",
        modelRef: stewardAgent.model || undefined,
      });
    }

    // Get citizen characters from config
    const citizenChars = characters.filter((c: any) => c.role === "citizen");

    // A citizen is a participant if:
    // 1. citizen-config.json has agentEnabled=true AND agentId, OR
    // 2. openclaw.json has a matching agent (by agentId or citizen-{id} pattern)
    for (const c of citizenChars) {
      const expectedAgentId = c.agentId ?? `citizen-${c.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      const isEnabled = (c.agentEnabled && c.agentId) || citizenAgentIds.has(expectedAgentId);
      if (!isEnabled) continue;
      participants.push({
        npcId: c.id,
        name: c.name,
        agentId: c.agentId ?? expectedAgentId,
        specialty: c.specialty,
        modelRef: c.modelRef || undefined,
      });
    }

    return participants;
  } catch {
    return [];
  }
}

/** Find a single citizen's participant info by npcId. */
function findParticipant(npcId: string, participants: Participant[]): Participant | undefined {
  return participants.find(p => p.npcId === npcId);
}

/** Get or create the default "town-square" group. */
export function getOrCreateDefaultGroup(ctx: {
  townSessionId: string;
  accountId: string;
  cfg: Record<string, unknown>;
}): ActiveGroupChat {
  let group = activeGroups.get(DEFAULT_GROUP_ID);
  if (group && !group.stopped) {
    // Update townSessionId for reconnected frontends (e.g. after gateway restart)
    group.townSessionId = ctx.townSessionId;
    return group;
  }

  const participants = loadAllEnabledCitizens();
  group = {
    groupId: DEFAULT_GROUP_ID,
    name: DEFAULT_GROUP_NAME,
    isDefault: true,
    participants,
    history: [],
    pendingMentions: [],
    activeSpeakers: new Set(),
    turnTimers: new Map(),
    speakerCooldowns: new Map(),
    mentionChainCount: new Map(),
    totalTurns: 0,
    stopped: false,
    topic: undefined,
    townSessionId: ctx.townSessionId,
    accountId: ctx.accountId,
    cfg: ctx.cfg,
    idleTimer: null,
    responseBuffers: new Map(),
    contextBudgets: new Map(),
    usageMap: new Map(),
    modelMap: new Map(),
    sessionConflictRetries: new Map(),
    finalizedSpeakers: new Set(),
    compactionCount: 0,
  };

  // Load persisted history
  const persisted = loadGroupHistory(DEFAULT_GROUP_ID, 50);
  group.history = persisted.map(p => ({
    sequenceId: p.sequenceId,
    timestamp: p.timestamp,
    speakerNpcId: p.speakerNpcId,
    speakerName: p.speakerName,
    text: p.text,
    mentions: p.mentions,
  }));

  // Advance globalSequence past history to prevent sequenceId collisions
  for (const p of persisted) {
    if (p.sequenceId > globalSequence) globalSequence = p.sequenceId;
  }

  activeGroups.set(DEFAULT_GROUP_ID, group);
  console.log(`[group-chat] Default group "${DEFAULT_GROUP_NAME}" ready with ${participants.length} participants, ${group.history.length} history messages`);
  return group;
}

/** Start an ad-hoc temporary group chat. */
export function startGroupChat(params: {
  groupId: string;
  name?: string;
  participants: Participant[];
  topic?: string;
  townSessionId: string;
  accountId: string;
  cfg: Record<string, unknown>;
}): ActiveGroupChat {
  const { groupId, participants, topic, townSessionId, accountId, cfg } = params;

  // End existing non-default group with same ID
  const existing = activeGroups.get(groupId);
  if (existing && !existing.isDefault) {
    endGroupChat(groupId);
  }

  const group: ActiveGroupChat = {
    groupId,
    name: params.name ?? `群聊-${groupId.slice(0, 8)}`,
    isDefault: false,
    participants,
    history: [],
    pendingMentions: [],
    activeSpeakers: new Set(),
    turnTimers: new Map(),
    speakerCooldowns: new Map(),
    mentionChainCount: new Map(),
    totalTurns: 0,
    stopped: false,
    topic,
    townSessionId,
    accountId,
    cfg,
    idleTimer: null,
    responseBuffers: new Map(),
    contextBudgets: new Map(),
    usageMap: new Map(),
    modelMap: new Map(),
    sessionConflictRetries: new Map(),
    finalizedSpeakers: new Set(),
    compactionCount: 0,
  };

  // Load persisted history for this group
  const persisted = loadGroupHistory(groupId, 50);
  group.history = persisted.map(p => ({
    sequenceId: p.sequenceId,
    timestamp: p.timestamp,
    speakerNpcId: p.speakerNpcId,
    speakerName: p.speakerName,
    text: p.text,
    mentions: p.mentions,
  }));

  // Advance globalSequence past history to prevent sequenceId collisions
  for (const p of persisted) {
    if (p.sequenceId > globalSequence) globalSequence = p.sequenceId;
  }

  activeGroups.set(groupId, group);
  console.log(`[group-chat] Started group "${group.name}" (${groupId}) with ${participants.length} participants, topic="${topic ?? "none"}"`);
  return group;
}

/** End a group chat (only non-default groups can be ended). */
export function endGroupChat(groupId: string): void {
  const group = activeGroups.get(groupId);
  if (!group) return;
  if (group.isDefault) {
    console.log(`[group-chat] Cannot end default group, pausing instead`);
    pauseGroup(groupId);
    return;
  }

  console.log(`[group-chat] Ending group "${group.name}" (${group.totalTurns} total turns)`);
  group.stopped = true;
  clearAllTimers(group);
  activeGroups.delete(groupId);
}

/** Pause a group (stop timers but keep state). */
export function pauseGroup(groupId: string): void {
  const group = activeGroups.get(groupId);
  if (!group) return;
  clearAllTimers(group);
  group.activeSpeakers.clear();
  group.pendingMentions = [];
  console.log(`[group-chat] Paused group "${group.name}"`);
}

/** Check if a group is active. */
export function hasActiveGroup(groupId?: string): boolean {
  if (groupId) {
    const g = activeGroups.get(groupId);
    return g !== undefined && !g.stopped;
  }
  for (const g of activeGroups.values()) {
    if (!g.stopped) return true;
  }
  return false;
}

/** Get the active group for a given agentId (for hook callbacks). */
export function findGroupByAgentId(agentId: string): ActiveGroupChat | null {
  for (const group of activeGroups.values()) {
    if (group.stopped) continue;
    const participant = group.participants.find(p => p.agentId === agentId);
    if (participant) return group;
  }
  return null;
}

/** Add a participant to the default group (called when new citizen is created). */
export function addParticipantToDefaultGroup(p: Participant): void {
  const group = activeGroups.get(DEFAULT_GROUP_ID);
  if (!group) {
    // Default group not yet created; will pick up on next getOrCreateDefaultGroup
    console.log(`[group-chat] Default group not active, ${p.name} will join on next init`);
    return;
  }
  if (group.participants.find(x => x.npcId === p.npcId)) return;
  group.participants.push(p);
  console.log(`[group-chat] ${p.name} joined default group (${group.participants.length} total)`);

  // Broadcast join event
  broadcastAgentEvent({
    type: "debug",
    category: "group_chat",
    message: `${p.name} 加入了群聊`,
    data: { groupId: DEFAULT_GROUP_ID, npcId: p.npcId, action: "joined" },
  } as any);
}

/** Remove a participant from the default group. */
export function removeParticipantFromDefaultGroup(npcId: string): void {
  const group = activeGroups.get(DEFAULT_GROUP_ID);
  if (!group) return;
  const before = group.participants.length;
  group.participants = group.participants.filter(p => p.npcId !== npcId);
  if (group.participants.length < before) {
    console.log(`[group-chat] ${npcId} left default group (${group.participants.length} remaining)`);
    broadcastAgentEvent({
      type: "debug",
      category: "group_chat",
      message: `${npcId} 离开了群聊`,
      data: { groupId: DEFAULT_GROUP_ID, npcId, action: "left" },
    } as any);
  }
}

/** Handle a user message in a group chat. */
export function onUserGroupMessage(params: {
  groupId: string;
  message: string;
  mentions: string[];
  townSessionId: string;
}): void {
  const { groupId, message, mentions } = params;
  const group = activeGroups.get(groupId);
  if (!group || group.stopped) {
    console.warn(`[group-chat] User message for inactive group ${groupId}`);
    return;
  }

  // Add user message to history
  const msg: GroupMessage = {
    sequenceId: nextSequenceId(),
    timestamp: Date.now(),
    speakerNpcId: "user",
    speakerName: "镇长",
    text: message,
    mentions,
  };
  group.history.push(msg);
  persistMessage(group, msg);
  resetIdleTimer(group);

  // Broadcast user message to frontend
  pushGroupChatMessage(group.townSessionId, {
    groupId: group.groupId,
    groupName: group.name,
    sequenceId: msg.sequenceId,
    timestamp: msg.timestamp,
    speakerNpcId: "user",
    speakerName: "镇长",
    text: message,
    mentions,
  });

  // Determine who to dispatch to
  let targets: string[] = [];
  if (mentions.includes("all")) {
    // @all → all participants
    targets = group.participants.map(p => p.npcId);
  } else if (mentions.length > 0) {
    // @specific → only mentioned
    targets = mentions.filter(npcId =>
      group.participants.some(p => p.npcId === npcId),
    );
  } else {
    // No @ → all participants (free discussion)
    targets = group.participants.map(p => p.npcId);
  }

  // Dispatch to targets
  const isAllMention = mentions.includes("all");
  for (const npcId of targets) {
    dispatchToCitizen(npcId, group, mentions.includes(npcId) || isAllMention);
  }

  // Maybe generate summary
  maybeGenerateSummary(group.groupId, group.history, group.participants).catch(() => {});
}

/** Handle citizen LLM output (streaming text). */
export function onCitizenResponse(agentId: string, text: string, contextTokenBudget?: number, usage?: { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number }, model?: string): void {
  const group = findGroupByAgentId(agentId);
  if (!group || group.stopped) return;

  const participant = group.participants.find(p => p.agentId === agentId);
  if (!participant) return;

  // Buffer the response
  const existing = group.responseBuffers.get(participant.npcId) ?? "";
  group.responseBuffers.set(participant.npcId, existing + text);

  // Store context token budget from llm_output for inclusion in group_chat_message
  if (typeof contextTokenBudget === "number") {
    group.contextBudgets.set(participant.npcId, contextTokenBudget);
  }
  // Store usage from llm_output (agent_end payload lacks usage in OpenClaw 2026.6.11)
  if (usage) {
    group.usageMap.set(participant.npcId, usage);
  }
  // Store model from llm_output for inclusion in group_chat_message
  if (model) {
    group.modelMap.set(participant.npcId, model);
  }
}

/** Handle citizen turn end (agent_end hook). */
export function onCitizenTurnEnd(agentId: string, _usage?: { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number }, compactionCount?: number): void {
  const group = findGroupByAgentId(agentId);
  if (!group || group.stopped) return;

  // Track max compaction count across all citizen turns
  if (typeof compactionCount === "number" && compactionCount > group.compactionCount) {
    group.compactionCount = compactionCount;
  }

  const participant = group.participants.find(p => p.agentId === agentId);
  if (!participant) return;

  // Clear turn timer
  const timer = group.turnTimers.get(participant.npcId);
  if (timer) {
    clearTimeout(timer);
    group.turnTimers.delete(participant.npcId);
  }
  // NOTE: llm_output may fire AFTER agent_end in OpenClaw 2026.6.11.
  // Do NOT delete from activeSpeakers yet; delete only after tryFinalize completes.
  // If buffer is empty, defer to allow llm_output to populate it.
  const tryFinalize = () => {
    const responseText = (group.responseBuffers.get(participant.npcId) ?? "").trim();
    group.responseBuffers.delete(participant.npcId);
    const contextBudget = group.contextBudgets.get(participant.npcId);
    group.contextBudgets.delete(participant.npcId);
    const storedUsage = group.usageMap.get(participant.npcId);
    group.usageMap.delete(participant.npcId);
    const storedModel = group.modelMap.get(participant.npcId);
    group.modelMap.delete(participant.npcId);

    // NOTE: Don't delete activeSpeakers here — OpenClaw's session stays locked until
    // dispatchReplyWithBufferedBlockDispatcher completes (fires message_sending AFTER agent_end).
    // Deleting here would let a new dispatch collide with the locked session.
    group.finalizedSpeakers.add(participant.npcId);
    // Notify frontend that this citizen is done typing
    pushGroupChatTypingDone(group.townSessionId, {
      groupId: group.groupId,
      npcId: participant.npcId,
    });
    if (!responseText || isSkipResponse(responseText)) {
      console.log(`[group-chat] ${participant.name} skipped response`);
      drainPendingMentions(group);
      return;
    }
    finalizeCitizenResponse(group, participant, responseText, storedUsage, contextBudget, storedModel);
  };

  if ((group.responseBuffers.get(participant.npcId) ?? "").trim()) {
    tryFinalize();
  } else {
    // Wait for llm_output to fire (may arrive AFTER agent_end)
    let attempts = 0;
    const maxAttempts = 3;
    const retryFinalize = () => {
      attempts++;
      const buf = (group.responseBuffers.get(participant.npcId) ?? "").trim();
      if (buf) {
        tryFinalize();
      } else if (attempts < maxAttempts) {
        setTimeout(retryFinalize, 800);
      } else {
        console.log(`[group-chat] ${participant.name} response buffer still empty after ${attempts} retries, skipping`);
        tryFinalize();
      }
    };
    setTimeout(retryFinalize, 800);
  }
}

/** Finalize a citizen response: parse mentions, persist, broadcast, chain. */
function finalizeCitizenResponse(group: ActiveGroupChat, participant: Participant, responseText: string, usage?: { input: number; output: number; totalTokens?: number; cacheRead?: number; cacheWrite?: number }, contextBudget?: number, model?: string): void {
  // Extract reasoning/thinking text from the response (e.g. <thinking>...</thinking> tags)
  const { reasoning, final } = extractReasoning(responseText);
  const cleanText = final || responseText;

  // Parse mentions from citizen output
  const mentions = parseMentionsFromText(cleanText, group.participants);

  // Add to history
  const msg: GroupMessage = {
    sequenceId: nextSequenceId(),
    timestamp: Date.now(),
    speakerNpcId: participant.npcId,
    speakerName: participant.name,
    text: cleanText,
    mentions,
    ...(usage ? { usage } : {}),
    ...(typeof contextBudget === "number" ? { contextBudget } : {}),
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
  group.history.push(msg);
  persistMessage(group, msg);
  resetIdleTimer(group);

  console.log(`[group-chat] ${participant.name} said: "${cleanText.slice(0, 80)}" (mentions: ${mentions.join(", ") || "none"})`);

  // Broadcast to frontend
  pushGroupChatMessage(group.townSessionId, {
    groupId: group.groupId,
    groupName: group.name,
    sequenceId: msg.sequenceId,
    timestamp: msg.timestamp,
    speakerNpcId: participant.npcId,
    speakerName: participant.name,
    text: cleanText,
    mentions,
    ...(usage ? { usage } : {}),
    ...(typeof contextBudget === "number" ? { contextBudget } : {}),
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
  });

  // Check mention chain limit (includes @all to prevent infinite broadcast loops)
  const chainTargets = mentions.filter(m => m !== "all");
  for (const targetNpcId of chainTargets) {
    const chainKey = `${participant.npcId}→${targetNpcId}`;
    const count = (group.mentionChainCount.get(chainKey) ?? 0) + 1;
    group.mentionChainCount.set(chainKey, count);
    if (count >= MAX_MENTION_CHAIN) {
      console.log(`[group-chat] Mention chain ${chainKey} reached limit (${MAX_MENTION_CHAIN}), breaking`);
      continue;
    }
  }

  // Track @all broadcast count to prevent infinite loops (uses higher limit)
  if (mentions.includes("all")) {
    const allChainKey = `${participant.npcId}→all`;
    const allCount = (group.mentionChainCount.get(allChainKey) ?? 0) + 1;
    group.mentionChainCount.set(allChainKey, allCount);
    if (allCount >= MAX_ALL_BROADCAST_CHAIN) {
      console.log(`[group-chat] @all chain from ${participant.name} reached limit (${MAX_ALL_BROADCAST_CHAIN}), breaking`);
    }
  }

  // Determine next targets
  let nextTargets: string[] = [];
  const allChainExceeded = mentions.includes("all") &&
    (group.mentionChainCount.get(`${participant.npcId}→all`) ?? 0) >= MAX_ALL_BROADCAST_CHAIN;
  if (mentions.includes("all") && !allChainExceeded) {
    nextTargets = group.participants
      .filter(p => p.npcId !== participant.npcId)
      .map(p => p.npcId);
  } else if (chainTargets.length > 0) {
    nextTargets = chainTargets.filter(npcId =>
      group.participants.some(p => p.npcId === npcId),
    );
  }
  // If no mentions, citizen chose not to pass the baton — no auto-dispatch

  // Dispatch to next targets
  // @所有人 → all targets are directly mentioned (must reply, not skip)
  // @specific → only mentioned targets are directly mentioned
  const isAllMention = mentions.includes("all");
  for (const npcId of nextTargets) {
    const directlyMentioned = isAllMention || mentions.includes(npcId);
    dispatchToCitizen(npcId, group, directlyMentioned);
  }

  // Drain pending mentions (citizens queued due to max concurrent speakers limit)
  drainPendingMentions(group);

  // Maybe generate summary
  maybeGenerateSummary(group.groupId, group.history, group.participants).catch(() => {});

  // Check max turns
  group.totalTurns++;
  if (group.totalTurns >= MAX_TOTAL_TURNS) {
    console.log(`[group-chat] Max turns (${MAX_TOTAL_TURNS}) reached for group "${group.name}", pausing`);
    pauseGroup(group.groupId);
  }
}

/** Dispatch a message to a specific citizen. */
async function dispatchToCitizen(npcId: string, group: ActiveGroupChat, isDirectlyMentioned = false): Promise<void> {
  const participant = findParticipant(npcId, group.participants);
  if (!participant) return;

  // Check if already speaking
  if (group.activeSpeakers.has(npcId)) {
    console.log(`[group-chat] ${participant.name} already speaking, queuing`);
    // Deduplicate: don't queue if already pending
    if (!group.pendingMentions.some(p => p.npcId === npcId)) {
      group.pendingMentions.push({ npcId, isDirectlyMentioned });
    }
    return;
  }

  // Check max concurrent speakers
  if (group.activeSpeakers.size >= MAX_CONCURRENT_SPEAKERS) {
    console.log(`[group-chat] Max concurrent speakers reached, queuing ${participant.name}`);
    // Deduplicate: don't queue if already pending
    if (!group.pendingMentions.some(p => p.npcId === npcId)) {
      group.pendingMentions.push({ npcId, isDirectlyMentioned });
    }
    return;
  }

  // Check cooldown (after concurrency check, so queued citizens aren't dropped)
  const now = Date.now();
  const lastSpoke = group.speakerCooldowns.get(npcId) ?? 0;
  if (now - lastSpoke < SPEAKER_COOLDOWN_MS) {
    console.log(`[group-chat] ${participant.name} on cooldown, re-queuing`);
    // Re-queue with a delay to retry after cooldown expires
    setTimeout(() => {
      if (group.stopped) return;
      if (group.activeSpeakers.size < MAX_CONCURRENT_SPEAKERS && !group.activeSpeakers.has(npcId)) {
        dispatchToCitizen(npcId, group, isDirectlyMentioned).catch(() => {});
      } else {
        group.pendingMentions.push({ npcId, isDirectlyMentioned });
      }
    }, SPEAKER_COOLDOWN_MS - (now - lastSpoke));
    return;
  }

  group.activeSpeakers.add(npcId);
  group.speakerCooldowns.set(npcId, now);

  // Notify frontend that this citizen is composing a reply (typing indicator)
  pushGroupChatTyping(group.townSessionId, {
    groupId: group.groupId,
    npcId: participant.npcId,
    speakerName: participant.name,
  });

  // Build context
  const contextMessage = buildContextForCitizen(
    group.groupId,
    group.history,
    group.participants,
    npcId,
    group.topic,
    isDirectlyMentioned,
  );

  // Set turn timeout
  const timer = setTimeout(() => {
    if (!group.activeSpeakers.has(npcId)) return;
    console.log(`[group-chat] ${participant.name} timed out after ${TURN_TIMEOUT_MS}ms`);
    group.activeSpeakers.delete(npcId);
    group.finalizedSpeakers.delete(npcId);
    group.responseBuffers.delete(npcId);
    group.turnTimers.delete(npcId);
    pushGroupChatTypingDone(group.townSessionId, { groupId: group.groupId, npcId });
    drainPendingMentions(group);
  }, TURN_TIMEOUT_MS);
  group.turnTimers.set(npcId, timer);

  console.log(`[group-chat] Dispatching to ${participant.name} (${npcId}), turn ${group.totalTurns + 1}`);

  // Route via citizen-chat-router with group session key
  try {
    await routeCitizenMessage({
      npcId,
      label: participant.name,
      message: contextMessage,
      townSessionId: group.townSessionId,
      accountId: group.accountId,
      cfg: group.cfg,
      sessionKeyPrefix: `group:${group.groupId}`,
      // Group chat has its own retry mechanism with longer backoff (8s/16s/24s...)
      // that handles session conflicts better. Skip internal retry to avoid storms.
      skipConflictRetry: true,
    });
    // routeCitizenMessage await returned — OpenClaw dispatch fully completed.
    // Now it's safe to release the speaker slot and set cooldown.
    group.activeSpeakers.delete(npcId);
    group.finalizedSpeakers.delete(npcId);
    group.sessionConflictRetries.delete(npcId); // dispatch 成功，清除重试计数
    group.speakerCooldowns.set(npcId, Date.now());
    const t = group.turnTimers.get(npcId);
    if (t) { clearTimeout(t); group.turnTimers.delete(npcId); }
    drainPendingMentions(group);
  } catch (err) {
    console.error(`[group-chat] Failed to dispatch to ${participant.name}:`, err);
    const t = group.turnTimers.get(npcId);
    if (t) { clearTimeout(t); group.turnTimers.delete(npcId); }
    pushGroupChatTypingDone(group.townSessionId, { groupId: group.groupId, npcId });

    // If session conflict, re-queue with exponential backoff retry
    const errMsg = err instanceof Error ? err.message : String(err ?? "");
    if (errMsg.includes("session initialization conflicted")) {
      const retryCount = (group.sessionConflictRetries.get(npcId) ?? 0) + 1;
      group.sessionConflictRetries.set(npcId, retryCount);
      // session 冲突 = OpenClaw session 仍被占用（idle settle 15s）。不删除 activeSpeakers
      // 保持锁定，防止 pending 被立即 dispatch 竞争同一 session。只通过 retry setTimeout 重试。
      group.speakerCooldowns.set(npcId, Date.now());
      if (retryCount <= SESSION_CONFLICT_MAX_RETRIES) {
        // 指数退避 + jitter: 1→8s, 2→16s, 3→32s, 4→64s, 5+→120s (cap)
        // agent 可能正在执行 subagent，session 被长期占用，需足够长退避
        const expBackoffMs = Math.min(
          SESSION_CONFLICT_RETRY_MS * Math.pow(2, retryCount - 1),
          120_000, // cap at 2 minutes
        );
        const jitterMs = Math.floor(Math.random() * 5000); // 0-5s random jitter
        const backoffMs = expBackoffMs + jitterMs;
        console.log(`[group-chat] ${participant.name} session conflict, re-queuing (retry ${retryCount}/${SESSION_CONFLICT_MAX_RETRIES}) after ${backoffMs}ms (jitter=${jitterMs}ms)`);
        setTimeout(() => {
          if (group.stopped) return;
          // 不删除 sessionConflictRetries（计数持续递增直到成功或达上限；成功时清除）
          // 释放 activeSpeakers 锁，允许 retry dispatch
          group.activeSpeakers.delete(npcId);
          group.finalizedSpeakers.delete(npcId);
          group.responseBuffers.delete(npcId);
          if (!group.activeSpeakers.has(npcId)) {
            dispatchToCitizen(npcId, group, isDirectlyMentioned).catch(() => {});
          } else {
            // 仍在发言中，放回队列
            if (!group.pendingMentions.some(p => p.npcId === npcId)) {
              group.pendingMentions.push({ npcId, isDirectlyMentioned });
            }
          }
        }, backoffMs);
        // 不调用 drainPendingMentions，避免立即触发新的 dispatch 竞争 session
        return;
      } else {
        console.log(`[group-chat] ${participant.name} session conflict max retries (${SESSION_CONFLICT_MAX_RETRIES}) exceeded, dropping`);
        group.sessionConflictRetries.delete(npcId);
        // 达到上限后释放锁
        group.activeSpeakers.delete(npcId);
        group.finalizedSpeakers.delete(npcId);
        group.responseBuffers.delete(npcId);
      }
    } else {
      // 非 session 冲突错误，释放锁
      group.activeSpeakers.delete(npcId);
      group.finalizedSpeakers.delete(npcId);
      group.responseBuffers.delete(npcId);
    }
    drainPendingMentions(group);
  }
}

/** Drain pending mentions when a speaker slot frees up. */
function drainPendingMentions(group: ActiveGroupChat): void {
  let guard = 0;
  while (group.pendingMentions.length > 0 && group.activeSpeakers.size < MAX_CONCURRENT_SPEAKERS && guard < 50) {
    guard++;
    const { npcId, isDirectlyMentioned } = group.pendingMentions.shift()!;
    if (group.activeSpeakers.has(npcId)) continue;
    const sizeBefore = group.activeSpeakers.size;
    dispatchToCitizen(npcId, group, isDirectlyMentioned).catch(() => {});
    // If activeSpeakers didn't grow, dispatch returned early (cooldown/re-queue); break to avoid spinning
    if (group.activeSpeakers.size === sizeBefore) break;
  }
}

/** Reset the idle timer for a group. */
function resetIdleTimer(group: ActiveGroupChat): void {
  if (group.idleTimer) clearTimeout(group.idleTimer);
  group.idleTimer = setTimeout(() => {
    if (group.activeSpeakers.size > 0) {
      resetIdleTimer(group);
      return;
    }
    console.log(`[group-chat] Group "${group.name}" idle for ${IDLE_TIMEOUT_MS}ms, pausing`);
    pauseGroup(group.groupId);
  }, IDLE_TIMEOUT_MS);
}

/** Clear all timers for a group. */
function clearAllTimers(group: ActiveGroupChat): void {
  for (const timer of group.turnTimers.values()) clearTimeout(timer);
  group.turnTimers.clear();
  if (group.idleTimer) {
    clearTimeout(group.idleTimer);
    group.idleTimer = null;
  }
}

/** Persist a message to history file. */
function persistMessage(group: ActiveGroupChat, msg: GroupMessage): void {
  const persisted: PersistedGroupMessage = {
    sequenceId: msg.sequenceId,
    timestamp: msg.timestamp,
    speakerNpcId: msg.speakerNpcId,
    speakerName: msg.speakerName,
    text: msg.text,
    mentions: msg.mentions,
    groupId: group.groupId,
    ...(msg.usage ? { usage: msg.usage } : {}),
    ...(typeof msg.contextBudget === "number" ? { contextBudget: msg.contextBudget } : {}),
    ...(msg.model ? { model: msg.model } : {}),
    ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
  };
  appendGroupMessage(group.groupId, persisted);
}

/** Get group info for frontend. */
export function getGroupInfo(groupId: string): {
  groupId: string;
  name: string;
  isDefault: boolean;
  participants: Array<{ npcId: string; name: string; specialty?: string }>;
  topic?: string;
  messageCount: number;
  compactionCount: number;
} | null {
  const group = activeGroups.get(groupId);
  if (!group) return null;
  return {
    groupId: group.groupId,
    name: group.name,
    isDefault: group.isDefault,
    participants: group.participants
      .map(p => ({
        npcId: p.npcId,
        name: p.name,
        specialty: p.specialty,
      }))
      .sort((a, b) => a.npcId.localeCompare(b.npcId)),
    topic: group.topic,
    messageCount: group.history.length,
    compactionCount: group.compactionCount,
  };
}

/**
 * Get the list of citizens currently composing a reply in a group.
 * Used to restore typing indicators on frontend reconnect/refresh.
 */
export function getActiveTypingCitizens(groupId: string): Array<{ npcId: string; speakerName: string }> {
  const group = activeGroups.get(groupId);
  if (!group || group.stopped) return [];
  const result: Array<{ npcId: string; speakerName: string }> = [];
  for (const npcId of group.activeSpeakers) {
    const participant = group.participants.find(p => p.npcId === npcId);
    if (participant) {
      result.push({ npcId: participant.npcId, speakerName: participant.name });
    }
  }
  return result;
}
