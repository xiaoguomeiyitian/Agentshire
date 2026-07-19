/**
 * MoodEngine — computes a citizen's mood from needs + events.
 *
 * Mood is a value from -100 (terrible) to +100 (ecstatic).
 * It is the weighted sum of need satisfaction levels plus event modifiers
 * (e.g., +20 for a festival, -15 for being rejected when visiting).
 *
 * Mood influences:
 *   - Animation selection (happy -> celebrating, tired -> idle)
 *   - Dialogue tone (injected into LLM prompt)
 *   - Decision tendency (low mood -> prioritize most lacking need)
 */

import type { NeedsEngine, NeedKey } from './NeedsEngine'

export type MoodLevel = 'great' | 'good' | 'neutral' | 'bad' | 'terrible'

export interface MoodState {
  value: number       // -100 to +100
  level: MoodLevel
  dominantNeed: NeedKey | null
}

const NEED_WEIGHTS: Record<NeedKey, number> = {
  hunger: 0.20,
  fatigue: 0.18,
  social: 0.12,
  fun: 0.10,
  hygiene: 0.08,
  safety: 0.15,
  esteem: 0.08,
  belonging: 0.09,
}

export class MoodEngine {
  private eventModifiers: Map<string, number> = new Map() // npcId -> transient modifier
  private eventExpiry: Map<string, number> = new Map()    // npcId -> expiry timestamp (ms)

  /** Compute mood for a citizen based on needs snapshot + active events. */
  compute(npcId: string, needs: NeedsEngine): MoodState {
    const snap = needs.getSnapshot(npcId)
    if (!snap) return { value: 0, level: 'neutral', dominantNeed: null }

    // Weighted average of need satisfaction (0-100) -> mood contribution
    let weightedSum = 0
    let totalWeight = 0
    for (const k of Object.keys(NEED_WEIGHTS) as NeedKey[]) {
      const w = NEED_WEIGHTS[k]
      weightedSum += snap.needs[k] * w
      totalWeight += w
    }
    const avgSatisfaction = totalWeight > 0 ? weightedSum / totalWeight : 50
    // Map 0-100 satisfaction to -100..+100 mood (50 = neutral)
    let mood = (avgSatisfaction - 50) * 2

    // Apply transient event modifier
    const mod = this.eventModifiers.get(npcId) ?? 0
    mood += mod

    // Clamp
    mood = Math.max(-100, Math.min(100, mood))

    const level = this.valueToLevel(mood)
    const dominantNeed = snap.urgent.length > 0 ? snap.lowest : null
    return { value: mood, level, dominantNeed }
  }

  /** Apply a transient mood modifier (e.g., +20 for festival, -15 for rejection). */
  applyEvent(npcId: string, modifier: number, durationMs: number = 60_000): void {
    const current = this.eventModifiers.get(npcId) ?? 0
    this.eventModifiers.set(npcId, current + modifier)
    this.eventExpiry.set(npcId, Date.now() + durationMs)
  }

  /** Clear expired event modifiers. Called periodically. */
  pruneExpired(): void {
    const now = Date.now()
    for (const [npcId, expiry] of this.eventExpiry) {
      if (expiry <= now) {
        this.eventModifiers.delete(npcId)
        this.eventExpiry.delete(npcId)
      }
    }
  }

  /** Clear all state for a citizen. */
  clearCitizen(npcId: string): void {
    this.eventModifiers.delete(npcId)
    this.eventExpiry.delete(npcId)
  }

  /** Clear all state. */
  clear(): void {
    this.eventModifiers.clear()
    this.eventExpiry.clear()
  }

  private valueToLevel(v: number): MoodLevel {
    if (v >= 50) return 'great'
    if (v >= 20) return 'good'
    if (v > -20) return 'neutral'
    if (v > -50) return 'bad'
    return 'terrible'
  }
}

export const MOOD_LABELS_ZH: Record<MoodLevel, string> = {
  great: '极好', good: '不错', neutral: '平静', bad: '低落', terrible: '糟糕',
}

