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
import { BUILDING_REGISTRY, getBuildingName, WAYPOINTS } from '../../types'
import type { GameClock } from '../GameClock'

export type AutonomyAction =
  | { type: 'stay'; reason: string }
  | { type: 'talk_to'; target: string; topic?: string; reason: string }
  | { type: 'leave_to'; place: string; reason: string }
  | { type: 'go_home'; reason: string }
  | { type: 'satisfy_need'; need: NeedKey; action: NeedAction }
  | { type: 'work_on'; project?: string; reason: string }
  | { type: 'rest'; duration: number; reason: string }
  | { type: 'explore'; target: string; reason: string }
  | { type: 'festival_join'; festival: string; reason: string }
  | { type: 'invite_guest'; target: string; reason: string }

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
  /** Recent memories (short-term) for context-aware decisions */
  recentMemories?: string[]
  /** Top relationships (npcId → sentiment) for social decisions */
  relationships?: Array<{ name: string; sentiment: number }>
  /** Issue 5: extra map info (sculptures / benches / props) for spatial awareness */
  extraMapInfo?: string
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
  /** Get recent memories for a citizen (short-term, for context-aware decisions) */
  getRecentMemories?: (npcId: string, limit?: number) => string[]
  /** Get top relationships for a citizen (name + sentiment) */
  getRelationships?: (npcId: string, limit?: number) => Array<{ name: string; sentiment: number }>
  /** Issue 5: get extra map info (sculptures / benches / props) for spatial awareness */
  getMapInfo?: () => string
}

export class AutonomyEngine {
  private deps: AutonomyDeps
  private lastDecisionTime: Map<string, number> = new Map()
  private l2IntervalMs: number
  private l2JitterMs: number
  /** Track when a citizen started chatting (npcId → timestamp ms). */
  private chatStartTime: Map<string, number> = new Map()
  /** Track who a citizen is chatting with (npcId → target name). */
  private chatTarget: Map<string, string> = new Map()
  /** Talk cooldown: npcId → timestamp until which talk_to is suppressed. */
  private talkCooldownUntil: Map<string, number> = new Map()
  /** Max chat duration in ms before forcing end (≈ 3 in-game minutes). */
  private readonly maxChatMs = 180_000
  /** Min chat duration in ms before considering ending (≈ 1 in-game minute). */
  private readonly minChatMs = 60_000
  /** Cooldown after ending a chat before starting a new one (ms). */
  private readonly talkCooldownMs = 120_000

  constructor(deps: AutonomyDeps, l2IntervalMs = 60_000, l2JitterMs = 20_000) {
    this.deps = deps
    this.l2IntervalMs = l2IntervalMs
    this.l2JitterMs = l2JitterMs
  }

  /** Mark that a citizen started chatting with target. */
  notifyChatStart(npcId: string, targetName: string): void {
    this.chatStartTime.set(npcId, Date.now())
    this.chatTarget.set(npcId, targetName)
  }

  /** Mark that a citizen ended their chat. */
  notifyChatEnd(npcId: string): void {
    this.chatStartTime.delete(npcId)
    this.chatTarget.delete(npcId)
    this.talkCooldownUntil.set(npcId, Date.now() + this.talkCooldownMs)
  }

  /** Check if a citizen is currently in a chat. */
  isChatting(npcId: string): boolean {
    return this.chatStartTime.has(npcId)
  }

  /**
   * Evaluate whether an ongoing chat should end based on:
   * - chat duration (must exceed minChatMs)
   * - sentiment toward chat partner
   * - current time period (dusk/night → end sooner)
   * - mood (low mood → shorter chats)
   * Returns true if the chat should end now.
   */
  private shouldEndChat(npcId: string, ctx: AutonomyContext): boolean {
    const start = this.chatStartTime.get(npcId)
    if (!start) return false
    const elapsed = Date.now() - start
    // Hard limit: force end after maxChatMs
    if (elapsed >= this.maxChatMs) return true
    // Must chat at least minChatMs before considering ending
    if (elapsed < this.minChatMs) return false

    // Score-based evaluation: higher score → more likely to end
    let endScore = 0
    // Duration factor: 0 at minChatMs, ~40 at maxChatMs
    endScore += (elapsed - this.minChatMs) / (this.maxChatMs - this.minChatMs) * 40

    // Sentiment: low/negative sentiment → end sooner
    const targetName = this.chatTarget.get(npcId)
    if (targetName && ctx.relationships) {
      const rel = ctx.relationships.find(r => r.name === targetName)
      if (rel) {
        // sentiment -100..100 → endScore contribution 30..-10
        endScore += (20 - rel.sentiment) * 0.2
      }
    }

    // Time period: dusk/night → end sooner (people go home)
    if (ctx.timePeriod === 'dusk' || ctx.timePeriod === 'night') {
      endScore += 25
    }
    // Noon: people are busy → end sooner
    if (ctx.timePeriod === 'noon') endScore += 10

    // Mood: low mood → shorter patience
    if (ctx.mood.value < 30) endScore += 15
    else if (ctx.mood.value > 70) endScore -= 10

    // Random factor to avoid deterministic behavior
    endScore += (Math.random() - 0.5) * 20

    return endScore >= 50
  }

  /** Check if a citizen is in talk cooldown. */
  private inTalkCooldown(npcId: string): boolean {
    const until = this.talkCooldownUntil.get(npcId)
    if (!until) return false
    if (Date.now() >= until) {
      this.talkCooldownUntil.delete(npcId)
      return false
    }
    return true
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
    // The mayor (user) is player-controlled — never make autonomous decisions.
    if (npcId === 'user') {
      return { type: 'stay', reason: '镇长由玩家控制' }
    }
    const ctx = this.buildContext(npcId, npcName)
    this.lastDecisionTime.set(npcId, Date.now())

    // ── Circadian rhythm: deterministic rules before LLM ──
    // Night (19:00–05:00): everyone goes home and stays in.
    if (ctx.timePeriod === 'night') {
      const indoorLoc = this.deps.indoorTracker.getIndoorLocation(ctx.npcId)
      const isHome = ctx.homeBuildingKey !== null && indoorLoc === ctx.homeBuildingKey
      if (!isHome) {
        return { type: 'go_home', reason: '夜深了，该回家休息了' }
      }
      // Already home — rest until morning
      return { type: 'rest', duration: 240, reason: '在家睡觉' }
    }
    // Dawn (05:00–07:00): if at home, go out for the day
    if (ctx.timePeriod === 'dawn') {
      const indoorLoc = this.deps.indoorTracker.getIndoorLocation(ctx.npcId)
      const isHome = ctx.homeBuildingKey !== null && indoorLoc === ctx.homeBuildingKey
      if (isHome) {
        // Pick a random non-home building to start the day
        const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
        if (buildings.length > 0) {
          const dest = buildings[Math.floor(Math.random() * buildings.length)]
          return { type: 'leave_to', place: dest.key, reason: '早上出门走走' }
        }
      }
    }

    // ── Issue 3: need-driven home visits during daytime ──
    // Citizens can decide to go home during the day based on needs:
    // - fatigue urgent → go home to rest
    // - hygiene urgent → go home to clean
    // - safety urgent (bad weather) → go home to shelter
    // - hunger urgent AND no cafe/market nearby → go home to eat
    if (ctx.homeBuildingKey && ctx.needs.urgent.length > 0) {
      // Use IndoorTracker to reliably check if citizen is at their own home
      const indoorLoc = this.deps.indoorTracker.getIndoorLocation(ctx.npcId)
      const isHome = indoorLoc === ctx.homeBuildingKey
      if (!isHome) {
        // Check if any urgent need is home-solvable
        const homeNeeds: NeedKey[] = ['fatigue', 'hygiene', 'safety']
        const urgentHomeNeeds = ctx.needs.urgent.filter(n => homeNeeds.includes(n))
        // Hunger is home-solvable only if no cafe/market available nearby
        if (ctx.needs.urgent.includes('hunger')) {
          const hasFoodNearby = BUILDING_REGISTRY.some(b =>
            b.tag === 'cafe' || b.tag === 'market')
          if (!hasFoodNearby) urgentHomeNeeds.push('hunger')
        }
        if (urgentHomeNeeds.length > 0) {
          // Pick the most urgent home-solvable need
          const lowest = urgentHomeNeeds.reduce((min, n) =>
            ctx.needs.needs[n] < ctx.needs.needs[min] ? n : min, urgentHomeNeeds[0])
          const reasonMap: Record<string, string> = {
            fatigue: '太累了，回家休息一下',
            hygiene: '需要洗漱，回家清洁一下',
            safety: '天气不好，回家躲避一下',
            hunger: '饿了，回家吃点东西',
          }
          return { type: 'go_home', reason: reasonMap[lowest] ?? '回家一趟' }
        }
      }
    }

    // ── Chat ending mechanism (issue 4): if currently chatting, evaluate whether to end ──
    if (this.isChatting(npcId)) {
      if (this.shouldEndChat(npcId, ctx)) {
        this.notifyChatEnd(npcId)
        // End chat → walk away to a different location
        const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
        if (buildings.length > 0) {
          const dest = buildings[Math.floor(Math.random() * buildings.length)]
          return { type: 'leave_to', place: dest.key, reason: '聊完了，去别处走走' }
        }
        return { type: 'stay', reason: '聊完了' }
      }
      // Still chatting — stay and continue
      return { type: 'stay', reason: '正在聊天中' }
    }

    // ── Anti-clustering (issue 5): if too many NPCs nearby, discourage talk_to ──
    const crowdThreshold = 3  // 3+ nearby NPCs = crowd
    const isCrowded = ctx.nearbyNpcs.length >= crowdThreshold

    // All other decisions go through the LLM with full context.
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
      '你的生活节奏：白天在镇上各处走动、办事、偶尔和路上遇到的人打招呼聊天；晚上回家睡觉。',
      '只有在行走中偶遇其他居民时，才会 talk_to 聊几句——不要刻意扎堆或一直找人聊天。',
      '大部分时间你应该在移动（leave_to 去不同地点）或停留做事（stay/work_on/rest）。',
      '如果附近没有人，就继续去下一个地点办事或散步。',
      '',
      '你可以做出以下决策：',
      '- stay：留在原地，做手头的事',
      '- talk_to：和路上偶遇的人聊几句（target=居民名，可带 topic=话题）',
      '- leave_to：前往其他地点散步/办事（target=地点英文 key）',
      '- go_home：回家',
      '- work_on：主动工作（project=项目名，可选）',
      '- rest：原地休息（duration=分钟数）',
      '- explore：探索新地点（target=地点名）',
      '- festival_join：参加节日活动（festival=节日名）',
      '- invite_guest：邀请某位居民到自己家做客（target=居民名），对方会来你家，两人都能恢复状态',
      '',
      '请输出一个 JSON 决策，格式：',
      '{"action":"决策类型","target":"目标名或地点","reason":"简短理由","topic":"话题(可选)","duration":分钟数(可选)","project":"项目名(可选)","festival":"节日名(可选)"}',
      '注意：action 只能是 stay、talk_to、leave_to、go_home、work_on、rest、explore、festival_join、invite_guest 之一。',
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
      lines.push('如果正好在路上碰到了，可以聊几句（talk_to）；否则继续去办事。')
    } else {
      lines.push('附近没有人，继续去下一个地点散步或办事（leave_to）')
    }
    // Inject recent memories for context-aware decisions
    if (ctx.recentMemories && ctx.recentMemories.length > 0) {
      lines.push('', '【近期记忆】')
      for (const mem of ctx.recentMemories) {
        lines.push(`- ${mem}`)
      }
    }
    // Inject relationships for social decisions
    if (ctx.relationships && ctx.relationships.length > 0) {
      lines.push('', '【人际关系】')
      for (const rel of ctx.relationships) {
        const sentimentLabel = rel.sentiment > 50 ? '亲密' : rel.sentiment > 20 ? '友好' : rel.sentiment > -20 ? '熟人' : '讨厌'
        lines.push(`- ${rel.name}：${sentimentLabel}（${rel.sentiment.toFixed(0)}）`)
      }
      const disliked = ctx.relationships.filter((r) => r.sentiment < -20)
      if (disliked.length > 0) {
        lines.push(`注意：你和 ${disliked.map((r) => r.name).join('、')} 关系不好，不要主动找他们聊天。`)
      }
    }
    if (ctx.currentPlan) {
      const currentItem = ctx.currentPlan.items[ctx.currentPlan.currentIndex]
      if (currentItem) {
        lines.push(`今日计划当前项：${currentItem.intent}（${currentItem.place}）`)
      }
    }
    // Provide available places list so LLM returns valid waypoint keys.
    // Issue 4/5: include coordinates + category so citizens know where each
    // place is (e.g. "中心广场" for gathering requests) and can reason about
    // the map spatially, not just pick a random building key.
    const buildingPlaces = BUILDING_REGISTRY.map(b => {
      const wp = (WAYPOINTS as Record<string, { x: number; z: number }>)[b.key]
      const coord = wp ? `(${wp.x},${wp.z})` : ''
      return `${getBuildingName(b.key)}[${b.category}]${coord}(${b.key})`
    })
    // Special landmarks (plaza / park / gathering point) — these are the
    // well-known social spots citizens should recognize by name.
    const landmarkPlaces: string[] = []
    const plazaWp = (WAYPOINTS as Record<string, { x: number; z: number }>).plaza_center
    if (plazaWp) landmarkPlaces.push(`中心广场[plaza](${plazaWp.x},${plazaWp.z})(plaza_center)`)
    const parkWp = (WAYPOINTS as Record<string, { x: number; z: number }>).park_center
    if (parkWp) landmarkPlaces.push(`公园[park](${parkWp.x},${parkWp.z})(park_center)`)
    const gatherWp = (WAYPOINTS as Record<string, { x: number; z: number }>).gathering_point
    if (gatherWp) landmarkPlaces.push(`集合点[plaza](${gatherWp.x},${gatherWp.z})(gathering_point)`)
    const roadWp = (WAYPOINTS as Record<string, { x: number; z: number }>).road_entrance
    if (roadWp) landmarkPlaces.push(`镇口[entrance](${roadWp.x},${roadWp.z})(road_entrance)`)
    // Issue 5: inject extra map info (sculptures / benches / props) if provided
    const extraMapInfo = ctx.extraMapInfo ? `\n${ctx.extraMapInfo}` : ''
    const places = [...landmarkPlaces, ...buildingPlaces].join('、')
    lines.push(`可前往的地点：${places}${extraMapInfo}`)
    lines.push('注意：leave_to 的 target 必须是上面括号内的英文 key 之一（如 plaza_center=中心广场、gathering_point=集合点、office_door=办公室）')
    lines.push('当有人喊"来中心广场/广场集合"时，请用 leave_to 前往 plaza_center 或 gathering_point。')
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
        case 'talk_to': {
          if (!target) break
          // Issue 4: talk cooldown — don't start a new chat right after ending one
          if (this.inTalkCooldown(ctx.npcId)) {
            const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
            if (buildings.length > 0) {
              const dest = buildings[Math.floor(Math.random() * buildings.length)]
              return { type: 'leave_to', place: dest.key, reason: '刚聊完，先去别处走走' }
            }
            return { type: 'stay', reason: '刚聊完，休息一下' }
          }
          // Issue 5: anti-clustering — if crowded, discourage talk_to
          if (ctx.nearbyNpcs.length >= 3 && Math.random() < 0.7) {
            const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
            if (buildings.length > 0) {
              const dest = buildings[Math.floor(Math.random() * buildings.length)]
              return { type: 'leave_to', place: dest.key, reason: '人太多了，去别处走走' }
            }
          }
          // Check sentiment toward the target — skip chat if dislike/enemy
          const allRels = this.deps.getRelationships?.(ctx.npcId, 100) ?? []
          const rel = allRels.find((r) => r.name === target)
          if (rel && rel.sentiment < -20) {
            // Dislike too much — don't talk, just walk away
            return { type: 'stay', reason: `不想和${target}说话` }
          }
          return { type: 'talk_to', target, topic: parsed.topic, reason: reason ?? '' }
        }
        case 'leave_to':
        case 'walk_to':  // LLM may return "walk_to" — treat as alias for leave_to
          if (target) return { type: 'leave_to', place: target, reason: reason ?? '' }
          break
        case 'go_home':
          return { type: 'go_home', reason: reason ?? '回家' }
        case 'work_on':
          return { type: 'work_on', project: parsed.project, reason: reason ?? '主动工作' }
        case 'rest':
          return { type: 'rest', duration: Number(parsed.duration ?? 30), reason: reason ?? '休息' }
        case 'explore':
          if (target) return { type: 'explore', target, reason: reason ?? '探索' }
          break
        case 'festival_join':
          return { type: 'festival_join', festival: parsed.festival ?? target ?? '', reason: reason ?? '参加节日' }
        case 'invite_guest': {
          // Issue 7: invite another citizen to host's home
          if (!target) break
          // Must have a home to invite someone
          if (!ctx.homeBuildingKey) {
            return { type: 'stay', reason: '没有家，无法邀请客人' }
          }
          // Don't invite if already at home
          const indoorLoc = this.deps.indoorTracker.getIndoorLocation(ctx.npcId)
          if (indoorLoc === ctx.homeBuildingKey) {
            return { type: 'stay', reason: '已经在家了' }
          }
          // Check sentiment — only invite friends/neutral
          const allRels = this.deps.getRelationships?.(ctx.npcId, 100) ?? []
          const rel = allRels.find((r) => r.name === target)
          if (rel && rel.sentiment < 0) {
            return { type: 'stay', reason: `和${target}关系不够好，不邀请` }
          }
          return { type: 'invite_guest', target, reason: reason ?? `邀请${target}来家里做客` }
        }
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
    // 2. Issue 5: anti-clustering — if 3+ nearby NPCs, strongly prefer walking away
    if (ctx.nearbyNpcs.length >= 3) {
      const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
      if (buildings.length > 0) {
        const dest = buildings[Math.floor(Math.random() * buildings.length)]
        return { type: 'leave_to', place: dest.key, reason: '人太多了，去别处走走' }
      }
    }
    // 3. If there are nearby NPCs, occasionally talk (low probability — walking takes priority)
    //    Skip NPCs we dislike (sentiment < -20) and respect talk cooldown (issue 4)
    if (ctx.nearbyNpcs.length > 0 && ctx.nearbyNpcs.length < 3 && !this.inTalkCooldown(ctx.npcId) && Math.random() < 0.25) {
      const allRels = this.deps.getRelationships?.(ctx.npcId, 100) ?? []
      const liked = ctx.nearbyNpcs.filter((n) => {
        const rel = allRels.find((r) => r.name === n.name)
        return !rel || rel.sentiment >= -20  // no relationship yet or not disliked
      })
      if (liked.length > 0) {
        const target = liked[Math.floor(Math.random() * liked.length)]
        return { type: 'talk_to', target: target.name, reason: '路上碰到了，聊两句' }
      }
    }
    // 4. Most of the time, walk to a random building (keep citizens moving)
    const buildings = BUILDING_REGISTRY.filter(b => b.key !== ctx.homeBuildingKey)
    if (buildings.length > 0 && Math.random() < 0.75) {
      const dest = buildings[Math.floor(Math.random() * buildings.length)]
      return { type: 'leave_to', place: dest.key, reason: '出去走走' }
    }
    // 5. Last resort: go home
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

    // Inject recent memories and relationships for context-aware decisions
    const recentMemories = this.deps.getRecentMemories?.(npcId, 5) ?? []
    const relationships = this.deps.getRelationships?.(npcId, 3) ?? []
    // Issue 5: extra map info (sculptures / benches / props)
    const extraMapInfo = this.deps.getMapInfo?.()

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
      recentMemories,
      relationships,
      extraMapInfo,
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
