/**
 * FestivalEngine — schedules and triggers town festivals (Animal Mode).
 *
 * Festivals are special days when all citizens gather at the plaza for
 * celebrations. On a festival day:
 *   - IndoorTracker releases all indoor citizens (they come out)
 *   - Citizens walk to plaza_center
 *   - Festival VFX plays (via broadcastAgentEvent)
 *   - Special festival dialogue context is injected into LLM prompts
 *   - RelationshipEngine records "festival together" sentiment boosts
 *
 * Festival calendar (game-day based, not real calendar):
 *   Every 7 game-days, a festival occurs. The festival type rotates:
 *     cherryBlossom -> harvest -> snowman -> flower -> starNight -> (repeat)
 *
 * Festivals can also be manually triggered via the town_query_festival /
 * town_join_festival tools.
 */

import type { IndoorTracker } from './IndoorTracker'

export type FestivalType =
  | 'cherryBlossom'
  | 'harvest'
  | 'snowman'
  | 'flower'
  | 'starNight'

export interface FestivalState {
  active: boolean
  type: FestivalType | null
  dayCount: number          // game day when festival started
  startedAt: number          // real timestamp when activated
}

export interface FestivalConfig {
  intervalDays: number       // festival every N game-days (default 7)
  durationMs: number          // festival lasts this long in real time (default 120_000 = 2min)
}

const FESTIVAL_ROTATION: FestivalType[] = [
  'cherryBlossom', 'harvest', 'snowman', 'flower', 'starNight',
]

const FESTIVAL_LABELS_ZH: Record<FestivalType, string> = {
  cherryBlossom: '樱花节',
  harvest: '丰收节',
  snowman: '雪人节',
  flower: '花祭',
  starNight: '星空夜',
}

const FESTIVAL_LABELS_EN: Record<FestivalType, string> = {
  cherryBlossom: 'Cherry Blossom Festival',
  harvest: 'Harvest Festival',
  snowman: 'Snowman Festival',
  flower: 'Flower Festival',
  starNight: 'Starry Night',
}

export class FestivalEngine {
  private config: FestivalConfig
  private state: FestivalState = { active: false, type: null, dayCount: 0, startedAt: 0 }
  private lastFestivalDay = 0
  private festivalIndex = 0
  private indoorTracker: IndoorTracker | null = null
  private onFestivalStart: ((type: FestivalType) => void) | null = null
  private onFestivalEnd: (() => void) | null = null

  constructor(config: Partial<FestivalConfig> = {}) {
    this.config = {
      intervalDays: 7,
      durationMs: 120_000,
      ...config,
    }
  }

  /** Set the IndoorTracker so festivals can release indoor citizens. */
  setIndoorTracker(tracker: IndoorTracker): void {
    this.indoorTracker = tracker
  }

  /** Set callbacks for festival start/end. */
  setCallbacks(onStart: (type: FestivalType) => void, onEnd: () => void): void {
    this.onFestivalStart = onStart
    this.onFestivalEnd = onEnd
  }

  /** Check if today (game dayCount) should trigger a festival. */
  shouldTriggerFestival(currentDayCount: number): boolean {
    if (this.state.active) return false
    return (currentDayCount - this.lastFestivalDay) >= this.config.intervalDays
  }

  /** Start a festival of the given type (or auto-rotate). */
  startFestival(type: FestivalType | null, dayCount: number): void {
    if (this.state.active) return
    const festivalType = type ?? FESTIVAL_ROTATION[this.festivalIndex % FESTIVAL_ROTATION.length]
    this.festivalIndex++
    this.state = {
      active: true,
      type: festivalType,
      dayCount,
      startedAt: Date.now(),
    }
    this.lastFestivalDay = dayCount

    // Release all indoor citizens so they can join the festival
    if (this.indoorTracker) {
      this.indoorTracker.clear()
    }

    this.onFestivalStart?.(festivalType)
  }

  /** End the current festival. */
  endFestival(): void {
    if (!this.state.active) return
    this.state = { active: false, type: null, dayCount: 0, startedAt: 0 }
    this.onFestivalEnd?.()
  }

  /** Called every frame; auto-ends festival after duration. */
  update(_deltaTimeMs: number): void {
    if (!this.state.active) return
    const elapsed = Date.now() - this.state.startedAt
    if (elapsed >= this.config.durationMs) {
      this.endFestival()
    }
  }

  /** Get current festival state. */
  getState(): FestivalState {
    return { ...this.state }
  }

  /** Is a festival currently active? */
  isActive(): boolean {
    return this.state.active
  }

  /** Get the current festival type (or null). */
  getCurrentType(): FestivalType | null {
    return this.state.type
  }

  /** Get the festival label in the specified locale. */
  getFestivalLabel(type: FestivalType, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
    return locale === 'en' ? FESTIVAL_LABELS_EN[type] : FESTIVAL_LABELS_ZH[type]
  }

  /** Build a festival context fragment for LLM prompts. */
  buildPromptFragment(locale: 'zh-CN' | 'en' = 'zh-CN'): string {
    if (!this.state.active || !this.state.type) return ''
    const label = this.getFestivalLabel(this.state.type, locale)
    if (locale === 'en') {
      return `Today is a festival: ${label}. All citizens are gathering at the plaza to celebrate. Join the festivities!`
    }
    return `今天是${label}。所有居民都在广场集合庆祝。请参与节日活动！`
  }

  /** Get all festival types. */
  getAllTypes(): FestivalType[] {
    return [...FESTIVAL_ROTATION]
  }
}

export { FESTIVAL_LABELS_ZH, FESTIVAL_LABELS_EN }
