// @desc Daily behavior scheduling, AgentBrain integration, and nightly routine orchestration
import { DailyBehavior, generateRouteProfile } from '../npc/DailyBehavior'
import { ActivityJournal } from '../npc/ActivityJournal'
import { AgentBrain } from '../npc/AgentBrain'
import { SpotAllocator } from '../npc/SpotAllocator'
import type { NPC } from '../npc/NPC'
import type { NPCManager } from '../npc/NPCManager'
import type { EncounterManager } from '../npc/EncounterManager'
import type { PersonaStore } from '../npc/PersonaStore'
import type { TownJournal } from '../npc/TownJournal'
import type { GameClock } from './GameClock'
import { WAYPOINTS } from '../types'

export interface DailySchedulerDeps {
  npcManager: NPCManager
  gameClock: GameClock
  encounterManager: EncounterManager
  personaStore: PersonaStore
  getTownJournal: () => TownJournal
  getCurrentSceneType: () => string
  getNpcSpecialty?: (npcId: string) => string | undefined
  getAgentIdForNpc?: (npcId: string) => string | undefined
}

export class DailyScheduler {
  private dailyBehaviors = new Map<string, DailyBehavior>()
  private activityJournals = new Map<string, ActivityJournal>()
  private agentBrains = new Map<string, AgentBrain>()
  private dailyBehaviorStartTimer: ReturnType<typeof setTimeout> | null = null
  private dailyBehaviorEligibleNpcIds = new Set<string>()
  private spotAllocator = new SpotAllocator()
  private _implicitChatFn: ((req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }) => Promise<{ text: string; fallback: boolean }>) | null = null

  private deps: DailySchedulerDeps

  constructor(deps: DailySchedulerDeps) {
    this.deps = deps
  }

  getDailyBehaviors(): Map<string, DailyBehavior> { return this.dailyBehaviors }
  getActivityJournals(): Map<string, ActivityJournal> { return this.activityJournals }
  getAgentBrains(): Map<string, AgentBrain> { return this.agentBrains }
  getEligibleNpcIds(): Set<string> { return this.dailyBehaviorEligibleNpcIds }

  setImplicitChatFn(fn: typeof this._implicitChatFn): void {
    this._implicitChatFn = fn
  }

  getImplicitChatFn() { return this._implicitChatFn }

  private _soulModeEnabled = true
  private _savedImplicitChatFn: typeof this._implicitChatFn = null

  enableSoulMode(): void {
    this._soulModeEnabled = true
    if (this._savedImplicitChatFn) {
      this._implicitChatFn = this._savedImplicitChatFn
    }
  }

  disableSoulMode(): void {
    this._soulModeEnabled = false
    this._savedImplicitChatFn = this._implicitChatFn
    this._implicitChatFn = null
  }

  isSoulModeEnabled(): boolean { return this._soulModeEnabled }

  addEligibleNpcId(id: string): void {
    this.dailyBehaviorEligibleNpcIds.add(id)
  }

  removeEligibleNpcId(id: string): void {
    this.dailyBehaviorEligibleNpcIds.delete(id)
  }

  getBestDailyBehaviorHome(npc: NPC): string {
    const homeOptions: Array<{ key: string; x: number; z: number }> = [
      { key: 'cafe_door', x: WAYPOINTS.cafe_door.x, z: WAYPOINTS.cafe_door.z },
      { key: 'house_a_door', x: WAYPOINTS.house_a_door.x, z: WAYPOINTS.house_a_door.z },
      { key: 'house_b_door', x: WAYPOINTS.house_b_door.x, z: WAYPOINTS.house_b_door.z },
      { key: 'house_c_door', x: WAYPOINTS.house_c_door.x, z: WAYPOINTS.house_c_door.z },
      { key: 'market_door', x: WAYPOINTS.market_door.x, z: WAYPOINTS.market_door.z },
      { key: 'museum_door', x: WAYPOINTS.museum_door.x, z: WAYPOINTS.museum_door.z },
      { key: 'user_home_door', x: WAYPOINTS.user_home_door.x, z: WAYPOINTS.user_home_door.z },
    ]

    const pos = npc.getPosition()
    let bestHome = homeOptions[0]
    let bestDistSq = Number.POSITIVE_INFINITY
    for (const h of homeOptions) {
      const dx = h.x - pos.x
      const dz = h.z - pos.z
      const d2 = dx * dx + dz * dz
      if (d2 < bestDistSq) {
        bestDistSq = d2
        bestHome = h
      }
    }
    return bestHome.key
  }

  startDailyBehaviors(): void {
    if (this.deps.getCurrentSceneType() !== 'town') return
    const workers = this.deps.npcManager
      .getWorkers()
      .filter((npc) => this.dailyBehaviorEligibleNpcIds.has(npc.id))

    if (workers.length === 0) {
      for (const behavior of this.dailyBehaviors.values()) behavior.stop()
      this.dailyBehaviors.clear()
      return
    }

    const workerIds = new Set(workers.map((npc) => npc.id))
    for (const [npcId, behavior] of this.dailyBehaviors.entries()) {
      if (workerIds.has(npcId)) continue
      behavior.stop()
      this.dailyBehaviors.delete(npcId)
    }

    workers.forEach((npc, i) => {
      if (this.dailyBehaviors.has(npc.id)) return
      this.createAndStartBehavior(npc, 2000 + i * (2000 + Math.floor(Math.random() * 2000)))
    })
  }

  stopBehaviorForNpcs(npcIds: string[]): void {
    for (const id of npcIds) {
      const behavior = this.dailyBehaviors.get(id)
      if (behavior) {
        behavior.stop()
        this.dailyBehaviors.delete(id)
      }
      this.agentBrains.delete(id)
    }
  }

  startBehaviorForNpc(npcId: string): void {
    if (this.dailyBehaviors.has(npcId)) return
    if (!this.dailyBehaviorEligibleNpcIds.has(npcId)) return
    const npc = this.deps.npcManager.get(npcId)
    if (!npc) return
    this.createAndStartBehavior(npc, 500, true)
  }

  private createAndStartBehavior(npc: NPC, delayMs: number, resumeFromCurrentPosition = false): void {
    const homeKey = this.getBestDailyBehaviorHome(npc)
    const specialty = this.deps.getNpcSpecialty?.(npc.id) ?? this.deps.personaStore.get(npc.id)?.specialty
    const profile = generateRouteProfile(npc.id, homeKey, specialty)
    const behavior = new DailyBehavior(npc, this.deps.gameClock, profile, this.spotAllocator)

    let journal = this.activityJournals.get(npc.id)
    if (!journal) {
      journal = new ActivityJournal(npc.id, npc.label ?? npc.id, this.deps.gameClock)
      this.activityJournals.set(npc.id, journal)
    }
    behavior.setJournal(journal)

    if (npc.id !== 'steward' && !this.agentBrains.has(npc.id)) {
      const persona = this.deps.personaStore.get(npc.id)
      const brain = new AgentBrain(npc, this.deps.gameClock, journal, persona, {
        implicitChat: this.implicitChatForBrain.bind(this),
        getNearbyNpcs: this.getNearbyNpcsForBrain.bind(this),
        getTownRecent: () => this.deps.getTownJournal().getRecentDescriptions(5),
        onTalkTo: (initiatorId, targetName, reason) => {
          this.onBrainTalkTo(initiatorId, targetName, reason)
        },
      })
      behavior.setAgentBrain(brain)
      brain.start()
      this.agentBrains.set(npc.id, brain)
    }

    this.dailyBehaviors.set(npc.id, behavior)
    if (resumeFromCurrentPosition) {
      behavior.resumeFromCurrentPosition()
    } else {
      behavior.start(delayMs)
    }
  }

  stopDailyBehaviors(): void {
    if (this.dailyBehaviorStartTimer) {
      clearTimeout(this.dailyBehaviorStartTimer)
      this.dailyBehaviorStartTimer = null
    }
    for (const behavior of this.dailyBehaviors.values()) behavior.stop()
    this.dailyBehaviors.clear()
    this.agentBrains.clear()
  }

  scheduleStartDailyBehaviors(delayMs: number): void {
    if (this.dailyBehaviorStartTimer) {
      clearTimeout(this.dailyBehaviorStartTimer)
    }
    this.dailyBehaviorStartTimer = setTimeout(() => {
      this.dailyBehaviorStartTimer = null
      this.startDailyBehaviors()
    }, delayMs)
  }

  async implicitChatForBrain(req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string
  }): Promise<{ text: string; fallback: boolean }> {
    if (!this._implicitChatFn) return { text: '', fallback: true }
    let agentId: string | undefined
    if (req.npcId && this.deps.getAgentIdForNpc) {
      agentId = this.deps.getAgentIdForNpc(req.npcId)
    }
    return this._implicitChatFn({ ...req, ...(agentId ? { agentId } : {}) })
  }

  getNearbyNpcsForBrain(npcId: string, radius: number): Array<{ npcId: string; name: string; distance: number }> {
    const npc = this.deps.npcManager?.get(npcId)
    if (!npc) return []
    const allNpcs = this.deps.npcManager?.getAll() ?? []
    const result: Array<{ npcId: string; name: string; distance: number }> = []
    for (const other of allNpcs) {
      if (other.id === npcId || other.id === 'steward' || other.id === 'user') continue
      if (this.deps.encounterManager && this.deps.encounterManager.getActiveDialogueCount() > 0) continue
      const dist = npc.getPosition().distanceTo(other.getPosition())
      if (dist < radius) {
        result.push({ npcId: other.id, name: other.label ?? other.id, distance: dist })
      }
    }
    return result.sort((a, b) => a.distance - b.distance)
  }

  onBrainTalkTo(initiatorId: string, targetName: string, reason: string): void {
    const allNpcs = this.deps.npcManager?.getAll() ?? []
    const target = allNpcs.find(n => (n.label ?? n.id) === targetName || n.id === targetName)
    if (!target) return
    const initiator = this.deps.npcManager?.get(initiatorId)
    if (!initiator) return
    this.deps.encounterManager?.requestEncounter(initiator, target, reason)
  }

  async triggerNightlyRoutine(): Promise<void> {
    if (!this._implicitChatFn) return

    const citizens: Array<{
      npcId: string
      name: string
      persona?: { coreSummary: string; speakingStyle?: string }
      journal: ActivityJournal
    }> = []

    for (const [npcId, journal] of this.activityJournals) {
      if (npcId === 'steward') continue
      const npc = this.deps.npcManager?.get(npcId)
      if (!npc) continue
      const persona = this.deps.personaStore.get(npcId)
      citizens.push({
        npcId,
        name: npc.label ?? npcId,
        persona: persona ? { coreSummary: persona.coreSummary, speakingStyle: persona.speakingStyle } : undefined,
        journal,
      })
    }

    if (citizens.length > 0) {
      await this.deps.getTownJournal().runNightlyReflections(citizens)
    }
  }

  async dialogueProviderImpl(opts: {
    scene: 'encounter_init' | 'encounter_reply' | 'dialogue_summary'
    speaker: { id: string; name: string; persona?: any }
    listener: { id: string; name: string }
    journalContext?: object
    conversationSoFar: Array<{ speaker: string; text: string }>
    turnNumber: number
    maxTurns: number
    tacticalReason?: string
  }): Promise<string> {
    if (!this._implicitChatFn) {
      return ''
    }

    if (opts.scene === 'dialogue_summary') {
      const transcript = opts.conversationSoFar.map(t => `${t.speaker}: ${t.text}`).join('\n')
      const result = await this._implicitChatFn({
        scene: 'dialogue_summary',
        system: '用一句简短的话总结这段对话的主题和内容，20字以内。只输出总结。',
        user: transcript,
      })
      return result.text
    }

    const persona = opts.speaker.persona
    const name = persona?.name ?? opts.speaker.name
    let system: string

    if (opts.scene === 'encounter_init') {
      system = [
        `你是${name}。${persona?.coreSummary ?? ''}`,
        `现在是${this.deps.gameClock?.getFormattedTime() ?? '白天'}。你主动找${opts.listener.name}搭话。`,
        opts.tacticalReason ? `你的动机：${opts.tacticalReason}` : '',
        `请打个招呼或提起话题。1句话，20字以内。只输出对话内容。`,
      ].filter(Boolean).join('\n')
    } else {
      system = [
        `你是${name}。${persona?.coreSummary ?? ''}`,
        persona?.speakingStyle ? `说话风格：${persona.speakingStyle}` : '',
        `继续对话。1句话，20字以内。如果聊完了加[END]。只输出对话内容。`,
      ].filter(Boolean).join('\n')
    }

    const user = opts.scene === 'encounter_init'
      ? '打招呼'
      : JSON.stringify({
          conversation_so_far: opts.conversationSoFar,
          turn_number: opts.turnNumber,
          max_turns: opts.maxTurns,
        })

    const result = await this._implicitChatFn({
      scene: opts.scene,
      system,
      user,
      extraStop: ['[END]'],
      npcId: opts.speaker.id,
      ...(this.deps.getAgentIdForNpc?.(opts.speaker.id) ? { agentId: this.deps.getAgentIdForNpc!(opts.speaker.id) } : {}),
    })

    return result.text
  }

  removeNpc(npcId: string): void {
    this.dailyBehaviorEligibleNpcIds.delete(npcId)
    this.activityJournals.delete(npcId)
    this.agentBrains.delete(npcId)
    const dailyBehavior = this.dailyBehaviors.get(npcId)
    if (dailyBehavior) {
      dailyBehavior.stop()
      this.dailyBehaviors.delete(npcId)
    }
  }
}
