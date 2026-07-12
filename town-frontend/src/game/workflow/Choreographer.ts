// @desc Central choreographer: receives high-level workflow intent events from Bridge, delegates to Orchestrators
import type { GameEvent } from '../../data/GameProtocol'
import type { ScreenState } from '../../data/GameProtocol'
import type { IWorldDataSource } from '../../data/IWorldDataSource'
import type { WorkflowHandler } from './WorkflowHandler'
import type { NPC } from '../../npc/NPC'
import type { NPCManager } from '../../npc/NPCManager'
import type { ChatBubbleSystem } from '../../ui/ChatBubble'
import type { UIManager } from '../../ui/UIManager'
import type { CameraController } from '../visual/CameraController'
import type { ModeManager } from './ModeManager'
import type { VFXSystem } from '../visual/VFXSystem'
import type { EncounterManager } from '../../npc/EncounterManager'
import type { DailyBehavior } from '../../npc/DailyBehavior'
import type { ActivityJournal } from '../../npc/ActivityJournal'
import type { GameClock } from '../GameClock'
import * as THREE from 'three'
import type { OfficeBuilder } from '../scene/OfficeBuilder'
import type { SceneType } from '../../types'
import { SummonOrchestrator } from './SummonOrchestrator'
import { BriefingOrchestrator } from './BriefingOrchestrator'
import { CelebrationOrchestrator } from './CelebrationOrchestrator'
import { getLocale } from '../../i18n'

export interface ChoreographerDeps {
  npcManager: NPCManager
  bubbles: ChatBubbleSystem
  ui: UIManager
  cameraCtrl: CameraController
  modeManager: ModeManager
  vfx: VFXSystem
  gameClock: GameClock
  dataSource: IWorldDataSource
  getEncounterManager: () => EncounterManager
  officeBuilder: OfficeBuilder
  officeScene: THREE.Scene
  workflow: WorkflowHandler
  getBehavior: (id: string) => DailyBehavior | undefined
  getJournal: (id: string) => ActivityJournal | undefined
  switchScene: (scene: SceneType) => Promise<void>
  getSceneType: () => SceneType
  dispatchGameEvent: (event: GameEvent) => void
  setInputEnabled: (enabled: boolean) => void
}

export class Choreographer {
  private summonOrchestrator = new SummonOrchestrator()
  private briefingOrchestrator = new BriefingOrchestrator()
  private celebrationOrchestrator = new CelebrationOrchestrator()
  private pendingDeliverableCards: unknown[] = []
  private deps: ChoreographerDeps

  constructor(deps: ChoreographerDeps) {
    this.deps = deps
  }

  async handleIntent(event: GameEvent): Promise<void> {
    this.deps.setInputEnabled(false)
    try {
      switch (event.type) {
        case 'workflow_summon':    await this.runSummonSequence(event); break
        case 'workflow_assign':    await this.runAssignSequence(event); break
        case 'workflow_go_office': await this.runGoToOfficeSequence(event); break
        case 'workflow_publish':   await this.runPublishSequence(event); break
        case 'workflow_return':    await this.runReturnSequence(event); break
      }
    } finally {
      this.deps.setInputEnabled(true)
    }
  }

  abort(): void {
    this.summonOrchestrator.abort()
    this.briefingOrchestrator.abort()
    this.celebrationOrchestrator.abort()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  private resolveNpcs(agents: Array<{ npcId: string }>): NPC[] {
    return agents
      .map(a => this.deps.npcManager.get(a.npcId))
      .filter((n): n is NPC => !!n)
  }

  private prepareNpcsForPerformance(npcs: NPC[], gatheringPoint?: { x: number; z: number }): void {
    for (const npc of npcs) {
      this.deps.getBehavior(npc.id)?.interrupt('summoned')
      npc.stopMoving()
      npc.transitionTo('idle')
      npc.setVisible(true)
      npc.setGlow('none')
      npc.setStatusEmoji(null)

      if (gatheringPoint) {
        const pos = npc.getPosition()
        const dx = pos.x - gatheringPoint.x
        const dz = pos.z - gatheringPoint.z
        const distSq = dx * dx + dz * dz
        const TELEPORT_THRESHOLD = 12
        if (distSq > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
          const angle = Math.random() * Math.PI * 2
          const r = 4 + Math.random() * 2
          npc.mesh.position.set(
            gatheringPoint.x + Math.cos(angle) * r,
            0,
            gatheringPoint.z + Math.sin(angle) * r,
          )
        }
      }
    }
  }

  // ── Pre-work sequences (Step 3.1) ──

  private async runSummonSequence(event: GameEvent & { type: 'workflow_summon' }): Promise<void> {
    const { npcManager, bubbles, cameraCtrl, modeManager } = this.deps
    const encounterManager = this.deps.getEncounterManager()
    const steward = npcManager.get('steward')
    if (!steward) return

    const npcs = this.resolveNpcs(event.agents)
    if (npcs.length === 0) return

    if (this.deps.getSceneType() === 'office') {
      this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'summoning' })
      return
    }

    const stewardPos = steward.getPosition()
    const gp = { x: stewardPos.x, z: stewardPos.z }

    this.prepareNpcsForPerformance(npcs, gp)

    const userNpc = npcManager.get('user')
    const userPos = userNpc ? { x: userNpc.getPosition().x, z: userNpc.getPosition().z } : undefined

    await this.summonOrchestrator.execute({
      steward, npcs, gatheringPoint: gp, userPosition: userPos, modeManager,
      getBehavior: (id) => this.deps.getBehavior(id),
      getJournal: (id) => this.deps.getJournal(id),
      encounterManager,
      onBubble: (npc, text, dur) => bubbles.show(npc.mesh, text, dur),
      onBubbleEnd: (npc) => bubbles.endStream(npc.mesh),
      onCameraFocus: (target) => cameraCtrl.animateTo(target, 2000),
      onAllGathered: () => {},
    })

    this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'summoning' })
  }

  private async runAssignSequence(event: GameEvent & { type: 'workflow_assign' }): Promise<void> {
    const { npcManager, bubbles, cameraCtrl, modeManager } = this.deps
    const steward = npcManager.get('steward')
    if (!steward) return

    const npcs = this.resolveNpcs(event.agents)
    if (npcs.length === 0) return

    if (this.deps.getSceneType() === 'office') {
      await this.deps.workflow.startOfficeWork(steward, npcs)
      this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'assigning' })
      return
    }

    const lines = event.agents.map(a => {
      const hasRealTask = a.task && a.task !== a.displayName
      if (!hasRealTask) return getLocale() === 'en'
        ? `${a.displayName}, it's yours!`
        : `${a.displayName}，交给你了！`
      const taskMatch = a.task.match(/## 任务\n([\s\S]*?)(?:\n## |$)/)
      const rawTask = taskMatch ? taskMatch[1].trim() : a.task
      const firstLine = rawTask.split('\n')[0]
        .replace(/^[#\s*\-]+/, '')
        .replace(/[：:。.，,]+$/, '')
        .trim()
      const brief = firstLine.length > 25 ? firstLine.slice(0, 22) + '...' : firstLine
      return `${a.displayName}，${brief}`
    })
    this.deps.workflow.pendingBriefingLines = lines

    await this.briefingOrchestrator.execute({
      steward, npcs, lines,
      mayor: npcManager.get('user') ?? null,
      gameName: this.deps.workflow.pendingBriefingGameName || (getLocale() === 'en' ? 'New Project' : '新项目'),
      modeManager,
      getBehavior: (id) => this.deps.getBehavior(id),
      getJournal: (id) => this.deps.getJournal(id),
      onBubble: (npc, text, dur) => bubbles.show(npc.mesh, text, dur),
      onBubbleEnd: (npc) => bubbles.endStream(npc.mesh),
      onCameraFocus: (target) => cameraCtrl.animateTo(target, 800),
      onSceneSwitch: async () => {
        await this.deps.switchScene('office')
      },
    })

    this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'assigning' })
  }

  private async runGoToOfficeSequence(event: GameEvent & { type: 'workflow_go_office' }): Promise<void> {
    const steward = this.deps.npcManager.get('steward')
    if (!steward) return

    const npcs = this.resolveNpcs(event.agents)

    await this.deps.switchScene('office')
    await this.deps.workflow.startOfficeWork(steward, npcs)
  }

  // ── Post-work sequences (Step 3.2) ──

  private async runPublishSequence(event: GameEvent & { type: 'workflow_publish' }): Promise<void> {
    const { npcManager, bubbles, vfx, gameClock, modeManager, ui, dataSource, officeBuilder } = this.deps
    const steward = npcManager.get('steward')
    if (!steward) return
    const mayor = npcManager.get('user') ?? null

    const npcs = this.resolveNpcs(event.agents)
    const currentScene = this.deps.getSceneType()

    const officeNpcIds = new Set(this.deps.workflow.officeNpcStations.keys())
    const npcsInOffice = npcs.filter(n => officeNpcIds.has(n.id))

    const hasCitizenNpcs = npcsInOffice.length > 0 && currentScene === 'office'

    if (hasCitizenNpcs) {
      await this.celebrationOrchestrator.execute({
        steward, mayor, npcs: npcsInOffice,
        gameName: this.deps.workflow.pendingBriefingGameName || (getLocale() === 'en' ? 'New Project' : '新项目'),
        teamText: npcsInOffice.map(n => n.label ?? n.id).join('、'),
        iframeSrc: this.deps.workflow.pendingGameIframeSrc,
        coverUrl: this.deps.workflow.pendingGameCoverUrl,
        inOffice: true,
        modeManager, vfx, gameClock,
        onBubble: (npc, text, dur) => bubbles.show(npc.mesh, text, dur),
        onScreenFlash: () => this.deps.workflow.screenFlash(),
        onSetAllScreens: (state) => {
          for (const stationId of this.deps.workflow.officeNpcStations.values()) {
            officeBuilder.setScreenState(stationId, { mode: state } as ScreenState)
          }
        },
        onShowPopup: (opts) => {
          const origClose = opts.onClose
          const hasUrl = !!opts.iframeSrc
          if (hasUrl) {
            ui.handleDeliverableCard({
              cardType: 'game',
              name: opts.gameName !== (getLocale() === 'en' ? 'New Game' : '新游戏') ? opts.gameName : undefined,
              url: opts.iframeSrc,
            }, () => {
              dataSource.sendAction({ type: 'game_popup_action', action: 'later' })
              origClose?.()
            })
          } else {
            origClose?.()
          }
        },
        onSwitchScene: (scene) => this.deps.switchScene(scene),
        onFadeToBlack: (ms) => ui.fadeToBlack(ms),
        onFadeFromBlack: (ms) => ui.fadeFromBlack(ms),
        onRestoreLifeMode: () => {},
      })
    } else {
      bubbles.show(steward.mesh, event.summary || (getLocale() === 'en' ? 'Task complete!' : '任务完成了！'), 2000)
      await this.delay(2000)
    }

    this.pendingDeliverableCards = event.deliverableCards ?? []
    this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'publishing' })
  }

  private async runReturnSequence(event: GameEvent & { type: 'workflow_return' }): Promise<void> {
    const { npcManager, bubbles, gameClock, modeManager } = this.deps
    const steward = npcManager.get('steward')
    if (!steward) return

    const npcs = this.resolveNpcs(event.agents)
    const npcsStillInOffice = npcs.filter((npc) =>
      this.deps.workflow.officeNpcStations.has(npc.id)
      && npc.mesh.parent === this.deps.officeScene,
    )
    const mayor = npcManager.get('user')
    const OFFICE_DOOR = { x: 15, z: 24 }
    const shouldPlayOfficeDeparture = event.wasInOffice && this.deps.getSceneType() === 'office'

    if (shouldPlayOfficeDeparture) {
      bubbles.show(steward.mesh, getLocale() === 'en' ? 'That\'s a wrap! Great work, team~' : '收工！大家辛苦了，回去休息吧~', 2000)
      await this.delay(2000)

      const allNpcs = [steward, ...npcsStillInOffice]
      if (mayor) allNpcs.push(mayor)
      let departureCancelled = false

      const departPromises = allNpcs.map(async (npc) => {
        const target = { x: OFFICE_DOOR.x + (Math.random() - 0.5) * 2, z: OFFICE_DOOR.z }
        const moveStatus = await npc.moveTo(target, 3)
        if (departureCancelled || moveStatus !== 'arrived') {
          return
        }
        await npc.fadeOut()
      })

      await Promise.race([
        Promise.all(departPromises).then(() => 'all_done' as const),
        this.delay(12000).then(() => {
          departureCancelled = true
          return 'timeout' as const
        }),
      ])

      await this.deps.switchScene('town')

      for (const npc of allNpcs) {
        npc.restoreVisual()
        npc.setVisible(true)
        npc.playAnim('idle')
      }
    }

    bubbles.show(steward.mesh, getLocale() === 'en' ? 'Alright, free time everyone!' : '好了，大家自由活动吧！', 3000)
    const skipHours = 1 + Math.random()
    gameClock.advanceTime(skipHours)
    gameClock.resume()
    modeManager.returnToLifeMode()

    if (shouldPlayOfficeDeparture) {
      this.deps.workflow.disperseAfterWork(steward, npcsStillInOffice)
    } else {
      this.deps.workflow.releaseLingeringOfficeWorkersToTown(npcs)
    }

    await this.delay(3000)

    for (const card of this.pendingDeliverableCards) {
      this.deps.dispatchGameEvent(card as GameEvent)
    }
    this.pendingDeliverableCards = []

    this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'returning' })
  }
}
