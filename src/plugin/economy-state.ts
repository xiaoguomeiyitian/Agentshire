/**
 * Economy state persistence — stores citizen economy (coins, reputation,
 * savings goals, work rewards) as a single JSON file under
 * stateDir()/agents/animal-economy.json.
 *
 * This is the server-side source of truth for citizen economy, so that:
 *   - Page refresh → frontend reconnects WS → animal_state_load → restore
 *   - openclaw restart → same flow (file survives process restart)
 *   - Device switch → same flow (state lives on server)
 *
 * Architecture:
 *   Frontend EconomyEngine → WS economy_state_save → saveEconomyState()
 *   Frontend reconnect → WS animal_state_load → loadEconomyState() → restore
 *
 * File format (single JSON object):
 *   {
 *     "citizens": {
 *       "citizen_1": { "coins": 50, "reputation": 5, "savingsGoal": 100, ... }
 *     },
 *     "savedAt": 1784177296910
 *   }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

// ── Types (mirrors frontend EconomyEngine.CitizenEconomy) ──

export interface CitizenEconomyRecord {
  coins: number;
  reputation: number;
  savingsGoal: number;
  todayWorkReward: number;
  frugal: boolean;
}

export interface EconomyState {
  citizens: Record<string, CitizenEconomyRecord>;
  savedAt: number;
}

// ── Path resolution ──

function economyStateFilePath(): string {
  return join(stateDir(), "agents", "animal-economy.json");
}

// ── Public API ──

/** Persist the economy state to disk. Overwrites any previous state. */
export function saveEconomyState(state: EconomyState): void {
  try {
    const dir = join(stateDir(), "agents");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(economyStateFilePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[economy-state] Failed to save:`, (err as Error).message);
  }
}

/** Load the persisted economy state, or null if none exists. */
export function loadEconomyState(): EconomyState | null {
  try {
    const filePath = economyStateFilePath();
    if (!existsSync(filePath)) return null;
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<EconomyState>;
    if (typeof raw.citizens !== "object" || raw.citizens === null) return null;
    return {
      citizens: raw.citizens as Record<string, CitizenEconomyRecord>,
      savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Clear the persisted economy state (reset town → economy reset). */
export function clearEconomyState(): void {
  try {
    const filePath = economyStateFilePath();
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.warn(`[economy-state] Failed to clear:`, (err as Error).message);
  }
}
