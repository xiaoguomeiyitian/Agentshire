/**
 * MoveEngine — handles citizens moving in and out of town (Animal Mode).
 *
 * A citizen may consider moving out when:
 *   - Their average mood has been low (bad/terrible) for multiple consecutive days
 *   - Their overall relationships are mostly negative (more enemies than friends)
 *
 * When a citizen moves out:
 *   - They disappear from the town (mesh.visible = false, removed from IndoorTracker)
 *   - A farewell dialogue is generated
 *   - A new citizen may move in to take their place
 *
 * When a new citizen moves in:
 *   - They spawn at the town entrance
 *   - An introduction dialogue is generated
 *   - They are registered in NeedsEngine and start autonomous behavior
 *
 * This engine is checked periodically (e.g., at dawn) and does not
 * force moves — it only flags candidates for the AutonomyEngine to act on.
 */

import type { NeedsEngine } from './NeedsEngine'
import type { MoodEngine } from './MoodEngine'
import type { RelationshipEngine } from './RelationshipEngine'
import type { IndoorTracker } from './IndoorTracker'

export interface MoveCandidate {
  npcId: string
  reason: string
  avgMood: number
  negativeRelationships: number
  positiveRelationships: number
}

export interface MoveConfig {
  minDaysBeforeMove: number     // citizen must live in town at least this long (default 5)
  moodThreshold: number         // avg mood below this triggers move consideration (default -30)
  negativeRelThreshold: number  // more negative relationships than this triggers (default 2)
  moveChancePerCheck: number    // probability of actually moving when eligible (default 0.3)
}

export interface MoveEvent {
  type: 'moved_out' | 'moved_in'
  npcId: string
  name: string
  timestamp: number
  detail: string
}

export class MoveEngine {
  private config: MoveConfig
  private needsEngine: NeedsEngine | null = null
  private moodEngine: MoodEngine | null = null
  private relationshipEngine: RelationshipEngine | null = null
  private indoorTracker: IndoorTracker | null = null
  private moveHistory: MoveEvent[] = []
  private arrivalDays: Map<string, number> = new Map() // npcId -> dayCount when arrived

  constructor(config: Partial<MoveConfig> = {}) {
    this.config = {
      minDaysBeforeMove: 5,
      moodThreshold: -30,
      negativeRelThreshold: 2,
      moveChancePerCheck: 0.3,
      ...config,
    }
  }

  /** Set the engines this MoveEngine depends on. */
  setEngines(
    needs: NeedsEngine,
    mood: MoodEngine,
    relationships: RelationshipEngine,
    indoor: IndoorTracker,
  ): void {
    this.needsEngine = needs
    this.moodEngine = mood
    this.relationshipEngine = relationships
    this.indoorTracker = indoor
  }

  /** Record a citizen's arrival day. */
  recordArrival(npcId: string, dayCount: number): void {
    this.arrivalDays.set(npcId, dayCount)
  }

  /** Check if a citizen is eligible to move out. */
  checkMoveOutEligibility(npcId: string, currentDayCount: number): MoveCandidate | null {
    if (!this.needsEngine || !this.moodEngine || !this.relationshipEngine) return null

    // Must have lived in town long enough
    const arrivalDay = this.arrivalDays.get(npcId) ?? 0
    const daysInTown = currentDayCount - arrivalDay
    if (daysInTown < this.config.minDaysBeforeMove) return null

    // Check mood
    const moodState = this.moodEngine.compute(npcId, this.needsEngine)
    if (moodState.value >= this.config.moodThreshold) return null

    // Check relationships
    const rels = this.relationshipEngine.getAllRelationships(npcId)
    let negative = 0
    let positive = 0
    for (const r of rels) {
      if (r.sentiment < -20) negative++
      else if (r.sentiment > 20) positive++
    }
    if (negative <= this.config.negativeRelThreshold) return null

    return {
      npcId,
      reason: `心情持续低落（${moodState.value.toFixed(0)}），人际关系不佳（${negative} 个负面关系）`,
      avgMood: moodState.value,
      negativeRelationships: negative,
      positiveRelationships: positive,
    }
  }

  /** Decide whether a citizen actually moves out (probabilistic). */
  shouldMoveOut(candidate: MoveCandidate): boolean {
    return Math.random() < this.config.moveChancePerCheck
  }

  /** Execute a move-out: remove citizen from all systems. */
  moveOut(npcId: string, name: string): MoveEvent {
    // Remove from indoor tracker
    this.indoorTracker?.leave(npcId)
    // Remove from needs engine
    this.needsEngine?.unregisterCitizen(npcId)
    // Clear mood state
    this.moodEngine?.clearCitizen(npcId)
    // Clear arrival record
    this.arrivalDays.delete(npcId)

    const event: MoveEvent = {
      type: 'moved_out',
      npcId,
      name,
      timestamp: Date.now(),
      detail: `${name} 搬离了小镇`,
    }
    this.moveHistory.push(event)
    return event
  }

  /** Execute a move-in: register a new citizen. */
  moveIn(npcId: string, name: string, dayCount: number): MoveEvent {
    this.needsEngine?.registerCitizen(npcId)
    this.arrivalDays.set(npcId, dayCount)

    const event: MoveEvent = {
      type: 'moved_in',
      npcId,
      name,
      timestamp: Date.now(),
      detail: `${name} 搬入了小镇`,
    }
    this.moveHistory.push(event)
    return event
  }

  /** Get move history. */
  getMoveHistory(): ReadonlyArray<MoveEvent> {
    return this.moveHistory
  }

  /** Get a citizen's arrival day. */
  getArrivalDay(npcId: string): number | null {
    return this.arrivalDays.get(npcId) ?? null
  }

  /** Clear all state. */
  clear(): void {
    this.moveHistory = []
    this.arrivalDays.clear()
  }
}
