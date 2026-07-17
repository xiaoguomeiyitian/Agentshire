/**
 * AutonomyEngine — LLM-driven autonomous decision core for Animal Mode.
 *
 * Integrates:
 *   - NeedsEngine  (what the citizen lacks)
 *   - MoodEngine   (how the citizen feels)
 *   - RulesEngine   (town rules injected into LLM prompt)
 *   - NeedActionMapper (need -> concrete action)
 *   - IndoorTracker (who is indoors)
 *
 * L2 tactical decision loop (per citizen, every l2IntervalMs ± jitter):
 *   1. Gather context: time, weather, needs snapshot, mood, nearby NPCs, current location
 *   2. If a need is urgent -> skip LLM, directly resolve via NeedActionMapper (fast path)
 *   3. Otherwise -> call LLM (autonomy_decide scene) with rules + context
 *   4. Parse LLM output: stay / talk_to / leave_to / go_home
 *   5. Execute the decision (walk, talk, go indoor, etc.)
 *
 * L1 daily plan (at dawn):
 *   - Call LLM (daily_plan scene) to generate 3-5 plan items
 *   - Plan items influence L2 decisions (injected into prompt)
 */

import type { NeedsEngine, NeedsSnapshot, NeedKey } from './NeedsEngine'
import type { MoodEngine, MoodState } from './MoodEngine'
import type { RulesEngine } from './RulesEngine'
import type { NeedActionMapper, NeedAction } from './NeedActionMapper'
import type { MoodAnimator } from './MoodAnimator'
import type { IndoorTracker } from './IndoorTracker'
import type { TimePeriod, DailyPlan, DailyPlanItem } from '../../types'
import { BUILDING_REGISTRY, getBuildingName } from '../../types'
import type { GameClock } from '../GameClock'

export type AutonomyAction =
  | { type: 'stay'; reason: string }
  | { type: 'talk_to'; target: string; reason: string }
  | { type: 'leave_to'; place: string; reason: string }
  | { type: 'go_home'; reason: string }
  | { type: 'satisfy_need'; need: NeedKey; action: NeedAction }

export interface AutonomyContext {
  npcId: string
  npcName: string
  persona: string
  homeBuildingKey: string | null
  currentLocation: string
  timePeriod: TimePeriod
  weather: string
  needs: NeedsSnapshot
  mood: MoodState
  nearbyNpcs: Array<{ npcId: string; name: string; distance: number }>
  currentPlan: DailyPlan | null
}

export interface AutonomyDeps {
  needsEngine: NeedsEngine
  moodEngine: MoodEngine
  rulesEngine: RulesEngine
  needActionMapper: NeedActionMapper
  moodAnimator: MoodAnimator
  indoorTracker: IndoorTracker
  gameClock: GameClock
  implicitChat: (req: {
    scene: string
    system: string
    user: string
    maxTokens?: number
    npcId?: string
  }) => Promise<{ text: string; fallback: boolean }>
  getNearbyNpcs: (npcId: string, radius: number) => Array<{ npcId: string; name: string; distance: number }>
  getWeather: () => string
  getCurrentLocation: (npcId: string) => string
  getPersona: (npcId: string) => string
  getHomeBuilding: (npcId: string) => string | null
  getCurrentPlan: (npcId: string) => DailyPlan | null
  onAction: (npcId: string, action: AutonomyAction) => void
}

export class AutonomyEngine {
  private deps: AutonomyDeps
  private lastDecisionTime: Map<string, number> = new Map()
  private l2IntervalMs: number
  private l2JitterMs: number

  constructor(deps: AutonomyDeps, l2IntervalMs = 60_000, l2JitterMs = 20_000) {
    this.deps = deps
    this.l2IntervalMs = l2IntervalMs
    this.l2JitterMs = l2JitterMs
  }

  /** Check if a citizen is due for an L2 decision. */
  isDueForDecision(npcId: string, now: number): boolean {
    // Never decided -> always due
    if (!this.lastDecisionTime.has(npcId)) return true
    const last = this.lastDecisionTime.get(npcId)!
    const interval = this.l2IntervalMs + (Math.random() - 0.5) * 2 * this.l2JitterMs
    return (now - last) >= interval
  }

  /** Run an L2 tactical decision for a citizen. */
  async decide(npcId: string, npcName: string): Promise<AutonomyAction> {
    const ctx = this.buildContext(npcId, npcName)
    this.lastDecisionTime.set(npcId, Date.now())

    // All decisions go through the LLM — no fast path bypass.
    // The LLM receives the full context (including urgent needs) and decides.
    const system = this.buildSystemPrompt(ctx)
    const user = this.buildUserPrompt(ctx)
    const result = await this.deps.implicitChat({
      scene: 'autonomy_decide',
      system,
      user,
      maxTokens: 100,
      npcId,
    })

    const parsed = this.parseDecision(result.text, ctx)
    return parsed
  }

  /** Build the LLM system prompt with rules + persona + mood. */
  private buildSystemPrompt(ctx: AutonomyContext): string {
    const rulesFragment = this.deps.rulesEngine.getRules()
    const moodFragment = this.deps.moodAnimator.buildPromptFragment(ctx.mood.level, ctx.mood.value)
    return [
      `你是小镇居民「${ctx.npcName}」，性格：${ctx.persona}`,
      '',
      moodFragment,
      '',
      '你必须遵守以下小镇规则：',
      '---',
      rulesFragment,
      '---',
      '',
      '你是一个有社交需求的居民，不要总是一个人待着或漫无目的地走动。',
      '如果附近有其他居民，优先考虑 talk_to 去找他们聊天、交流近况、分享想法。',
      '只有在需要满足生理需求（吃饭、休息等）或确实想换个地点时，才选择 leave_to 或 go_home。',
      '不要频繁走动，停留和交流才是生活的主旋律。',
      '',
      '请输出一个 JSON 决策，格式：',
      '{"action":"stay|talk_to|leave_to|go_home","target":"目标名或地点","reason":"简短理由"}',
      '注意：action 只能是 stay、talk_to、leave_to、go_home 之一，不要使用其他值。',
    ].join('\n')
  }

  /** Build the user prompt with current context. */
  private buildUserPrompt(ctx: AutonomyContext): string {
    const lines: string[] = [
      `当前时间：${ctx.timePeriod}时段`,
      `当前天气：${ctx.weather}`,
      `当前位置：${ctx.currentLocation}`,
      `最迫切的需求：${ctx.needs.lowest}（值 ${ctx.needs.needs[ctx.needs.lowest].toFixed(0)}/100）`,
      `心情：${ctx.mood.level}（${ctx.mood.value.toFixed(0)}）`,
    ]
    if (ctx.nearbyNpcs.length > 0) {
      lines.push(`附近的人：${ctx.nearbyNpcs.map((n) => `${n.name}(${n.distance.toFixed(1)}m)`).join('、')}`)
      lines.push('附近有居民，可以考虑去找他们聊聊天！')
    } else {
      lines.push('附近没有人，如果觉得孤单可以去别处走走（leave_to）或回家（go_home）')
    }
    if (ctx.currentPlan) {
      const currentItem = ctx.currentPlan.items[ctx.currentPlan.currentIndex]
      if (currentItem) {
        lines.push(`今日计划当前项：${currentItem.intent}（${currentItem.place}）`)
      }
    }
    // Provide available places list so LLM returns valid waypoint keys
    const places = BUILDING_REGISTRY.map(b => `${getBuildingName(b.key)}(${b.key})`).join('、')
    lines.push(`可前往的地点：${places}`)
    lines.push('注意：leave_to 的 target 必须是上面括号内的英文 key 之一')
    lines.push('', '请做出决策：')
    return lines.join('\n')
  }

  /** Parse LLM decision output, with fallback. */
  private parseDecision(text: string, ctx: AutonomyContext): AutonomyAction {
    try {
      // Extract JSON from text
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('no JSON')
      const parsed = JSON.parse(jsonMatch[0])
      const action = parsed.action as string
      const target = parsed.target as string | undefined
      const reason = parsed.reason as string | undefined

      switch (action) {
        case 'talk_to':
          if (target) return { type: 'talk_to', target, reason: reason ?? '' }
          break
        case 'leave_to':
        case 'walk_to':  // LLM may return "walk_to" — treat as alias for leave_to
          if (target) return { type: 'leave_to', place: target, reason: reason ?? '' }
          break
        case 'go_home':
          return { type: 'go_home', reason: reason ?? '回家' }
        case 'stay':
        default:
          return { type: 'stay', reason: reason ?? '停留' }
      }
    } catch {
      // Fallback below
    }
    // Fallback: don't just stand still — pick a meaningful action so citizens keep moving.
    return this.fallbackAction(ctx)
  }

  /** Pick a fallback action when the LLM fails or returns unparseable output. */
  private fallbackAction(ctx: AutonomyContext): AutonomyAction {
    // 1. If a need is urgent, satisfy it directly via NeedActionMapper (no LLM)
    for (const need of ctx.needs.urgent) {
      const action = this.deps.needActionMapper.resolveAction(need as NeedKey, ctx.homeBuildingKey)
      if (action) {
        return { type: 'satisfy_need', need: need as NeedKey, action }
      }
    }
    // 2. If there are nearby NPCs, talk to one of them
    if (ctx.nearbyNpcs.length > 0 && Math.random() < 0.5) {
      const target = ctx.nearbyNpcs[Math.floor(Math.random() * ctx.nearbyNpcs.length)]
      return { type: 'talk_to', target: target.name, reason: '想聊聊天' }
    }
    // 3. Otherwise, walk to a random building (keep citizens moving)
    const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
    if (buildings.length > 0 && Math.random() < 0.6) {
      const dest = buildings[Math.floor(Math.random() * buildings.length)]
      return { type: 'leave_to', place: dest.key, reason: '出去走走' }
    }
    // 4. Last resort: go home
    if (ctx.homeBuildingKey) {
      return { type: 'go_home', reason: '回家' }
    }
    return { type: 'stay', reason: 'fallback' }
  }

  /** Build the context object for a citizen. */
  private buildContext(npcId: string, npcName: string): AutonomyContext {
    const needs = this.deps.needsEngine.getSnapshot(npcId)
    if (!needs) {
      throw new Error(`Citizen ${npcId} not registered in NeedsEngine`)
    }
    const mood = this.deps.moodEngine.compute(npcId, this.deps.needsEngine)
    const persona = this.deps.getPersona(npcId) ?? '普通居民'
    const homeBuildingKey = this.deps.getHomeBuilding(npcId)
    const currentLocation = this.deps.getCurrentLocation(npcId)
    const timePeriod = this.deps.gameClock.getPeriod()
    const weather = this.deps.getWeather()
    const nearbyNpcs = this.deps.getNearbyNpcs(npcId, 5)
    const currentPlan = this.deps.getCurrentPlan(npcId)

    return {
      npcId,
      npcName,
      persona,
      homeBuildingKey,
      currentLocation,
      timePeriod,
      weather,
      needs,
      mood,
      nearbyNpcs,
      currentPlan,
    }
  }

  /** Reset decision timer for a citizen (e.g., after an action). */
  resetTimer(npcId: string): void {
    this.lastDecisionTime.delete(npcId)
  }

  /** Clear all timers. */
  clear(): void {
    this.lastDecisionTime.clear()
  }
}
