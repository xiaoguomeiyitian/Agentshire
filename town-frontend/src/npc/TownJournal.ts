/**
 * TownJournal — real-time event stream + daily narrative summaries.
 *
 * Zero LLM cost for event collection; one LLM call per game-day for summary.
 * Also orchestrates nightly citizen reflections.
 */

import type { GameClock } from '../game/GameClock'
import type { TimePeriod } from '../types'

// ── TownEvent: real-time stream entry ──

export type TownEventType =
  | 'wake_up' | 'arrival' | 'departure'
  | 'encounter_start' | 'encounter_message' | 'encounter_end'
  | 'reflection' | 'go_home'
  | 'time_change' | 'mode_change'

export interface TownEvent {
  gameTime: string
  period: TimePeriod
  type: TownEventType
  actors: string[]
  location: string
  description: string
  timestamp: number
}

// ── Daily Summary ──

export interface DailySummary {
  dayCount: number
  text: string
  eventCount: number
  timestamp: number
}

// ── Config ──

const MAX_EVENTS_PER_DAY = 100
const MAX_DAILY_SUMMARIES = 30
const RECENT_EVENTS_FOR_PERCEPTION = 10

const PERIOD_LABELS: Partial<Record<TimePeriod, string>> = {
  dawn: '天亮了，新的一天开始',
  morning: '早晨的阳光洒满小镇',
  noon: '正午时分',
  afternoon: '午后时光',
  dusk: '天色渐暗',
  night: '夜幕降临',
}

export interface TownJournalDeps {
  implicitChat: (req: {
    scene: string
    system: string
    user: string
  }) => Promise<{ text: string; fallback: boolean }>
}

export class TownJournal {
  private gameClock: GameClock
  private deps: TownJournalDeps

  private events: TownEvent[] = []
  private currentDayEvents: TownEvent[] = []
  private dailySummaries: DailySummary[] = []
  private lastDayCount = -1

  private onEventListeners: Array<(event: TownEvent) => void> = []
  private onSummaryListeners: Array<(summary: DailySummary) => void> = []

  constructor(gameClock: GameClock, deps: TownJournalDeps) {
    this.gameClock = gameClock
    this.deps = deps
  }

  // ── Event Recording ──

  record(type: TownEventType, actors: string[], location: string, description: string): void {
    const state = this.gameClock.getState()
    const event: TownEvent = {
      gameTime: this.gameClock.getFormattedTime(),
      period: state.period,
      type,
      actors,
      location,
      description,
      timestamp: Date.now(),
    }

    this.events.push(event)
    if (this.events.length > MAX_EVENTS_PER_DAY * 3) {
      this.events = this.events.slice(-MAX_EVENTS_PER_DAY * 2)
    }

    if (state.dayCount !== this.lastDayCount) {
      this.currentDayEvents = []
      this.lastDayCount = state.dayCount
    }
    this.currentDayEvents.push(event)
    if (this.currentDayEvents.length > MAX_EVENTS_PER_DAY) {
      this.currentDayEvents.shift()
    }

    for (const fn of this.onEventListeners) fn(event)
  }

  // ── Convenience recorders ──

  recordWakeUp(name: string, home: string): void {
    this.record('wake_up', [name], home, `${name}从家里出来`)
  }

  recordArrival(name: string, location: string, locationName: string): void {
    this.record('arrival', [name], location, `${name}到了${locationName}`)
  }

  recordDeparture(name: string, location: string, locationName: string): void {
    this.record('departure', [name], location, `${name}离开了${locationName}`)
  }

  recordEncounterStart(nameA: string, nameB: string, location: string): void {
    this.record('encounter_start', [nameA, nameB], location, `${nameA}和${nameB}聊了起来`)
  }

  recordEncounterMessage(speaker: string, text: string, location: string): void {
    this.record('encounter_message', [speaker], location, `${speaker}说："${text}"`)
  }

  recordEncounterEnd(nameA: string, nameB: string, summary: string, location: string): void {
    this.record('encounter_end', [nameA, nameB], location, `${nameA}和${nameB}结束了对话：${summary}`)
  }

  recordGoHome(name: string, home: string): void {
    this.record('go_home', [name], home, `${name}回到了家`)
  }

  recordReflection(name: string, reflection: string): void {
    this.record('reflection', [name], 'home', `${name}说："${reflection}"`)
  }

  recordTimeChange(period: TimePeriod): void {
    const desc = PERIOD_LABELS[period] ?? `时段变为${period}`
    this.record('time_change', [], 'town', desc)
  }

  recordModeChange(mode: 'life' | 'work', detail?: string): void {
    const desc = mode === 'work'
      ? (detail ?? '管家召集大家开会了')
      : (detail ?? '大家回到了日常生活')
    this.record('mode_change', [], 'town', desc)
  }

  // ── Queries (for L2 tactical perception) ──

  getRecentEvents(count?: number): TownEvent[] {
    const n = count ?? RECENT_EVENTS_FOR_PERCEPTION
    return this.currentDayEvents.slice(-n)
  }

  getRecentDescriptions(count?: number): string[] {
    return this.getRecentEvents(count).map(e => `[${e.gameTime}] ${e.description}`)
  }

  getCurrentDayEventCount(): number {
    return this.currentDayEvents.length
  }

  // ── Daily Summaries ──

  getDailySummary(dayCount: number): DailySummary | undefined {
    return this.dailySummaries.find(s => s.dayCount === dayCount)
  }

  getAllSummaries(): ReadonlyArray<DailySummary> {
    return this.dailySummaries
  }

  async generateDailySummary(dayCount: number): Promise<DailySummary> {
    const existing = this.getDailySummary(dayCount)
    if (existing) return existing

    const dayEvents = this.currentDayEvents.length > 0
      ? this.currentDayEvents
      : this.events.slice(-50)

    const eventLog = dayEvents
      .filter(e => e.type !== 'encounter_message' && e.type !== 'time_change')
      .map(e => `[${e.gameTime}] ${e.description}`)
      .join('\n')

    let text: string

    if (eventLog.length > 0) {
      try {
        const result = await this.deps.implicitChat({
          scene: 'town_journal',
          system: '你是小镇日志的记录者。根据今天发生的事件，写一段3~5句话的叙事日志。语气温暖自然，像在讲故事。只输出日志内容。',
          user: `第${dayCount}天的事件：\n${eventLog}`,
        })
        text = result.fallback ? this.buildFallbackSummary(dayEvents) : result.text
      } catch {
        text = this.buildFallbackSummary(dayEvents)
      }
    } else {
      text = '平静的一天，小镇一切如常。'
    }

    const summary: DailySummary = {
      dayCount,
      text,
      eventCount: dayEvents.length,
      timestamp: Date.now(),
    }

    this.dailySummaries.push(summary)
    if (this.dailySummaries.length > MAX_DAILY_SUMMARIES) {
      this.dailySummaries.shift()
    }

    for (const fn of this.onSummaryListeners) fn(summary)

    return summary
  }

  private buildFallbackSummary(events: TownEvent[]): string {
    const actors = new Set<string>()
    let encounters = 0
    const places = new Set<string>()

    for (const e of events) {
      for (const a of e.actors) actors.add(a)
      if (e.type === 'encounter_end') encounters++
      if (e.location && e.location !== 'town' && e.location !== 'home') places.add(e.location)
    }

    const parts: string[] = []
    if (actors.size > 0) parts.push(`${[...actors].slice(0, 3).join('、')}等人度过了忙碌的一天`)
    if (encounters > 0) parts.push(`发生了${encounters}次对话`)
    if (places.size > 0) parts.push(`大家去了${[...places].slice(0, 3).join('、')}`)

    return parts.length > 0 ? parts.join('，') + '。' : '平静的一天。'
  }

  // ── Nightly Reflection Orchestration ──

  async runNightlyReflections(citizens: Array<{
    npcId: string
    name: string
    persona?: { coreSummary: string; speakingStyle?: string }
    journal: import('./ActivityJournal').ActivityJournal
  }>): Promise<void> {
    const dayCount = this.gameClock.getState().dayCount

    for (const citizen of citizens) {
      const recentActivities = citizen.journal.getRecentActivities(5)
        .map(a => `${a.time} ${a.action} @ ${a.location}`)
        .join('、')

      const system = [
        `你是${citizen.name}。${citizen.persona?.coreSummary ?? ''}`,
        '回顾今天，写一句感想，30字以内。只输出感想内容。',
      ].join('\n')

      try {
        const result = await this.deps.implicitChat({
          scene: 'daily_reflection',
          system,
          user: recentActivities || '今天没做什么特别的事',
        })

        const reflection = result.text || '今天过得还不错'
        citizen.journal.addReflection(dayCount, reflection)
        this.recordReflection(citizen.name, reflection)
      } catch {
        const fallback = '今天过得还不错'
        citizen.journal.addReflection(dayCount, fallback)
        this.recordReflection(citizen.name, fallback)
      }
    }

    await this.generateDailySummary(dayCount)
  }

  // ── Listeners ──

  onEvent(fn: (event: TownEvent) => void): void {
    this.onEventListeners.push(fn)
  }

  onSummary(fn: (summary: DailySummary) => void): void {
    this.onSummaryListeners.push(fn)
  }

  // ── Snapshot persistence ──

  toJSON(): {
    events: TownEvent[]
    currentDayEvents: TownEvent[]
    dailySummaries: DailySummary[]
    lastDayCount: number
  } {
    return {
      events: this.events.slice(),
      currentDayEvents: this.currentDayEvents.slice(),
      dailySummaries: this.dailySummaries.slice(),
      lastDayCount: this.lastDayCount,
    }
  }

  restore(data: {
    events?: TownEvent[]
    currentDayEvents?: TownEvent[]
    dailySummaries?: DailySummary[]
    lastDayCount?: number
  }): void {
    if (data.events) this.events = data.events.slice()
    if (data.currentDayEvents) this.currentDayEvents = data.currentDayEvents.slice()
    if (data.dailySummaries) this.dailySummaries = data.dailySummaries.slice()
    if (data.lastDayCount != null) this.lastDayCount = data.lastDayCount
  }

  // ── Cleanup ──

  destroy(): void {
    this.onEventListeners.length = 0
    this.onSummaryListeners.length = 0
  }
}
