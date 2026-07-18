/**
 * CasualEncounter — lightweight NPC-to-NPC interactions (no LLM).
 *
 * Two types of interactions:
 * 1. Passerby wave: both walking, distance < 3, 30% chance
 * 2. Area chat: both stopped nearby, distance < 3, 40% chance, 2-3 preset exchanges
 *
 * All text comes from preset pools — zero API cost.
 * When soul mode is on, EncounterManager (LLM-driven) takes over for deep conversations.
 */

import type { NPC } from './NPC'
import type { TimePeriod, WeatherType } from '../types'
import {
  getGeneralScripts, getWeatherScripts, getPeriodScripts,
  getWaveLines, getWaveLinesPeriod,
  type DialogueLine,
} from './DialogueScripts'

const WAVE_DISTANCE = 4.5
const CHAT_DISTANCE = 4.0
const WAVE_CHANCE = 0.6
const CHAT_CHANCE = 0.5
const GLOBAL_COOLDOWN_MS = 15_000
const PAIR_COOLDOWN_MS = 90_000
const CHAT_DURATION_MS = 8_000
const FACE_DISTANCE = 1.5

interface ActiveChat {
  npcA: NPC
  npcB: NPC
  lines: string[]
  lineIndex: number
  timer: number
  lineInterval: number
  positionSet: boolean
}

const _pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

function pickDialogue(weather?: WeatherType, period?: TimePeriod): DialogueLine {
  const useContext = Math.random() < 0.3
  if (useContext) {
    const weatherScripts = getWeatherScripts()
    if (weather && weatherScripts[weather]?.length) {
      if (Math.random() < 0.5) return _pick(weatherScripts[weather]!)
    }
    const periodScripts = getPeriodScripts()
    if (period && periodScripts[period]?.length) {
      return _pick(periodScripts[period]!)
    }
  }
  return _pick(getGeneralScripts())
}

function pickWaveLine(period?: TimePeriod): string {
  const periodLines = getWaveLinesPeriod()
  if (period && periodLines[period]?.length && Math.random() < 0.4) {
    return _pick(periodLines[period]!)
  }
  return _pick(getWaveLines())
}

export type CasualBubbleCallback = (npcId: string, text: string, durationMs: number) => void
export type CasualAnimCallback = (npcId: string, anim: string) => void
export type CasualPauseCallback = (npcId: string) => void
export type CasualResumeCallback = (npcId: string) => void

export type CasualBubbleProvider = (req: {
  scene: 'wave' | 'chat'
  npcId: string
  npcName?: string
  targetId?: string
  targetName?: string
  weather?: WeatherType
  period?: TimePeriod
  recentTopics?: string[]
}) => Promise<string>

export class CasualEncounter {
  private lastInteraction = new Map<string, number>()
  private pairCooldowns = new Map<string, number>()
  private activeChats: ActiveChat[] = []
  private recentTopics = new Map<string, string[]>()  // pairKey → recent chat lines (dedup)
  private onBubble: CasualBubbleCallback
  private onPause: CasualPauseCallback
  private onResume: CasualResumeCallback
  private isBlocked?: (npcId: string) => boolean
  private bubbleProvider: CasualBubbleProvider | null = null

  constructor(onBubble: CasualBubbleCallback, _onAnim: CasualAnimCallback, onPause: CasualPauseCallback, onResume: CasualResumeCallback, isBlocked?: (npcId: string) => boolean) {
    this.onBubble = onBubble
    this.onPause = onPause
    this.onResume = onResume
    this.isBlocked = isBlocked
  }

  /** Set the LLM bubble provider. When set, all bubble text is generated via LLM. */
  setBubbleProvider(fn: CasualBubbleProvider | null): void {
    this.bubbleProvider = fn
  }

  /** Record recent chat lines for a pair so the LLM can avoid repeating topics. */
  private recordPairTopics(aId: string, bId: string, lines: string[]): void {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
    const prev = this.recentTopics.get(key) ?? []
    const merged = [...prev, ...lines].slice(-6)  // keep last 6 lines
    this.recentTopics.set(key, merged)
  }

  /** Get recent chat lines for a pair (to inject into LLM prompt as "avoid repeating"). */
  private getPairTopics(aId: string, bId: string): string[] {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
    return this.recentTopics.get(key) ?? []
  }

  private currentWeather?: WeatherType
  private currentPeriod?: TimePeriod

  update(dtMs: number, allNpcs: NPC[], weather?: WeatherType, period?: TimePeriod): void {
    this.currentWeather = weather
    this.currentPeriod = period
    this.updateActiveChats(dtMs)
    this.decayCooldowns(dtMs)

    const visible = allNpcs.filter(n => n.id !== 'steward' && n.id !== 'user' && n.mesh.visible)
    const stopped = visible.filter(n => n.state !== 'walking')
    const walking = visible.filter(n => n.state === 'walking')

    for (let i = 0; i < walking.length; i++) {
      for (let j = i + 1; j < walking.length; j++) {
        this.tryPasserbyWave(walking[i], walking[j])
      }
    }

    for (let i = 0; i < stopped.length; i++) {
      for (let j = i + 1; j < stopped.length; j++) {
        this.tryAreaChat(stopped[i], stopped[j])
      }
    }
  }

  private tryPasserbyWave(a: NPC, b: NPC): void {
    if (this.isBlocked?.(a.id) || this.isBlocked?.(b.id)) return
    if (this.dist(a, b) > WAVE_DISTANCE) return
    if (!this.canInteract(a.id) || !this.canInteract(b.id)) return
    if (!this.canPair(a.id, b.id)) return
    if (this.isInChat(a.id) || this.isInChat(b.id)) return
    if (Math.random() > WAVE_CHANCE) return

    this.markInteraction(a.id)
    this.markInteraction(b.id)
    this.markPair(a.id, b.id)

    const waver = Math.random() < 0.5 ? a : b
    const target = waver === a ? b : a
    if (this.bubbleProvider) {
      // LLM-driven wave bubble
      void this.bubbleProvider({
        scene: 'wave',
        npcId: waver.id,
        npcName: waver.label ?? waver.id,
        targetId: target.id,
        targetName: target.label ?? target.id,
        weather: this.currentWeather,
        period: this.currentPeriod,
      }).then((text) => {
        if (text) this.onBubble(waver.id, text, 2000)
      }).catch(() => {
        this.onBubble(waver.id, pickWaveLine(this.currentPeriod), 2000)
      })
    } else {
      this.onBubble(waver.id, pickWaveLine(this.currentPeriod), 2000)
    }
  }

  private tryAreaChat(a: NPC, b: NPC): void {
    if (this.isBlocked?.(a.id) || this.isBlocked?.(b.id)) return
    if (this.dist(a, b) > CHAT_DISTANCE) return
    if (!this.canInteract(a.id) || !this.canInteract(b.id)) return
    if (!this.canPair(a.id, b.id)) return
    if (this.isInChat(a.id) || this.isInChat(b.id)) return
    if (Math.random() > CHAT_CHANCE) return

    this.markInteraction(a.id)
    this.markInteraction(b.id)
    this.markPair(a.id, b.id)

    if (this.bubbleProvider) {
      // LLM-driven area chat — generate both lines via LLM
      const recentTopics = this.getPairTopics(a.id, b.id)
      void this.bubbleProvider({
        scene: 'chat',
        npcId: a.id,
        npcName: a.label ?? a.id,
        targetId: b.id,
        targetName: b.label ?? b.id,
        weather: this.currentWeather,
        period: this.currentPeriod,
        recentTopics,
      }).then((text) => {
        const lines = this.parseChatLines(text, a, b)
        this.startActiveChat(a, b, lines)
      }).catch(() => {
        const script = pickDialogue(this.currentWeather, this.currentPeriod)
        this.startActiveChat(a, b, [script[0], script[1]])
      })
    } else {
      const script = pickDialogue(this.currentWeather, this.currentPeriod)
      this.startActiveChat(a, b, [script[0], script[1]])
    }
  }

  /** Parse LLM response into two chat lines (fallback: split by newline). */
  private parseChatLines(text: string, _a: NPC, _b: NPC): string[] {
    const trimmed = text.trim()
    const parts = trimmed.split(/\n+/).filter((s) => s.trim().length > 0)
    if (parts.length >= 2) return [parts[0].trim(), parts[1].trim()]
    // Fallback: generate a second line from preset
    const script = pickDialogue(this.currentWeather, this.currentPeriod)
    return [trimmed || script[0], script[1]]
  }

  private startActiveChat(a: NPC, b: NPC, lines: string[]): void {
    // Record the lines so future chats between this pair can avoid repeating
    this.recordPairTopics(a.id, b.id, lines)
    this.activeChats.push({
      npcA: a,
      npcB: b,
      lines: lines,
      lineIndex: 0,
      timer: 0,
      lineInterval: CHAT_DURATION_MS / lines.length,
      positionSet: false,
    })
    this.onPause(a.id)
    this.onPause(b.id)
  }

  private updateActiveChats(dtMs: number): void {
    for (let i = this.activeChats.length - 1; i >= 0; i--) {
      const chat = this.activeChats[i]
      chat.timer += dtMs

      if (!chat.positionSet) {
        chat.positionSet = true
        chat.npcA.stopMoving()
        chat.npcB.stopMoving()

        const posA = chat.npcA.getPosition()
        const posB = chat.npcB.getPosition()
        const dx = posB.x - posA.x
        const dz = posB.z - posA.z
        const len = Math.sqrt(dx * dx + dz * dz)

        const midX = (posA.x + posB.x) / 2
        const midZ = (posA.z + posB.z) / 2
        const nx = len > 0.1 ? dx / len : 0
        const nz = len > 0.1 ? dz / len : 1
        const halfDist = FACE_DISTANCE / 2

        // Issue 3: walk NPCs to face-to-face positions instead of teleporting.
        // Previously this directly set mesh.position, causing a visible jump.
        // Now both NPCs walk (short distance) to their facing spots; once
        // both arrive, they turn to face each other and the chat proceeds.
        const targetA = { x: midX - nx * halfDist, z: midZ - nz * halfDist }
        const targetB = { x: midX + nx * halfDist, z: midZ + nz * halfDist }
        chat.npcA.moveTo(targetA, 2).then((status) => {
          if (status === 'arrived') {
            const angleAtoB = Math.atan2(dx, dz)
            chat.npcA.mesh.rotation.y = angleAtoB
          }
        })
        chat.npcB.moveTo(targetB, 2).then((status) => {
          if (status === 'arrived') {
            const angleAtoB = Math.atan2(dx, dz)
            chat.npcB.mesh.rotation.y = angleAtoB + Math.PI
          }
        })
      }

      const expectedLine = Math.floor(chat.timer / chat.lineInterval)
      if (expectedLine > chat.lineIndex && chat.lineIndex < chat.lines.length) {
        const speaker = chat.lineIndex % 2 === 0 ? chat.npcA : chat.npcB
        this.onBubble(speaker.id, chat.lines[chat.lineIndex], chat.lineInterval * 0.8)
        chat.lineIndex++
      }

      if (chat.lineIndex >= chat.lines.length && chat.timer >= CHAT_DURATION_MS) {
        this.onResume(chat.npcA.id)
        this.onResume(chat.npcB.id)
        this.activeChats.splice(i, 1)
      } else if (chat.timer >= CHAT_DURATION_MS + 7000) {
        this.onResume(chat.npcA.id)
        this.onResume(chat.npcB.id)
        this.activeChats.splice(i, 1)
      }
    }
  }

  private isInChat(npcId: string): boolean {
    return this.activeChats.some(c => c.npcA.id === npcId || c.npcB.id === npcId)
  }

  private dist(a: NPC, b: NPC): number {
    const pa = a.getPosition()
    const pb = b.getPosition()
    const dx = pa.x - pb.x
    const dz = pa.z - pb.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  private canInteract(npcId: string): boolean {
    const last = this.lastInteraction.get(npcId) ?? 0
    return Date.now() - last >= GLOBAL_COOLDOWN_MS
  }

  private canPair(aId: string, bId: string): boolean {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
    return (this.pairCooldowns.get(key) ?? 0) <= 0
  }

  private markInteraction(npcId: string): void {
    this.lastInteraction.set(npcId, Date.now())
  }

  private markPair(aId: string, bId: string): void {
    const key = aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
    this.pairCooldowns.set(key, PAIR_COOLDOWN_MS)
  }

  private decayCooldowns(dtMs: number): void {
    for (const [key, val] of this.pairCooldowns) {
      const next = val - dtMs
      if (next <= 0) this.pairCooldowns.delete(key)
      else this.pairCooldowns.set(key, next)
    }
  }

  destroy(): void {
    this.activeChats.length = 0
    this.lastInteraction.clear()
    this.pairCooldowns.clear()
  }
}
