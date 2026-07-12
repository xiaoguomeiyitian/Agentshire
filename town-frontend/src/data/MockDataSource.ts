import type { IWorldDataSource, WorldSnapshot, ConnectResult } from './IWorldDataSource'
import type { GameEvent, GameAction } from './GameProtocol'
import type { TownConfig } from './TownConfig'
import { getSpecialtyLabel } from './TownConfig'
import { NarrativeEngine } from '../narrative/NarrativeEngine'
import { MockDialog } from '../narrative/MockDialog'
import {
  ACT_3_REQUEST,
  ACT_4_SUMMON, ACT_5_ASSIGN, ACT_6_TO_OFFICE,
  ACT_7_WORK, ACT_8_PUBLISH,
} from '../narrative/sequences'
import type { SceneType } from '../types'

type GameEventHandler = (event: GameEvent) => void

export class MockDataSource implements IWorldDataSource {
  private handler: GameEventHandler | null = null
  private narrative = new NarrativeEngine()
  private mockDialog = new MockDialog()
  private _connected = false
  private townConfig: TownConfig | null = null

  private phase: 'setup' | 'ceremony' | 'daily' | 'working' = 'setup'

  get connected(): boolean { return this._connected }

  onGameEvent(handler: GameEventHandler): void {
    this.handler = handler
  }

  async connect(townConfig: TownConfig): Promise<ConnectResult> {
    this._connected = true
    this.townConfig = townConfig
    this.setupNarrativeHandlers()
    return { hasWorkRestore: false }
  }

  disconnect(): void {
    this._connected = false
    this.narrative.stop()
  }

  getSnapshot(): WorldSnapshot | null {
    return null
  }

  sendAction(action: GameAction): void {
    switch (action.type) {
      case 'town_setup_complete':
        this.onSetupComplete()
        break
      case 'user_message':
        this.handleUserMessage(action.text)
        break
      case 'abort_requested':
        this.narrative.stop()
        break
    }
  }

  updateTownConfig(config: TownConfig): void {
    this.townConfig = config
  }

  // ── Public flow starters ──

  startFirstVisit(): void {
    this.phase = 'daily'
    const cfg = this.townConfig!
    this.emit({ type: 'npc_spawn', npcId: 'steward', name: cfg?.steward?.name || '管家', role: 'steward', category: 'steward', avatarId: cfg?.steward?.avatarId })
    this.emit({ type: 'npc_spawn', npcId: 'user', name: cfg?.user?.name ?? '镇长', role: 'general', category: 'citizen', avatarId: cfg?.user?.avatarId })

    for (const c of cfg.citizens) {
      this.emit({
        type: 'npc_spawn', npcId: c.id, name: c.name,
        role: c.specialty as any, category: 'citizen',
        specialty: getSpecialtyLabel(c.specialty),
        persona: c.persona, avatarId: c.avatarId,
      })
    }

    this.mockDialog.markGreeted()
    this.emit({ type: 'setup_complete' })
  }

  startReturn(): void {
    this.phase = 'daily'
    const cfg = this.townConfig!

    this.emit({ type: 'npc_spawn', npcId: 'steward', name: cfg.steward.name, role: 'steward', category: 'steward', avatarId: cfg.steward.avatarId })
    this.emit({ type: 'npc_spawn', npcId: 'user', name: cfg.user?.name ?? '镇长', role: 'general', category: 'citizen', avatarId: cfg.user?.avatarId })

    for (const c of cfg.citizens) {
      this.emit({
        type: 'npc_spawn', npcId: c.id, name: c.name,
        role: c.specialty as any, category: 'citizen',
        specialty: getSpecialtyLabel(c.specialty),
        persona: c.persona, avatarId: c.avatarId,
      })
    }

    this.mockDialog.markGreeted()
    this.emit({ type: 'setup_complete' })
    this.runReturnSequence()
  }

  // ── Internal flows ──

  private onSetupComplete(): void {
    this.phase = 'ceremony'
    this.runEntranceCeremony()
  }

  private async runEntranceCeremony(): Promise<void> {
    const cfg = this.townConfig!

    this.emit({ type: 'dialog_message', npcId: 'steward', text: `太好了！我这就去迎接居民们！`, isStreaming: false })
    await this.delay(2000)

    this.emit({ type: 'npc_move_to', npcId: 'steward', target: { x: 20, y: 0, z: 23 }, speed: 4 })
    this.emit({ type: 'camera_move', follow: 'steward', durationMs: 1000 })
    await this.delay(2500)

    for (const c of cfg.citizens) {
      this.emit({
        type: 'npc_spawn', npcId: c.id, name: c.name,
        role: c.specialty as any, category: 'citizen',
        specialty: getSpecialtyLabel(c.specialty),
        persona: c.persona, avatarId: c.avatarId,
      })
    }
    await this.delay(500)

    this.emit({ type: 'npc_move_to', npcId: 'steward', target: { x: 18, y: 0, z: 13 }, speed: 3 })
    for (let i = 0; i < cfg.citizens.length; i++) {
      const c = cfg.citizens[i]
      this.emit({ type: 'npc_move_to', npcId: c.id, target: { x: 14 + i * 2.5, y: 0, z: 15 }, speed: 3 })
    }
    this.emit({ type: 'camera_move', target: { x: 18, y: 0, z: 14 }, durationMs: 2000 })
    await this.delay(3500)

    this.emit({ type: 'dialog_message', npcId: 'steward', text: `镇长，请允许我介绍——`, isStreaming: false })
    await this.delay(2000)

    const greetings: Record<string, string> = {
      citizen_1: '镇长好！有什么好点子尽管告诉我！',
      citizen_2: '镇长好...我会努力的。',
      citizen_3: '镇长，代码的事交给我。',
      citizen_4: '嗨镇长！有什么难题一起解决！',
    }

    for (const c of cfg.citizens) {
      const specLabel = getSpecialtyLabel(c.specialty)
      this.emit({ type: 'dialog_message', npcId: 'steward', text: `这位是 ${c.name}，我们的${specLabel}！`, isStreaming: false })
      await this.delay(1500)
      const greeting = greetings[c.id] || `镇长好！`
      this.emit({ type: 'dialog_message', npcId: c.id, text: greeting, isStreaming: false })
      await this.delay(2000)
    }

    this.emit({ type: 'dialog_message', npcId: 'steward', text: `所有居民都安顿好了！告诉我你想做什么——比如做一个游戏？`, isStreaming: false })
    await this.delay(1000)

    this.emit({ type: 'setup_complete' })
    this.phase = 'daily'
    this.mockDialog.markGreeted()
  }

  private async runReturnSequence(): Promise<void> {
    this.emit({ type: 'npc_move_to', npcId: 'user', target: { x: 20, y: 0, z: 18 }, speed: 2.5 })
    this.emit({ type: 'camera_move', follow: 'user', durationMs: 1000 })
    await this.delay(2000)

    this.emit({ type: 'npc_move_to', npcId: 'user', target: { x: 18, y: 0, z: 15 }, speed: 2.5 })
    await this.delay(1500)
  }

  private handleUserMessage(text: string): void {
    if (this.phase === 'working') {
      this.emit({ type: 'dialog_message', npcId: 'steward', text: '团队正在办公室干活呢，稍等一下~', isStreaming: false })
      return
    }

    const { reply, event } = this.mockDialog.matchReply(text)
    this.emit({ type: 'dialog_message', npcId: 'steward', text: reply, isStreaming: false })

    if (event === 'summon_team') {
      this.phase = 'working'
      this.startWorkDemo()
    }
  }

  private async startWorkDemo(): Promise<void> {
    const acts = [
      ACT_3_REQUEST, ACT_4_SUMMON, ACT_5_ASSIGN,
      ACT_6_TO_OFFICE, ACT_7_WORK, ACT_8_PUBLISH,
    ]
    for (const act of acts) {
      this.narrative.load(act)
      await this.narrative.play()
    }
    this.phase = 'daily'
  }

  // ── Narrative handler bridge (reuses existing sequences) ──

  private setupNarrativeHandlers(): void {
    const npcIdMap: Record<string, string> = {
      producer: 'steward',
      planner: 'citizen_1',
      explorer: 'citizen_2',
      coder: 'citizen_3',
      architect: 'citizen_4',
      user: 'user',
    }
    const resolve = (id: string) => npcIdMap[id] ?? id

    this.narrative.on('camera_move', async (p) => {
      const target = p.target ? { x: p.target.x as number, y: 0, z: p.target.z as number } : undefined
      const follow = p.follow ? resolve(p.follow as string) : undefined
      this.emit({ type: 'camera_move', target, follow, durationMs: (p.durationMs as number) ?? 500 })
    })

    this.narrative.on('npc_move', async (p) => {
      const t = p.target as { x: number; z: number }
      this.emit({ type: 'npc_move_to', npcId: resolve(p.id as string), target: { x: t.x, y: 0, z: t.z }, speed: p.speed as number })
      const dist = Math.hypot(t.x - 18, t.z - 13)
      await this.delay(Math.max(800, (dist / ((p.speed as number) || 3)) * 1000))
    })

    this.narrative.on('npc_walk', async (p) => {
      const t = p.target as { x: number; z: number }
      this.emit({ type: 'npc_move_to', npcId: resolve(p.id as string), target: { x: t.x, y: 0, z: t.z }, speed: p.speed as number })
    })

    this.narrative.on('dialog', async (p) => {
      const fromId = resolve(p.from as string)
      this.emit({ type: 'dialog_message', npcId: fromId, text: p.text as string, isStreaming: false })
    })

    this.narrative.on('npc_state', async (p) => {
      const npcId = resolve(p.id as string)
      if (p.action === 'lookAt') {
        const t = p.target as { x: number; z: number }
        this.emit({ type: 'npc_move_to', npcId, target: { x: t.x, y: 0, z: t.z }, speed: 0 })
      } else if (p.action === 'nod') {
        this.emit({ type: 'npc_anim', npcId, anim: 'wave' })
      }
    })

    this.narrative.on('scene_switch', async (p) => {
      this.emit({ type: 'scene_switch', target: p.scene as SceneType })
    })

    this.narrative.on('fx', async (p) => {
      this.emit({ type: 'fx', effect: p.effect as string, params: p })
    })

    this.narrative.on('npc_glow', async (p) => {
      this.emit({ type: 'npc_glow', npcId: resolve(p.id as string), color: p.color as any })
    })

    this.narrative.on('npc_anim', async (p) => {
      this.emit({ type: 'npc_anim', npcId: resolve(p.id as string), anim: p.anim as string })
    })

    this.narrative.on('npc_emoji', async (p) => {
      this.emit({ type: 'npc_emoji', npcId: resolve(p.id as string), emoji: (p.emoji as string | null) })
    })

    this.narrative.on('progress', async (p) => {
      this.emit({ type: 'progress', current: p.current as number, total: p.total as number, label: p.label as string | undefined })
    })

    this.narrative.on('callback', async (p) => {
      const action = p.action as string
      if (action === 'enable_input') {
        this.emit({ type: 'setup_complete' })
      } else if (action === 'show_game_publish') {
        this.emit({ type: 'fx', effect: 'show_game_publish', params: {} })
      } else if (action === 'setup_office_npcs') {
        const assignments: Record<string, string> = {
          citizen_1: 'B', citizen_2: 'C', citizen_3: 'F', citizen_4: 'G',
        }
        for (const [npcId, wsId] of Object.entries(assignments)) {
          this.emit({ type: 'workstation_assign', npcId, stationId: wsId })
        }
      } else if (action === 'screen_state') {
        const wsId = p.workstation as string
        const state = p.state as string
        const stateMap: Record<string, { mode: string; label?: string; fileName?: string }> = {
          coding: { mode: 'coding', fileName: 'working...' },
          waiting: { mode: 'waiting', label: '等待中...' },
          done: { mode: 'done' },
          error: { mode: 'error' },
          thinking: { mode: 'thinking' },
        }
        this.emit({ type: 'workstation_screen', stationId: wsId, state: (stateMap[state] ?? { mode: 'off' }) as any })
      } else if (action === 'start_daily_behavior' || action === 'restart_daily_behavior') {
        // daily behavior is handled by MainScene directly
      } else if (action === 'stop_daily_behavior') {
        // daily behavior is handled by MainScene directly
      }
    })
  }

  private emit(event: GameEvent): void {
    this.handler?.(event)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
