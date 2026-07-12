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

const WAVE_DISTANCE = 3.5
const CHAT_DISTANCE = 3.5
const WAVE_CHANCE = 0.5
const CHAT_CHANCE = 0.6
const GLOBAL_COOLDOWN_MS = 10_000
const PAIR_COOLDOWN_MS = 30_000
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

export class CasualEncounter {
  private lastInteraction = new Map<string, number>()
  private pairCooldowns = new Map<string, number>()
  private activeChats: ActiveChat[] = []
  private onBubble: CasualBubbleCallback
  private onPause: CasualPauseCallback
  private onResume: CasualResumeCallback
  private isBlocked?: (npcId: string) => boolean

  constructor(onBubble: CasualBubbleCallback, _onAnim: CasualAnimCallback, onPause: CasualPauseCallback, onResume: CasualResumeCallback, isBlocked?: (npcId: string) => boolean) {
    this.onBubble = onBubble
    this.onPause = onPause
    this.onResume = onResume
    this.isBlocked = isBlocked
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
    this.onBubble(waver.id, pickWaveLine(this.currentPeriod), 2000)
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

    const script = pickDialogue(this.currentWeather, this.currentPeriod)
    const lines = [script[0], script[1]]

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

        chat.npcA.mesh.position.x = midX - nx * halfDist
        chat.npcA.mesh.position.z = midZ - nz * halfDist
        chat.npcB.mesh.position.x = midX + nx * halfDist
        chat.npcB.mesh.position.z = midZ + nz * halfDist

        const angleAtoB = Math.atan2(dx, dz)
        chat.npcA.mesh.rotation.y = angleAtoB
        chat.npcB.mesh.rotation.y = angleAtoB + Math.PI
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
