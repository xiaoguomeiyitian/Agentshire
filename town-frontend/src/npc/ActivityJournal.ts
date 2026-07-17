import type { GameClock } from '../game/GameClock'
import type {
  ActivityEntry, ActivityAction, DialogueRecord,
  Relationship, DailyReflection, DailyPlan, DailyPlanItem,
} from '../types'

const MAX_ENTRIES = 20
const MAX_DIALOGUES = 5
const MAX_REFLECTIONS = 7
const MAX_RECENT_TOPICS = 3

export class ActivityJournal {
  readonly npcId: string
  readonly npcName: string
  private gameClock: GameClock
  private entries: ActivityEntry[] = []
  private dialogues: DialogueRecord[] = []
  private relationships: Map<string, Relationship> = new Map()
  private reflections: DailyReflection[] = []
  private _currentPlan: DailyPlan | null = null

  constructor(npcId: string, npcName: string, gameClock: GameClock) {
    this.npcId = npcId
    this.npcName = npcName
    this.gameClock = gameClock
  }

  record(data: {
    location: string
    locationName: string
    action: ActivityAction
    detail?: string
    relatedNpc?: string
  }): void {
    this.entries.push({
      ...data,
      time: this.gameClock.getFormattedTime(),
      timestamp: Date.now(),
    })
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift()
    }
  }

  /** Record that a need became urgent (Phase 2). */
  recordNeedUrgent(needLabel: string, location: string, locationName: string): void {
    this.record({
      location,
      locationName,
      action: 'need_urgent',
      detail: `${needLabel}需求迫切`,
    })
  }

  /** Record that a need was satisfied (Phase 2). */
  recordNeedSatisfied(needLabel: string, location: string, locationName: string): void {
    this.record({
      location,
      locationName,
      action: 'need_satisfied',
      detail: `满足了${needLabel}需求`,
    })
  }

  /** Record a mood change (Phase 2). */
  recordMoodChange(moodLabel: string, moodValue: number, location: string, locationName: string): void {
    this.record({
      location,
      locationName,
      action: 'mood_changed',
      detail: `心情变为${moodLabel}（${moodValue.toFixed(0)}）`,
    })
  }

  /** Record that citizen went indoors (became invisible, Phase 2). */
  recordWentIndoor(buildingKey: string, buildingName: string): void {
    this.record({
      location: buildingKey,
      locationName: buildingName,
      action: 'went_indoor',
      detail: `进入${buildingName}`,
    })
  }

  /** Record that citizen left indoors (became visible again, Phase 2). */
  recordLeftIndoor(buildingKey: string, buildingName: string): void {
    this.record({
      location: buildingKey,
      locationName: buildingName,
      action: 'left_indoor',
      detail: `离开${buildingName}`,
    })
  }

  recordDialogue(dialogue: DialogueRecord): void {
    this.dialogues.push(dialogue)
    if (this.dialogues.length > MAX_DIALOGUES) {
      this.dialogues.shift()
    }
  }

  /**
   * Generate context object for LLM encounter dialogue prompts.
   */
  toContextJSON(options: {
    currentLocation: string
    currentLocationName: string
    encounteredNpc: { name: string; lastSeenAt?: string }
  }): object {
    return {
      current_time: this.gameClock.getFormattedTime(),
      current_period: this.gameClock.getPeriod(),
      current_location: options.currentLocation,
      current_location_name: options.currentLocationName,
      encountered_npc: options.encounteredNpc,
      my_recent_activities: this.getRecentActivities(5),
      my_recent_dialogues: this.getRecentDialogueSummaries(2),
    }
  }

  getRecentActivities(count: number): Array<{ time: string; action: string; location: string; detail?: string }> {
    const filtered: ActivityEntry[] = []
    let lastStayingLoc: string | null = null
    for (let i = this.entries.length - 1; i >= 0 && filtered.length < count * 2; i--) {
      const e = this.entries[i]
      if (e.action === 'staying') {
        if (e.location === lastStayingLoc) continue
        lastStayingLoc = e.location
      }
      filtered.unshift(e)
    }

    filtered.sort((a, b) => {
      const aChatScore = a.action === 'chatted' ? 1 : 0
      const bChatScore = b.action === 'chatted' ? 1 : 0
      if (aChatScore !== bChatScore) return bChatScore - aChatScore
      return a.timestamp - b.timestamp
    })

    return filtered.slice(0, count).map(e => ({
      time: e.time,
      action: e.action,
      location: e.locationName,
      ...(e.detail ? { detail: e.detail } : {}),
    }))
  }

  getRecentDialogueSummaries(count: number): Array<{ time: string; with: string; topic: string }> {
    return this.dialogues.slice(-count).map(d => {
      const state = this.gameClock.getState()
      const hh = String(state.hour).padStart(2, '0')
      const mm = String(state.minute).padStart(2, '0')
      return {
        time: `${hh}:${mm}`,
        with: d.partnerName,
        topic: d.summary,
      }
    })
  }

  getEntries(): ReadonlyArray<ActivityEntry> {
    return this.entries
  }

  getDialogues(): ReadonlyArray<DialogueRecord> {
    return this.dialogues
  }

  clear(): void {
    this.entries.length = 0
    this.dialogues.length = 0
  }

  // ── Relationship Graph ──

  getRelationship(npcId: string): Relationship | undefined {
    return this.relationships.get(npcId)
  }

  getRelationships(): ReadonlyArray<Relationship> {
    return [...this.relationships.values()]
  }

  getRelationshipMap(): ReadonlyMap<string, Relationship> {
    return this.relationships
  }

  updateRelationship(partner: { npcId: string; name: string }, update: {
    topic?: string
    sentimentDelta?: number
    label?: string
  }): void {
    let rel = this.relationships.get(partner.npcId)
    if (!rel) {
      rel = {
        npcId: partner.npcId,
        name: partner.name,
        label: update.label ?? '邻居',
        sentiment: 0,
        lastInteraction: Date.now(),
        interactionCount: 0,
        recentTopics: [],
      }
    }

    rel.lastInteraction = Date.now()
    rel.interactionCount++
    if (update.label) rel.label = update.label
    if (update.sentimentDelta != null) {
      rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + update.sentimentDelta))
    }
    if (update.topic) {
      rel.recentTopics.push(update.topic)
      if (rel.recentTopics.length > MAX_RECENT_TOPICS) {
        rel.recentTopics.shift()
      }
    }

    this.relationships.set(partner.npcId, rel)
  }

  getRelationshipsForPrompt(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const rel of this.relationships.values()) {
      const sentiment = rel.sentiment > 0.3 ? '，关系不错' : rel.sentiment < -0.3 ? '，关系一般' : ''
      result[rel.name] = `${rel.label}${sentiment}`
    }
    return result
  }

  // ── Daily Reflections ──

  addReflection(dayCount: number, text: string): void {
    this.reflections.push({ dayCount, text, timestamp: Date.now() })
    if (this.reflections.length > MAX_REFLECTIONS) {
      this.reflections.shift()
    }
  }

  getLatestReflection(): DailyReflection | undefined {
    return this.reflections.length > 0 ? this.reflections[this.reflections.length - 1] : undefined
  }

  getReflections(): ReadonlyArray<DailyReflection> {
    return this.reflections
  }

  getYesterdaySummary(currentDayCount: number): string {
    const yesterday = this.reflections.find(r => r.dayCount === currentDayCount - 1)
    return yesterday?.text ?? '没什么特别的'
  }

  // ── Daily Plan ──

  get currentPlan(): DailyPlan | null {
    return this._currentPlan
  }

  setDailyPlan(dayCount: number, items: DailyPlanItem[]): void {
    this._currentPlan = {
      dayCount,
      items,
      currentIndex: 0,
      suspended: false,
    }
  }

  advancePlan(): DailyPlanItem | null {
    if (!this._currentPlan || this._currentPlan.suspended) return null
    if (this._currentPlan.currentIndex >= this._currentPlan.items.length) return null
    const item = this._currentPlan.items[this._currentPlan.currentIndex]
    this._currentPlan.currentIndex++
    return item
  }

  getCurrentPlanItem(): DailyPlanItem | null {
    if (!this._currentPlan || this._currentPlan.suspended) return null
    const idx = this._currentPlan.currentIndex
    if (idx >= this._currentPlan.items.length) return null
    return this._currentPlan.items[idx]
  }

  suspendPlan(): void {
    if (this._currentPlan) this._currentPlan.suspended = true
  }

  resumePlan(): void {
    if (this._currentPlan) this._currentPlan.suspended = false
  }

  isPlanActive(): boolean {
    return this._currentPlan != null && !this._currentPlan.suspended
  }

  // ── Snapshot persistence ──

  toJSON(): {
    npcId: string
    npcName: string
    entries: ActivityEntry[]
    dialogues: DialogueRecord[]
    relationships: Array<[string, Relationship]>
    reflections: DailyReflection[]
    currentPlan: DailyPlan | null
  } {
    return {
      npcId: this.npcId,
      npcName: this.npcName,
      entries: this.entries.slice(),
      dialogues: this.dialogues.slice(),
      relationships: Array.from(this.relationships.entries()),
      reflections: this.reflections.slice(),
      currentPlan: this._currentPlan ? { ...this._currentPlan, items: this._currentPlan.items.slice() } : null,
    }
  }

  restore(data: {
    entries?: ActivityEntry[]
    dialogues?: DialogueRecord[]
    relationships?: Array<[string, Relationship]>
    reflections?: DailyReflection[]
    currentPlan?: DailyPlan | null
  }): void {
    if (data.entries) this.entries = data.entries.slice()
    if (data.dialogues) this.dialogues = data.dialogues.slice()
    if (data.relationships) this.relationships = new Map(data.relationships)
    if (data.reflections) this.reflections = data.reflections.slice()
    if (data.currentPlan !== undefined) this._currentPlan = data.currentPlan
  }

  // ── Extended Context for AgentBrain ──

  toAgentBrainContext(options: {
    currentLocation: string
    currentLocationName: string
    nearbyNpcs?: Array<{ name: string; npcId: string; distance: number }>
    townRecent?: string[]
  }): object {
    const nearby = options.nearbyNpcs?.map(n => ({
      name: n.name,
      distance: n.distance,
      relationship: this.relationships.get(n.npcId)?.label ?? '不认识',
    }))

    return {
      current_time: this.gameClock.getFormattedTime(),
      current_period: this.gameClock.getPeriod(),
      current_location: options.currentLocation,
      current_location_name: options.currentLocationName,
      current_plan: this.getCurrentPlanItem(),
      nearby_npcs: nearby ?? [],
      relationships: this.getRelationshipsForPrompt(),
      recent_memory: this.getRecentActivities(5).map(a =>
        `${a.time} ${a.action} @ ${a.location}${a.detail ? ': ' + a.detail : ''}`
      ),
      recent_dialogues: this.getRecentDialogueSummaries(2),
      town_recent: options.townRecent ?? [],
    }
  }
}
