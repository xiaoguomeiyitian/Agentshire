/**
 * MemoryStore — in-memory cache for citizen memories (dialogues + activities).
 *
 * In Animal Mode, each citizen accumulates memories across game sessions.
 * This store keeps a compact in-memory summary of recent dialogues and
 * activities per citizen, keyed by npcId. When a new entry is recorded,
 * it is immediately reported to the plugin layer via the injected
 * `onEvent` callback (which sends a WS `animal_memory_event` message).
 *
 * The plugin layer persists these events to JSONL files under
 * stateDir()/agents/animal-memories/{npcId}.jsonl — the server-side
 * source of truth. The town_recall_memory tool reads directly from
 * those files, so it works even when the frontend is offline.
 *
 * On reconnect, the frontend requests `animal_state_load` and the plugin
 * returns all persisted snapshots; the frontend restores them into
 * ActivityJournal instances (not this MemoryStore, which is a cache only).
 */

export interface DialogueSummary {
  partnerName: string
  summary: string
  timestamp: number
}

export interface ActivitySummary {
  action: string
  location: string
  detail?: string
  timestamp: number
}

export interface CitizenMemory {
  dialogues: DialogueSummary[]
  activities: ActivitySummary[]
  updatedAt: number
}

export type MemoryMap = Map<string, CitizenMemory>

/** Callback to report a memory event to the plugin layer (via WS). */
export type MemoryEventReporter = (npcId: string, entry: {
  type: 'dialogue'
  partnerName: string
  summary: string
  timestamp: number
} | {
  type: 'activity'
  action: string
  location: string
  detail?: string
  timestamp: number
}) => void

const MAX_DIALOGUES = 10
const MAX_ACTIVITIES = 20

export class MemoryStore {
  private memories: MemoryMap = new Map()
  private reporter: MemoryEventReporter | null = null

  /** Inject the WS event reporter (called by AnimalModeManager when dataSource is ready). */
  setReporter(reporter: MemoryEventReporter | null): void {
    this.reporter = reporter
  }

  /** Load memories from a snapshot (e.g., restored from plugin on reconnect). */
  loadFromSnapshot(entries: Record<string, CitizenMemory>): void {
    for (const [npcId, mem] of Object.entries(entries)) {
      this.memories.set(npcId, mem)
    }
  }

  /** Record a dialogue for a citizen. */
  recordDialogue(npcId: string, partnerName: string, summary: string): void {
    let mem = this.memories.get(npcId)
    if (!mem) {
      mem = { dialogues: [], activities: [], updatedAt: 0 }
      this.memories.set(npcId, mem)
    }
    const entry = { partnerName, summary, timestamp: Date.now() }
    mem.dialogues.push(entry)
    if (mem.dialogues.length > MAX_DIALOGUES) mem.dialogues.shift()
    mem.updatedAt = entry.timestamp
    // Report to plugin layer for persistence
    this.reporter?.(npcId, { type: 'dialogue', ...entry })
  }

  /** Record an activity for a citizen. */
  recordActivity(npcId: string, action: string, location: string, detail?: string): void {
    let mem = this.memories.get(npcId)
    if (!mem) {
      mem = { dialogues: [], activities: [], updatedAt: 0 }
      this.memories.set(npcId, mem)
    }
    const entry = { action, location, detail, timestamp: Date.now() }
    mem.activities.push(entry)
    if (mem.activities.length > MAX_ACTIVITIES) mem.activities.shift()
    mem.updatedAt = entry.timestamp
    // Report to plugin layer for persistence
    this.reporter?.(npcId, { type: 'activity', ...entry })
  }

  /** Get a citizen's memory. */
  getMemory(npcId: string): CitizenMemory | null {
    return this.memories.get(npcId) ?? null
  }

  /** Get a citizen's recent dialogues, optionally filtered by topic. */
  getDialogues(npcId: string, topic?: string, count = 5): DialogueSummary[] {
    const mem = this.memories.get(npcId)
    if (!mem) return []
    let result = mem.dialogues
    if (topic) {
      const lower = topic.toLowerCase()
      result = result.filter((d) =>
        d.summary.toLowerCase().includes(lower) ||
        d.partnerName.toLowerCase().includes(lower),
      )
    }
    return result.slice(-count)
  }

  /** Get a citizen's recent activities. */
  getActivities(npcId: string, count = 10): ActivitySummary[] {
    const mem = this.memories.get(npcId)
    if (!mem) return []
    return mem.activities.slice(-count)
  }

  /** Clear a citizen's memory (in-memory cache only; plugin file cleared separately). */
  clearCitizen(npcId: string): void {
    this.memories.delete(npcId)
  }

  /** Clear all memories (in-memory cache only; plugin files cleared via animal_memory_clear_all). */
  clear(): void {
    this.memories.clear()
  }

  /** Get all citizen IDs with memories. */
  getCitizens(): string[] {
    return Array.from(this.memories.keys())
  }
}
