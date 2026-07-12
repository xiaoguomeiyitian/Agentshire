import type { NPC } from './NPC'
import type { GameClock } from '../game/GameClock'
import type { ActivityJournal } from './ActivityJournal'
import type { DailyBehavior } from './DailyBehavior'
import type { PersonaCache, PersonaStore } from './PersonaStore'
import { getLocale } from '../i18n'

const FALLBACK_INIT_ZH = ['嗨，好久不见！', '哟，你也在这啊', '今天天气不错呢', '最近怎么样？', '嘿！在忙啥呢？']
const FALLBACK_REPLY_ZH = ['是呀！', '哈哈对', '嗯嗯', '说得也是', '可不是嘛', '哈哈，你说得对']
const FAREWELL_PHRASES_ZH = ['回见~', '下次聊~', '先走了！', '拜拜~']

const FALLBACK_INIT_EN = ['Hey, long time!', 'Oh, you\'re here too', 'Nice day, huh?', 'How\'s it going?', 'Hey! What\'s up?']
const FALLBACK_REPLY_EN = ['Yeah!', 'Haha right', 'Mhm', 'True that', 'Exactly', 'Haha, you said it']
const FAREWELL_PHRASES_EN = ['See ya~', 'Chat later~', 'Gotta go!', 'Bye~']

function getFallbackInit() { return getLocale() === 'en' ? FALLBACK_INIT_EN : FALLBACK_INIT_ZH }
function getFallbackReply() { return getLocale() === 'en' ? FALLBACK_REPLY_EN : FALLBACK_REPLY_ZH }
function getFarewellPhrases() { return getLocale() === 'en' ? FAREWELL_PHRASES_EN : FAREWELL_PHRASES_ZH }

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ── Types ──

export type DialogueProvider = (opts: {
  scene: 'encounter_init' | 'encounter_reply' | 'dialogue_summary'
  speaker: { id: string; name: string; persona?: PersonaCache }
  listener: { id: string; name: string }
  journalContext?: object
  conversationSoFar: Array<{ speaker: string; text: string }>
  turnNumber: number
  maxTurns: number
  /** For encounter_init from AgentBrain L2 decision */
  tacticalReason?: string
}) => Promise<string>

interface ActiveDialogue {
  initiator: NPC
  responder: NPC
  turns: Array<{ speaker: string; text: string }>
  maxTurns: number
  currentTurn: number
  phase: 'initiator_speaking' | 'responder_speaking' | 'ending'
  tacticalReason?: string
}

interface CooldownState {
  global: number
  pairCooldowns: Map<string, number>
  dialogueCount: number
}

const MAX_DIALOGUES_PER_CYCLE = 3
const MAX_CONCURRENT_DIALOGUES = 2
const GLOBAL_COOLDOWN_RANGE: [number, number] = [45_000, 90_000]
const PAIR_COOLDOWN_RANGE: [number, number] = [180_000, 300_000]
const BUBBLE_MS_PER_CHAR = 120
const BUBBLE_MIN_MS = 2000

export class EncounterManager {
  private activeDialogues: ActiveDialogue[] = []
  private cooldowns = new Map<string, CooldownState>()
  private excludedNpcs = new Set<string>()

  private dialogueProvider: DialogueProvider | null = null

  private personaStore: PersonaStore | null = null
  private onBubble: ((npc: NPC, text: string, durationMs: number) => void) | null = null
  private onBubbleEnd: ((npc: NPC) => void) | null = null
  private getJournal: ((npcId: string) => ActivityJournal | undefined) | null = null
  private getBehavior: ((npcId: string) => DailyBehavior | undefined) | null = null
  private onDialogueComplete: ((initiatorId: string, responderId: string, turns: Array<{ speaker: string; text: string }>, summary: string) => void) | null = null

  constructor(_gameClock: GameClock) {
  }

  setDialogueProvider(provider: DialogueProvider): void {
    this.dialogueProvider = provider
  }

  setOnBubble(cb: (npc: NPC, text: string, durationMs: number) => void): void {
    this.onBubble = cb
  }

  setOnBubbleEnd(cb: (npc: NPC) => void): void {
    this.onBubbleEnd = cb
  }

  setJournalAccessor(fn: (npcId: string) => ActivityJournal | undefined): void {
    this.getJournal = fn
  }

  setBehaviorAccessor(fn: (npcId: string) => DailyBehavior | undefined): void {
    this.getBehavior = fn
  }

  setPersonaStore(store: PersonaStore): void {
    this.personaStore = store
  }

  setExcludedNpcs(ids: Set<string>): void {
    this.excludedNpcs = ids
  }

  setOnDialogueComplete(cb: (initiatorId: string, responderId: string, turns: Array<{ speaker: string; text: string }>, summary: string) => void): void {
    this.onDialogueComplete = cb
  }

  /**
   * Tick cooldowns. Active scanning has been removed —
   * dialogues are now triggered externally via requestEncounter().
   */
  update(dtMs: number, _npcs: NPC[]): void {
    for (const [, cd] of this.cooldowns) {
      cd.global = Math.max(0, cd.global - dtMs)
      for (const [pairId, t] of cd.pairCooldowns) {
        const next = t - dtMs
        if (next <= 0) cd.pairCooldowns.delete(pairId)
        else cd.pairCooldowns.set(pairId, next)
      }
    }
  }

  /**
   * External request to start an encounter (from AgentBrain L2 talk_to decision).
   * Respects cooldowns and concurrent limits; silently skipped if not possible.
   */
  requestEncounter(initiator: NPC, responder: NPC, reason?: string): void {
    if (this.activeDialogues.length >= MAX_CONCURRENT_DIALOGUES) return
    if (this.isInDialogue(initiator.id) || this.isInDialogue(responder.id)) return
    if (!this.canChat(initiator.id) || !this.canChat(responder.id)) return
    if (!this.canChatPair(initiator.id, responder.id)) return
    if (this.excludedNpcs.has(initiator.id) || this.excludedNpcs.has(responder.id)) return
    if (!this.isEligibleState(initiator.id) || !this.isEligibleState(responder.id)) return
    this.startDialogue(initiator, responder, reason)
  }

  // ── Checks ──

  private canChat(npcId: string): boolean {
    const cd = this.cooldowns.get(npcId)
    if (!cd) return true
    if (cd.global > 0) return false
    if (cd.dialogueCount >= MAX_DIALOGUES_PER_CYCLE) return false
    return true
  }

  private canChatPair(aId: string, bId: string): boolean {
    const cdA = this.cooldowns.get(aId)
    const cdB = this.cooldowns.get(bId)
    if (cdA?.pairCooldowns.get(bId)) return false
    if (cdB?.pairCooldowns.get(aId)) return false
    return true
  }

  private isInDialogue(npcId: string): boolean {
    return this.activeDialogues.some(
      d => d.initiator.id === npcId || d.responder.id === npcId,
    )
  }

  private isEligibleState(npcId: string): boolean {
    const behavior = this.getBehavior?.(npcId)
    if (!behavior) return false
    if (behavior.inDialogue) return false
    const s = behavior.getState()
    return s === 'roaming' || s === 'at_building'
  }

  // ── Dialogue orchestration ──

  private async startDialogue(a: NPC, b: NPC, reason?: string): Promise<void> {
    const maxTurns = Math.floor(randRange(3, 6))

    const dialogue: ActiveDialogue = {
      initiator: a,
      responder: b,
      turns: [],
      maxTurns,
      currentTurn: 0,
      phase: 'initiator_speaking',
      tacticalReason: reason,
    }
    this.activeDialogues.push(dialogue)

    this.pauseNpcForDialogue(a, b)

    const dist = a.getPosition().distanceTo(b.getPosition())
    if (dist > 2.5) {
      const bPos = b.getPosition()
      const aPos = a.getPosition()
      const dx = bPos.x - aPos.x
      const dz = bPos.z - aPos.z
      const d = Math.sqrt(dx * dx + dz * dz)
      const approachTarget = {
        x: bPos.x - (dx / d) * 1.5,
        z: bPos.z - (dz / d) * 1.5,
      }
      await Promise.race([
        a.moveTo(approachTarget, 3),
        this.delay(5000),
      ])
    }

    a.smoothLookAt({ x: b.getPosition().x, z: b.getPosition().z })
    b.smoothLookAt({ x: a.getPosition().x, z: a.getPosition().z })
    a.playAnim('wave')
    await this.delay(800)
    a.playAnim('idle')

    const ended = await this.runTurn(dialogue, a, b, 'encounter_init')
    if (ended) {
      await this.endDialogue(dialogue)
      return
    }

    const speakers = [b, a]
    let speakerIdx = 0

    while (dialogue.currentTurn < dialogue.maxTurns) {
      const speaker = speakers[speakerIdx % 2]
      const listener = speakers[(speakerIdx + 1) % 2]
      speakerIdx++

      const turnEnded = await this.runTurn(dialogue, speaker, listener, 'encounter_reply')
      if (turnEnded) break
    }

    await this.endDialogue(dialogue)
  }

  private async runTurn(
    dialogue: ActiveDialogue,
    speaker: NPC,
    listener: NPC,
    scene: 'encounter_init' | 'encounter_reply',
  ): Promise<boolean> {
    dialogue.currentTurn++
    dialogue.phase = speaker === dialogue.initiator ? 'initiator_speaking' : 'responder_speaking'

    let text: string
    let detectedEnd = false

    if (this.dialogueProvider) {
      try {
        const journal = this.getJournal?.(speaker.id)
        const context = journal?.toContextJSON({
          currentLocation: 'town',
          currentLocationName: getLocale() === 'en' ? 'Town' : '小镇',
          encounteredNpc: { name: listener.label ?? listener.id },
        })
        const persona = this.personaStore?.get(speaker.id)
        const raw = await Promise.race([
          this.dialogueProvider({
            scene,
            speaker: { id: speaker.id, name: speaker.label ?? speaker.id, persona },
            listener: { id: listener.id, name: listener.label ?? listener.id },
            journalContext: context,
            conversationSoFar: dialogue.turns,
            turnNumber: dialogue.currentTurn,
            maxTurns: dialogue.maxTurns,
            tacticalReason: dialogue.tacticalReason,
          }),
          this.delay(8000).then(() => { throw new Error('timeout') }),
        ]) as string

        detectedEnd = /\[END\]/.test(raw)
        text = raw.replace(/\[END\]/g, '').trim()
      } catch {
        text = pick(scene === 'encounter_init' ? getFallbackInit() : getFallbackReply())
      }
    } else {
      text = pick(scene === 'encounter_init' ? getFallbackInit() : getFallbackReply())
    }

    if (!text) text = pick(scene === 'encounter_init' ? getFallbackInit() : getFallbackReply())

    dialogue.turns.push({ speaker: speaker.label ?? speaker.id, text })

    const bubbleDuration = Math.max(BUBBLE_MIN_MS, text.length * BUBBLE_MS_PER_CHAR)
    this.onBubble?.(speaker, text, bubbleDuration)
    await this.delay(bubbleDuration + 400)

    return detectedEnd
  }

  private async endDialogue(dialogue: ActiveDialogue): Promise<void> {
    dialogue.phase = 'ending'
    const { initiator, responder, turns } = dialogue

    this.onBubble?.(initiator, pick(getFarewellPhrases()), 1500)
    initiator.playAnim('wave')
    responder.playAnim('wave')
    await this.delay(1500)
    this.onBubbleEnd?.(initiator)
    this.onBubbleEnd?.(responder)

    this.applyCooldowns(initiator.id, responder.id)

    const summary = await this.generateSummary(dialogue)

    this.writeDialogueToJournals(dialogue, summary)
    this.updateRelationships(dialogue, summary)

    this.onDialogueComplete?.(initiator.id, responder.id, turns, summary)

    const idx = this.activeDialogues.indexOf(dialogue)
    if (idx >= 0) this.activeDialogues.splice(idx, 1)

    this.resumeNpcFromDialogue(initiator, responder)
  }

  // ── Summary generation ──

  private async generateSummary(dialogue: ActiveDialogue): Promise<string> {
    const { turns } = dialogue
    if (turns.length === 0) return getLocale() === 'en' ? 'had a brief chat' : '闲聊了几句'

    if (this.dialogueProvider) {
      try {
        const raw = await Promise.race([
          this.dialogueProvider({
            scene: 'dialogue_summary',
            speaker: { id: dialogue.initiator.id, name: dialogue.initiator.label ?? dialogue.initiator.id },
            listener: { id: dialogue.responder.id, name: dialogue.responder.label ?? dialogue.responder.id },
            conversationSoFar: turns,
            turnNumber: turns.length,
            maxTurns: turns.length,
          }),
          this.delay(5000).then(() => { throw new Error('timeout') }),
        ]) as string

        const text = raw.replace(/\[END\]/g, '').trim()
        if (text) return text
      } catch { /* fallback below */ }
    }

    const joined = turns.map(t => t.text).join(getLocale() === 'en' ? ', ' : '、').slice(0, 30)
    return getLocale() === 'en' ? `chatted about ${joined}` : `聊了${joined}`
  }

  // ── Relationship update (local rules, no LLM) ──

  private updateRelationships(dialogue: ActiveDialogue, summary: string): void {
    const { initiator, responder, turns } = dialogue
    const topic = summary.slice(0, 30)

    const jI = this.getJournal?.(initiator.id)
    const jR = this.getJournal?.(responder.id)

    const sentimentDelta = turns.length >= 3 ? 0.1 : 0.05

    jI?.updateRelationship(
      { npcId: responder.id, name: responder.label ?? responder.id },
      { topic, sentimentDelta },
    )
    jR?.updateRelationship(
      { npcId: initiator.id, name: initiator.label ?? initiator.id },
      { topic, sentimentDelta },
    )
  }

  // ── NPC pause/resume via DailyBehavior ──

  private pauseNpcForDialogue(a: NPC, b: NPC): void {
    this.getBehavior?.(a.id)?.pauseForDialogue()
    this.getBehavior?.(b.id)?.pauseForDialogue()
  }

  private resumeNpcFromDialogue(a: NPC, b: NPC): void {
    this.getBehavior?.(a.id)?.resumeFromDialogue()
    this.getBehavior?.(b.id)?.resumeFromDialogue()
  }

  // ── Cooldowns ──

  private ensureCooldown(npcId: string): CooldownState {
    let cd = this.cooldowns.get(npcId)
    if (!cd) {
      cd = { global: 0, pairCooldowns: new Map(), dialogueCount: 0 }
      this.cooldowns.set(npcId, cd)
    }
    return cd
  }

  private applyCooldowns(aId: string, bId: string): void {
    const cdA = this.ensureCooldown(aId)
    const cdB = this.ensureCooldown(bId)
    const globalCd = randRange(...GLOBAL_COOLDOWN_RANGE)
    const pairCd = randRange(...PAIR_COOLDOWN_RANGE)
    cdA.global = globalCd
    cdB.global = globalCd
    cdA.pairCooldowns.set(bId, pairCd)
    cdB.pairCooldowns.set(aId, pairCd)
    cdA.dialogueCount++
    cdB.dialogueCount++
  }

  resetDayCooldowns(): void {
    for (const cd of this.cooldowns.values()) {
      cd.dialogueCount = 0
    }
  }

  // ── Journal writes ──

  private writeDialogueToJournals(dialogue: ActiveDialogue, summary: string): void {
    const { initiator, responder, turns } = dialogue

    const jI = this.getJournal?.(initiator.id)
    const jR = this.getJournal?.(responder.id)

    const townLabel = getLocale() === 'en' ? 'Town' : '小镇'

    jI?.record({
      location: 'town',
      locationName: townLabel,
      action: 'chatted',
      detail: getLocale() === 'en'
        ? `with ${responder.label ?? responder.id}: ${summary}`
        : `和${responder.label ?? responder.id}${summary}`,
      relatedNpc: responder.label ?? responder.id,
    })
    jI?.recordDialogue({
      timestamp: Date.now(),
      partnerNpcId: responder.id,
      partnerName: responder.label ?? responder.id,
      location: 'town',
      turns,
      summary,
    })

    jR?.record({
      location: 'town',
      locationName: townLabel,
      action: 'chatted',
      detail: getLocale() === 'en'
        ? `with ${initiator.label ?? initiator.id}: ${summary}`
        : `和${initiator.label ?? initiator.id}${summary}`,
      relatedNpc: initiator.label ?? initiator.id,
    })
    jR?.recordDialogue({
      timestamp: Date.now(),
      partnerNpcId: initiator.id,
      partnerName: initiator.label ?? initiator.id,
      location: 'town',
      turns,
      summary,
    })
  }

  // ── Helpers ──

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  getActiveDialogueCount(): number {
    return this.activeDialogues.length
  }

  destroy(): void {
    this.activeDialogues.length = 0
    this.cooldowns.clear()
  }
}
