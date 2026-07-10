/**
 * AgentBrain — AI-driven decision core for each citizen NPC.
 *
 * Three-tier decision hierarchy:
 *   L1  Daily Plan    – generated once per game-day at dawn
 *   L2  Tactical      – triggered on arrival / nearby NPC / plan item done / stay timeout
 *   L3  Dialogue      – delegated to EncounterManager when L2 outputs talk_to
 *
 * Fallback: if LLM is unavailable or returns invalid data, DailyBehavior
 * state-machine takes over (handled externally by DailyBehavior).
 */

import type { NPC } from './NPC'
import type { GameClock } from '../game/GameClock'
import type { ActivityJournal } from './ActivityJournal'
import type { PersonaCache } from './PersonaStore'
import type { DailyPlanItem, TimePeriod } from '../types'
import { BUILDING_REGISTRY, WAYPOINTS } from '../types'

// ── Types ──

export type TacticalAction =
  | { type: 'stay' }
  | { type: 'talk_to'; target: string; reason: string }
  | { type: 'leave_to'; place: string; reason: string }
  | { type: 'go_home'; reason: string }

export type BrainState = 'idle' | 'planning' | 'executing' | 'deciding' | 'suspended'

export interface NearbyNpcInfo {
  npcId: string
  name: string
  distance: number
}

export interface AgentBrainDeps {
  implicitChat: (req: {
    scene: string
    system: string
    user: string
    maxTokens?: number
    extraStop?: string[]
    npcId?: string
  }) => Promise<{ text: string; fallback: boolean }>

  getNearbyNpcs: (npcId: string, radius: number) => NearbyNpcInfo[]
  getTownRecent: () => string[]
  onTalkTo: (initiatorId: string, targetName: string, reason: string) => void
}

// ── Constants ──

const L2_COOLDOWN_MS = 120_000
const STAY_TIMEOUT_MS = 60_000
const AVAILABLE_PLACES = BUILDING_REGISTRY.map(b => b.key)
const PLACE_NAMES: Record<string, string> = {}
for (const b of BUILDING_REGISTRY) PLACE_NAMES[b.key] = b.name

const NEARBY_RADIUS = 5

// ── AgentBrain ──

export class AgentBrain {
  readonly npcId: string
  private npc: NPC
  private gameClock: GameClock
  private journal: ActivityJournal
  private persona: PersonaCache | undefined
  private deps: AgentBrainDeps

  private _state: BrainState = 'idle'
  private lastL2Time = 0
  private arrivalTriggered = false
  private stayTimer = 0
  private currentPlace: string | null = null
  private pendingL1 = false
  private townName = '小镇'
  private nearbyGreeted = new Set<string>()

  constructor(
    npc: NPC,
    gameClock: GameClock,
    journal: ActivityJournal,
    persona: PersonaCache | undefined,
    deps: AgentBrainDeps,
  ) {
    this.npcId = npc.id
    this.npc = npc
    this.gameClock = gameClock
    this.journal = journal
    this.persona = persona
    this.deps = deps
  }

  get state(): BrainState { return this._state }

  setPersona(persona: PersonaCache): void {
    this.persona = persona
  }

  setTownName(name: string): void {
    this.townName = name
  }

  // ── Lifecycle ──

  start(): void {
    this._state = 'idle'
    const period = this.gameClock.getPeriod()
    if (period === 'dawn' || !this.journal.currentPlan) {
      this.pendingL1 = true
    }
  }

  suspend(): void {
    this._state = 'suspended'
    this.journal.suspendPlan()
  }

  resume(): void {
    this._state = 'idle'
    this.journal.resumePlan()
    this.triggerL2('resume_from_work')
  }

  // Called from DailyBehavior on dawn period change
  onDawn(): void {
    this.pendingL1 = true
  }

  // Called when NPC arrives at a destination
  onArrival(placeKey: string): void {
    this.currentPlace = placeKey
    this.arrivalTriggered = true
    this.stayTimer = 0
    this.nearbyGreeted.clear()
  }

  // ── Update (called every frame from DailyBehavior) ──

  update(dtMs: number): TacticalAction | null {
    if (this._state === 'suspended' || this._state === 'planning' || this._state === 'deciding') {
      return null
    }

    if (this.pendingL1) {
      this.pendingL1 = false
      this.triggerL1()
      return null
    }

    if (this.arrivalTriggered) {
      this.arrivalTriggered = false
      // On arrival, check for nearby NPCs to greet (one LLM call max)
      const nearby = this.deps.getNearbyNpcs(this.npcId, NEARBY_RADIUS)
      const ungreeted = nearby.find(n => !this.nearbyGreeted.has(n.npcId))
      if (ungreeted && this.canL2()) {
        this.nearbyGreeted.add(ungreeted.npcId)
        this.triggerL2('arrival')
      }
      return null
    }

    this.stayTimer += dtMs

    // Stay timeout: just move to next plan destination, no LLM needed
    if (this.stayTimer >= STAY_TIMEOUT_MS && this.currentPlace) {
      this.stayTimer = 0
      this._overriddenDestination = null
      return null
    }

    // Check for new (ungreeted) nearby NPCs — triggers at most once per NPC per location visit
    const nearby = this.deps.getNearbyNpcs(this.npcId, NEARBY_RADIUS)
    const newNearby = nearby.find(n => !this.nearbyGreeted.has(n.npcId))
    if (newNearby && this.canL2()) {
      this.nearbyGreeted.add(newNearby.npcId)
      this.triggerL2('nearby_npc')
    }

    return null
  }

  // Returns the next plan item to execute (used by DailyBehavior)
  getNextPlanDestination(): { placeKey: string; intent: string } | null {
    const item = this.journal.advancePlan()
    if (!item) return null
    const resolved = this.resolvePlaceKey(item.place)
    return resolved ? { placeKey: resolved, intent: item.intent } : null
  }

  hasPlan(): boolean {
    return this.journal.isPlanActive()
  }

  // ── L1: Daily Plan ──

  private async triggerL1(): Promise<void> {
    if (this._state === 'suspended') return
    this._state = 'planning'

    const name = this.persona?.name ?? this.npc.label ?? this.npcId
    const dayCount = this.gameClock.getState().dayCount

    const system = [
      `你是${name}，${this.townName}小镇的居民。`,
      this.persona?.coreSummary ?? '',
      this.persona?.speakingStyle ? `说话风格：${this.persona.speakingStyle}` : '',
      `今天是第${dayCount}天。`,
    ].filter(Boolean).join('\n')

    const yesterday = this.journal.getYesterdaySummary(dayCount)
    const relationships = this.journal.getRelationshipsForPrompt()
    const places = AVAILABLE_PLACES.map(k => PLACE_NAMES[k] || k)

    const user = JSON.stringify({
      yesterday_summary: yesterday,
      relationships,
      available_places: places,
      instruction: '规划今天的日程，3~5个计划。JSON数组：[{"time":"morning","place":"...","intent":"..."}]。只输出JSON。',
    })

    try {
      const result = await this.deps.implicitChat({
        scene: 'daily_plan',
        system,
        user,
        npcId: this.npcId,
      })

      if (!result.fallback) {
        const items = this.parseDailyPlan(result.text)
        if (items.length > 0) {
          this.journal.setDailyPlan(dayCount, items)
          this._state = 'executing'
          return
        }
      }
    } catch { /* fallback below */ }

    this._state = 'executing'
  }

  private parseDailyPlan(raw: string): DailyPlanItem[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []
      const arr = JSON.parse(jsonMatch[0])
      if (!Array.isArray(arr)) return []

      return arr
        .filter((item: any) =>
          typeof item.time === 'string' &&
          typeof item.place === 'string' &&
          typeof item.intent === 'string'
        )
        .slice(0, 5)
        .map((item: any) => ({
          time: item.time,
          place: item.place,
          intent: item.intent,
        }))
    } catch {
      return []
    }
  }

  // ── L2: Tactical Decision ──

  private canL2(): boolean {
    return (
      this._state !== 'suspended' &&
      this._state !== 'planning' &&
      this._state !== 'deciding' &&
      Date.now() - this.lastL2Time >= L2_COOLDOWN_MS
    )
  }

  private async triggerL2(trigger: string): Promise<void> {
    if (!this.canL2()) return
    this._state = 'deciding'
    this.lastL2Time = Date.now()

    const name = this.persona?.name ?? this.npc.label ?? this.npcId
    const nearby = this.deps.getNearbyNpcs(this.npcId, NEARBY_RADIUS)
    const townRecent = this.deps.getTownRecent()
    const currentPlan = this.journal.getCurrentPlanItem()
    const locationName = this.currentPlace ? (PLACE_NAMES[this.currentPlace] ?? this.currentPlace) : '小镇'

    const system = `你是${name}，小镇居民。${this.persona?.coreSummary ?? ''}根据当前情境选择行动。`

    const nearbyForPrompt = nearby.map(n => ({
      name: n.name,
      distance: Math.round(n.distance * 10) / 10,
      relationship: this.journal.getRelationship(n.npcId)?.label ?? '不认识',
    }))

    const options: string[] = ['stay']
    for (const n of nearby) options.push(`talk_to:${n.name}`)
    for (const b of BUILDING_REGISTRY) {
      if (b.key !== this.currentPlace) options.push(`leave_to:${PLACE_NAMES[b.key] ?? b.key}`)
    }
    options.push('go_home')

    const user = JSON.stringify({
      current_time: this.gameClock.getFormattedTime(),
      current_plan: currentPlan ? { intent: currentPlan.intent } : null,
      current_location: locationName,
      nearby_npcs: nearbyForPrompt,
      recent_memory: this.journal.getRecentActivities(3).map(a =>
        `${a.time} ${a.action} @ ${a.location}${a.detail ? ': ' + a.detail : ''}`
      ),
      town_recent: townRecent.slice(0, 5),
      trigger,
      options,
      instruction: '选择一个行动。JSON：{"action":"...","target":"...","reason":"..."}。只输出JSON。',
    })

    try {
      const result = await this.deps.implicitChat({
        scene: 'tactical_decision',
        system,
        user,
        npcId: this.npcId,
      })

      if (!result.fallback) {
        const action = this.parseTacticalAction(result.text)
        if (action) {
          this.executeTacticalAction(action)
          this._state = 'executing'
          return
        }
      }
    } catch { /* fallback below */ }

    this._state = 'executing'
  }

  private parseTacticalAction(raw: string): TacticalAction | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return null
      const obj = JSON.parse(jsonMatch[0])
      const action = typeof obj.action === 'string' ? obj.action : ''
      const target = typeof obj.target === 'string' ? obj.target : ''
      const reason = typeof obj.reason === 'string' ? obj.reason : ''

      if (action === 'stay') return { type: 'stay' }
      if (action.startsWith('talk_to')) {
        const talkTarget = target || action.split(':')[1] || ''
        if (talkTarget) return { type: 'talk_to', target: talkTarget, reason }
      }
      if (action.startsWith('leave_to')) {
        const place = target || action.split(':')[1] || ''
        if (place) return { type: 'leave_to', place, reason }
      }
      if (action === 'go_home') return { type: 'go_home', reason }

      return null
    } catch {
      return null
    }
  }

  private executeTacticalAction(action: TacticalAction): void {
    switch (action.type) {
      case 'stay':
        this.stayTimer = 0
        break
      case 'talk_to':
        this.deps.onTalkTo(this.npcId, action.target, action.reason)
        break
      case 'leave_to':
        // Resolved by DailyBehavior through overriddenDestination
        this._overriddenDestination = this.resolvePlaceKey(action.place)
        break
      case 'go_home':
        this._overriddenDestination = '__home__'
        break
    }
  }

  // ── Destination override (consumed by DailyBehavior) ──

  private _overriddenDestination: string | null = null

  consumeOverriddenDestination(): string | null {
    const dest = this._overriddenDestination
    this._overriddenDestination = null
    return dest
  }

  // ── Helpers ──

  private resolvePlaceKey(nameOrKey: string): string | null {
    const direct = BUILDING_REGISTRY.find(b => b.key === nameOrKey)
    if (direct) return direct.key

    const byName = BUILDING_REGISTRY.find(b =>
      b.name === nameOrKey || nameOrKey.includes(b.name) || b.name.includes(nameOrKey)
    )
    if (byName) return byName.key

    const wpKey = nameOrKey.endsWith('_door') ? nameOrKey : `${nameOrKey}_door`
    if (WAYPOINTS[wpKey]) return wpKey

    return null
  }
}
