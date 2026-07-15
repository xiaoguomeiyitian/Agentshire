/**
 * Group chat history persistence.
 * Stores group chat messages as JSONL files under stateDir()/agents/group-chats/{groupId}/.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

export interface PersistedGroupMessage {
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
  /** Reasoning/thinking text extracted from the citizen response (if present). */
  reasoning?: string;
}

function groupChatDir(groupId: string): string {
  return join(stateDir(), "agents", "group-chats", sanitizeGroupId(groupId));
}

function sanitizeGroupId(groupId: string): string {
  return groupId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function historyFilePath(groupId: string): string {
  return join(groupChatDir(groupId), "history.jsonl");
}

function summaryFilePath(groupId: string): string {
  return join(groupChatDir(groupId), "summary.json");
}

export interface StoredSummary {
  summary: string;
  summaryUpToIndex: number;
  updatedAt: number;
}

/** Append a message to the group's JSONL history file. */
export function appendGroupMessage(groupId: string, msg: PersistedGroupMessage): void {
  try {
    const dir = groupChatDir(groupId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(historyFilePath(groupId), JSON.stringify(msg) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[group-chat-history] Failed to append message to ${groupId}:`, (err as Error).message);
  }
}

/** Load recent messages from the group's history file. */
export function loadGroupHistory(groupId: string, limit: number = 50): PersistedGroupMessage[] {
  try {
    const filePath = historyFilePath(groupId);
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const sliced = lines.slice(-limit);
    return sliced.map(line => {
      try { return JSON.parse(line) as PersistedGroupMessage; }
      catch { return null; }
    }).filter(Boolean) as PersistedGroupMessage[];
  } catch {
    return [];
  }
}

/** Load the full history (for summary generation). */
export function loadFullGroupHistory(groupId: string): PersistedGroupMessage[] {
  try {
    const filePath = historyFilePath(groupId);
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line) as PersistedGroupMessage; }
      catch { return null; }
    }).filter(Boolean) as PersistedGroupMessage[];
  } catch {
    return [];
  }
}

/** Save a summary for the group. */
export function saveSummary(groupId: string, summary: StoredSummary): void {
  try {
    const dir = groupChatDir(groupId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(summaryFilePath(groupId), JSON.stringify(summary, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[group-chat-history] Failed to save summary for ${groupId}:`, (err as Error).message);
  }
}

/** Load the stored summary for the group. */
export function loadSummary(groupId: string): StoredSummary | null {
  try {
    const filePath = summaryFilePath(groupId);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as StoredSummary;
  } catch {
    return null;
  }
}

/** List all group chat directories. */
export function listGroupChats(): string[] {
  try {
    const baseDir = join(stateDir(), "agents", "group-chats");
    if (!existsSync(baseDir)) return [];
    return readdirSync(baseDir).filter(f => {
      const stat = statSync(join(baseDir, f));
      return stat.isDirectory();
    });
  } catch {
    return [];
  }
}

/** Clear (truncate) the group's history file. */
export function clearGroupHistory(groupId: string): void {
  try {
    const filePath = historyFilePath(groupId);
    if (!existsSync(filePath)) return;
    writeFileSync(filePath, "", "utf-8");
    console.log(`[group-chat-history] Cleared history for ${groupId}`);
  } catch (err) {
    console.warn(`[group-chat-history] Failed to clear history for ${groupId}:`, (err as Error).message);
  }
}
