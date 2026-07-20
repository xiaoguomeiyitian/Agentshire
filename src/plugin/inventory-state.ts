/**
 * Inventory state persistence — stores citizen backpacks (owned items) as a
 * single JSON file under stateDir()/agents/animal-inventory.json.
 *
 * Mirrors economy-state.ts in structure. The server-side file is the source
 * of truth so that:
 *   - Page refresh → frontend reconnects WS → animal_state_load → restore
 *   - openclaw restart → same flow (file survives process restart)
 *   - Device switch → same flow (state lives on server)
 *
 * Architecture:
 *   Frontend InventoryEngine → WS inventory_state_save → saveInventoryState()
 *   Frontend reconnect → WS animal_state_load → loadInventoryState() → restore
 *
 * File format (single JSON object):
 *   {
 *     "citizens": {
 *       "citizen_1": [ { "id": "inv_1", "itemId": "sandwich", ... }, ... ]
 *     },
 *     "savedAt": 1784177296910
 *   }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

// ── Types (mirrors frontend InventoryEngine.InventoryItem) ──

export interface InventoryItemRecord {
  id: string;
  itemId: string;
  name: string;
  icon: string;
  count: number;
  category: "food" | "gift" | "craft" | "misc";
  effects?: {
    hunger?: number;
    energy?: number;
    mood?: number;
    belonging?: number;
  };
  obtainedAt: number;
  source: string;
}

export interface InventoryState {
  citizens: Record<string, InventoryItemRecord[]>;
  savedAt: number;
}

// ── Path resolution ──

function inventoryStateFilePath(): string {
  return join(stateDir(), "agents", "animal-inventory.json");
}

// ── Public API ──

/** Persist the inventory state to disk. Overwrites any previous state. */
export function saveInventoryState(state: InventoryState): void {
  try {
    const dir = join(stateDir(), "agents");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(inventoryStateFilePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[inventory-state] Failed to save:`, (err as Error).message);
  }
}

/** Load the persisted inventory state, or null if none exists. */
export function loadInventoryState(): InventoryState | null {
  try {
    const filePath = inventoryStateFilePath();
    if (!existsSync(filePath)) return null;
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<InventoryState>;
    if (typeof raw.citizens !== "object" || raw.citizens === null) return null;
    return {
      citizens: raw.citizens as Record<string, InventoryItemRecord[]>,
      savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Clear the persisted inventory state (reset town → inventory reset). */
export function clearInventoryState(): void {
  try {
    const filePath = inventoryStateFilePath();
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    console.warn(`[inventory-state] Failed to clear:`, (err as Error).message);
  }
}
