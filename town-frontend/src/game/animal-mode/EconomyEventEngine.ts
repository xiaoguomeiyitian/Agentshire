/**
 * EconomyEventEngine — automatic event triggers based on vital thresholds.
 *
 * Monitors citizen state and fires events when thresholds are crossed
 * (see design doc §9.1):
 *   - help_request:    coins < 5 AND hunger < 20 → ask friend/mayor for help
 *   - leave_warning:   belonging < 20 for 2 days → mayor gets notification
 *   - move_out:        belonging < 10 for 3 days → citizen leaves town
 *   - celebration:     mood > 90 for 1 day → host gathering
 *   - conflict:        relationship < -50 on encounter → argument event
 *   - gratitude:       after receiving gift/help → relationship +5, mood +10
 *
 * This engine is stateless logic — it checks conditions and returns events.
 * AnimalModeManager polls it periodically (e.g., every L2 cycle) and dispatches
 * events via externalDeps.onAction or implicit chat.
 *
 * Anti-stuck protections (§11):
 *   - hunger=0 → force free relief (town welfare, no coin cost)
 *   - energy=0 → force go home (no coin cost)
 *   - mood=0 → mayor care event (+20 mood)
 */

import type { EconomyEngine } from './EconomyEngine'
import type { NeedsEngine, NeedKey } from './NeedsEngine'
import type { MoodEngine } from './MoodEngine'
import type { RelationshipEngine } from './RelationshipEngine'

export type EconomyEventType =
  | 'help_request'
  | 'leave_warning'
  | 'move_out'
  | 'celebration'
  | 'conflict'
  | 'gratitude'
  | 'welfare_relief'
  | 'force_go_home'
  | 'mayor_care'

export interface EconomyEvent {
  type: EconomyEventType
  npcId: string
  targetNpcId?: string
  amount?: number
  message: string
  /** Suggested action for AnimalModeManager to execute. */
  action?: 'go_cafe' | 'go_home' | 'talk_to' | 'gather' | 'notify_mayor' | 'welfare'
}

export interface EconomyEventEngineDeps {
  economy: EconomyEngine
  needs: NeedsEngine
  mood: MoodEngine
  relationships: RelationshipEngine
}

/** Per-citizen tracking state for sustained-condition events. */
interface CitizenEventTracker {
  /** Days belonging has been below 20 (for leave_warning). */
  lowBelongingDays: number
  /** Days belonging has been below 10 (for move_out). */
  criticalBelongingDays: number
  /** Days mood has been > 90 (for celebration). */
  highMoodDays: number
  /** Whether help_request was recently fired (cooldown). */
  lastHelpRequestDay: number
  /** Whether welfare relief was given today. */
  welfareGivenToday: boolean
  /** Whether mayor care was given today. */
  mayorCareGivenToday: boolean
}

export class EconomyEventEngine {
  private deps: EconomyEventEngineDeps | null = null
  private trackers: Map<string, CitizenEventTracker> = new Map()
  private currentDay = 0

  /** Inject dependencies. */
  setDeps(deps: EconomyEventEngineDeps): void {
    this.deps = deps
  }

  /** Register a citizen for event tracking. */
  registerCitizen(npcId: string): void {
    if (!this.trackers.has(npcId)) {
      this.trackers.set(npcId, {
        lowBelongingDays: 0,
        criticalBelongingDays: 0,
        highMoodDays: 0,
        lastHelpRequestDay: -1,
        welfareGivenToday: false,
        mayorCareGivenToday: false,
      })
    }
  }

  /** Unregister a citizen. */
  unregisterCitizen(npcId: string): void {
    this.trackers.delete(npcId)
  }

  /** Set the current game day (called at dawn settlement). */
  setCurrentDay(day: number): void {
    this.currentDay = day
    // Reset daily flags
    for (const t of this.trackers.values()) {
      t.welfareGivenToday = false
      t.mayorCareGivenToday = false
    }
  }

  /**
   * Check a citizen for triggered events. Called periodically.
   * Returns an array of events to dispatch (may be empty).
   */
  checkCitizen(npcId: string): EconomyEvent[] {
    if (!this.deps) return []
    const tracker = this.trackers.get(npcId)
    if (!tracker) return []

    const events: EconomyEvent[] = []
    const econ = this.deps.economy.getCitizen(npcId)
    const needsSnap = this.deps.needs.getSnapshot(npcId)
    const moodState = this.deps.mood.compute(npcId, this.deps.needs)
    if (!econ || !needsSnap) return []

    // ── Welfare relief: hunger=0 → free food (town welfare) ──
    if (needsSnap.needs.hunger <= 0 && !tracker.welfareGivenToday) {
      tracker.welfareGivenToday = true
      events.push({
        type: 'welfare_relief',
        npcId,
        amount: 30,
        message: `${npcId}饥饿难耐，小镇发放救济食物`,
        action: 'welfare',
      })
    }

    // ── Force go home: energy=0 ──
    if (needsSnap.needs.fatigue <= 0) {
      events.push({
        type: 'force_go_home',
        npcId,
        message: `${npcId}精疲力竭，强制回家休息`,
        action: 'go_home',
      })
    }

    // ── Mayor care: mood=0 (terrible) ──
    if (moodState.value <= -100 && !tracker.mayorCareGivenToday) {
      tracker.mayorCareGivenToday = true
      events.push({
        type: 'mayor_care',
        npcId,
        amount: 20,
        message: `${npcId}心情跌至谷底，镇长关怀`,
        action: 'notify_mayor',
      })
    }

    // ── Help request: coins < 5 AND hunger < 20 ──
    if (econ.coins < 5 && needsSnap.needs.hunger < 20) {
      if (this.currentDay !== tracker.lastHelpRequestDay) {
        tracker.lastHelpRequestDay = this.currentDay
        events.push({
          type: 'help_request',
          npcId,
          message: `${npcId}没钱买食物，向朋友求助`,
          action: 'talk_to',
        })
      }
    }

    // ── Leave warning: belonging < 20 for 2 days ──
    if (needsSnap.needs.belonging < 20) {
      tracker.lowBelongingDays++
      if (tracker.lowBelongingDays >= 2) {
        events.push({
          type: 'leave_warning',
          npcId,
          message: `${npcId}归属感过低（${tracker.lowBelongingDays}天），想离开小镇`,
          action: 'notify_mayor',
        })
      }
    } else {
      tracker.lowBelongingDays = 0
    }

    // ── Move out: belonging < 10 for 3 days ──
    if (needsSnap.needs.belonging < 10) {
      tracker.criticalBelongingDays++
      if (tracker.criticalBelongingDays >= 3) {
        events.push({
          type: 'move_out',
          npcId,
          message: `${npcId}归属感极低（${tracker.criticalBelongingDays}天），准备搬走`,
          action: 'notify_mayor',
        })
      }
    } else {
      tracker.criticalBelongingDays = 0
    }

    // ── Celebration: mood > 90 for 1 day ──
    if (moodState.value > 90) {
      tracker.highMoodDays++
      if (tracker.highMoodDays >= 1) {
        events.push({
          type: 'celebration',
          npcId,
          message: `${npcId}心情极好，想举办聚会`,
          action: 'gather',
        })
        tracker.highMoodDays = 0 // reset to avoid spamming
      }
    } else {
      tracker.highMoodDays = 0
    }

    return events
  }

  /** Check all citizens for events. */
  checkAll(): EconomyEvent[] {
    const all: EconomyEvent[] = []
    for (const npcId of this.trackers.keys()) {
      all.push(...this.checkCitizen(npcId))
    }
    return all
  }

  /**
   * Check for conflict on encounter: relationship < -50.
   * Called by EncounterManager when two citizens meet.
   */
  checkEncounterConflict(npcA: string, npcB: string): EconomyEvent | null {
    if (!this.deps) return null
    const sentiment = this.deps.relationships.getSentiment(npcA, npcB)
    if (sentiment < -50) {
      return {
        type: 'conflict',
        npcId: npcA,
        targetNpcId: npcB,
        message: `${npcA}与${npcB}关系敌对，发生冲突`,
        action: 'talk_to',
      }
    }
    return null
  }

  /**
   * Record gratitude: after receiving gift/help.
   * Relationship +5, mood +10 (via fun need).
   */
  recordGratitude(npcId: string, targetId: string, targetName: string): EconomyEvent {
    if (this.deps) {
      this.deps.relationships.adjustSentiment(npcId, targetId, targetName, 5, '感恩')
      this.deps.needs.satisfy(npcId, 'fun', 10)
    }
    return {
      type: 'gratitude',
      npcId,
      targetNpcId: targetId,
      message: `${npcId}对${targetName}表达感恩`,
    }
  }

  /** Clear all state. */
  clear(): void {
    this.trackers.clear()
  }
}
