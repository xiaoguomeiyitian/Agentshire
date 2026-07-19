/**
 * DailySettlementEngine — handles the 06:00 dawn settlement.
 *
 * At dawn each game-day, this engine:
 *   1. Pays out daily salary + work rewards + reputation bonus (via EconomyEngine)
 *   2. Restores mood (+30 base, +10-20 if positive social/work yesterday)
 *   3. Restores social (+20 daily reset)
 *   4. Restores belonging (+5 if slept at home)
 *   5. Applies breakfast hunger restore (+40, 06:00-08:00 at home)
 *
 * Night sleep (22:00-06:00) is handled separately in AnimalModeManager.update()
 * via the indoor-recovery logic (fatigue/hunger/hygiene/safety recover at home).
 * This engine focuses on the dawn settlement tick.
 *
 * Integration:
 *   AnimalModeManager.onPeriodChange('dawn') → runDailySettlement()
 *   The manager injects NeedsEngine + MoodEngine + EconomyEngine + IndoorTracker.
 */

import type { NeedsEngine, NeedKey } from './NeedsEngine'
import type { MoodEngine } from './MoodEngine'
import type { EconomyEngine } from './EconomyEngine'
import type { IndoorTracker } from './IndoorTracker'

export interface DailySettlementResult {
  dayCount: number
  citizens: Array<{
    npcId: string
    salary: number
    workReward: number
    repBonus: number
    total: number
    moodRestore: number
    socialRestore: number
    belongingRestore: number
    breakfastRestore: number
  }>
}

/** Settlement parameters (see design doc §2.2). */
const SETTLEMENT_PARAMS = {
  baseMoodRestore: 30,
  bonusMoodRestoreMin: 10,
  bonusMoodRestoreMax: 20,
  socialRestore: 20,
  belongingHomeRestore: 5,
  breakfastHungerRestore: 40,
}

export class DailySettlementEngine {
  private needsEngine: NeedsEngine | null = null
  private moodEngine: MoodEngine | null = null
  private economyEngine: EconomyEngine | null = null
  private indoorTracker: IndoorTracker | null = null
  /** Track whether a citizen had positive social/work yesterday (for mood bonus). */
  private hadPositiveDay: Set<string> = new Set()
  /** Track whether a citizen slept at home last night (for belonging restore). */
  private sleptAtHome: Set<string> = new Set()

  /** Inject engine dependencies. */
  setEngines(
    needs: NeedsEngine,
    mood: MoodEngine,
    economy: EconomyEngine,
    indoor: IndoorTracker,
  ): void {
    this.needsEngine = needs
    this.moodEngine = mood
    this.economyEngine = economy
    this.indoorTracker = indoor
  }

  /**
   * Mark that a citizen had a positive event today (social, task completion).
   * Called by AutonomyEngine/EncounterManager when good things happen.
   */
  markPositiveDay(npcId: string): void {
    this.hadPositiveDay.add(npcId)
  }

  /**
   * Record that a citizen slept at home last night.
   * Called by AnimalModeManager when detecting citizen at home during night.
   */
  markSleptAtHome(npcId: string): void {
    this.sleptAtHome.add(npcId)
  }

  /**
   * Run the daily settlement. Called at dawn (06:00) by AnimalModeManager.
   * @param dayCount Current game day count (for logging).
   * @returns Settlement summary per citizen.
   */
  runDailySettlement(dayCount: number): DailySettlementResult {
    if (!this.needsEngine || !this.moodEngine || !this.economyEngine) {
      console.warn('[DailySettlement] engines not set, skipping')
      return { dayCount, citizens: [] }
    }

    const citizens: DailySettlementResult['citizens'] = []

    // 1. Economy payout (salary + work reward + reputation bonus)
    const economyResults = this.economyEngine.runDailySettlement()
    const economyMap = new Map(economyResults.map((r) => [r.npcId, r]))

    // 2. Restore needs for each citizen
    for (const npcId of this.needsEngine.getCitizens()) {
      const econ = economyMap.get(npcId)
      if (!econ) continue

      // Mood restore: base + bonus if positive day
      const hadPositive = this.hadPositiveDay.has(npcId)
      const moodBonus = hadPositive
        ? SETTLEMENT_PARAMS.bonusMoodRestoreMin +
          Math.floor(Math.random() * (SETTLEMENT_PARAMS.bonusMoodRestoreMax - SETTLEMENT_PARAMS.bonusMoodRestoreMin + 1))
        : 0
      const moodRestore = SETTLEMENT_PARAMS.baseMoodRestore + moodBonus
      // Mood is computed by MoodEngine from needs; we restore the 'fun' and 'esteem'
      // needs which feed into mood, plus apply a transient mood event.
      this.needsEngine.satisfy(npcId, 'fun', moodRestore * 0.3)
      this.needsEngine.satisfy(npcId, 'esteem', moodRestore * 0.2)
      this.moodEngine.applyEvent(npcId, moodBonus, 120_000) // transient mood boost

      // Social restore (daily reset)
      const socialRestore = SETTLEMENT_PARAMS.socialRestore
      this.needsEngine.satisfy(npcId, 'social', socialRestore)

      // Belonging restore (if slept at home)
      const sleptHome = this.sleptAtHome.has(npcId)
      const belongingRestore = sleptHome ? SETTLEMENT_PARAMS.belongingHomeRestore : 0
      if (belongingRestore > 0) {
        this.needsEngine.satisfy(npcId, 'belonging', belongingRestore)
      }

      // Breakfast hunger restore (06:00-08:00, at home)
      // We apply it immediately at dawn; the 06:00-08:00 window is handled
      // by the indoor-recovery logic in AnimalModeManager.update() which
      // already restores hunger at home. This is an extra breakfast boost.
      const isAtHome = this.indoorTracker?.isIndoor(npcId) ?? false
      const breakfastRestore = isAtHome ? SETTLEMENT_PARAMS.breakfastHungerRestore : 0
      if (breakfastRestore > 0) {
        this.needsEngine.satisfy(npcId, 'hunger', breakfastRestore)
      }

      citizens.push({
        npcId,
        salary: econ.salary,
        workReward: econ.workReward,
        repBonus: econ.repBonus,
        total: econ.total,
        moodRestore,
        socialRestore,
        belongingRestore,
        breakfastRestore,
      })
    }

    // Reset daily tracking sets
    this.hadPositiveDay.clear()
    this.sleptAtHome.clear()

    console.log(
      `[DailySettlement] day ${dayCount}: ${citizens.length} citizens settled, ` +
      `total paid=${citizens.reduce((s, c) => s + c.total, 0)} coins`,
    )

    return { dayCount, citizens }
  }

  /** Clear all state (e.g., Animal Mode disabled). */
  clear(): void {
    this.hadPositiveDay.clear()
    this.sleptAtHome.clear()
  }
}
