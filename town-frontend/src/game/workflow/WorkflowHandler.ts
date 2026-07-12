// @desc Office work flow: summon, briefing, office work, celebration, disperse
import * as THREE from 'three'
import type { NPC } from '../../npc/NPC'
import type { NPCManager } from '../../npc/NPCManager'
import type { ChatBubbleSystem } from '../../ui/ChatBubble'
import type { UIManager } from '../../ui/UIManager'
import type { CameraController } from '../visual/CameraController'
import { OfficeBuilder } from '../scene/OfficeBuilder'
import type { ModeManager } from './ModeManager'
import type { ModeIndicator } from '../../ui/ModeIndicator'
import type { VFXSystem } from '../visual/VFXSystem'
import type { GameClock } from '../GameClock'
import type { Effects } from '../visual/Effects'
import type { DailyBehavior } from '../../npc/DailyBehavior'
import type { ActivityJournal } from '../../npc/ActivityJournal'
import type { EncounterManager } from '../../npc/EncounterManager'
import type { IWorldDataSource } from '../../data/IWorldDataSource'
import { SummonOrchestrator } from './SummonOrchestrator'
import { BriefingOrchestrator } from './BriefingOrchestrator'
import { getAudioSystem } from '../../audio/AudioSystem'
import { getCharacterKeyForNpc } from '../../data/CharacterRoster'
import { WAYPOINTS } from '../../types'
import type { SceneType } from '../../types'
import { getLocale, t } from '../../i18n'

export interface WorkflowHandlerDeps {
  npcManager: NPCManager
  bubbles: ChatBubbleSystem
  ui: UIManager
  cameraCtrl: CameraController
  officeBuilder: OfficeBuilder
  modeManager: ModeManager
  vfx: VFXSystem
  effects: Effects
  gameClock: GameClock
  dataSource: IWorldDataSource
  officeScene: import('three').Scene
  townScene: import('three').Scene
  getModeIndicator: () => ModeIndicator | undefined
  getBehavior: (id: string) => DailyBehavior | undefined
  getJournal: (id: string) => ActivityJournal | undefined
  encounterManager: EncounterManager
  switchScene: (scene: SceneType) => Promise<void>
  scheduleStartDailyBehaviors: (delayMs: number) => void
  startBehaviorForNpc: (npcId: string) => void
  stopBehaviorForNpcs: (npcIds: string[]) => void
  despawnNpc: (npcId: string) => void
  setInputEnabled: (enabled: boolean) => void
  hasWhiteboardPlan: () => boolean
}

export class WorkflowHandler {
  private static readonly OFFICE_WORKER_Z_OFFSET = 0.7
  private static readonly ALL_STATION_IDS = ['B', 'C', 'F', 'G', 'D', 'E', 'H', 'A', 'I', 'J']
  summonPlayed = false
  pendingSummonNpcs: string[] = []
  workingCitizens = new Set<string>()

  officeNpcStations = new Map<string, string>()
  officeWorkTotal = 0
  officeWorkCompleted = 0
  officeCompletedNpcIds = new Set<string>()
  private firstBatchNpcIds = new Set<string>()
  private earlyDoneNpcs = new Map<string, { status: string; stationId?: string; isTempWorker?: boolean }>()

  pendingBriefingLines: string[] = []
  pendingBriefingGameName = ''
  pendingGameIframeSrc = ''
  pendingGameCoverUrl: string | null = null

  private summonOrchestrator = new SummonOrchestrator()
  private briefingOrchestrator = new BriefingOrchestrator()
  private deps: WorkflowHandlerDeps

  constructor(deps: WorkflowHandlerDeps) {
    this.deps = deps
  }

  placeNpcInOffice(npcId: string): boolean {
    if (!this.officeNpcStations.has(npcId)) return false
    const npc = this.deps.npcManager.get(npcId)
    if (!npc) return false
    if (npc.mesh.parent !== this.deps.officeScene) {
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      this.deps.officeScene.add(npc.mesh)
    }
    return true
  }

  getActiveOfficeNpcIds(): string[] {
    return Array.from(this.officeNpcStations.keys())
      .filter(id => !this.officeCompletedNpcIds.has(id))
  }

  getOfficeNpcStateSnapshot(): Array<{ npcId: string; stationId: string; completed: boolean }> {
    return Array.from(this.officeNpcStations.entries()).map(([npcId, stationId]) => ({
      npcId,
      stationId,
      completed: this.officeCompletedNpcIds.has(npcId),
    }))
  }

  restoreOfficeSceneLayout(): void {
    const { npcManager, officeBuilder } = this.deps

    for (const { npcId, stationId, completed } of this.getOfficeNpcStateSnapshot()) {
      const npc = npcManager.get(npcId)
      const ws = officeBuilder.getWorkstation(stationId)
      if (!npc || !ws) continue

      this.placeNpcInOffice(npcId)
      npc.stopMoving()
      npc.restoreVisual()
      npc.setVisible(true)

      const target = this.getOfficeWorkTarget(ws)
      npc.mesh.position.set(target.x, this.getStationY(npc), target.z)
      npc.lookAtTarget({ x: ws.position.x, z: ws.position.z - 2 })

      if (completed) {
        npc.transitionTo('idle')
        npc.setGlow('green')
        npc.indicator.setState('done')
        npc.setStatusEmoji('success')
        officeBuilder.setScreenState(stationId, { mode: 'done' })
        continue
      }

      if (npc.npcState === 'thinking') {
        npc.playAnim('thinking')
        npc.setGlow('yellow')
        npc.indicator.setState('thinking')
      } else {
        npc.playAnim('typing')
        npc.setGlow('cyan')
        npc.indicator.setState('working')
      }
      npc.setStatusEmoji('working')
      officeBuilder.setScreenState(stationId, { mode: 'waiting' })
    }
  }

  async playSummonSequence(): Promise<void> {
    const { npcManager, effects, cameraCtrl, ui, officeBuilder } = this.deps

    const stewardNpc = npcManager.get('steward')
    if (stewardNpc) {
      this.deps.effects.summonRipple(stewardNpc.getPosition())
    }

    cameraCtrl.setAutoPilot(false)
    await this.delay(800)

    const citizenIds = ['citizen_1', 'citizen_2', 'citizen_3', 'citizen_4']
    for (const cId of citizenIds) {
      const npc = npcManager.get(cId)
      if (!npc) continue
      const pos = npc.getPosition()
      cameraCtrl.follow(null)
      cameraCtrl.moveTo({ x: pos.x, z: pos.z })
      effects.exclamation(npc.mesh)
      npc.playAnim('wave')
      await this.delay(800)
    }

    cameraCtrl.moveTo({ x: 18, z: 13 })
    ui.setProgress(0, citizenIds.length, getLocale() === 'en' ? 'Rallying...' : '团队集结中...')
    await this.delay(500)

    const rallyPositions = [
      { x: 14, z: 15 }, { x: 16, z: 15 }, { x: 20, z: 15 }, { x: 22, z: 15 },
    ]
    const rallyPromises: Promise<unknown>[] = []
    citizenIds.forEach((cId, i) => {
      const npc = npcManager.get(cId)
      if (npc) {
        npc.setVisible(true)
        rallyPromises.push(npc.moveTo(rallyPositions[i], 5))
      }
    })

    await Promise.all(rallyPromises)
    ui.setProgress(citizenIds.length, citizenIds.length, getLocale() === 'en' ? 'Ready!' : '团队就绪！')

    citizenIds.forEach(cId => {
      const npc = npcManager.get(cId)
      if (npc) npc.playAnim('idle')
    })

    await this.delay(1000)
    ui.setProgress(0, 0)

    await this.deps.switchScene('office')

    const stationMap: Record<string, string> = {
      citizen_1: 'B', citizen_2: 'C', citizen_3: 'F', citizen_4: 'G',
    }
    for (const cId of citizenIds) {
      const npc = npcManager.get(cId)
      const wsId = stationMap[cId]
      if (npc && wsId) {
        const ws = officeBuilder.getWorkstation(wsId)
        if (ws) {
          npc.mesh.position.copy(ws.position)
          npc.mesh.position.y = this.getStationY(npc)
        }
      }
    }

    const userNpc = npcManager.get('user')
    if (userNpc) userNpc.mesh.position.set(18, 0, 12)
    if (stewardNpc) stewardNpc.mesh.position.set(15, 0, 12)
  }

  handleSummonNpcs(stewardId: string, npcIds: string[], taskDescription: string): void {
    const { npcManager, modeManager, bubbles, cameraCtrl } = this.deps
    const steward = npcManager.get(stewardId)
    if (!steward) return

    if (!modeManager.isWorkMode()) {
      modeManager.enterWorkMode(taskDescription)
    }

    const npcs: NPC[] = []
    for (const id of npcIds) {
      const npc = npcManager.get(id)
      if (npc) npcs.push(npc)
    }
    if (npcs.length === 0) return

    const gp = WAYPOINTS.gathering_point ?? { x: 24, z: 19 }

    this.summonOrchestrator.execute({
      steward,
      npcs,
      gatheringPoint: gp,
      modeManager,
      getBehavior: (id) => this.deps.getBehavior(id),
      getJournal: (id) => this.deps.getJournal(id),
      encounterManager: this.deps.encounterManager,
      onBubble: (npc, text, dur) => bubbles.show(npc.mesh, text, dur),
      onBubbleEnd: (npc) => bubbles.endStream(npc.mesh),
      onCameraFocus: (target) => cameraCtrl.animateTo(target, 2000),
      onAllGathered: () => {
        this.startBriefing(steward, npcs)
      },
    })
  }

  startBriefing(steward: NPC, npcs: NPC[]): void {
    const { modeManager, bubbles, cameraCtrl } = this.deps
    const lines = this.pendingBriefingLines.length >= npcs.length
      ? this.pendingBriefingLines
      : npcs.map(n => getLocale() === 'en'
        ? `${n.label ?? n.id}, it's yours!`
        : `${n.label ?? n.id}，交给你了！`)

    this.briefingOrchestrator.execute({
      steward,
      mayor: this.deps.npcManager.get('user') ?? null,
      npcs,
      lines,
      gameName: this.pendingBriefingGameName || t('new_project'),
      modeManager,
      getBehavior: (id) => this.deps.getBehavior(id),
      getJournal: (id) => this.deps.getJournal(id),
      onBubble: (npc, text, dur) => bubbles.show(npc.mesh, text, dur),
      onBubbleEnd: (npc) => bubbles.endStream(npc.mesh),
      onCameraFocus: (target) => cameraCtrl.animateTo(target, 800),
      onSceneSwitch: async (scene) => {
        await this.deps.switchScene(scene)
        if (scene === 'office') {
          this.startOfficeWork(steward, npcs)
        }
      },
    })
  }

  async startOfficeWork(steward: NPC, npcs: NPC[]): Promise<void> {
    const { npcManager, officeBuilder, modeManager } = this.deps
    const DOOR_POS = { x: 15, z: 24 }
    const SUPERVISOR = { steward: { x: 15, z: 12 }, mayor: { x: 18, z: 18 } }

    this.officeNpcStations.clear()
    this.officeCompletedNpcIds.clear()
    this.firstBatchNpcIds = new Set(npcs.map(n => n.id))
    for (let i = 0; i < npcs.length; i++) {
      const stationId = WorkflowHandler.ALL_STATION_IDS[i % WorkflowHandler.ALL_STATION_IDS.length]
      this.officeNpcStations.set(npcs[i].id, stationId)
    }

    this.deps.stopBehaviorForNpcs(npcs.map(n => n.id))

    npcManager.moveNpcsToScene(['steward', 'user'], this.deps.officeScene)
    for (const npc of npcs) {
      this.placeNpcInOffice(npc.id)
      npc.restoreVisual()
      npc.setVisible(true)
      npc.mesh.position.set(DOOR_POS.x + (Math.random() - 0.5) * 2, 0, DOOR_POS.z)
      npc.playAnim('idle')
    }
    steward.restoreVisual()
    steward.setVisible(true)
    steward.mesh.position.set(DOOR_POS.x, 0, DOOR_POS.z - 1)
    steward.playAnim('idle')
    const userNpc = npcManager.get('user')
    if (userNpc) {
      userNpc.restoreVisual()
      userNpc.setVisible(true)
      userNpc.mesh.position.set(DOOR_POS.x + 2, 0, DOOR_POS.z)
    }

    this.officeWorkTotal = npcs.length
    this.officeWorkCompleted = 0

    if (!this.deps.hasWhiteboardPlan()) {
      this.deps.getModeIndicator()?.setProgress(0, this.officeWorkTotal)
    }

    await this.delay(1500)

    this.deps.setInputEnabled(false)
    steward.playAnim('walk')
    const stewardMove = steward.moveTo(SUPERVISOR.steward, 3).then(() => steward.playAnim('idle')).catch(() => {})
    if (userNpc) {
      userNpc.playAnim('walk')
    }
    const userMove = userNpc
      ? userNpc.moveTo(SUPERVISOR.mayor, 3).then(() => userNpc?.playAnim('idle')).catch(() => {})
      : Promise.resolve()
    Promise.allSettled([stewardMove, userMove]).then(() => {
      this.deps.setInputEnabled(true)
    })

    const seated = new Set<string>()
    let officeReadySent = false
    const sendOfficeReadyOnce = () => {
      if (officeReadySent) return
      officeReadySent = true
      this.deps.dataSource.sendAction({ type: 'workflow_phase_complete', phase: 'going_to_office' })
    }
    for (const npc of npcs) {
      const stationId = this.officeNpcStations.get(npc.id)
      if (!stationId) continue
      const ws = officeBuilder.getWorkstation(stationId)
      if (!ws) continue
      const target = this.getOfficeWorkTarget(ws)

      await this.delay(300)
      npc.playAnim('walk')
      npc.moveTo(target, 4).then(() => {
        npc.lookAtTarget({ x: ws.position.x, z: ws.position.z - 2 })
        npc.playAnim('typing')
        officeBuilder.setScreenState(stationId, { mode: 'waiting' })
        seated.add(npc.id)
        if (seated.size === npcs.length) {
          sendOfficeReadyOnce()
          modeManager.advanceWorkState('working')
          this.flushEarlyDoneNpcs()
        }
      }).catch(() => {})
    }

    const timeout = setTimeout(() => {
      for (const npc of npcs) {
        if (seated.has(npc.id)) continue
        const sid = this.officeNpcStations.get(npc.id)
        if (!sid) continue
        const ws = officeBuilder.getWorkstation(sid)
        if (ws) {
          const target = this.getOfficeWorkTarget(ws)
          npc.mesh.position.set(target.x, this.getStationY(npc), target.z)
          npc.lookAtTarget({ x: ws.position.x, z: ws.position.z - 2 })
          npc.playAnim('typing')
          officeBuilder.setScreenState(sid, { mode: 'waiting' })
          seated.add(npc.id)
        }
      }
      if (seated.size > 0 && !modeManager.isWorkSubState('working')) {
        sendOfficeReadyOnce()
        modeManager.advanceWorkState('working')
        this.flushEarlyDoneNpcs()
      }
    }, 12_000)

    const checkSeated = setInterval(() => {
      if (seated.size >= npcs.length) {
        clearInterval(checkSeated)
        clearTimeout(timeout)
      }
    }, 500)
  }

  onNpcWorkDone(npcId: string): void {
    if (!this.officeNpcStations.has(npcId)) return
    if (this.officeCompletedNpcIds.has(npcId)) return

    this.officeCompletedNpcIds.add(npcId)
    this.officeWorkTotal = Math.max(this.officeWorkTotal, this.officeNpcStations.size)
    this.officeWorkCompleted = this.officeCompletedNpcIds.size
    if (!this.deps.hasWhiteboardPlan()) {
      this.deps.getModeIndicator()?.setProgress(this.officeWorkCompleted, this.officeWorkTotal)
    }
  }

  private static readonly DEPART_PHRASES_ZH = [
    '搞定了！先撤啦~',
    '完工！回去休息~',
    '收工收工！',
    '终于写完了！',
    '任务完成，下班！',
    '交差咯~',
  ]

  private static readonly DEPART_PHRASES_EN = [
    'Done! Heading out~',
    'Finished! Time to rest~',
    'That\'s a wrap!',
    'Finally done!',
    'Task complete, off I go!',
    'Delivered~',
  ]

  private static getDepartPhrase(): string {
    const pool = getLocale() === 'en'
      ? WorkflowHandler.DEPART_PHRASES_EN
      : WorkflowHandler.DEPART_PHRASES_ZH
    return pool[Math.floor(Math.random() * pool.length)]
  }

  async handleNpcWorkDone(npcId: string, status: string, stationId?: string, isTempWorker?: boolean): Promise<void> {
    const { npcManager, bubbles, officeBuilder, vfx } = this.deps
    const npc = npcManager.get(npcId)
    if (!npc) return

    if (!this.officeNpcStations.has(npcId)) {
      this.earlyDoneNpcs.set(npcId, { status, stationId, isTempWorker })
      return
    }

    const resolvedStationId = stationId ?? this.officeNpcStations.get(npcId)

    const audio = getAudioSystem()
    const isError = status === 'failed'

    vfx.stopThinkingAura(npc.mesh)
    vfx.stopWorkingStream(npc.mesh)

    if (isError) {
      npc.transitionTo('emoting', { anim: 'frustrated' }); npc.setGlow('red'); npc.indicator.setState('error')
      npc.setStatusEmoji('error')
      vfx.errorLightning(npc.getPosition()); audio.play('error')
      this.workingCitizens.delete(npcId)
      if (resolvedStationId) officeBuilder.setScreenState(resolvedStationId, { mode: 'error' })
      return
    }

    npc.transitionTo('celebrating'); npc.setGlow('green'); npc.indicator.setState('done')
    npc.setStatusEmoji('celebrate')
    vfx.completionFirework(npc.getPosition()); audio.play('complete')
    this.workingCitizens.delete(npcId)
    this.onNpcWorkDone(npcId)

    if (resolvedStationId) officeBuilder.setScreenState(resolvedStationId, { mode: 'done' })

    await this.delay(2500)

    if (isTempWorker) {
      npc.setStatusEmoji(null)
      npc.setGlow('none')
      npc.indicator.setState('idle')
      await this.delay(500)
      this.deps.despawnNpc(npcId)
      this.releaseWorkstation(npcId, stationId)
      return
    }

    const TOTAL_STATIONS = 10
    const MIN_EMPTY_TO_STAY = 3
    const emptyStations = TOTAL_STATIONS - this.officeNpcStations.size
    const isFirstBatch = this.firstBatchNpcIds.has(npcId)
    const shouldLeave = isFirstBatch || emptyStations < MIN_EMPTY_TO_STAY

    if (!shouldLeave) {
      npc.setStatusEmoji('success')
      npc.setGlow('green')
      npc.indicator.setState('done')
      npc.transitionTo('idle')
      if (resolvedStationId) officeBuilder.setScreenState(resolvedStationId, { mode: 'done' })
      return
    }

    npc.setStatusEmoji(null)
    npc.setGlow('none')
    npc.indicator.setState('idle')
    this.releaseWorkstation(npcId, stationId)

    const phrase = WorkflowHandler.getDepartPhrase()
    bubbles.show(npc.mesh, phrase, 1500)
    await this.delay(2000)

    const door = { x: 15 + (Math.random() - 0.5) * 2, z: 24 }
    await npc.moveTo(door, 3)
    await npc.fadeOut()

    npcManager.moveNpcsToScene([npcId], this.deps.townScene)
    const townDoor = WAYPOINTS.office_door ?? { x: 17, z: 8 }
    npc.mesh.position.set(townDoor.x + (Math.random() - 0.5) * 2, 0, townDoor.z)
    npc.setVisible(true)
    npc.restoreVisual()

    const behavior = this.deps.getBehavior(npcId)
    if (behavior) {
      behavior.resume()
    } else {
      this.deps.startBehaviorForNpc(npcId)
    }
  }

  disperseAfterWork(steward: NPC, npcs: NPC[]): void {
    this.cleanupOfficeWork()

    const { npcManager, cameraCtrl, ui } = this.deps
    const officePos = WAYPOINTS.office_door ?? { x: 17, z: 8 }

    const allIds = ['steward', 'user', ...npcs.map(n => n.id)]
    npcManager.moveNpcsToScene(allIds, this.deps.townScene)

    steward.mesh.position.set(officePos.x, 0, officePos.z)

    const userNpc = npcManager.get('user')
    if (userNpc) {
      userNpc.mesh.position.set(officePos.x + 2, 0, officePos.z)
      userNpc.playAnim('idle')
    }

    for (const npc of npcs) {
      npc.mesh.position.set(
        officePos.x + (Math.random() - 0.5) * 3,
        0,
        officePos.z + (Math.random() - 0.5) * 2,
      )
      npc.setGlow('none')
      npc.setStatusEmoji(null)
      npc.indicator.setState('idle')
      npc.setVisible(true)
    }

    const buildings = ['cafe_door', 'house_a_door', 'house_b_door', 'house_c_door', 'market_door', 'museum_door']
    const delays = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500]

    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]
      setTimeout(() => {
        const key = buildings[Math.floor(Math.random() * buildings.length)]
        const wp = WAYPOINTS[key]
        if (wp) {
          npc.playAnim('walk')
          npc.moveTo(wp, 3).then((status) => {
            if (status === 'arrived') {
              npc.playAnim('idle')
            }
            this.resumeNpcDailyBehavior(npc.id)
          }).catch(() => this.resumeNpcDailyBehavior(npc.id))
          return
        }
        this.resumeNpcDailyBehavior(npc.id)
      }, delays[i] ?? i * 500)
    }

    this.finishPostWorkCleanup(cameraCtrl, ui)
  }

  releaseLingeringOfficeWorkersToTown(npcs: NPC[]): void {
    const { npcManager } = this.deps
    const officePos = WAYPOINTS.office_door ?? { x: 17, z: 8 }

    // Some workers may have already left individually when the player returned
    // to town. Only force-migrate workers still physically stuck in the office.
    for (const npc of npcs) {
      if (!this.officeNpcStations.has(npc.id)) continue
      if (npc.mesh.parent !== this.deps.officeScene) continue

      npc.stopMoving()
      this.releaseWorkstation(npc.id)
      npcManager.moveNpcsToScene([npc.id], this.deps.townScene)
      npc.mesh.position.set(
        officePos.x + (Math.random() - 0.5) * 3,
        0,
        officePos.z + (Math.random() - 0.5) * 2,
      )
      npc.restoreVisual()
      npc.setVisible(true)
      npc.setGlow('none')
      npc.setStatusEmoji(null)
      npc.indicator.setState('idle')
      npc.playAnim('idle')
      this.resumeNpcDailyBehavior(npc.id)
    }

    this.cleanupOfficeWork()
    this.finishPostWorkCleanup(this.deps.cameraCtrl, this.deps.ui)
  }

  cleanupOfficeWork(): void {
    this.officeNpcStations.clear()
    this.firstBatchNpcIds.clear()
    this.earlyDoneNpcs.clear()
    this.officeWorkTotal = 0
    this.officeWorkCompleted = 0
    this.officeCompletedNpcIds.clear()
  }

  private flushEarlyDoneNpcs(): void {
    if (this.earlyDoneNpcs.size === 0) return
    const pending = new Map(this.earlyDoneNpcs)
    this.earlyDoneNpcs.clear()
    for (const [id, args] of pending) {
      if (this.officeNpcStations.has(id)) {
        this.handleNpcWorkDone(id, args.status, undefined, args.isTempWorker)
      }
    }
  }

  async onRestoreWorkState(agents: Array<{ npcId: string; displayName: string; task: string; status: string; avatarId: string }>): Promise<void> {
    const { npcManager, officeBuilder, modeManager } = this.deps
    const modeIndicator = this.deps.getModeIndicator()

    this.cleanupOfficeWork()
    modeManager.enterWorkMode('', 'working')

    for (const a of agents) {
      if (a.status !== 'completed' && a.status !== 'failed') {
        this.workingCitizens.add(a.npcId)
      }
      const existing = npcManager.get(a.npcId)
      if (!existing) {
        const finalCharacterKey = getCharacterKeyForNpc(a.npcId, a.avatarId || undefined)
        npcManager.createNPCs([{
          id: a.npcId,
          name: a.displayName,
          color: 0x888888,
          spawn: { x: 15 + (Math.random() - 0.5) * 3, y: 0, z: 24 },
          role: 'worker',
          label: a.displayName,
          characterKey: finalCharacterKey,
        }])
      }
    }

    this.officeNpcStations.clear()
    for (let i = 0; i < agents.length; i++) {
      const stationId = WorkflowHandler.ALL_STATION_IDS[i % WorkflowHandler.ALL_STATION_IDS.length]
      this.officeNpcStations.set(agents[i].npcId, stationId)
    }

    const doneCount = agents.filter(a => a.status === 'completed' || a.status === 'failed').length
    this.officeWorkTotal = agents.length
    this.officeWorkCompleted = doneCount
    this.officeCompletedNpcIds.clear()
    for (const a of agents) {
      if (a.status === 'completed' || a.status === 'failed') {
        this.officeCompletedNpcIds.add(a.npcId)
      }
    }

    await this.deps.switchScene('office')
    await this.delay(300)

    npcManager.moveNpcsToScene(['steward', 'user'], this.deps.officeScene)
    for (const a of agents) this.placeNpcInOffice(a.npcId)

    const usedStations = new Set<string>()
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]
      const stationId = WorkflowHandler.ALL_STATION_IDS[i % WorkflowHandler.ALL_STATION_IDS.length]
      if (usedStations.has(stationId)) continue
      usedStations.add(stationId)

      const npc = npcManager.get(a.npcId)
      const ws = officeBuilder.getWorkstation(stationId)
      if (!npc || !ws) continue
      const target = this.getOfficeWorkTarget(ws)

      npc.mesh.position.set(target.x, this.getStationY(npc), target.z)
      npc.lookAtTarget({ x: ws.position.x, z: ws.position.z - 2 })
      npc.setVisible(true)

      if (a.status === 'completed') {
        npc.playAnim('cheer')
        npc.setGlow('green')
      } else if (a.status === 'failed') {
        npc.playAnim('frustrated')
        npc.setGlow('red')
      } else {
        npc.playAnim('typing')
      }

      officeBuilder.setScreenState(stationId, {
        mode: a.status === 'completed' ? 'done' : a.status === 'failed' ? 'error' : 'coding',
        fileName: a.task,
      })
    }

    if (modeIndicator && !this.deps.hasWhiteboardPlan()) {
      modeIndicator.setProgress(doneCount, agents.length)
    }
  }

  private getOfficeWorkTarget(ws: { position: { x: number; z: number } }): { x: number; z: number } {
    return {
      x: ws.position.x,
      z: ws.position.z + WorkflowHandler.OFFICE_WORKER_Z_OFFSET,
    }
  }

  private getStationY(npc: NPC): number {
    const box = new THREE.Box3().setFromObject(npc.mesh)
    const height = box.max.y - box.min.y
    return height < OfficeBuilder.CHAIR_SEAT_HEIGHT ? OfficeBuilder.CHAIR_SEAT_HEIGHT : 0
  }

  private allocateEmptyStation(): string | null {
    const used = new Set(this.officeNpcStations.values())
    for (const id of WorkflowHandler.ALL_STATION_IDS) {
      if (!used.has(id)) return id
    }
    return null
  }

  private resumeNpcDailyBehavior(npcId: string): void {
    const behavior = this.deps.getBehavior(npcId)
    if (behavior) {
      behavior.resume()
    } else {
      this.deps.startBehaviorForNpc(npcId)
    }
  }

  private finishPostWorkCleanup(cameraCtrl: CameraController, ui: UIManager): void {
    const stewardBehavior = this.deps.getBehavior('steward')
    stewardBehavior?.resume()

    this.deps.scheduleStartDailyBehaviors(4500)
    ui.showBackButton(false)
    cameraCtrl.setAutoPilot(false)

    this.pendingBriefingLines = []
    this.pendingBriefingGameName = ''
    this.pendingGameIframeSrc = ''
    this.pendingGameCoverUrl = null
  }

  private releaseWorkstation(npcId: string, stationId?: string): void {
    const resolvedStationId = stationId ?? this.officeNpcStations.get(npcId)
    this.officeNpcStations.delete(npcId)
    this.officeCompletedNpcIds.delete(npcId)
    this.firstBatchNpcIds.delete(npcId)
    if (resolvedStationId) {
      this.deps.officeBuilder.setScreenState(resolvedStationId, { mode: 'off' })
    }
    this.deps.dataSource.sendAction({
      type: 'workstation_released',
      npcId,
      stationId: resolvedStationId,
    })
  }

  async onWorkstationAssign(npcId: string, stationId: string): Promise<void> {
    if (this.officeCompletedNpcIds.has(npcId)) return

    const { npcManager, officeBuilder } = this.deps

    const resolvedStation = (stationId && stationId !== '') ? stationId : this.allocateEmptyStation()
    if (!resolvedStation) {
      console.warn(`[WorkflowHandler] No empty station for ${npcId}`)
      return
    }

    this.officeNpcStations.set(npcId, resolvedStation)
    this.officeWorkTotal = this.officeNpcStations.size

    const npc = npcManager.get(npcId)
    const ws = officeBuilder.getWorkstation(resolvedStation)
    if (!npc || !ws) return

    if (!this.placeNpcInOffice(npcId)) return
    const OFFICE_DOOR_Z = 24
    npc.mesh.position.set(15 + (Math.random() - 0.5) * 2, 0, OFFICE_DOOR_Z)
    npc.setVisible(true)

    npc.playAnim('walk')
    const MOVE_TIMEOUT = 8000
    const target = this.getOfficeWorkTarget(ws)
    const movePromise = npc.moveTo(target, 4)
    const timeoutPromise = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), MOVE_TIMEOUT))
    await Promise.race([movePromise, timeoutPromise])

    npc.mesh.position.set(target.x, this.getStationY(npc), target.z)
    npc.lookAtTarget({ x: ws.position.x, z: ws.position.z - 2 })
    npc.playAnim('typing')
    npc.setGlow('yellow')
    npc.setStatusEmoji('working')
    officeBuilder.setScreenState(resolvedStation, { mode: 'waiting', label: t('card.thinking') })
  }

  screenFlash(): void {
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      background: '#fff', opacity: '0', zIndex: '9999', pointerEvents: 'none',
      transition: 'opacity 0.15s ease',
    })
    document.body.appendChild(overlay)
    requestAnimationFrame(() => { overlay.style.opacity = '0.6' })
    setTimeout(() => { overlay.style.opacity = '0' }, 200)
    setTimeout(() => overlay.remove(), 600)
  }

  async playSkillAbsorb(_slug: string): Promise<void> {
    const { npcManager, cameraCtrl, vfx } = this.deps
    const steward = npcManager.get('steward')
    if (!steward) return

    const audio = getAudioSystem()
    cameraCtrl.follow(steward.mesh)

    await this.delay(500)
    audio.play('summon')
    vfx.skillLearnCeremony(steward.mesh)

    await this.delay(3500)
    audio.play('complete')

    await this.delay(700)
    audio.play('deploy')
    steward.transitionTo('celebrating')

    await this.delay(1300)
    const pos = steward.getPosition()
    vfx.deployFireworks(pos)
    vfx.confetti(pos, 150, 2500)
    steward.transitionTo('emoting', { anim: 'wave' })

    await this.delay(2000)
    steward.transitionTo('idle')
  }

  async onAllWorkDone(): Promise<void> {
    const { npcManager, cameraCtrl } = this.deps
    await this.delay(2000)
    this.summonPlayed = false
    this.pendingSummonNpcs = []

    await this.deps.switchScene('town')

    const stewardNpc = npcManager.get('steward')
    if (stewardNpc) cameraCtrl.follow(stewardNpc.mesh)
  }

  abort(): void {
    this.summonOrchestrator?.abort()
    this.briefingOrchestrator?.abort()
  }

  destroy(): void {
    this.abort()
    this.cleanupOfficeWork()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
