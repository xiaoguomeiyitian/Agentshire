/**
 * Animal Mode memory persistence — stores citizen memories (dialogues + activities)
 * as JSONL files under stateDir()/agents/animal-memories/{npcId}.jsonl.
 *
 * This is the server-side source of truth for citizen memories. The frontend
 * MemoryStore is now a thin in-memory cache that reports events here via WS.
 * The town_recall_memory tool reads directly from these files, so it works
 * even when the frontend is offline.
 *
 * Architecture:
 *   Frontend NPC interaction → WS animal_memory_event → appendMemoryEntry()
 *   town_recall_memory tool → loadRecentMemories() → direct file read
 *
 * File format (one JSON object per line):
 *   {"type":"dialogue","partnerName":"Bob","summary":"聊了天气","timestamp":1234567890}
 *   {"type":"activity","action":"went_indoor","location":"house_a","detail":"回家休息","timestamp":1234567891}
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

// ── Types (mirrors frontend MemoryStore types) ──

export interface DialogueEntry {
  type: "dialogue";
  partnerName: string;
  summary: string;
  timestamp: number;
}

export interface ActivityEntry {
  type: "activity";
  action: string;
  location: string;
  detail?: string;
  timestamp: number;
}

export type MemoryEntry = DialogueEntry | ActivityEntry;

export interface CitizenMemorySummary {
  npcId: string;
  dialogues: DialogueEntry[];
  activities: ActivityEntry[];
  updatedAt: number;
}

// ── Constants ──

const MAX_DIALOGUES = 10;
const MAX_ACTIVITIES = 20;

function memoriesDir(): string {
  return join(stateDir(), "agents", "animal-memories");
}

function memoryFilePath(npcId: string): string {
  return join(memoriesDir(), `${sanitizeNpcId(npcId)}.jsonl`);
}

function sanitizeNpcId(npcId: string): string {
  return npcId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// ── Public API ──

/** Append a memory entry for a citizen (called when frontend reports an event). */
export function appendMemoryEntry(npcId: string, entry: MemoryEntry): void {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(memoryFilePath(npcId), JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.warn(`[animal-memory] Failed to append entry for ${npcId}:`, (err as Error).message);
  }
}

/** Convenience: append a dialogue entry. */
export function appendDialogue(npcId: string, partnerName: string, summary: string): void {
  appendMemoryEntry(npcId, {
    type: "dialogue",
    partnerName,
    summary,
    timestamp: Date.now(),
  });
}

/** Convenience: append an activity entry. */
export function appendActivity(npcId: string, action: string, location: string, detail?: string): void {
  appendMemoryEntry(npcId, {
    type: "activity",
    action,
    location,
    detail,
    timestamp: Date.now(),
  });
}

/** Load all entries for a citizen from the JSONL file. */
export function loadAllEntries(npcId: string): MemoryEntry[] {
  try {
    const filePath = memoryFilePath(npcId);
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as MemoryEntry;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as MemoryEntry[];
  } catch {
    return [];
  }
}

/** Load recent memories for a citizen, optionally filtered by topic. */
export function loadRecentMemories(
  npcId: string,
  options?: { topic?: string; dialogueCount?: number; activityCount?: number },
): CitizenMemorySummary {
  const entries = loadAllEntries(npcId);
  const dialogueCount = options?.dialogueCount ?? MAX_DIALOGUES;
  const activityCount = options?.activityCount ?? MAX_ACTIVITIES;

  let dialogues = entries.filter((e): e is DialogueEntry => e.type === "dialogue");
  let activities = entries.filter((e): e is ActivityEntry => e.type === "activity");

  // Topic filter (applies to dialogues)
  if (options?.topic) {
    const lower = options.topic.toLowerCase();
    dialogues = dialogues.filter(
      (d) =>
        d.summary.toLowerCase().includes(lower) ||
        d.partnerName.toLowerCase().includes(lower),
    );
  }

  // Take most recent N
  dialogues = dialogues.slice(-dialogueCount);
  activities = activities.slice(-activityCount);

  const allTimestamps = [...dialogues, ...activities].map((e) => e.timestamp);
  const updatedAt = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0;

  return { npcId, dialogues, activities, updatedAt };
}

/** Clear all memories for a citizen (e.g., when they move out). */
export function clearCitizenMemory(npcId: string): void {
  try {
    const filePath = memoryFilePath(npcId);
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.warn(`[animal-memory] Failed to clear memory for ${npcId}:`, (err as Error).message);
  }
}

/** Clear all citizen memories. */
export function clearAllMemories(): void {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".jsonl")) {
        unlinkSync(join(dir, file));
      }
    }
  } catch (err) {
    console.warn(`[animal-memory] Failed to clear all memories:`, (err as Error).message);
  }
}

/** List all citizens that have memory files. */
export function listCitizensWithMemories(): string[] {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(/\.jsonl$/, ""));
  } catch {
    return [];
  }
}

// ── Activity Journal Snapshot persistence ──
// Stores the full ActivityJournal snapshot (relationships, reflections, plans)
// as a single JSON file per citizen. This is the server-side source of truth
// for relationship data — the frontend saveSnapshot() also reports here.

import type { ActivityJournalSnapshot } from "./animal-snapshot-types.js";

function snapshotFilePath(npcId: string): string {
  return join(memoriesDir(), `${sanitizeNpcId(npcId)}.snapshot.json`);
}

/** Save a citizen's ActivityJournal snapshot (called from frontend saveSnapshot). */
export function saveActivityJournalSnapshot(npcId: string, snapshot: ActivityJournalSnapshot): void {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(snapshotFilePath(npcId), JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[animal-memory] Failed to save snapshot for ${npcId}:`, (err as Error).message);
  }
}

/** Load a citizen's ActivityJournal snapshot. */
export function loadActivityJournalSnapshot(npcId: string): ActivityJournalSnapshot | null {
  try {
    const filePath = snapshotFilePath(npcId);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as ActivityJournalSnapshot;
  } catch {
    return null;
  }
}

/** Load all ActivityJournal snapshots (for full state restore on reconnect). */
export function loadAllActivityJournalSnapshots(): Array<{ npcId: string; snapshot: ActivityJournalSnapshot }> {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) return [];
    const results: Array<{ npcId: string; snapshot: ActivityJournalSnapshot }> = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".snapshot.json")) continue;
      const npcId = file.replace(".snapshot.json", "");
      try {
        const snapshot = JSON.parse(readFileSync(join(dir, file), "utf-8")) as ActivityJournalSnapshot;
        results.push({ npcId, snapshot });
      } catch {
        // skip corrupt files
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── GameClock state persistence ──

function clockFilePath(): string {
  return join(stateDir(), "agents", "animal-clock.json");
}

export interface ClockState {
  dayCount: number;
  gameSeconds: number;
  savedAt: number;
}

/** Save the GameClock state (called from frontend periodically). */
export function saveClockState(state: ClockState): void {
  try {
    const dir = join(stateDir(), "agents");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(clockFilePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[animal-memory] Failed to save clock state:`, (err as Error).message);
  }
}

/** Load the GameClock state. */
export function loadClockState(): ClockState | null {
  try {
    const filePath = clockFilePath();
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as ClockState;
  } catch {
    return null;
  }
}

/** Clear the saved GameClock state (reset town → clock restarts at day 1). */
export function clearClockState(): void {
  try {
    const filePath = clockFilePath();
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.warn(`[animal-memory] Failed to clear clock state:`, (err as Error).message);
  }
}

/** Clear all ActivityJournal snapshots (reset town → relationships/plans reset). */
export function clearAllSnapshots(): void {
  try {
    const dir = memoriesDir();
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".snapshot.json")) {
        unlinkSync(join(dir, file));
      }
    }
  } catch (err) {
    console.warn(`[animal-memory] Failed to clear all snapshots:`, (err as Error).message);
  }
}
