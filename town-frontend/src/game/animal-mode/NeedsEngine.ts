/**
 * NeedsEngine — 8 needs that decay over time for each citizen.
 *
 * Needs range 0-100 (100 = fully satisfied, 0 = critically lacking).
 * When a need drops below its threshold, it becomes "urgent" and
 * influences the AutonomyEngine's L2 tactical decisions.
 *
 * Needs are restored by specific actions (satisfy_need):
 *   hunger    -> go to cafe/market (eat)
 *   fatigue   -> go home (sleep, becomes invisible)
 *   social    -> talk to someone
 *   fun       -> go to museum/plaza
 *   hygiene   -> go home (clean)
 *   safety    -> avoid bad weather / go indoors
 *   esteem    -> do specialty work
 *   belonging -> join festival / community activity
 */

export type NeedKey =
  | 'hunger'
  | 'fatigue'
  | 'social'
  | 'fun'
  | 'hygiene'
  | 'safety'
  | 'esteem'
  | 'belonging'

export interface NeedState {
  key: NeedKey
  value: number       // 0-100, 100 = fully satisfied
  threshold: number   // below this = urgent
  decayPerHour: number // how fast it drops per game-hour
}

export interface NeedsSnapshot {
  needs: Record<NeedKey, number>
  urgent: NeedKey[]
  lowest: NeedKey
  average: number
}

const DEFAULT_NEEDS: Record<NeedKey, Omit<NeedState, 'key'>> = {
  hunger:    { value: 80, threshold: 30, decayPerHour: 8 },
  fatigue:   { value: 90, threshold: 25, decayPerHour: 6 },
  social:    { value: 70, threshold: 35, decayPerHour: 5 },
  fun:       { value: 75, threshold: 30, decayPerHour: 4 },
  hygiene:   { value: 85, threshold: 20, decayPerHour: 3 },
  safety:    { value: 95, threshold: 40, decayPerHour: 2 },
  esteem:    { value: 70, threshold: 30, decayPerHour: 3 },
  // Belonging decays slowly — it represents long-term community attachment,
  // not a momentary urge. Only sustained isolation or conflict should erode it.
  belonging: { value: 75, threshold: 25, decayPerHour: 1.5 },
}

const ALL_NEEDS: NeedKey[] = [
  'hunger', 'fatigue', 'social', 'fun',
  'hygiene', 'safety', 'esteem', 'belonging',
]

export class NeedsEngine {
  private needs: Map<string, Record<NeedKey, number>> = new Map()
  private config: Record<NeedKey, Omit<NeedState, 'key'>>

  constructor(config?: Partial<Record<NeedKey, Partial<Omit<NeedState, 'key'>>>>) {
    this.config = { ...DEFAULT_NEEDS }
    if (config) {
      for (const k of ALL_NEEDS) {
        if (config[k]) this.config[k] = { ...this.config[k], ...config[k] }
      }
    }
  }

  /** Register a citizen with default need values. */
  registerCitizen(npcId: string): void {
    const init: Record<NeedKey, number> = {} as any
    for (const k of ALL_NEEDS) init[k] = this.config[k].value
    this.needs.set(npcId, init)
  }

  /** Remove a citizen (e.g., moved away). */
  unregisterCitizen(npcId: string): void {
    this.needs.delete(npcId)
  }

  /** Advance needs by `gameHours` (game-time hours, not real seconds). */
  tick(gameHours: number): void {
    for (const [, needs] of this.needs) {
      for (const k of ALL_NEEDS) {
        const decay = this.config[k].decayPerHour * gameHours
        needs[k] = Math.max(0, needs[k] - decay)
      }
    }
  }

  /** Restore a specific need (e.g., eating restores hunger). */
  satisfy(npcId: string, need: NeedKey, amount: number): void {
    const n = this.needs.get(npcId)
    if (n) n[need] = Math.min(100, n[need] + amount)
  }

  /** Get a citizen's full needs snapshot. */
  getSnapshot(npcId: string): NeedsSnapshot | null {
    const n = this.needs.get(npcId)
    if (!n) return null
    const needs = { ...n }
    const urgent: NeedKey[] = []
    let lowest: NeedKey = ALL_NEEDS[0]
    let sum = 0
    for (const k of ALL_NEEDS) {
      if (needs[k] < this.config[k].threshold) urgent.push(k)
      if (needs[k] < needs[lowest]) lowest = k
      sum += needs[k]
    }
    return {
      needs,
      urgent,
      lowest,
      average: sum / ALL_NEEDS.length,
    }
  }

  /** Get the most urgent need for a citizen (or null if none urgent). */
  getMostUrgent(npcId: string): NeedKey | null {
    const snap = this.getSnapshot(npcId)
    if (!snap || snap.urgent.length === 0) return null
    // Return the lowest among urgent
    let lowest: NeedKey = snap.urgent[0]
    for (const k of snap.urgent) {
      if (snap.needs[k] < snap.needs[lowest]) lowest = k
    }
    return lowest
  }

  /** Get all registered citizen ids. */
  getCitizens(): string[] {
    return Array.from(this.needs.keys())
  }

  /** Clear all citizens. */
  clear(): void {
    this.needs.clear()
  }
}

export const NEED_LABELS_ZH: Record<NeedKey, string> = {
  hunger: '饥饿', fatigue: '疲劳', social: '社交', fun: '娱乐',
  hygiene: '卫生', safety: '安全', esteem: '自我实现', belonging: '归属',
}

export const NEED_LABELS_EN: Record<NeedKey, string> = {
  hunger: 'Hunger', fatigue: 'Fatigue', social: 'Social', fun: 'Fun',
  hygiene: 'Hygiene', safety: 'Safety', esteem: 'Esteem', belonging: 'Belonging',
}
