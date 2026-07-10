import * as THREE from 'three'
import type { Engine, GameScene } from '../engine'
import { UIManager } from '../ui/UIManager'
import { TownSetupUI } from '../ui/TownSetupUI'
import { ChatBubbleSystem, cleanBubbleText, getBubbleDurationMs } from '../ui/ChatBubble'
import { AssetLoader } from './visual/AssetLoader'
import { TownBuilder } from './scene/TownBuilder'
import { OfficeBuilder } from './scene/OfficeBuilder'
import { MuseumBuilder } from './scene/MuseumBuilder'
import { VehicleManager } from './scene/VehicleManager'
import { CameraController } from './visual/CameraController'
import { Effects } from './visual/Effects'
import { VFXSystem } from './visual/VFXSystem'
import { getAudioSystem } from '../audio/AudioSystem'
import { AmbientSoundManager } from '../audio/AmbientSoundManager'
import { BGMManager } from '../audio/BGMManager'
import { NPC } from '../npc/NPC'
import { NPCManager } from '../npc/NPCManager'
import { EncounterManager } from '../npc/EncounterManager'
import { CasualEncounter } from '../npc/CasualEncounter'
import { FollowBehavior } from '../npc/FollowBehavior'
import { PersonaStore } from '../npc/PersonaStore'
import { TownJournal } from '../npc/TownJournal'
import { getCharacterKeyForNpc } from '../data/CharacterRoster'
import { getNpcProfiles, type NPCProfile } from '../data/TownConfig'
import { GameClock } from './GameClock'
import { TimeOfDayLighting } from './visual/TimeOfDayLighting'
import { WeatherSystem } from './WeatherSystem'
import { TimeHUD } from '../ui/TimeHUD'
import { ModeIndicator } from '../ui/ModeIndicator'
import { ModeManager } from './workflow/ModeManager'
import { WAYPOINTS, type SceneType, type NPCConfig, type WorkSubState } from '../types'
import type { IWorldDataSource } from '../data/IWorldDataSource'
import type { GameEvent, GameNPCRole } from '../data/GameProtocol'
import { t } from '../i18n'
import type { TownConfigStore } from '../data/TownConfigStore'
import { EventDispatcher } from './EventDispatcher'
import { DialogManager } from './DialogManager'
import { SceneSwitcher } from './workflow/SceneSwitcher'
import { DailyScheduler } from './DailyScheduler'
import { SceneBootstrap } from './SceneBootstrap'
import { WorkflowHandler } from './workflow/WorkflowHandler'
import { Choreographer } from './workflow/Choreographer'
import { CitizenChatManager } from '../npc/CitizenChatManager'
import { installDebugBindings, removeDebugBindings } from './DebugBindings'
import { detectProfile } from '../engine/Performance'
import type { MinigameSlot } from './minigame/MinigameSlot'
import { BanweiGame } from './minigame/BanweiGame'

export class MainScene implements GameScene {
  private engine: Engine
  private ui: UIManager
  private setupUI!: TownSetupUI
  private dataSource: IWorldDataSource
  private configStore: TownConfigStore
  private assets!: AssetLoader
  private bubbles!: ChatBubbleSystem
  private cameraCtrl!: CameraController
  private effects!: Effects
  private vfx!: VFXSystem
  private npcManager!: NPCManager
  private debugCharacterAssignments = new Map<string, string>()

  private townScene!: THREE.Scene
  private officeScene!: THREE.Scene
  private museumScene!: THREE.Scene

  private townBuilder!: TownBuilder
  private officeBuilder!: OfficeBuilder
  private museumBuilder!: MuseumBuilder
  private vehicleManager!: VehicleManager

  private gameClock!: GameClock
  private timeOfDayLighting!: TimeOfDayLighting
  private weatherSystem!: WeatherSystem
  private ambientSound = new AmbientSoundManager()
  private bgm = new BGMManager()
  private timeHUD!: TimeHUD
  private modeManager = new ModeManager()
  private modeIndicator!: ModeIndicator
  private minigame: MinigameSlot | null = null
  private _minigameUpdateCb: ((dt: number) => void) | null = null
  private whiteboardHasPlan = false

  private townJournal!: TownJournal
  private encounterManager!: EncounterManager
  private casualEncounter!: CasualEncounter
  private personaStore = new PersonaStore()
  private npcProfiles: Map<string, NPCProfile> | null = null
  private getNpcProfilesCached(): Map<string, NPCProfile> {
    if (!this.npcProfiles) this.npcProfiles = getNpcProfiles()
    return this.npcProfiles
  }
  private inputEnabled = false
  private dialogTarget = 'steward'
  private followBehavior = new FollowBehavior()
  private playerMoveEnabled = true
  private pendingDoorInteraction: { scene: SceneType; doorPos: THREE.Vector3 } | null = null
  private postTownReturnDebugFrames = 0
  private static readonly NON_INTERACTIVE_WORK_SUBSTATES = new Set<WorkSubState>([
    'summoning',
    'assigning',
    'going_to_office',
    'publishing',
    'returning',
  ])

  private skillLearnCard: import('../ui/SkillLearnCard').SkillLearnCard | null = null
  private bubbleDebugEnabled = this.readBubbleDebugFlag()

  private dispatcher!: EventDispatcher
  private dialogManager!: DialogManager
  private sceneSwitcher!: SceneSwitcher
  private dailyScheduler!: DailyScheduler
  private bootstrap!: SceneBootstrap
  private workflow!: WorkflowHandler
  private choreographer!: Choreographer
  private citizenChat!: CitizenChatManager

  constructor(engine: Engine, dataSource: IWorldDataSource, configStore: TownConfigStore) {
    this.engine = engine
    this.dataSource = dataSource
    this.configStore = configStore
    this.ui = new UIManager()
  }

  async init(): Promise<void> {
    this.ui.init()

    this.setupUI = new TownSetupUI((action) => this.bootstrap.handleSetupAction(action))

    this.assets = new AssetLoader()
    await this.assets.preload(['characters', 'buildings', 'furniture', 'props'], (loaded, total) => {
      const pct = Math.round((loaded / total) * 100)
      console.log(`[Assets] Loading ${pct}% (${loaded}/${total})`)
    })

    NPC.setAssetLoader(this.assets)

    this.townScene = new THREE.Scene()
    this.townScene.background = new THREE.Color(0x87ceeb)
    this.townScene.fog = new THREE.Fog(0x87ceeb, 30, 60)

    this.officeScene = new THREE.Scene()
    this.officeScene.background = new THREE.Color(0x181818)

    this.museumScene = new THREE.Scene()
    this.museumScene.background = new THREE.Color(0xf0f0f0)

    this.townBuilder = new TownBuilder(this.townScene)
    this.townBuilder.build(this.assets)

    this.officeBuilder = new OfficeBuilder(this.officeScene)
    this.officeBuilder.build(this.assets)
    this.officeBuilder.startWhiteboardPolling('')
    this.officeBuilder.whiteboard.onStepProgress = (current, total) => {
      this.whiteboardHasPlan = total > 0
      if (this.modeIndicator && total > 0) {
        this.modeIndicator.setProgress(current, total)
      }
    }

    this.museumBuilder = new MuseumBuilder(this.museumScene)
    this.museumBuilder.build(this.assets)

    this.vehicleManager = new VehicleManager(this.townScene)
    this.vehicleManager.build(this.assets)

    this.engine.world.scene = this.townScene

    this.cameraCtrl = new CameraController(this.engine.camera, this.ui.getGameContainer())
    this.cameraCtrl.init()

    this.effects = new Effects(this.townScene)
    this.vfx = new VFXSystem(this.townScene, this.effects)
    this.vfx.setCamera(this.engine.camera)

    try { this.engine.initPostProcess() } catch { /* bloom not critical */ }

    this.gameClock = new GameClock()
    this.gameClock.setStorageKey(this.configStore.getScopedKey('agentshire_clock'))

    const lightingRefs = this.townBuilder.getLightingRefs()
    if (lightingRefs) {
      this.timeOfDayLighting = new TimeOfDayLighting(
        this.townScene, lightingRefs, this.engine.postProcess,
      )
    }

    this.timeHUD = new TimeHUD()

    this.weatherSystem = new WeatherSystem(
      this.townScene,
      this.engine.camera,
      this.timeOfDayLighting,
      this.engine.postProcess,
      detectProfile(),
    )
    this.weatherSystem.onThunder((intensity) => {
      this.ambientSound.playThunder(intensity)
    })

    installDebugBindings({
      gameClock: {
        setTime: (h: number) => { this.gameClock.setTime(h) },
        setSpeed: (minutes: number) => { this.gameClock.setSpeed(minutes * 60_000) },
        pause: () => { this.gameClock.pause() },
        resume: () => { this.gameClock.resume() },
        getState: () => this.gameClock.getState(),
      },
      weather: {
        get: () => this.weatherSystem.getDisplayWeather(),
        theme: () => this.weatherSystem.getDayTheme(),
        set: (type: string) => this.weatherSystem.forceWeather(type as import('../types').WeatherType),
        setTheme: (theme: string) => this.weatherSystem.forceTheme(theme),
        themes: () => ['sunny','overcast','drizzleDay','rainy','stormy','snowy','blizzardDay','foggy','sandstormDay','auroraDay'],
        types: () => ['clear','cloudy','drizzle','rain','heavyRain','storm','lightSnow','snow','blizzard','fog','sandstorm','aurora'],
      },
      audio: {
        bgmVolume: (v: number) => this.bgm.setVolume(v),
        ambientVolume: (v: number) => this.ambientSound.setVolume(v),
        mute: () => { getAudioSystem().muted = true },
        unmute: () => { getAudioSystem().muted = false },
      },
    })

    const audio = getAudioSystem()
    await audio.preload()

    const actx = audio.getAudioContext()
    const sfxGain = audio.getSfxGain()
    if (actx && sfxGain) {
      this.ambientSound.init(actx, sfxGain)
      this.bgm.init(actx, sfxGain).catch(() => {})
    }

    this.bubbles = new ChatBubbleSystem(this.ui.getGameContainer(), this.engine.camera, this.engine.renderer)
    this.npcManager = new NPCManager(this.townScene, this.ui.getGameContainer())

    this.initSubModules()
    this.initEncounterManager()
    this.initModeSystem()
    this.initDebugHelpers()

    this.ui.on(event => {
      if (event.type === 'send_message') this.onUserMessage(event.text)
      if (event.type === 'play_now') {
        this.dataSource.sendAction({ type: 'game_popup_action', action: 'play_now', gameUrl: event.gameUrl })
        if (event.gameUrl) window.open(event.gameUrl, '_blank', 'noopener')
      }
      if (event.type === 'back_town') {
        this.sceneSwitcher.switchScene('town')
      }
      if (event.type === 'tab_change' && event.tab === 'world') this.bubbles.updateCamera(this.engine.camera)
      if (event.type === 'chat_with_citizen') {
        this.citizenChat.startChat(event.npcId)
      }
    })

    this.engine.input.on('tap', (gesture) => {
      this.handleTap(gesture.position.x, gesture.position.y)
    })

    this.engine.input.on('doubletap', () => {
      this.dialogTarget = 'steward'
      const stewardNpc = this.npcManager.get('steward')
      if (stewardNpc) this.cameraCtrl.follow(stewardNpc.mesh)
    })

    this.engine.input.on('drag', (gesture) => {
      this.cameraCtrl.onDrag(gesture.phase, gesture.delta, gesture.totalDelta)
    })

    this.engine.input.on('pinch', (gesture) => {
      this.cameraCtrl.onPinch(gesture.deltaScale)
    })

    this.dataSource.onGameEvent(event => this.handleGameEvent(event))

    this.ui.hideLoading()
    this.bootstrap.startFlow()
  }

  private initSubModules(): void {
    this.dailyScheduler = new DailyScheduler({
      npcManager: this.npcManager,
      gameClock: this.gameClock,
      encounterManager: this.encounterManager,
      personaStore: this.personaStore,
      getTownJournal: () => this.townJournal,
      getCurrentSceneType: () => this.sceneSwitcher.getSceneType(),
      getNpcSpecialty: (npcId) => this.getNpcProfilesCached().get(npcId)?.specialty,
      getAgentIdForNpc: (npcId) => this.bootstrap?.agentConfigMap.get(npcId)?.agentId,
    })

    this.dialogManager = new DialogManager({
      bubbles: this.bubbles,
      ui: this.ui,
      npcManager: this.npcManager,
      logBubble: (stage, text) => this.logBubbleText(stage, text),
    })

    this.sceneSwitcher = new SceneSwitcher({
      engine: this.engine,
      ui: this.ui,
      npcManager: this.npcManager,
      bubbles: this.bubbles,
      cameraCtrl: this.cameraCtrl,
      vfx: this.vfx,
      officeBuilder: this.officeBuilder,
      modeManager: this.modeManager,
      getModeIndicator: () => this.modeIndicator,
      gameClock: this.gameClock,
      townScene: this.townScene,
      officeScene: this.officeScene,
      museumScene: this.museumScene,
      weatherSystem: this.weatherSystem,
      getActiveOfficeNpcIds: () => this.workflow.getActiveOfficeNpcIds(),
      onRestoreOfficeSceneLayout: () => this.workflow.restoreOfficeSceneLayout(),
      onStopDailyBehaviors: () => this.dailyScheduler.stopDailyBehaviors(),
      onStopBehaviorForNpcs: (ids) => this.dailyScheduler.stopBehaviorForNpcs(ids),
      onScheduleStartDailyBehaviors: (ms) => this.dailyScheduler.scheduleStartDailyBehaviors(ms),
      onCleanupOfficeWork: () => this.workflow.cleanupOfficeWork(),
      onSyncTopHudLayout: () => this.syncTopHudLayout(),
      getTownDoorPosition: (buildingId) => {
        const marker = this.townBuilder.getDoorMarker(buildingId)
        if (!marker) return null
        const pos = new THREE.Vector3()
        marker.getWorldPosition(pos)
        return { x: pos.x, z: pos.z }
      },
      getSummonPlayed: () => this.workflow.summonPlayed,
      setSummonPlayed: (v) => { this.workflow.summonPlayed = v },
      getWorkingCitizens: () => this.workflow.workingCitizens,
      getPendingSummonNpcs: () => this.workflow.pendingSummonNpcs,
      setPendingSummonNpcs: (v) => { this.workflow.pendingSummonNpcs = v },
      setInputEnabled: (v) => { this.inputEnabled = v; this.playerMoveEnabled = v },
    })

    this.workflow = new WorkflowHandler({
      npcManager: this.npcManager,
      bubbles: this.bubbles,
      ui: this.ui,
      cameraCtrl: this.cameraCtrl,
      officeBuilder: this.officeBuilder,
      modeManager: this.modeManager,
      vfx: this.vfx,
      effects: this.effects,
      gameClock: this.gameClock,
      dataSource: this.dataSource,
      officeScene: this.officeScene,
      townScene: this.townScene,
      getModeIndicator: () => this.modeIndicator,
      getBehavior: (id) => this.dailyScheduler.getDailyBehaviors().get(id),
      getJournal: (id) => this.dailyScheduler.getActivityJournals().get(id),
      encounterManager: this.encounterManager,
      switchScene: (scene) => this.sceneSwitcher.switchScene(scene),
      scheduleStartDailyBehaviors: (ms) => this.dailyScheduler.scheduleStartDailyBehaviors(ms),
      startBehaviorForNpc: (id) => this.dailyScheduler.startBehaviorForNpc(id),
      stopBehaviorForNpcs: (ids) => this.dailyScheduler.stopBehaviorForNpcs(ids),
      despawnNpc: (npcId) => this.onNpcDespawn(npcId),
      setInputEnabled: (v) => { this.inputEnabled = v; this.playerMoveEnabled = v },
      hasWhiteboardPlan: () => this.whiteboardHasPlan,
    })

    this.choreographer = new Choreographer({
      npcManager: this.npcManager,
      bubbles: this.bubbles,
      ui: this.ui,
      cameraCtrl: this.cameraCtrl,
      modeManager: this.modeManager,
      vfx: this.vfx,
      gameClock: this.gameClock,
      dataSource: this.dataSource,
      getEncounterManager: () => this.encounterManager,
      officeBuilder: this.officeBuilder,
      officeScene: this.officeScene,
      workflow: this.workflow,
      getBehavior: (id) => this.dailyScheduler.getDailyBehaviors().get(id),
      getJournal: (id) => this.dailyScheduler.getActivityJournals().get(id),
      switchScene: (scene) => this.sceneSwitcher.switchScene(scene),
      getSceneType: () => this.sceneSwitcher.getSceneType(),
      dispatchGameEvent: (event) => this.handleGameEvent(event),
      setInputEnabled: (v) => { this.inputEnabled = v; this.playerMoveEnabled = v },
    })

    this.bootstrap = new SceneBootstrap({
      ui: this.ui,
      setupUI: this.setupUI,
      npcManager: this.npcManager,
      cameraCtrl: this.cameraCtrl,
      dataSource: this.dataSource,
      configStore: this.configStore,
      dispatchGameEvent: (event) => this.handleGameEvent(event),
      addEligibleNpcId: (id) => this.dailyScheduler.addEligibleNpcId(id),
      scheduleStartDailyBehaviors: (ms) => this.dailyScheduler.scheduleStartDailyBehaviors(ms),
      startSnapshotSaving: () => this.startSnapshotSaving(),
      setInputEnabled: (v) => { this.inputEnabled = v },
      setDialogTarget: (id, name) => {
        this.ui.setDialogTarget({
          id, name, color: 0x4488CC,
          spawn: { x: 0, y: 0, z: 0 }, role: 'producer', label: name,
        })
      },
    })

    this.citizenChat = new CitizenChatManager({
      npcManager: this.npcManager,
      getBehavior: (id) => this.dailyScheduler.getDailyBehaviors().get(id),
      getUser: () => this.npcManager.get('user'),
      getSteward: () => this.npcManager.get('steward'),
      getCameraCtrl: () => this.cameraCtrl,
      getFollowBehavior: () => this.followBehavior,
      getSceneType: () => this.sceneSwitcher.getSceneType(),
      getAvatarUrl: (npcId) => {
        const config = this.configStore.load()
        return config?.citizens.find(c => c.id === npcId)?.avatarUrl
      },
      onDialogTargetChange: (npcId) => { this.dialogTarget = npcId },
      onInputTargetChange: (npc) => {
        if (npc) {
          this.ui.updateChatTargetIndicator(npc, true)
        } else {
          this.ui.clearChatTarget()
        }
      },
    })

    const savedConfig = this.configStore.load()
    const stewardLabel = savedConfig?.steward.name ?? t('steward')
    const stewardNpc = this.npcManager.get('steward')
    this.ui.initChatTargetIndicator({
      stewardName: stewardLabel,
      stewardConfig: {
        id: 'steward', name: stewardLabel, color: 0x4488CC,
        spawn: { x: 0, y: 0, z: 0 }, role: 'producer', label: stewardLabel,
        characterKey: stewardNpc?.characterKey ?? savedConfig?.steward.avatarId,
        avatarUrl: savedConfig?.steward.avatarUrl,
      },
      onSwitchToSteward: () => {
        this.dialogTarget = 'steward'
        this.citizenChat.resetIdleTimer()
        this.ui.updateChatTargetIndicator(null, false)
      },
      onSwitchToCitizen: () => {
        const npcId = this.citizenChat.getActiveNpcId()
        if (!npcId || !this.citizenChat.canSwitchToCitizen()) return
        this.dialogTarget = npcId
        this.citizenChat.resetIdleTimer()
        this.ui.updateChatTargetIndicator(null, true)
      },
    })

    this.dispatcher = new EventDispatcher({
      onNpcSpawn: (e) => this.onNpcSpawn(e),
      onNpcDespawn: (npcId) => this.onNpcDespawn(npcId),
      onNpcPhase: (npcId, phase) => this.onNpcPhase(npcId, phase),
      onNpcMoveTo: (npcId, target, speed, requestId) => this.onNpcMoveTo(npcId, target, speed, requestId),
      onNpcDailyBehaviorReady: (npcId) => this.onNpcDailyBehaviorReady(npcId),
      onNpcEmote: (e) => {
        const npc = this.npcManager.get(e.npcId)
        if (npc) {
          const emoteMap: Record<string, string> = { frustrated: 'frustrated', happy: 'cheer', thinking: 'thinking', wave: 'wave' }
          const anim = emoteMap[e.emote]
          if (anim) npc.playAnim(anim)
          if (e.emote === 'frustrated') this.vfx.errorLightning(npc.getPosition())
          if (e.emote === 'happy') this.vfx.completionFirework(npc.getPosition())
        }
      },
      onNpcEmoji: (npcId, emoji) => this.onNpcEmoji(npcId, emoji),
      onNpcGlow: (npcId, color) => this.onNpcGlow(npcId, color),
      onNpcAnim: (npcId, anim) => this.onNpcAnim(npcId, anim),
      onNpcLookAt: (npcId, targetNpcId) => {
        const looker = this.npcManager.get(npcId)
        const lookTarget = this.npcManager.get(targetNpcId)
        if (looker && lookTarget) {
          const tPos = lookTarget.getPosition()
          const lPos = looker.getPosition()
          looker.smoothLookAt({ x: tPos.x, z: tPos.z })
          lookTarget.smoothLookAt({ x: lPos.x, z: lPos.z })
        }
      },
      onNpcWorkDone: (npcId, status, stationId, isTempWorker) => {
        this.workflow.handleNpcWorkDone(npcId, status, stationId, isTempWorker)
        this.minigame?.removeWorkingNpc(npcId)
      },
      onDialogMessage: (npcId, text, isStreaming) => this.dialogManager.onDialogMessage(npcId, text, isStreaming),
      onDialogEnd: (npcId) => this.dialogManager.onDialogEnd(npcId),
      onWorkstationAssign: (npcId, stationId) => {
        this.workflow.onWorkstationAssign(npcId, stationId)
        this.minigame?.addWorkingNpc(npcId)
      },
      onWorkstationScreen: (stationId, state) => this.officeBuilder.setScreenState(stationId, state),
      onSceneSwitch: (target) => this.sceneSwitcher.switchScene(target as SceneType),
      onFx: (effect, params) => this.onFx(effect, params),
      onProgress: (current, total, label) => {
        if (this.modeIndicator) {
          if (!this.whiteboardHasPlan) {
            this.modeIndicator.setProgress(current, total)
          }
          this.ui.hideProgress()
        } else {
          this.ui.setProgress(current, total, label)
        }
      },
      onCameraMove: (target, follow, durationMs) => this.onCameraMove(target, follow, durationMs),
      onNpcPersonaUpdate: (npcId, name) => {
        const npc = this.npcManager.get(npcId)
        if (npc) { npc.setLabel(name); this.personaStore.register(npcId, name) }
      },
      onSetupComplete: () => {
        this.bootstrap.hideTownInitLoading()
        this.inputEnabled = true
        const config = this.configStore.load()
        if (config && !this.npcManager.get('steward')) {
          this.bootstrap.spawnFromConfig(config)
          this.bootstrap.playReturnAnimation(config)
        }
        for (const npc of this.npcManager.getWorkers()) {
          this.dailyScheduler.addEligibleNpcId(npc.id)
        }
        this.dailyScheduler.scheduleStartDailyBehaviors(5000)
      },
      onModeChange: (event) => this.onModeChange(event),
      onSummonNpcs: (stewardId, npcIds, taskDescription) => this.workflow.handleSummonNpcs(stewardId, npcIds, taskDescription),
      onTaskBriefing: (lines, gameName) => {
        this.workflow.pendingBriefingLines = lines
        this.workflow.pendingBriefingGameName = gameName
      },
      onWorkStatusUpdate: (updates) => {
        for (const u of updates) this.onNpcPhase(u.npcId, u.phase)
      },
      onWorkComplete: (_taskDescription, gameUrl) => {
        if (gameUrl) this.workflow.pendingGameIframeSrc = gameUrl
      },
      onGameCompletionPopup: (gameName, gameUrl, previewImageUrl) => {
        this.workflow.pendingGameIframeSrc = gameUrl
        this.workflow.pendingGameCoverUrl = previewImageUrl ?? null
        this.workflow.pendingBriefingGameName = gameName
      },
      onDeliverableCard: (event) => {
        if (event.name) this.workflow.pendingBriefingGameName = event.name
        if (event.url) this.workflow.pendingGameIframeSrc = event.url
        this.ui.handleDeliverableCard(event, () => {
          this.dataSource.sendAction({ type: 'game_popup_action', action: 'later' })
        })
      },
      onNpcActivity: (event) => this.dialogManager.onNpcActivity(event),
      onNpcActivityStatus: (npcId, success) => this.dialogManager.onNpcActivityStatus(npcId, success),
      onNpcActivityStream: (npcId, delta) => this.dialogManager.onNpcActivityStream(npcId, delta),
      onNpcActivityStreamEnd: (npcId) => this.dialogManager.onNpcActivityStreamEnd(npcId),
      onNpcActivityTodo: (npcId, todos) => this.dialogManager.onNpcActivityTodo(npcId, todos),
      onNpcActivityRestore: (npcId, entries) => this.dialogManager.onNpcActivityRestore(npcId, entries),
      onSkillLearned: (slug) => {
        import('../ui/SkillLearnCard').then(({ SkillLearnCard }) => {
          if (!this.skillLearnCard) this.skillLearnCard = new SkillLearnCard()
          this.skillLearnCard.show(slug, (s) => this.workflow.playSkillAbsorb(s))
        }).catch(e => console.warn('[MainScene] SkillLearnCard import failed:', e))
      },
      onModeSwitch: (mode, taskDescription) => {
        if (mode === 'work' && taskDescription) {
          if (!this.modeManager.isWorkMode()) this.modeManager.enterWorkMode(taskDescription)
        } else if (mode === 'life') {
          this.modeManager.returnToLifeMode()
        }
      },
      onRestoreWorkState: (agents) => this.workflow.onRestoreWorkState(agents),
      onSetSessionId: async (sessionId) => {
        this.configStore.setSessionId(sessionId)
        const config = await this.bootstrap.loadFinalConfig()
        if (config && config.citizens.length > 0) {
          this.bootstrap.spawnFromConfig(config)
          this.bootstrap.playReturnAnimation(config)
        }
      },
      onTownConfigReady: (config) => {
        this.configStore.save(config)
        for (const c of config.citizens) {
          if (!this.npcManager.get(c.id)) {
            this.handleGameEvent({
              type: 'npc_spawn', npcId: c.id, name: c.name,
              role: c.specialty as GameNPCRole, category: 'citizen',
              specialty: c.specialty, persona: c.persona, avatarId: c.avatarId,
              modelUrl: c.modelUrl,
              modelTransform: c.modelTransform as any,
              animMapping: c.animMapping as any,
              animFileUrls: c.animFileUrls,
            })
          }
        }
      },
      onNpcChangeModel: (npcId, characterKey, modelUrl, modelTransform, animMapping, animFileUrls) => {
        const npc = this.npcManager.get(npcId)
        if (npc) {
          this.vfx.personaTransform(npc.mesh)
          npc.transitionCharacterKey(characterKey, 1800, { modelUrl, modelTransform, animMapping, animFileUrls })
        }
        const config = this.configStore.load()
        if (config) {
          const citizen = config.citizens.find((c: { id: string }) => c.id === npcId)
          if (citizen) citizen.avatarId = characterKey
          if (npcId === 'steward') config.steward.avatarId = characterKey
          this.configStore.save(config)
        }
      },
      onStewardRename: (newName, characterKey) => {
        const steward = this.npcManager.get('steward')
        if (steward) steward.setLabel(newName)
        if (steward && typeof characterKey === 'string' && characterKey) {
          steward.transitionCharacterKey(characterKey, 1800)
        }
        const config = this.configStore.load()
        if (config) { config.steward.name = newName; this.configStore.save(config) }
        this.ui.setDialogTarget({
          id: 'steward', name: newName, color: 0x4488CC,
          spawn: { x: 0, y: 0, z: 0 }, role: 'producer', label: newName,
        })
        this.ui.updateStewardName(newName)
      },
      onSetTime: (event) => {
        if (event.action === 'set' && event.hour != null) this.gameClock.setTime(event.hour)
        else if (event.action === 'pause') this.gameClock.pause()
        else if (event.action === 'resume') this.gameClock.resume()
      },
      onSetWeather: (event) => {
        if (event.action === 'set' && event.weather) {
          this.weatherSystem.forceWeather(event.weather as import('../types').WeatherType)
        } else if (event.action === 'reset') {
          this.weatherSystem.resetToAutomatic()
        }
      },
      onWorkflowIntent: (event) => this.choreographer.handleIntent(event),
    })
  }

  private readBubbleDebugFlag(): boolean {
    try {
      const search = new URLSearchParams(globalThis.location?.search ?? '')
      if (search.get('bubbleDebug') === '1') return true
      const local = globalThis.localStorage?.getItem?.('agentshire_bubble_debug')
      return local === '1' || local === 'true'
    } catch {
      return false
    }
  }

  private logBubbleText(stage: string, text: string): void {
    if (!this.bubbleDebugEnabled) return
    const clean = cleanBubbleText(text)
    if (clean === text) {
      console.log(`[BubbleDebug][MainScene][${stage}] raw=${JSON.stringify(text)}`)
      return
    }
    console.log(
      `[BubbleDebug][MainScene][${stage}] raw=${JSON.stringify(text)} clean=${JSON.stringify(clean)}`,
    )
  }

  private initEncounterManager(): void {
    this.encounterManager = new EncounterManager(this.gameClock)
    this.casualEncounter = new CasualEncounter(
      (npcId, text, durationMs) => {
        const npc = this.npcManager.get(npcId)
        if (npc) this.bubbles.show(npc.mesh, text, durationMs)
      },
      (npcId, anim) => {
        const npc = this.npcManager.get(npcId)
        if (npc) npc.playAnim(anim as any)
      },
      (npcId) => {
        this.dailyScheduler.getDailyBehaviors().get(npcId)?.pauseForDialogue()
      },
      (npcId) => {
        this.dailyScheduler.getDailyBehaviors().get(npcId)?.resumeFromDialogue()
      },
      (npcId) => !!this.dailyScheduler.getDailyBehaviors().get(npcId)?.inDialogue,
    )
    this.townJournal = new TownJournal(this.gameClock, {
      implicitChat: (req) => this.dailyScheduler.implicitChatForBrain(req),
    })
    this.gameClock.onPeriodChange('encounter-day-reset', (state) => {
      if (state.period === 'dawn') this.encounterManager.resetDayCooldowns()
    })
    this.gameClock.onPeriodChange('town-journal-period', (state) => {
      this.townJournal.recordTimeChange(state.period)
      if (state.period === 'night') this.dailyScheduler.triggerNightlyRoutine()
    })
    this.encounterManager.setOnBubble((npc, text, duration) => {
      this.bubbles.show(npc.mesh, text, duration)
    })
    this.encounterManager.setOnBubbleEnd((npc) => {
      this.bubbles.endStream(npc.mesh)
    })
    this.encounterManager.setJournalAccessor((id) => this.dailyScheduler.getActivityJournals().get(id))
    this.encounterManager.setBehaviorAccessor((id) => this.dailyScheduler.getDailyBehaviors().get(id))
    this.encounterManager.setPersonaStore(this.personaStore)
    this.encounterManager.setDialogueProvider(async (opts) => {
      return this.dailyScheduler.dialogueProviderImpl(opts)
    })
    this.encounterManager.setOnDialogueComplete((initiatorId, responderId, turns, summary) => {
      const initiator = this.npcManager?.get(initiatorId)
      const responder = this.npcManager?.get(responderId)
      const iName = initiator?.label ?? initiatorId
      const rName = responder?.label ?? responderId
      this.townJournal.recordEncounterStart(iName, rName, 'town')
      for (const turn of turns) {
        this.townJournal.recordEncounterMessage(turn.speaker, turn.text, 'town')
      }
      this.townJournal.recordEncounterEnd(iName, rName, summary, 'town')
    })
  }

  private initModeSystem(): void {
    this.modeIndicator = new ModeIndicator()

    this.modeManager.onModeChange('daily-behavior', (state) => {
      const behaviors = this.dailyScheduler.getDailyBehaviors()
      const brains = this.dailyScheduler.getAgentBrains()
      if (state.mode === 'work') {
        this.townJournal.recordModeChange('work', state.taskDescription ? `管家发起了任务：${state.taskDescription}` : undefined)
        for (const id of state.summonedNpcIds) {
          behaviors.get(id)?.interrupt('summoned')
          brains.get(id)?.suspend()
        }
      } else {
        this.townJournal.recordModeChange('life')
        for (const [id, db] of behaviors) {
          if (!db.isActive()) continue
          const s = db.getState()
          if (s === 'summoned' || s === 'gathered' || s === 'assigned' || s === 'at_office') {
            db.resume()
            brains.get(id)?.resume()
          }
        }
      }
    })

    this.modeManager.onModeChange('encounter', (state) => {
      this.encounterManager.setExcludedNpcs(new Set(state.summonedNpcIds))
    })

    this.modeManager.onModeChange('gameclock', (state) => {
      if (state.mode === 'life' || state.mode === 'work') this.gameClock?.resume()
    })

    this.modeManager.onModeChange('mode-indicator', (state) => {
      this.modeIndicator?.update(state)
      this.syncTopHudLayout()
    })

    this.modeIndicator.setActionCallback(() => {
      const cur = this.sceneSwitcher.getSceneType()
      this.sceneSwitcher.switchScene(cur === 'office' ? 'town' : 'office')
    })
    this.syncTopHudLayout()

    this.minigame = new BanweiGame()
    this.minigame.mount({
      camera: this.engine.camera,
      renderer: this.engine.renderer,
      container: this.ui.getGameContainer(),
      getNpc: (id) => this.npcManager.get(id),
      getNpcVoiceConfig: (id) => {
        const npc = this.npcManager.get(id)
        if (!npc) return null
        const currentConfig = this.configStore.load()
        const configAvatarUrl = id === 'steward'
          ? currentConfig?.steward.avatarUrl
          : id === 'user'
            ? currentConfig?.user.avatarUrl
            : currentConfig?.citizens.find(c => c.id === id)?.avatarUrl
        return {
          id,
          name: npc.name ?? id,
          color: npc.color,
          spawn: { x: 0, y: 0, z: 0 },
          role: 'worker',
          label: npc.label ?? npc.name ?? id,
          characterKey: npc.characterKey,
          avatarUrl: configAvatarUrl,
        }
      },
      getWorkingNpcIds: () => this.workflow.getActiveOfficeNpcIds(),
      getSceneType: () => this.sceneSwitcher.getSceneType(),
      onUpdate: (cb) => { this._minigameUpdateCb = cb },
      offUpdate: () => { this._minigameUpdateCb = null },
    })
    this.modeManager.onModeChange('banwei-minigame', (state) => {
      if (state.mode === 'work' && state.workSubState === 'working') {
        this.minigame?.start()
      } else {
        this.minigame?.stop()
      }
    })
  }

  private initDebugHelpers(): void {
    const sched = this.dailyScheduler
    installDebugBindings({
      mode: {
        get: () => this.modeManager.getState(),
        enterWork: (task: string) => this.modeManager.enterWorkMode(task),
        advance: (s: string) => this.modeManager.advanceWorkState(s as WorkSubState),
        returnLife: () => this.modeManager.returnToLifeMode(),
        setSummoned: (ids: string[]) => this.modeManager.setSummonedNpcs(ids),
        summon: (npcIds: string[], task = '测试任务') =>
          this.workflow.handleSummonNpcs('steward', npcIds, task),
      },
      journals: {
        get: (npcId: string) => sched.getActivityJournals().get(npcId),
        list: () => Array.from(sched.getActivityJournals().keys()),
        dump: (npcId: string) => {
          const j = sched.getActivityJournals().get(npcId)
          return j ? { entries: j.getEntries(), dialogues: j.getDialogues() } : null
        },
      },
      encounter: {
        activeCount: () => this.encounterManager.getActiveDialogueCount(),
        resetCooldowns: () => this.encounterManager.resetDayCooldowns(),
      },
      daily: {
        list: () => Array.from(sched.getDailyBehaviors().entries()).map(([id, b]) => ({ id, state: b.getState(), active: b.isActive() })),
        get: (id: string) => {
          const b = sched.getDailyBehaviors().get(id)
          return b ? { state: b.getState(), active: b.isActive() } : null
        },
      },
      townJournal: {
        events: (n?: number) => this.townJournal.getRecentEvents(n),
        descriptions: (n?: number) => this.townJournal.getRecentDescriptions(n),
        summaries: () => this.townJournal.getAllSummaries(),
        todayCount: () => this.townJournal.getCurrentDayEventCount(),
      },
      workflow: {
        testSummon: (npcIds?: string[]) => {
          const ids = npcIds ?? ['citizen_1', 'citizen_2']
          const agents = ids.map(id => {
            const npc = this.npcManager.get(id)
            return { npcId: id, displayName: npc?.label ?? id, task: '测试任务' }
          })
          this.handleGameEvent({ type: 'workflow_summon', agents } as any)
        },
        testAssign: (npcIds?: string[]) => {
          const ids = npcIds ?? ['citizen_1', 'citizen_2']
          const agents = ids.map(id => {
            const npc = this.npcManager.get(id)
            return { npcId: id, displayName: npc?.label ?? id, task: '测试任务' }
          })
          this.handleGameEvent({ type: 'workflow_assign', agents } as any)
        },
        testPublish: () => {
          this.handleGameEvent({
            type: 'workflow_publish',
            summary: '测试完成了！',
            deliverableCards: [],
            agents: Array.from(this.workflow.officeNpcStations.keys()).map(id => ({
              npcId: id, displayName: this.npcManager.get(id)?.label ?? id, status: 'completed',
            })),
          } as any)
        },
        testReturn: () => {
          const agents = Array.from(this.workflow.officeNpcStations.keys()).map(id => ({ npcId: id }))
          this.handleGameEvent({ type: 'workflow_return', agents, wasInOffice: true } as any)
        },
        testNpcDone: (npcId?: string) => {
          const id = npcId ?? Array.from(this.workflow.officeNpcStations.keys())[0]
          if (!id) { console.warn('No NPC in office'); return }
          const station = this.workflow.officeNpcStations.get(id)
          this.handleGameEvent({ type: 'npc_work_done', npcId: id, status: 'completed', stationId: station } as any)
        },
        testCelebrate: () => {
          const npcs = Array.from(this.workflow.officeNpcStations.keys()).map(id => ({
            npcId: id, displayName: this.npcManager.get(id)?.label ?? id, status: 'completed',
          }))
          this.handleGameEvent({
            type: 'workflow_publish', summary: '测试庆祝！', deliverableCards: [], agents: npcs,
          } as any)
        },
        testBanwei: (npcIds?: string[]) => {
          const ids = npcIds ?? this.npcManager.getAll().filter(n => n.id !== 'user' && n.id !== 'steward').map(n => n.id).slice(0, 3)
          this.modeManager.enterWorkMode('班味测试')
          this.modeManager.forceWorkSubState('working')
          for (const id of ids) this.minigame?.addWorkingNpc(id)
          console.log('[Debug] Banwei test started with NPCs:', ids)
        },
        testBanweiStop: () => {
          this.modeManager.returnToLifeMode()
          console.log('[Debug] Banwei test stopped')
        },
        help: () => {
          console.log(`
__workflow 演出测试指令:
  testSummon(['citizen_1','citizen_2'])  — 召唤集结（默认 citizen_1+2）
  testAssign(['citizen_1','citizen_2'])  — 任务分配 + 行军 + 进办公室
  testNpcDone('citizen_1')              — 单个 NPC 完成离场
  testPublish()                         — 庆祝发布
  testReturn()                          — 返回小镇散场
  testCelebrate()                       — 庆祝（= testPublish 别名）
  testBanwei(['citizen_1'])             — 启动班味小游戏测试
  testBanweiStop()                      — 停止班味小游戏
  help()                                — 显示本帮助
          `)
        },
      },
    })
  }

  // ── User message from input bar ──

  showUserBubble(text: string): void {
    const userNpc = this.npcManager.get('user')
    this.logBubbleText('user_message', text)
    if (userNpc) this.bubbles.show(userNpc.mesh, text, getBubbleDurationMs(text, 'user'))
    this.ui.addChatMessage({ from: t('mayor'), text, timestamp: Date.now() })
  }

  getDialogTarget(): string {
    return this.dialogTarget
  }

  getUIManager(): UIManager { return this.ui }
  getModeManager(): ModeManager { return this.modeManager }
  isNpcVisible(npcId: string): boolean { return !!this.npcManager.get(npcId)?.mesh.visible }

  getAgentEnabledCitizens(): Array<{ id: string; name: string; specialty: string; color: number; characterKey?: string; avatarUrl?: string; spawned: boolean }> {
    const config = this.configStore.load()
    if (!config) return []
    const agentMap = this.bootstrap.agentConfigMap
    return config.citizens
      .filter(c => agentMap.get(c.id)?.agentEnabled)
      .map(c => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty,
        color: 0x4488CC,
        characterKey: c.avatarId,
        avatarUrl: c.avatarUrl,
        spawned: !!this.npcManager.get(c.id)?.mesh.visible,
      }))
  }

  setMusicEnabled(enabled: boolean): void {
    if (enabled) {
      this.bgm.setEnabled(true)
      this.ambientSound.setEnabled(true)
    } else {
      this.bgm.setEnabled(false)
      this.ambientSound.setEnabled(false)
    }
  }

  setSoulModeEnabled(enabled: boolean): void {
    if (enabled) {
      this.dailyScheduler.enableSoulMode()
    } else {
      this.dailyScheduler.disableSoulMode()
    }
  }

  // ── Topic mode (group discussion) ──

  private topicNpcIds: string[] = []
  private topicGathering = false

  isTopicActive(): boolean {
    return this.topicNpcIds.length > 0
  }

  isTopicGathering(): boolean {
    return this.topicGathering
  }

  async gatherForTopic(npcIds: string[]): Promise<void> {
    this.topicNpcIds = npcIds
    this.topicGathering = true

    for (const id of npcIds) {
      this.dailyScheduler.getDailyBehaviors().get(id)?.pauseForDialogue()
      const npc = this.npcManager.get(id)
      if (npc) npc.transitionTo('idle')
    }

    const userNpc = this.npcManager.get('user')
    if (!userNpc) { this.topicGathering = false; return }
    const center = userNpc.mesh.position.clone()

    const RADIUS = 3.0
    const ARC_SPAN = Math.PI
    const startAngle = -ARC_SPAN / 2

    const targets: Array<{ npcId: string; pos: { x: number; z: number } }> = []
    for (let i = 0; i < npcIds.length; i++) {
      const angle = startAngle + (ARC_SPAN / Math.max(npcIds.length - 1, 1)) * i
      targets.push({
        npcId: npcIds[i],
        pos: {
          x: center.x + Math.sin(angle) * RADIUS,
          z: center.z + Math.cos(angle) * RADIUS,
        },
      })
    }

    const movePromises: Promise<void>[] = []
    for (const t of targets) {
      const npc = this.npcManager.get(t.npcId)
      if (!npc) continue
      const speed = this.dailyScheduler.getDailyBehaviors().get(t.npcId)?.getWalkSpeed() ?? 2.5
      movePromises.push(
        npc.moveTo(t.pos, speed).then(() => {
          const dx = center.x - npc.mesh.position.x
          const dz = center.z - npc.mesh.position.z
          npc.mesh.rotation.y = Math.atan2(dx, dz)
          npc.transitionTo('emoting')
        }),
      )
    }

    const timeout = new Promise<void>(r => setTimeout(r, 15000))
    await Promise.race([Promise.all(movePromises), timeout])

    this.topicGathering = false
  }

  dismissTopic(): void {
    const npcIds = [...this.topicNpcIds]
    this.topicNpcIds = []
    this.topicGathering = false

    for (const npcId of npcIds) {
      const npc = this.npcManager.get(npcId)
      if (!npc) continue
      npc.transitionTo('idle')
      this.dailyScheduler.getDailyBehaviors().get(npcId)?.resumeFromDialogue()
    }
  }

  private onUserMessage(text: string): void {
    if (!this.inputEnabled) return

    this.showUserBubble(text)
    this.citizenChat.onUserMessage(this.dialogTarget)
    this.dataSource.sendAction({ type: 'user_message', targetNpcId: this.dialogTarget, text })
  }

  // ── Central GameEvent dispatcher ──

  handleGameEvent(event: GameEvent): void {
    this.dispatcher.dispatch(event)
  }

  // ── GameEvent handlers ──

  private onNpcSpawn(event: GameEvent & { type: 'npc_spawn' }): void {
    const existing = this.npcManager.get(event.npcId)
    if (existing) {
      if (event.task && event.category === 'citizen') {
        this.workflow.workingCitizens.add(event.npcId)
        this.workflow.summonPlayed = true
      }
      return
    }
    const finalCharacterKey = getCharacterKeyForNpc(
      event.npcId,
      typeof event.avatarId === 'string' ? event.avatarId : undefined,
    )
    this.debugCharacterAssignments.set(event.npcId, finalCharacterKey)

    const colorMap: Record<string, number> = {
      steward: 0x4488CC, citizen_1: 0xBB66CC, citizen_2: 0x44AA44,
      citizen_3: 0x6688AA, citizen_4: 0xCC8844, citizen_5: 0xCC6688, user: 0xDDAA44,
    }

    const homeKeys = ['house_a_door', 'house_b_door', 'house_c_door']
    const citizenIndex = parseInt(event.npcId.replace(/\D/g, ''), 10) || 0
    const homeKey = homeKeys[citizenIndex % homeKeys.length]
    const homeWp = WAYPOINTS[homeKey]

    let spawn: { x: number; y: number; z: number }
    let startHidden = false
    if (event.spawn) {
      spawn = { x: event.spawn.x, y: event.spawn.y ?? 0, z: event.spawn.z }
    } else if (event.npcId === 'steward') {
      spawn = { x: WAYPOINTS.plaza_side.x, y: 0, z: WAYPOINTS.plaza_side.z }
    } else if (event.npcId === 'user') {
      spawn = { x: WAYPOINTS.road_entrance.x, y: 0, z: WAYPOINTS.road_entrance.z }
    } else if (homeWp) {
      spawn = { x: homeWp.x, y: 0, z: homeWp.z }
      startHidden = true
    } else {
      spawn = { x: WAYPOINTS.plaza_center.x, y: 0, z: WAYPOINTS.plaza_center.z }
    }

    const config: NPCConfig = {
      id: event.npcId, name: event.name,
      color: colorMap[event.npcId] ?? 0x888888,
      spawn,
      role: event.category === 'steward' ? 'producer' : event.npcId === 'user' ? 'user' : 'worker',
      label: event.name, characterKey: finalCharacterKey,
      modelUrl: event.modelUrl,
      modelTransform: event.modelTransform,
      animMapping: event.animMapping,
      animFileUrls: event.animFileUrls,
    }

    this.npcManager.createNPCs([config])

    if (startHidden) {
      const npc = this.npcManager.get(event.npcId)
      if (npc) npc.setVisible(false)
    }

    if (event.category === 'citizen' || event.category === 'steward') {
      this.personaStore.register(
        event.npcId, event.name,
        typeof event.persona === 'string' ? event.persona : undefined,
      )
    }

    if (event.category === 'steward') {
      this.ui.setDialogTarget(config)
      this.ui.updateStewardName(config.name)
      this.dialogTarget = 'steward'
    }
    if (event.task && event.category === 'citizen') {
      this.workflow.workingCitizens.add(event.npcId)
    }

    if (event.arrivalFanfare) {
      const npc = this.npcManager.get(event.npcId)
      if (npc) {
        requestAnimationFrame(() => {
          this.handleGameEvent({ type: 'fx', effect: 'exclamation', params: { npcId: event.npcId } })
          npc.transitionTo('emoting', { anim: 'wave' })
        })
      }
    }
  }

  private onNpcDespawn(npcId: string): void {
    if (npcId === 'steward' || npcId === 'user') {
      console.warn(`[MainScene] blocked despawn of protected NPC: ${npcId}`)
      return
    }
    this.dailyScheduler.removeNpc(npcId)
    this.debugCharacterAssignments.delete(npcId)
    this.personaStore.remove(npcId)

    const despawnNpc = this.npcManager.get(npcId)
    if (despawnNpc) {
      const mesh = despawnNpc.mesh
      mesh.traverse((child: THREE.Object3D) => {
        if (!(child instanceof THREE.Mesh)) return
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m: THREE.Material) => {
            if (m.userData?.npcOwnedMaterial) return m
            const c = m.clone(); c.transparent = true; return c
          })
        } else if (child.material && !child.material.userData?.npcOwnedMaterial) {
          child.material = child.material.clone()
          child.material.transparent = true
        }
      })
      let t = 0
      const duration = 0.5
      const tick = () => {
        t += 0.016
        const progress = Math.min(t / duration, 1)
        const s = 1 - progress
        mesh.scale.set(s, s, s)
        mesh.traverse((child: THREE.Object3D) => {
          const meshChild = child as THREE.Mesh
          if (meshChild.isMesh && meshChild.material && !Array.isArray(meshChild.material)) {
            meshChild.material.opacity = s
          }
        })
        if (progress < 1) requestAnimationFrame(tick)
        else this.npcManager.remove(npcId)
      }
      requestAnimationFrame(tick)
    }
  }

  private onNpcPhase(npcId: string, phase: string): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return

    this.vfx.stopThinkingAura(npc.mesh)
    this.vfx.stopWorkingStream(npc.mesh)

    const isWalking = npc.npcState === 'walking'
    const audio = getAudioSystem()

    const stationId = this.workflow.officeNpcStations.get(npcId)
    const isTrackedWorkingCitizen = this.workflow.workingCitizens.has(npcId)

    if (phase === 'working') {
      if (!isWalking) { npc.playAnim('typing'); this.vfx.workingStream(npc.mesh); audio.play('typing') }
      npc.setGlow('cyan'); npc.indicator.setState('working'); npc.setStatusEmoji('working')
      if (stationId) this.officeBuilder.setScreenState(stationId, { mode: 'coding', fileName: 'index.ts' })
    } else if (phase === 'thinking') {
      if (!isWalking) { npc.playAnim('thinking'); this.vfx.thinkingAura(npc.mesh) }
      npc.setGlow('yellow'); npc.indicator.setState('thinking'); npc.setStatusEmoji('working')
      if (stationId) this.officeBuilder.setScreenState(stationId, { mode: 'coding', fileName: 'index.ts' })
    } else if (phase === 'done') {
      npc.playAnim('cheer'); npc.setGlow('green'); npc.indicator.setState('done')
      npc.setStatusEmoji('celebrate')
      this.vfx.completionFirework(npc.getPosition()); audio.play('complete')
      this.workflow.workingCitizens.delete(npcId)
      this.workflow.onNpcWorkDone(npcId)
    } else if (phase === 'error') {
      npc.playAnim('frustrated'); npc.setGlow('red'); npc.indicator.setState('error')
      npc.setStatusEmoji('error')
      this.vfx.errorLightning(npc.getPosition()); audio.play('error')
      this.workflow.workingCitizens.delete(npcId)
    } else if (phase === 'idle') {
      npc.playAnim('idle'); npc.setGlow('none'); npc.indicator.setState('idle')
      npc.setStatusEmoji(null)
    } else if (phase === 'waiting') {
      npc.playAnim('idle'); npc.setGlow('gray'); npc.indicator.setState('waiting')
      npc.setStatusEmoji('working')
    } else if (phase === 'documenting') {
      npc.playAnim('reading'); npc.setGlow('yellow'); npc.indicator.setState('idle')
      npc.setStatusEmoji('📋')
    }

  }

  private onModeChange(event: GameEvent & { type: 'mode_change' }): void {
    const prevMode = this.modeManager.getMode()
    const prevWorkSubState = this.modeManager.getWorkSubState()
    if (event.mode === 'work') {
      this.followBehavior.stop()
      const nextWorkSubState = event.workSubState ?? 'summoning'
      const startingFreshWorkCycle =
        nextWorkSubState === 'summoning' && (prevMode !== 'work' || prevWorkSubState !== 'summoning')
      if (startingFreshWorkCycle) {
        this.workflow.cleanupOfficeWork()
        this.workflow.workingCitizens.clear()
      }
      if (!this.modeManager.isWorkMode()) {
        this.modeManager.enterWorkMode(event.taskDescription ?? '', nextWorkSubState)
      } else if (event.workSubState) {
        const current = this.modeManager.getWorkSubState()
        if (current !== event.workSubState) {
          this.modeManager.forceWorkSubState(event.workSubState)
        }
      }
      if (event.summonedNpcIds) {
        this.modeManager.setSummonedNpcs(event.summonedNpcIds)
      }
    } else {
      const wasWorkMode = this.modeManager.isWorkMode()
      this.modeManager.returnToLifeMode()
      if (wasWorkMode && this.sceneSwitcher.getSceneType() === 'town') {
        this.workflow.summonPlayed = false
        this.workflow.workingCitizens.clear()
        this.workflow.pendingSummonNpcs = []
        this.workflow.cleanupOfficeWork()
        this.dailyScheduler.scheduleStartDailyBehaviors(4500)
      }
    }
  }

  private onNpcMoveTo(
    npcId: string,
    target: { x: number; y: number; z: number },
    speed?: number,
    requestId?: string,
  ): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return

    if (npcId === 'user' || npcId === 'steward') {
      this.playerMoveEnabled = false
      this.followBehavior.stop()
    }

    npc.setVisible(true)
    npc.moveTo({ x: target.x, z: target.z }, speed ?? 3).then((status) => {
      if (npcId === 'user' || npcId === 'steward') {
        this.playerMoveEnabled = true
      }
      if (!requestId) return
      this.dataSource.sendAction({ type: 'npc_move_completed', npcId, requestId, status })
    })
  }

  private onNpcDailyBehaviorReady(npcId: string): void {
    this.dailyScheduler.addEligibleNpcId(npcId)
    if (this.sceneSwitcher.getSceneType() === 'town') {
      this.dailyScheduler.scheduleStartDailyBehaviors(800)
    }
  }

  private onNpcEmoji(_npcId: string, _emoji: string | null): void {
    // SVG status is now driven by npc_phase, not npc_emoji
  }

  private onNpcGlow(npcId: string, color: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) npc.setGlow(color)
  }

  private onNpcAnim(npcId: string, anim: string): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return
    if (anim === 'idle' && npc.state === 'walking') return
    npc.playAnim(anim as 'idle' | 'walk' | 'typing' | 'wave' | 'cheer')
  }

  private onCameraMove(target?: { x: number; y: number; z: number }, follow?: string, durationMs?: number): void {
    if (follow) {
      const npc = this.npcManager.get(follow)
      if (npc) this.cameraCtrl.follow(npc.mesh)
    } else if (target) {
      this.cameraCtrl.follow(null)
      this.cameraCtrl.moveTo({ x: target.x, z: target.z })
    }
  }

  private onFx(effect: string, params: Record<string, unknown>): void {
    const getNpc = (id?: unknown) => id ? this.npcManager.get(id as string) : null
    const audio = getAudioSystem()

    switch (effect) {
      case 'summon_ripple': {
        const npc = getNpc(params.npcId)
        const rawPos = params.position as { x: number; z: number } | undefined
        const pos = npc ? npc.getPosition() : (rawPos ? new THREE.Vector3(rawPos.x, 0, rawPos.z) : null)
        if (pos) { this.vfx.summonShockwave(pos); audio.play('summon') }
        break
      }
      case 'exclamation': {
        const npc = getNpc(params.npcId)
        if (npc) this.effects.exclamation(npc.mesh)
        break
      }
      case 'completion_stars': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.completionFirework(npc.getPosition())
        break
      }
      case 'error_sparks': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.errorLightning(npc.getPosition())
        break
      }
      case 'personaTransform': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.personaTransform(npc.mesh)
        break
      }
      case 'fileIcon': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.fileIcon(npc.mesh, (params.fileName as string) ?? 'file.ts')
        break
      }
      case 'workingStream': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.workingStream(npc.mesh)
        break
      }
      case 'searchRadar': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.searchRadar(npc.mesh)
        break
      }
      case 'connectionBeam': {
        const a = getNpc(params.fromNpcId)
        const b = getNpc(params.toNpcId)
        if (a && b) this.vfx.connectionBeam(a.mesh, b.mesh)
        break
      }
      case 'deployFireworks': {
        this.vfx.deployFireworks(new THREE.Vector3(15, 0, 12))
        break
      }
      case 'hookFlash': {
        const npc = getNpc(params.npcId)
        if (npc) this.vfx.hookFlash(npc.mesh)
        break
      }
      case 'routeDebugPath': {
        const rawPoints = Array.isArray(params.points) ? params.points : []
        this.vfx.routeDebugPath(
          rawPoints as Array<{ x: number; y?: number; z: number }>,
          Number(params.color ?? 0x33e0ff),
          Number(params.ttlMs ?? 5000),
        )
        break
      }
      case 'show_game_publish': {
        this.vfx.deployFireworks(new THREE.Vector3(15, 0, 12))
        audio.play('deploy')
        const p = params as { gameName?: string; team?: string; iframeSrc?: string; coverUrl?: string }
        if (p.iframeSrc) this.workflow.pendingGameIframeSrc = p.iframeSrc
        if (p.coverUrl) this.workflow.pendingGameCoverUrl = p.coverUrl
        if (p.gameName) this.workflow.pendingBriefingGameName = p.gameName
        this.ui.showGamePublish({
          gameName: p.gameName || t('new_game'),
          iframeSrc: p.iframeSrc || '',
        })
        break
      }
    }
  }

  private syncTopHudLayout(): void {
    const compactSideHud = this.modeManager.isWorkMode()
    this.modeIndicator?.setActionCompact(compactSideHud)
    this.timeHUD?.setCompact(compactSideHud)
  }

  // ── Tap detection ──

  private isSceneInteractionLocked(): { locked: boolean; reason: string } {
    const workSubState = this.modeManager.getWorkSubState()
    if (!this.inputEnabled) {
      return { locked: true, reason: 'input_disabled' }
    }
    if (
      this.modeManager.isWorkMode()
      && workSubState !== null
      && MainScene.NON_INTERACTIVE_WORK_SUBSTATES.has(workSubState)
    ) {
      return { locked: true, reason: `work_substate:${workSubState}` }
    }
    return { locked: false, reason: 'interactive' }
  }

  private handleTap(screenX: number, screenY: number): void {
    const rect = this.engine.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this.engine.camera)

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const worldPos = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, worldPos)

    if (worldPos) {
      const interactionLock = this.isSceneInteractionLocked()
      if (interactionLock.locked) return

      const tapRadius = this.sceneSwitcher.getSceneType() === 'office' ? 1.0 : 1.2
      const npc = this.npcManager.findNearestNPC(worldPos, tapRadius)
      if (npc) {
        this.handleNPCTap(npc)
        return
      }

      const curSceneType = this.sceneSwitcher.getSceneType()

      if (curSceneType === 'town') {
        for (const [buildingId, marker] of this.townBuilder.getDoorMarkers()) {
          const doorPos = new THREE.Vector3()
          marker.getWorldPosition(doorPos)
          if (worldPos.distanceTo(doorPos) < 5) {
            this.walkToDoor(buildingId, doorPos)
            return
          }
        }
      }

      if (curSceneType === 'office') {
        const wbMesh = this.officeBuilder.whiteboardMesh
        if (wbMesh) {
          const intersects = raycaster.intersectObject(wbMesh)
          if (intersects.length > 0) {
            this.ui.showWhiteboard()
            return
          }
        }
        
        const officeDoor = this.officeBuilder.doorPos
        if (worldPos.distanceTo(officeDoor) < 5) {
          this.walkToDoor('exit_office', officeDoor)
          return
        }
      }

      this.pendingDoorInteraction = null
      this.handleGroundTap(worldPos)
    }
  }

  private handleNPCTap(npc: NPC): void {
    const currentConfig = this.configStore.load()
    const configAvatarUrl = npc.id === 'steward'
      ? currentConfig?.steward.avatarUrl
      : npc.id === 'user'
        ? currentConfig?.user.avatarUrl
        : currentConfig?.citizens.find(c => c.id === npc.id)?.avatarUrl
    const config: NPCConfig = {
      id: npc.id, name: npc.name ?? npc.id,
      color: 0x888888, spawn: { x: 0, y: 0, z: 0 },
      role: 'worker', label: npc.label ?? npc.name ?? npc.id,
      characterKey: npc.characterKey,
      avatarUrl: configAvatarUrl,
    }

    const profile = this.getNpcProfilesCached().get(npc.id)
    const logs = this.dialogManager.getWorkLogs().get(npc.id)

    const isWorking = this.workflow.workingCitizens.has(npc.id)
    const agentConfigured = this.bootstrap.agentConfigMap.get(npc.id)
    const agentOnline = npc.id === 'steward'
      ? this.dataSource.connected
      : npc.id === 'user' ? undefined : !!(agentConfigured?.agentEnabled) || isWorking

    this.ui.showNPCCard({
      npc: config,
      state: npc.state || 'idle',
      specialty: profile?.specialty ?? '',
      persona: profile?.bio ?? this.personaStore.get(npc.id)?.coreSummary,
      workLogs: logs && logs.length > 0 ? logs : undefined,
      agentOnline,
      isWorking,
    })
  }

  private walkToDoor(buildingId: string, doorPos: THREE.Vector3): void {
    const sceneMap: Record<string, SceneType> = {
      office: 'office', museum: 'museum',
      exit_office: 'town', exit_museum: 'town',
    }
    const targetScene = sceneMap[buildingId]
    if (!targetScene) return
    if (targetScene === 'museum') return

    const mayor = this.npcManager.get('user')
    if (!mayor || !mayor.mesh.visible) return

    const dist = mayor.mesh.position.distanceTo(doorPos)
    if (dist < 2) {
      this.pendingDoorInteraction = null
      this.followBehavior.stop()
      if (targetScene === 'town') this.postTownReturnDebugFrames = 4
      this.sceneSwitcher.switchScene(targetScene)
      return
    }

    this.pendingDoorInteraction = { scene: targetScene, doorPos }
    mayor.moveTo({ x: doorPos.x, z: doorPos.z }, 2.5)
    this.cameraCtrl.follow(mayor.mesh)

    const steward = this.npcManager.get('steward')
    if (steward && steward.mesh.visible) {
      this.followBehavior.setTarget(mayor, steward)
      if (!this.followBehavior.isActive()) this.followBehavior.start()
    }
  }

  private handleGroundTap(worldPos: THREE.Vector3): void {
    const mayor = this.npcManager.get('user')
    if (!this.playerMoveEnabled) return
    if (!this.inputEnabled) return

    if (!mayor || !mayor.mesh.visible) return

    this.citizenChat.onPlayerMoveInterrupt()

    mayor.moveTo({ x: worldPos.x, z: worldPos.z }, 2.5)
    this.cameraCtrl.follow(mayor.mesh)

    const steward = this.npcManager.get('steward')
    if (steward && steward.mesh.visible) {
      this.followBehavior.setTarget(mayor, steward)
      if (!this.followBehavior.isActive()) this.followBehavior.start()
    }
  }

  // ── State persistence ──

  private snapshotSaveTimer: ReturnType<typeof setInterval> | null = null

  private startSnapshotSaving(): void {
    if (this.snapshotSaveTimer) return
    this.snapshotSaveTimer = setInterval(() => this.saveSnapshot(), 10_000)
  }

  private stopSnapshotSaving(): void {
    if (this.snapshotSaveTimer) {
      clearInterval(this.snapshotSaveTimer)
      this.snapshotSaveTimer = null
    }
  }

  private saveSnapshot(): void {
    try {
      const npcPositions: Record<string, { x: number; z: number }> = {}
      for (const npc of this.npcManager.getAll()) {
        const pos = npc.getPosition()
        npcPositions[npc.id] = { x: pos.x, z: pos.z }
      }
      const snapshot = {
        townJournal: this.townJournal.toJSON(),
        activityJournals: Array.from(this.dailyScheduler.getActivityJournals().entries()).map(
          ([id, j]) => [id, j.toJSON()] as const,
        ),
        npcPositions,
        currentScene: this.sceneSwitcher.getSceneType(),
        globalMode: this.modeManager.isWorkMode() ? 'work' : 'life',
        gameClockState: this.gameClock.getState(),
      }
      localStorage.setItem(
        this.configStore.getScopedKey('agentshire_snapshot'),
        JSON.stringify(snapshot),
      )
    } catch {
      // localStorage full or unavailable
    }
  }

  private restoreSnapshot(): boolean {
    try {
      const raw = localStorage.getItem(this.configStore.getScopedKey('agentshire_snapshot'))
      if (!raw) return false
      const snapshot = JSON.parse(raw)
      if (snapshot.townJournal) this.townJournal.restore(snapshot.townJournal)
      if (snapshot.activityJournals) {
        for (const [id, data] of snapshot.activityJournals) {
          const journal = this.dailyScheduler.getActivityJournals().get(id)
          if (journal) journal.restore(data)
        }
      }
      if (snapshot.gameClockState?.hour != null) {
        this.gameClock.setTime(snapshot.gameClockState.hour)
      }
      return true
    } catch {
      return false
    }
  }

  // ── Update loop ──

  update(deltaTime: number): void {
    if (!this.cameraCtrl) return

    if (this.pendingDoorInteraction) {
      const mayor = this.npcManager.get('user')
      if (mayor) {
        const dist = mayor.mesh.position.distanceTo(this.pendingDoorInteraction.doorPos)
        if (dist < 2) {
          const target = this.pendingDoorInteraction.scene
          this.pendingDoorInteraction = null
          this.followBehavior.stop()
          if (target === 'town') this.postTownReturnDebugFrames = 4
          this.sceneSwitcher.switchScene(target)
          return
        }
      }
    }

    this.gameClock?.update(deltaTime)
    const curScene = this.sceneSwitcher.getSceneType()

    if (curScene === 'town') {
      this.cameraCtrl.update(deltaTime)
      this.timeOfDayLighting?.update(this.gameClock)
      this.weatherSystem?.update(deltaTime, this.gameClock)
      this.vehicleManager?.update(this.gameClock, deltaTime)
    } else if (curScene === 'office') {
      this.cameraCtrl.updateOfficePan(deltaTime)
    } else if (curScene === 'museum') {
      this.cameraCtrl.update(deltaTime)
    }

    this.followBehavior.update(deltaTime * 1000)
    this.citizenChat.update(deltaTime * 1000)

    this.timeHUD?.update(this.gameClock, this.weatherSystem?.getDisplayWeather())

    const clockState = this.gameClock?.getState()
    if (clockState && curScene === 'town') {
      this.ambientSound.setEnabled(true)
      this.ambientSound.update(
        deltaTime,
        this.weatherSystem?.getDisplayWeather() ?? 'clear',
        clockState.period,
      )
    } else {
      this.ambientSound.setEnabled(false)
    }

    if (clockState) {
      this.bgm.update(
        deltaTime,
        this.weatherSystem?.getDisplayWeather() ?? 'clear',
        clockState.period,
        curScene,
      )
    }

    const activeScene = curScene === 'office' ? this.officeScene
      : curScene === 'museum' ? this.museumScene
      : this.townScene
    this.npcManager?.update(deltaTime, this.engine.camera, this.engine.renderer, activeScene)
    if (curScene === 'town' && this.postTownReturnDebugFrames > 0) {
      this.postTownReturnDebugFrames -= 1
    }
    if (curScene === 'town') {
      const allNpcs = this.npcManager?.getAll() ?? []
      for (const b of this.dailyScheduler.getDailyBehaviors().values()) {
        b.update(deltaTime, allNpcs)
      }
      this.encounterManager?.update(deltaTime * 1000, allNpcs)
      this.casualEncounter?.update(
        deltaTime * 1000, allNpcs,
        this.weatherSystem?.getDisplayWeather(),
        this.gameClock?.getPeriod(),
      )
    }
    this.vfx?.update(deltaTime)
    this.bubbles?.update()
    if (curScene === 'office') {
      this.officeBuilder?.updateScreens(deltaTime)
      this.ui.updateWhiteboardMirror(this.officeBuilder.whiteboard.getCanvas())
    }
    this._minigameUpdateCb?.(deltaTime)
  }

  setImplicitChatFn(fn: ((req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }) => Promise<{ text: string; fallback: boolean }>) | null): void {
    this.dailyScheduler.setImplicitChatFn(fn)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  destroy(): void {
    this.stopSnapshotSaving()
    this.citizenChat.destroy()
    this.dailyScheduler.stopDailyBehaviors()
    this.encounterManager?.destroy()
    this.townJournal?.destroy()
    this.workflow.abort()
    this.workflow.destroy()
    this.minigame?.unmount()
    this.modeManager?.destroy()
    this.modeIndicator?.destroy()
    this.timeHUD?.destroy()
    this.weatherSystem?.destroy()
    this.ambientSound.destroy()
    this.bgm.destroy()
    removeDebugBindings()
    this.dataSource.disconnect()
    this.npcManager.destroy()
    this.cameraCtrl.destroy()
    this.bubbles.clear()
    this.vfx.clear()
    this.townBuilder.clear()
    this.officeBuilder.clear()
    this.museumBuilder.clear()
    this.vehicleManager.clear()
  }
}
