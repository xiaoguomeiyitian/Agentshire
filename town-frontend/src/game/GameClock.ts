import type { GameClockConfig, GameTimeState, TimePeriod } from '../types'

const PERIOD_RANGES: Array<{ period: TimePeriod; startHour: number; endHour: number }> = [
  { period: 'dawn',      startHour: 5,  endHour: 7  },
  { period: 'morning',   startHour: 7,  endHour: 12 },
  { period: 'noon',      startHour: 12, endHour: 14 },
  { period: 'afternoon', startHour: 14, endHour: 17 },
  { period: 'dusk',      startHour: 17, endHour: 19 },
  { period: 'night',     startHour: 19, endHour: 5  },
]

export const GAME_CLOCK_DEFAULTS: GameClockConfig = {
  startHour: 6,
  dayDurationRealMs: 3_600_000,
  nightSpeedMultiplier: 3.0,
  paused: false,
}

const CLOCK_STORAGE_KEY = 'agentshire_clock'

interface ClockSnapshot {
  dayCount: number
  gameSeconds: number
  savedAt: number
}

export class GameClock {
  private config: GameClockConfig
  private gameSeconds: number
  private dayCount = 0
  private lastPeriod: TimePeriod
  private periodCallbacks = new Map<string, (state: GameTimeState) => void>()
  private storageKey = CLOCK_STORAGE_KEY
  private saveCounter = 0

  constructor(config: Partial<GameClockConfig> = {}) {
    this.config = { ...GAME_CLOCK_DEFAULTS, ...config }
    this.gameSeconds = this.config.startHour * 3600
    this.restoreFromStorage()
    this.lastPeriod = this.getPeriod()
  }

  setStorageKey(sessionScoped: string): void {
    this.storageKey = sessionScoped
    const raw = localStorage.getItem(this.storageKey)
    if (raw) {
      this.restoreFromStorage()
    } else {
      this.gameSeconds = this.config.startHour * 3600
      this.dayCount = 0
    }
    this.lastPeriod = this.getPeriod()
  }

  private restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) return
      const snap: ClockSnapshot = JSON.parse(raw)
      if (typeof snap.dayCount === 'number' && typeof snap.gameSeconds === 'number') {
        this.dayCount = snap.dayCount
        this.gameSeconds = snap.gameSeconds
      }
    } catch { /* ignore corrupt data */ }
  }

  private persistToStorage(): void {
    try {
      const snap: ClockSnapshot = {
        dayCount: this.dayCount,
        gameSeconds: this.gameSeconds,
        savedAt: Date.now(),
      }
      localStorage.setItem(this.storageKey, JSON.stringify(snap))
    } catch { /* ignore */ }
  }

  /** Restore clock state from plugin-side persistence (server-side source of truth). */
  restoreFromPlugin(dayCount: number, gameSeconds: number): void {
    if (typeof dayCount === 'number' && typeof gameSeconds === 'number') {
      this.dayCount = dayCount
      this.gameSeconds = gameSeconds
      this.lastPeriod = this.getPeriod()
      this.persistToStorage() // sync to localStorage too
    }
  }

  /** Get raw game seconds (for plugin persistence). */
  getGameSeconds(): number {
    return this.gameSeconds
  }

  update(deltaTime: number): void {
    if (this.config.paused) return

    const period = this.getPeriod()
    const speedFactor = period === 'night' ? this.config.nightSpeedMultiplier : 1.0
    const baseSpeed = (24 * 3600) / (this.config.dayDurationRealMs / 1000)

    this.gameSeconds += deltaTime * baseSpeed * speedFactor

    if (this.gameSeconds >= 24 * 3600) {
      this.gameSeconds -= 24 * 3600
      this.dayCount++
      this.persistToStorage()
    }

    const newPeriod = this.getPeriod()
    if (newPeriod !== this.lastPeriod) {
      this.lastPeriod = newPeriod
      const state = this.getState()
      for (const cb of this.periodCallbacks.values()) {
        cb(state)
      }
      this.persistToStorage()
    }

    this.saveCounter++
    if (this.saveCounter >= 600) {
      this.saveCounter = 0
      this.persistToStorage()
    }
  }

  getState(): GameTimeState {
    const totalSeconds = this.gameSeconds
    const hour = Math.floor(totalSeconds / 3600) % 24
    const minute = Math.floor((totalSeconds % 3600) / 60)
    return {
      hour,
      minute,
      normalizedTime: totalSeconds / (24 * 3600),
      period: this.getPeriod(),
      dayCount: this.dayCount,
      isNight: this.isNight(),
    }
  }

  getFormattedTime(): string {
    const s = this.getState()
    return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
  }

  getPeriod(): TimePeriod {
    const hour = (this.gameSeconds / 3600) % 24
    for (const range of PERIOD_RANGES) {
      if (range.period === 'night') {
        if (hour >= range.startHour || hour < range.endHour) return 'night'
      } else {
        if (hour >= range.startHour && hour < range.endHour) return range.period
      }
    }
    return 'morning'
  }

  getNormalizedTime(): number {
    return this.gameSeconds / (24 * 3600)
  }

  getGameHour(): number {
    return (this.gameSeconds / 3600) % 24
  }

  isNight(): boolean {
    const h = this.getGameHour()
    return h >= 19 || h < 5
  }

  isPaused(): boolean {
    return this.config.paused
  }

  pause(): void {
    this.config.paused = true
  }

  resume(): void {
    this.config.paused = false
  }

  setSpeed(dayDurationMs: number): void {
    this.config.dayDurationRealMs = dayDurationMs
  }

  setTime(hour: number): void {
    this.gameSeconds = (hour % 24) * 3600
    this.lastPeriod = this.getPeriod()
  }

  advanceTime(hours: number): void {
    this.gameSeconds += hours * 3600
    while (this.gameSeconds >= 24 * 3600) {
      this.gameSeconds -= 24 * 3600
      this.dayCount++
    }
    this.lastPeriod = this.getPeriod()
    this.persistToStorage()
  }

  onPeriodChange(id: string, cb: (state: GameTimeState) => void): void {
    this.periodCallbacks.set(id, cb)
  }

  offPeriodChange(id: string): void {
    this.periodCallbacks.delete(id)
  }
}
