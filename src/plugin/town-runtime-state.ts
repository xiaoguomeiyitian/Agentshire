/**
 * Town runtime state persistence — stores the live town state (NPC positions,
 * scene type, topic state, indoor citizens, mayor position) as a single JSON
 * file under stateDir()/agents/town-runtime-state.json.
 *
 * This is the server-side source of truth for town runtime state, so that:
 *   - Page refresh → frontend reconnects WS → animal_state_load → restore
 *   - openclaw restart → same flow (file survives process restart)
 *   - Device switch → same flow (state lives on server, not browser localStorage)
 *
 * Architecture:
 *   Frontend MainScene.saveSnapshot() → WS town_runtime_save → saveTownRuntimeState()
 *   Frontend reconnect → WS animal_state_load → loadTownRuntimeState() → restore
 *
 * File format (single JSON object):
 *   {
 *     "sceneType": "town",
 *     "mayorPos": { "x": 15, "z": 5 },
 *     "npcPositions": { "user": {"x":15,"z":5}, "steward": {"x":10,"z":10} },
 *     "topicNpcIds": [],
 *     "indoorCitizens": ["citizen_3"],
 *     "savedAt": 1784177296910
 *   }
 *
 * Note: GameClock state is persisted separately in animal-clock.json.
 * Phase state machine and workSnapshots are NOT persisted (restart returns
 * to idle; user re-initiates tasks).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

// ── Types ──

export interface NpcPosition {
  x: number;
  z: number;
}

export interface TownRuntimeState {
  /** Current scene type ('town' | 'office' | 'house_a' | ...). */
  sceneType: string;
  /** Mayor (user NPC) position in world coords. */
  mayorPos: NpcPosition;
  /** Map of npcId → position for all NPCs (including mayor). */
  npcPositions: Record<string, NpcPosition>;
  /** NPC ids currently gathered for a topic (empty if no active topic). */
  topicNpcIds: string[];
  /** NPC ids currently inside a building (hidden from outdoor scene). */
  indoorCitizens: string[];
  /** Epoch milliseconds when this snapshot was saved. */
  savedAt: number;
}

// ── Path resolution ──

function runtimeStateFilePath(): string {
  return join(stateDir(), "agents", "town-runtime-state.json");
}

// ── Public API ──

/**
 * Persist the town runtime state to disk. Overwrites any previous state.
 * Silently warns on failure (never throws — persistence is best-effort).
 */
export function saveTownRuntimeState(state: TownRuntimeState): void {
  try {
    const dir = join(stateDir(), "agents");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(runtimeStateFilePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[town-runtime-state] Failed to save:`, (err as Error).message);
  }
}

/**
 * Load the persisted town runtime state, or null if none exists.
 * Validates the basic shape; returns null if the file is missing or corrupt.
 */
export function loadTownRuntimeState(): TownRuntimeState | null {
  try {
    const filePath = runtimeStateFilePath();
    if (!existsSync(filePath)) return null;
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<TownRuntimeState>;
    // Minimal validation — require the core fields
    if (
      typeof raw.sceneType !== "string" ||
      typeof raw.npcPositions !== "object" ||
      raw.npcPositions === null
    ) {
      return null;
    }
    return {
      sceneType: raw.sceneType,
      mayorPos: raw.mayorPos ?? { x: 0, z: 0 },
      npcPositions: raw.npcPositions as Record<string, NpcPosition>,
      topicNpcIds: Array.isArray(raw.topicNpcIds) ? raw.topicNpcIds : [],
      indoorCitizens: Array.isArray(raw.indoorCitizens) ? raw.indoorCitizens : [],
      savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Clear the persisted town runtime state (reset town → runtime state cleared).
 * Silently warns on failure.
 */
export function clearTownRuntimeState(): void {
  try {
    const filePath = runtimeStateFilePath();
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.warn(`[town-runtime-state] Failed to clear:`, (err as Error).message);
  }
}
