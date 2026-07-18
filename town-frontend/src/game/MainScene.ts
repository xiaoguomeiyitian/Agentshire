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
import { apiUrl } from '@/utils/api-base'
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
import { WAYPOINTS, updateWaypointsFromMapConfig, BUILDING_REGISTRY, getBuildingName, getAreaName, MODEL_KEY_TO_ROLE, type SceneType, type NPCConfig } from '../types'
import type { IWorldDataSource } from '../data/IWorldDataSource'
import type { GameEvent, GameNPCRole } from '../data/GameProtocol'
import { t } from '../i18n'
import type { TownConfigStore } from '../data/TownConfigStore'
import { EventDispatcher } from './EventDispatcher'
import { DialogManager } from './DialogManager'
import { getAnimalModeManager } from './animal-mode'
import { SceneBootstrap } from './SceneBootstrap'
import type { PlatformBridge } from '../platform/Bridge'
import { CitizenChatManager } from '../npc/CitizenChatManager'
import { ActivityJournal } from '../npc/ActivityJournal'
import type { TownMapConfig, TerrainType } from '../editor/TownMapConfig'
import { createDefaultConfig } from '../editor/TownMapConfig'
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
  private platformBridge: PlatformBridge | null = null
  private townStatusTimer = 0

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
  private musicEnabled = true
  private timeHUD!: TimeHUD
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
  private pendingDoorInteraction: { scene: SceneType; doorPos: THREE.Vector3; virtualEnter?: { buildingName: string; buildingKey: string } } | null = null
  /** Issue 2+4: virtual building entry state */
  private isVirtualEnter = false
  private virtualEnterPos = { x: 0, z: 0 }
  private postTownReturnDebugFrames = 0

  private skillLearnCard: import('../ui/SkillLearnCard').SkillLearnCard | null = null
  private bubbleDebugEnabled = this.readBubbleDebugFlag()

  private dispatcher!: EventDispatcher
  private dialogManager!: DialogManager
  private currentSceneType: SceneType = 'town'
  private animalMode = getAnimalModeManager()
  private bootstrap!: SceneBootstrap
  private citizenChat!: CitizenChatManager
  private activityJournals = new Map<string, ActivityJournal>()
  private implicitChatFn: ((req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }) => Promise<{ text: string; fallback: boolean }>) | null = null

  constructor(engine: Engine, dataSource: IWorldDataSource, configStore: TownConfigStore) {
    this.engine = engine
    this.dataSource = dataSource
    this.configStore = configStore
    this.ui = new UIManager()
    // Wire AnimalModeManager's WS reporting to the dataSource
    this.animalMode.setDataSource(dataSource)
  }

  /** Inject the PlatformBridge so bubble content and town status can be forwarded to the parent React App. */
  setPlatformBridge(bridge: PlatformBridge): void {
    this.platformBridge = bridge
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
    // Async: load saved TownMapConfig and switch to config-driven mode if available
    this.loadMapConfigAsync()

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

    // Forward bubble content to parent React App via PlatformBridge
    this.bubbles.onBubble((npcId, text, isStreaming) => {
      if (!this.platformBridge) return
      if (isStreaming) return // only forward final non-streaming text to avoid spam
      const npc = this.npcManager.get(npcId)
      const npcName = npc?.label ?? npcId
      const clockState = this.gameClock?.getState()
      this.platformBridge.sendBubble({
        npcId, npcName, text, timestamp: Date.now(),
        townHour: clockState?.hour,
        townMinute: clockState?.minute,
        townPeriod: clockState?.period,
        townWeather: this.weatherSystem?.getDisplayWeather(),
      })
    })

    this.initSubModules()
    this.initEncounterManager()
    this.initModeSystem()
    this.initDebugHelpers()

    this.ui.on(event => {
      if (event.type === 'send_message') this.onUserMessage(event.text)
      if (event.type === 'play_now') {
        this.dataSource.sendAction({ type: 'game_popup_action', action: 'play_now', gameUrl: event.gameUrl })
        if (event.gameUrl) window.open(apiUrl(event.gameUrl), '_blank', 'noopener')
      }
      if (event.type === 'back_town') {
        // Issue 2+4: if in virtual building, exit it; otherwise switch scene
        if (this.isVirtualEnter) {
          void this.exitVirtualBuilding()
        } else {
          this.switchScene('town')
        }
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
    this.dialogManager = new DialogManager({
      bubbles: this.bubbles,
      ui: this.ui,
      npcManager: this.npcManager,
      logBubble: (stage, text) => this.logBubbleText(stage, text),
    })

    this.bootstrap = new SceneBootstrap({
      ui: this.ui,
      setupUI: this.setupUI,
      npcManager: this.npcManager,
      cameraCtrl: this.cameraCtrl,
      dataSource: this.dataSource,
      configStore: this.configStore,
      dispatchGameEvent: (event) => this.handleGameEvent(event),
      addEligibleNpcId: (_id) => { /* no-op: DailyScheduler removed */ },
      scheduleStartDailyBehaviors: (_ms) => { /* no-op: DailyScheduler removed */ },
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
      getBehavior: (_id) => undefined,
      getUser: () => this.npcManager.get('user'),
      getSteward: () => this.npcManager.get('steward'),
      getCameraCtrl: () => this.cameraCtrl,
      getFollowBehavior: () => this.followBehavior,
      getSceneType: () => this.currentSceneType,
      getAvatarUrl: (npcId) => {
        const config = this.configStore.load()
        return config?.citizens.find(c => c.id === npcId)?.avatarUrl
      },
      onDialogTargetChange: (npcId) => {
        this.dialogTarget = npcId
        // Issue 8: refresh NPC card panel immediately on target switch
        if (npcId && npcId !== 'steward') {
          this.showCurrentTargetDetail()
        }
      },
      onInputTargetChange: (npc) => {
        if (npc) {
          // Issue 2: enrich NPC config with specialty from citizen config
          const cfg = this.configStore.load()
          const citizenCfg = cfg?.citizens.find(c => c.id === npc.id)
          if (citizenCfg?.specialty) npc.specialty = citizenCfg.specialty
          this.ui.updateChatTargetIndicator(npc, true)
          // Issue 6: refresh tas-model to the citizen's model ref
          const modelRef = this.getModelRefForNpc(npc.id)
          const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
          if (tasModelEl) {
            tasModelEl.textContent = modelRef || ''
          }
          // Issue 1 (model id empty): fetch real model from agent config if published modelRef is empty
          if (!modelRef) void this.fetchAndUpdateModelDisplay(npc.id)
          // Issue 8: refresh NPC card panel when chat becomes active
          this.showCurrentTargetDetail()
        } else {
          this.ui.clearChatTarget()
          // Issue 6: reset tas-model when disconnecting back to steward.
          // Steward inherits the global default model — fetch it so the model id is shown.
          const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
          if (tasModelEl) {
            tasModelEl.textContent = ''
            void this.fetchAndUpdateModelDisplay('steward')
          }
        }
      },
      // Issue 7: show "walking toward citizen" status while approaching
      onApproachingStart: (npcId: string) => {
        const npc = this.npcManager.get(npcId)
        const name = npc?.label ?? npc?.name ?? npcId
        const tasNameEl = document.querySelector('#town-agent-status .tas-name') as HTMLElement | null
        if (tasNameEl) {
          tasNameEl.textContent = `${t('chat.walking_to')} ${name}`
        }
        const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
        if (tasModelEl) {
          const modelRef = this.getModelRefForNpc(npcId)
          tasModelEl.textContent = modelRef || ''
          // Issue 1 (model id empty): fetch real model from agent config if published modelRef is empty
          if (!modelRef) void this.fetchAndUpdateModelDisplay(npcId)
        }
        // Issue 8: refresh NPC card panel immediately
        this.showCurrentTargetDetail()
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
      getAllCitizenTargets: () => {
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
            spawn: { x: 0, y: 0, z: 0 },
            role: 'worker' as const,
            label: c.name,
            characterKey: c.avatarId,
            avatarUrl: c.avatarUrl,
          }))
      },
      isNpcOnMap: (npcId: string) => {
        const npc = this.npcManager.get(npcId)
        return !!npc && npc.mesh.visible
      },
      onSwitchToSteward: () => {
        this.dialogTarget = 'steward'
        this.citizenChat.resetIdleTimer()
        this.ui.updateChatTargetIndicator(null, false)
        // Issue 6: reset tas-model when switching back to steward.
        // Steward inherits the global default model — fetch it so the model id is shown.
        const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
        if (tasModelEl) {
          tasModelEl.textContent = ''
          void this.fetchAndUpdateModelDisplay('steward')
        }
        // Issue 8: refresh NPC card panel
        this.showCurrentTargetDetail()
      },
      onSwitchToCitizen: () => {
        const npcId = this.citizenChat.getActiveNpcId()
        if (!npcId || !this.citizenChat.canSwitchToCitizen()) return
        this.dialogTarget = npcId
        this.citizenChat.resetIdleTimer()
        this.ui.updateChatTargetIndicator(null, true)
        // Issue 6: refresh tas-model to the citizen's model ref
        const modelRef = this.getModelRefForNpc(npcId)
        const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
        if (tasModelEl) tasModelEl.textContent = modelRef || ''
        // Issue 8: refresh NPC card panel
        this.showCurrentTargetDetail()
      },
      onSwitchToSpecificCitizen: (npcId: string) => {
        this.citizenChat.startChat(npcId)
      },
    })

    this.dispatcher = new EventDispatcher({
      onNpcSpawn: (e) => this.onNpcSpawn(e),
      onNpcDespawn: (npcId) => this.onNpcDespawn(npcId),
      onNpcPhase: (npcId, phase) => this.onNpcPhase(npcId, phase),
      onNpcMoveTo: (npcId, target, speed, requestId) => this.onNpcMoveTo(npcId, target, speed, requestId),
      onNpcQuery: (requestId, query) => this.onNpcQuery(requestId, query),
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
      onNpcWorkDone: (npcId, _status, _stationId, _isTempWorker) => {
        this.minigame?.removeWorkingNpc(npcId)
      },
      onDialogMessage: (npcId, text, isStreaming) => this.dialogManager.onDialogMessage(npcId, text, isStreaming),
      onDialogEnd: (npcId) => this.dialogManager.onDialogEnd(npcId),
      onWorkstationAssign: (npcId, _stationId) => {
        this.minigame?.addWorkingNpc(npcId)
      },
      onWorkstationScreen: (stationId, state) => this.officeBuilder.setScreenState(stationId, state),
      onSceneSwitch: (target) => this.switchScene(target as SceneType),
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
      },
      onModeChange: (_event) => { /* ModeManager removed */ },
      onSummonNpcs: (_stewardId, _npcIds, _taskDescription) => { /* WorkflowHandler removed */ },
      onTaskBriefing: (_lines, _gameName) => { /* WorkflowHandler removed */ },
      onWorkStatusUpdate: (updates) => {
        for (const u of updates) this.onNpcPhase(u.npcId, u.phase)
      },
      onWorkComplete: (_taskDescription, _gameUrl) => { /* WorkflowHandler removed */ },
      onGameCompletionPopup: (_gameName, _gameUrl, _previewImageUrl) => { /* WorkflowHandler removed */ },
      onDeliverableCard: (event) => {
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
          this.skillLearnCard.show(slug, () => { /* playSkillAbsorb removed */ })
        }).catch(e => console.warn('[MainScene] SkillLearnCard import failed:', e))
      },
      onModeSwitch: (_mode, _taskDescription) => { /* ModeManager removed */ },
      onRestoreWorkState: (_agents) => { /* WorkflowHandler removed */ },
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
      onSceneEdit: (event) => this.handleSceneEdit(event),
      onWorkflowIntent: (event) => {
        // Issue 7: when the steward summons citizens for a task, suspend L2
        // autonomous LLM decisions so citizens stop making their own choices
        // (and calling the LLM) while the workflow is in progress. Resume
        // when the workflow returns to idle (workflow_return).
        if (!this.animalMode.isEnabled()) return
        if (event.type === 'workflow_summon' || event.type === 'workflow_assign' ||
            event.type === 'workflow_go_office' || event.type === 'workflow_publish') {
          this.animalMode.pauseL2Decisions()
        } else if (event.type === 'workflow_return') {
          this.animalMode.resumeL2Decisions()
        }
      },
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
      (_npcId) => { /* DailyBehavior removed */ },
      (_npcId) => { /* DailyBehavior removed */ },
      (_npcId) => false,
    )
    this.townJournal = new TownJournal(this.gameClock, {
      implicitChat: (req) => this.callImplicitChat(req),
    })
    this.gameClock.onPeriodChange('encounter-day-reset', (state) => {
      if (state.period === 'dawn') this.encounterManager.resetDayCooldowns()
    })
    this.gameClock.onPeriodChange('town-journal-period', (state) => {
      this.townJournal.recordTimeChange(state.period)
      // Nightly routine previously handled by DailyScheduler; now a no-op.
    })
    this.gameClock.onPeriodChange('animal-mode-period', (state) => {
      this.animalMode.onPeriodChange(state.period)
    })
    this.encounterManager.setOnBubble((npc, text, duration) => {
      this.bubbles.show(npc.mesh, text, duration)
    })
    this.encounterManager.setOnBubbleEnd((npc) => {
      this.bubbles.endStream(npc.mesh)
    })
    this.encounterManager.setJournalAccessor((id) => this.activityJournals.get(id))
    this.encounterManager.setPersonaStore(this.personaStore)
    this.encounterManager.setDialogueProvider(async (_opts) => {
      return ''
    })
    // Route all CasualEncounter bubbles through LLM (implicit chat)
    this.casualEncounter.setBubbleProvider(async (req) => {
      const persona = this.personaStore.get(req.npcId)
      const personaName = req.npcName ?? persona?.name ?? req.npcId
      const targetName = req.targetName ?? '路人'
      const weatherStr = req.weather ? `天气：${req.weather}。` : ''
      const periodStr = req.period ? `时段：${req.period}。` : ''
      // Inject recent topics so the LLM avoids repeating the same conversation
      const recentStr = (req.recentTopics && req.recentTopics.length > 0)
        ? `你们最近刚聊过这些，不要重复：${req.recentTopics.join('、')}。换个新话题。`
        : ''
      const system = req.scene === 'wave'
        ? `你是小镇居民"${personaName}"。你路过遇到了"${targetName}"，想打个招呼。请生成一句简短的打招呼语（10字以内），符合你的性格。只输出打招呼的内容，不要加引号或其他标记。`
        : `你是小镇居民"${personaName}"。你和"${targetName}"在小镇上偶遇并开始闲聊。请生成两句简短对话（每句15字以内），第一句是你说的，第二句是"${targetName}"说的。每句一行，不要加角色名前缀或引号。${weatherStr}${periodStr}${recentStr}`
      const result = await this.callImplicitChat({
        scene: 'casual_encounter',
        system,
        user: req.scene === 'wave' ? `对${targetName}打个招呼` : `和${targetName}闲聊两句`,
        maxTokens: 80,
        npcId: req.npcId,
      })
      return result.text
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

    this.modeIndicator.setActionCallback(() => {
      const cur = this.currentSceneType
      void this.switchScene(cur === 'office' ? 'town' : 'office')
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
      getWorkingNpcIds: () => [],
      getSceneType: () => this.currentSceneType,
      onUpdate: (cb) => { this._minigameUpdateCb = cb },
      offUpdate: () => { this._minigameUpdateCb = null },
    })
  }

  private initDebugHelpers(): void {
    installDebugBindings({
      encounter: {
        activeCount: () => this.encounterManager.getActiveDialogueCount(),
        resetCooldowns: () => this.encounterManager.resetDayCooldowns(),
      },
      townJournal: {
        events: (n?: number) => this.townJournal.getRecentEvents(n),
        descriptions: (n?: number) => this.townJournal.getRecentDescriptions(n),
        summaries: () => this.townJournal.getAllSummaries(),
        todayCount: () => this.townJournal.getCurrentDayEventCount(),
      },
      workflow: {
        testBanwei: (npcIds?: string[]) => {
          const ids = npcIds ?? this.npcManager.getAll().filter(n => n.id !== 'user' && n.id !== 'steward').map(n => n.id).slice(0, 3)
          for (const id of ids) this.minigame?.addWorkingNpc(id)
          console.log('[Debug] Banwei test started with NPCs:', ids)
        },
        testBanweiStop: () => {
          this.minigame?.stop()
          console.log('[Debug] Banwei test stopped')
        },
        help: () => {
          console.log(`
__workflow 演出测试指令:
  testBanwei(['citizen_1'])             — 启动班味小游戏测试
  testBanweiStop()                      — 停止班味小游戏
  getCamera()                          — 读取相机 lookAt + panBounds
  help()                                — 显示本帮助
          `)
        },
        getCamera: () => {
          const c = this.cameraCtrl as any
          return {
            targetLookAt: { x: c.targetLookAt?.x, y: c.targetLookAt?.y, z: c.targetLookAt?.z },
            currentLookAt: { x: c.currentLookAt?.x, y: c.currentLookAt?.y, z: c.currentLookAt?.z },
            panBounds: c.panBounds,
            patrolPoints: c.patrolPoints,
          }
        },
      },
    })
  }

  // ── User message from input bar ──

  showUserBubble(text: string): void {
    const userNpc = this.npcManager.get('user')
    this.logBubbleText('user_message', text)
    if (userNpc) this.bubbles.show(userNpc.mesh, text, getBubbleDurationMs(text, 'user'))
    // Issue 4: tag user messages with the current dialog target so the NPC card
    // can filter chat history per-citizen instead of showing all user messages.
    this.ui.addChatMessage({ from: t('mayor'), text, timestamp: Date.now(), targetNpcId: this.dialogTarget })
  }

  getDialogTarget(): string {
    return this.dialogTarget
  }

  /** Issue 3: Get the display name of the current dialog target (for usage meta tagging). */
  getDialogTargetDisplayName(): string | undefined {
    const targetId = this.dialogTarget
    if (!targetId) return undefined
    const npc = this.npcManager.get(targetId)
    if (!npc) return undefined
    return npc.label ?? npc.name ?? targetId
  }

  /** Get the agent ID for a given NPC (for model config updates). */
  getAgentIdForNpc(npcId: string): string | undefined {
    if (npcId === 'steward') return 'steward'
    return this.bootstrap?.agentConfigMap.get(npcId)?.agentId
  }

  /** Issue 6: Get the LLM model ref for a given NPC (for tas-model display). */
  getModelRefForNpc(npcId: string): string | undefined {
    if (npcId === 'steward') return undefined
    return this.bootstrap?.agentConfigMap.get(npcId)?.modelRef
  }

  /**
   * Issue 1 (model id empty): Fetch the agent's model from the backend
   * (openclaw.json agent config) and update the tas-model element.
   * The published config's modelRef is often empty; the real model lives
   * in the agent config. This is async.
   */
  async fetchAndUpdateModelDisplay(npcId: string): Promise<void> {
    const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null
    if (!tasModelEl) return
    // Only update if this NPC is still the current dialog target
    if (this.dialogTarget !== npcId) return
    // First try the published config modelRef (sync)
    const published = this.getModelRefForNpc(npcId)
    if (published) { tasModelEl.textContent = published; return }
    // Otherwise fetch from agent config API
    const agentId = this.getAgentIdForNpc(npcId)
    if (!agentId) { tasModelEl.textContent = ''; return }
    try {
      const resp = await fetch(apiUrl('/citizen-workshop/_api/get-agent-config'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      const data = await resp.json()
      if (this.dialogTarget !== npcId) return // stale
      // Prefer the agent's explicit model; fall back to the global default model
      // (returned as `defaultModel`) so inherited models are still displayed.
      // `agent.model` may be a string or { primary: "..." } — normalize it.
      const rawModel = data?.agent?.model
      const agentModel = typeof rawModel === 'string'
        ? rawModel
        : (rawModel && typeof rawModel === 'object' ? rawModel.primary : undefined)
      const model = agentModel ?? data?.defaultModel
      tasModelEl.textContent = model || ''
    } catch {
      tasModelEl.textContent = ''
    }
  }

  /** Show NPC detail card for the current dialog target (steward or citizen). */
  showCurrentTargetDetail(): void {
    const targetId = this.dialogTarget
    if (targetId === 'steward') {
      const steward = this.npcManager.get('steward')
      if (!steward) return
      const config = this.configStore.load()
      const stewardLabel = config?.steward.name ?? t('steward')
      // Gather chat messages for steward (filter by display name)
      const allChatMessages = this.ui.getChatPanel().getChatMessages()
      const mayorLabel = t('mayor')
      const isUserMsg = (from: string) => from === 'user' || from === '你' || from === 'Jin' || from === 'Mayor' || from === mayorLabel
      const stewardChatMessages = allChatMessages.filter(m =>
        // Issue 4: user messages tagged with targetNpcId='steward' (or legacy untagged user msgs)
        (isUserMsg(m.from) && (m.targetNpcId === 'steward' || !m.targetNpcId)) ||
        m.from === stewardLabel || m.from === 'steward' || m.from === 'shire'
      )
      this.ui.showNPCCard({
        npc: {
          id: 'steward', name: stewardLabel, color: 0x4488CC,
          spawn: { x: 0, y: 0, z: 0 }, role: 'producer', label: stewardLabel,
          characterKey: steward.characterKey ?? config?.steward.avatarId,
          avatarUrl: config?.steward.avatarUrl,
        },
        state: steward.state || 'idle',
        specialty: t('steward'),
        persona: this.personaStore.get('steward')?.coreSummary,
        agentOnline: this.dataSource.connected,
        chatMessages: stewardChatMessages.length > 0 ? stewardChatMessages : undefined,
        chatFetcher: () => {
          const all = this.ui.getChatPanel().getChatMessages()
          return all.filter(m =>
            (isUserMsg(m.from) && (m.targetNpcId === 'steward' || !m.targetNpcId)) ||
            m.from === stewardLabel || m.from === 'steward' || m.from === 'shire'
          )
        },
        agentId: 'town-steward',
      })
      return
    }

    // Citizen target
    const npc = this.npcManager.get(targetId)
    const config = this.configStore.load()
    const citizenConfig = config?.citizens.find(c => c.id === targetId)
    if (!npc || !citizenConfig) return

    const profile = this.getNpcProfilesCached().get(targetId)
    const logs = this.dialogManager.getWorkLogs().get(targetId)
    const agentConfigured = this.bootstrap.agentConfigMap.get(targetId)
    const agentOnline = !!(agentConfigured?.agentEnabled)

    // Gather activity journal data
    const journal = this.activityJournals.get(targetId)
    const recentActivities = journal ? journal.getRecentActivities(6) : undefined

    // Gather mood/needs/relationships from AnimalMode (if enabled)
    let mood: import('../ui/NpcCardPanel').MoodInfo | null = null
    let needs: import('../ui/NpcCardPanel').NeedsInfo | null = null
    let relationships: import('../ui/NpcCardPanel').RelationshipInfo[] | undefined
    if (this.animalMode.isEnabled()) {
      const needsEngine = this.animalMode.getNeedsEngine()
      const moodEngine = this.animalMode.getMoodEngine()
      const relEngine = this.animalMode.getRelationshipEngine()
      const needsSnap = needsEngine.getSnapshot(targetId)
      if (needsSnap) {
        needs = {
          needs: needsSnap.needs as Record<string, number>,
          urgent: needsSnap.urgent,
          lowest: needsSnap.lowest,
          average: needsSnap.average,
        }
        const moodState = moodEngine.compute(targetId, needsEngine)
        mood = {
          value: moodState.value,
          level: moodState.level,
          dominantNeed: moodState.dominantNeed,
        }
      }
      const allRels = relEngine.getAllRelationships(targetId)
      if (allRels.length > 0) {
        relationships = allRels.map(r => ({
          npcId: r.npcId, name: r.name, sentiment: r.sentiment,
          level: r.level, label: r.label, interactionCount: r.interactionCount,
        }))
      } else if (config) {
        // Issue 2: no interactions yet — show default values for all other
        // citizens so the "关系" tab is never empty. Default sentiment is 0
        // (neutral / acquaintance) with zero interaction count.
        relationships = config.citizens
          .filter(c => c.id !== targetId)
          .map(c => ({
            npcId: c.id,
            name: c.name,
            sentiment: 0,
            level: 'acquaintance',
            label: c.specialty ?? '',
            interactionCount: 0,
          }))
      }
    }

    // Gather chat messages for this citizen (filter by display name + targetNpcId)
    const allChatMessages = this.ui.getChatPanel().getChatMessages()
    const npcLabel = npc.label ?? npc.name ?? targetId
    const npcName = npc.name ?? targetId
    const mayorLabel = t('mayor')
    const isUserMsg = (from: string) => from === 'user' || from === '你' || from === 'Jin' || from === 'Mayor' || from === mayorLabel
    // Issue 4: user messages must be tagged with this citizen's targetNpcId to show here.
    // Legacy untagged user messages (targetNpcId undefined) are excluded to avoid cross-citizen bleed.
    const citizenChatMessages = allChatMessages.filter(m =>
      (isUserMsg(m.from) && m.targetNpcId === targetId) ||
      m.from === npcLabel || m.from === npcName || m.from === targetId
    )

    // Gather home building & current location for detail panel (issue 3)
    let homeBuilding: string | null = null
    let currentLocation: string | null = null
    if (this.animalMode.isEnabled()) {
      const homeKey = this.animalMode.getHomeBuilding(targetId)
      if (homeKey) {
        const bld = BUILDING_REGISTRY.find(b => b.key === homeKey)
        homeBuilding = bld ? bld.name : homeKey
      }
      // Compute current location: building name if indoors, area name if outdoors
      const indoor = this.animalMode.getIndoorTracker().getIndoorLocation(targetId)
      if (indoor) {
        const bld = BUILDING_REGISTRY.find(b => b.key === indoor)
        currentLocation = bld ? bld.name : indoor
      } else {
        const npcPos = this.npcManager.get(targetId)
        if (npcPos) {
          const pos = npcPos.getPosition()
          currentLocation = getAreaName(pos.x, pos.z)
        }
      }
    }

    this.ui.showNPCCard({
      npc: {
        id: npc.id, name: npc.name ?? npc.id,
        color: 0x4488CC, spawn: { x: 0, y: 0, z: 0 },
        role: 'worker', label: npc.label ?? npc.name ?? npc.id,
        characterKey: npc.characterKey,
        avatarUrl: citizenConfig.avatarUrl,
      },
      state: npc.state || 'idle',
      specialty: profile?.specialty ?? citizenConfig.specialty,
      persona: profile?.bio ?? this.personaStore.get(targetId)?.coreSummary,
      workLogs: logs && logs.length > 0 ? logs : undefined,
      agentOnline,
      recentActivities,
      mood,
      needs,
      relationships,
      chatMessages: citizenChatMessages.length > 0 ? citizenChatMessages : undefined,
      chatFetcher: () => {
        const all = this.ui.getChatPanel().getChatMessages()
        return all.filter(m =>
          (isUserMsg(m.from) && m.targetNpcId === targetId) ||
          m.from === npcLabel || m.from === npcName || m.from === targetId
        )
      },
      agentId: this.getAgentIdForNpc(targetId),
      homeBuilding,
      currentLocation,
    })
  }

  getUIManager(): UIManager { return this.ui }
  getNpcManager(): NPCManager { return this.npcManager }
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
    this.musicEnabled = enabled
    if (enabled) {
      this.bgm.setEnabled(true)
      this.ambientSound.setEnabled(true)
    } else {
      this.bgm.setEnabled(false)
      this.ambientSound.setEnabled(false)
    }
  }

  setSoulModeEnabled(_enabled: boolean): void {
  }

  setAnimalModeEnabled(enabled: boolean): void {
    // Exclude the mayor (user) — player-controlled, no autonomous decisions.
    const citizenIds = this.npcManager.getWorkers().map((n) => n.id).filter((id) => id !== 'user')
    console.log(`[MainScene] setAnimalModeEnabled(${enabled}) citizens=[${citizenIds.join(',')}]`)
    if (enabled) {
      // Inject deps for AutonomyEngine before enabling
      this.animalMode.setExternalDeps({
        implicitChat: (req) => this.callImplicitChat(req),
        getNearbyNpcs: (npcId, radius) => this.getNearbyNpcs(npcId, radius),
        getWeather: () => this.weatherSystem?.getDisplayWeather() ?? 'clear',
        getCurrentLocation: (npcId) => {
          const indoor = this.animalMode.getIndoorTracker().getIndoorLocation(npcId)
          if (indoor) {
            // Return building display name when indoors
            const bld = BUILDING_REGISTRY.find(b => b.key === indoor)
            return bld ? bld.name : indoor
          }
          const npc = this.npcManager.get(npcId)
          if (npc) {
            const pos = npc.getPosition()
            // Return area name (e.g. "西区", "广场") for outdoor positions
            return getAreaName(pos.x, pos.z)
          }
          return '未知'
        },
        // Issue 5: provide extra map info (sculptures / benches / props) so
        // citizens can reason about every map location, building, and sculpture.
        getMapInfo: () => this.buildExtraMapInfo(),
        getPersona: (npcId) => {
          const persona = this.personaStore.get(npcId)
          return persona?.coreSummary ?? '普通居民'
        },
        getCurrentPlan: (npcId) => {
          const journal = this.activityJournals.get(npcId)
          return journal?.currentPlan ?? null
        },
        onAction: (npcId, action) => this.executeAutonomyAction(npcId, action),
      })
      // Set home buildings for citizens — spatially balanced allocation.
      // Sort residential buildings by x coordinate, then alternate between
      // west (low x) and east (high x) so citizens spread across the map
      // instead of clustering on one side.
      const residentialBuildings = BUILDING_REGISTRY.filter(b => b.category === 'residential')
      if (residentialBuildings.length > 0) {
        // Sort by x coordinate (west → east)
        const sorted = [...residentialBuildings].sort((a, b) => {
          const ax = WAYPOINTS[a.key]?.x ?? 0
          const bx = WAYPOINTS[b.key]?.x ?? 0
          return ax - bx
        })
        // Interleave: pick from west and east ends alternately
        const allocated: typeof sorted = []
        let lo = 0, hi = sorted.length - 1
        let takeHigh = false
        while (lo <= hi) {
          if (takeHigh) {
            allocated.push(sorted[hi])
            hi--
          } else {
            allocated.push(sorted[lo])
            lo++
          }
          takeHigh = !takeHigh
        }
        citizenIds.forEach((id, i) => {
          const home = allocated[i % allocated.length]
          this.animalMode.setHomeBuilding(id, home.key)
        })
      }
      console.log(`[MainScene] Animal Mode taking over for ${citizenIds.length} citizens`)
      // Issue 2: create an ActivityJournal for each citizen so autonomy actions are recorded
      for (const id of citizenIds) {
        if (!this.activityJournals.has(id)) {
          const npc = this.npcManager.get(id)
          this.activityJournals.set(id, new ActivityJournal(id, npc?.label ?? npc?.name ?? id, this.gameClock))
        }
      }
    } else {
      console.log('[MainScene] Animal Mode disabled')
    }
    void this.animalMode.setEnabled(enabled, citizenIds, this.gameClock)
  }

  /**
   * Issue 5: Build extra map info (sculptures / benches / props) so citizens
   * can reason about every map location, building, and sculpture. Returns a
   * formatted string injected into the AutonomyEngine prompt.
   */
  private buildExtraMapInfo(): string {
    const config = this.townBuilder.getMapConfig()
    if (!config) return ''
    // Group props by modelKey and area so the list stays compact.
    const propGroups = new Map<string, Array<{ x: number; z: number }>>()
    for (const p of config.props ?? []) {
      const key = p.modelKey
      if (!propGroups.has(key)) propGroups.set(key, [])
      propGroups.get(key)!.push({ x: p.gridX, z: p.gridZ })
    }
    const lines: string[] = ['【地图物件】']
    // Buildings with full detail
    lines.push('建筑：')
    for (const b of config.buildings ?? []) {
      const role = (MODEL_KEY_TO_ROLE as Record<string, { name: string; category: string }>)[b.modelKey]
      const name = role?.name ?? b.modelKey
      lines.push(`  ${name}(${b.modelKey}) 坐标(${b.gridX},${b.gridZ}) 占地${b.widthCells}×${b.depthCells} 旋转${b.rotationY}°`)
    }
    // Props (sculptures, benches, bushes, etc.)
    lines.push('物件：')
    for (const [key, cells] of propGroups) {
      const xs = cells.map(c => c.x)
      const zs = cells.map(c => c.z)
      const cx = xs.reduce((a, b) => a + b, 0) / cells.length
      const cz = zs.reduce((a, b) => a + b, 0) / cells.length
      lines.push(`  ${key} ×${cells.length} 中心约(${cx.toFixed(0)},${cz.toFixed(0)})`)
    }
    return lines.join('\n')
  }

  /** Execute an AutonomyAction by making the NPC walk/talk/go-indoor. */
  private executeAutonomyAction(npcId: string, action: import('./animal-mode/AutonomyEngine').AutonomyAction): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) {
      console.warn(`[MainScene] executeAutonomyAction: NPC ${npcId} not found`)
      this.animalMode.setExecuting(npcId, false)
      return
    }
    // Issue 2: record autonomy actions to the activity journal so the Activity tab is populated
    const journal = this.activityJournals.get(npcId)
    const pos = npc.getPosition()
    const areaName = getAreaName(pos.x, pos.z)
    const recordActivity = (a: { action: import('../types').ActivityAction; detail: string; locationName?: string }) => {
      journal?.record({
        location: areaName,
        locationName: a.locationName ?? areaName,
        action: a.action,
        detail: a.detail,
      })
    }

    // Issue 1: citizens spawn hidden (startHidden); make visible when they start acting
    if (!npc.mesh.visible) npc.setVisible(true)
    console.log(`[MainScene] executeAutonomyAction: ${npcId} → ${action.type}`)
    this.animalMode.setExecuting(npcId, true)

    switch (action.type) {
      case 'satisfy_need': {
        // Walk to target place, then satisfy the need
        const targetPlace = action.action.targetPlace
        const wp = WAYPOINTS[targetPlace]
        if (!wp) {
          console.warn(`[MainScene] satisfy_need: waypoint ${targetPlace} not found`)
          this.animalMode.setExecuting(npcId, false)
          return
        }
        const placeName = getBuildingName(targetPlace) ?? targetPlace
        recordActivity({ action: 'need_urgent', detail: `前往${placeName}满足${action.need}需求`, locationName: placeName })
        // If goIndoor, become invisible on arrival
        const goIndoor = action.action.goIndoor
        npc.moveTo({ x: wp.x, z: wp.z }).then(async (status) => {
          if (status !== 'arrived') {
            this.animalMode.setExecuting(npcId, false)
            return
          }
          if (goIndoor) {
            this.animalMode.getIndoorTracker().enter(npcId, targetPlace)
            npc.mesh.visible = false
            console.log(`[MainScene] ${npcId} went indoor: ${targetPlace}`)
          }
          npc.transitionTo('working', { anim: action.action.anim })
          // Wait for satisfy duration, then restore need
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, action.action.satisfyDurationMs)
          })
          this.animalMode.getNeedsEngine().satisfy(npcId, action.need, action.action.satisfyAmount)
          recordActivity({ action: 'need_satisfied', detail: `在${placeName}满足了${action.need}需求`, locationName: placeName })
          if (goIndoor) {
            this.animalMode.getIndoorTracker().leave(npcId)
            npc.mesh.visible = true
          }
          npc.transitionTo('idle')
          console.log(`[MainScene] ${npcId} satisfied ${action.need} (+${action.action.satisfyAmount})`)
          this.animalMode.setExecuting(npcId, false)
        })
        break
      }
      case 'go_home': {
        const homeKey = this.animalMode.getHomeBuilding(npcId) ?? 'house_a_door'
        const wp = WAYPOINTS[homeKey]
        const homeName = getBuildingName(homeKey) ?? homeKey
        recordActivity({ action: 'went_indoor', detail: `回家（${homeName}）`, locationName: homeName, })
        if (wp) {
          npc.moveTo({ x: wp.x, z: wp.z }).then((status) => {
            if (status === 'arrived') {
              this.animalMode.getIndoorTracker().enter(npcId, homeKey)
              npc.mesh.visible = false
              console.log(`[MainScene] ${npcId} went home: ${homeKey}`)
            }
            this.animalMode.setExecuting(npcId, false)
          })
        } else {
          this.animalMode.setExecuting(npcId, false)
        }
        break
      }
      case 'leave_to': {
        // Try direct waypoint key first, then fallback to Chinese name → key mapping
        let wpKey = action.place
        let wp = WAYPOINTS[wpKey]
        if (!wp) {
          // Try matching by Chinese building name
          const building = BUILDING_REGISTRY.find(b => b.name === action.place || getBuildingName(b.key) === action.place)
          if (building) {
            wpKey = building.key
            wp = WAYPOINTS[wpKey]
          }
        }
        if (!wp) {
          // Fuzzy match: try matching by tag (e.g. "cafe_1" → cafe_door, "market_2" → market_door)
          const tagMatch = action.place.match(/^(cafe|market|office|museum|house_[abc]|user_home|coffee|shop|store)/i)
          if (tagMatch) {
            const tag = tagMatch[1].toLowerCase()
            const tagMap: Record<string, string> = {
              cafe: 'cafe_door', coffee: 'cafe_door', shop: 'cafe_door',
              market: 'market_door', store: 'market_door',
              office: 'office_door', museum: 'museum_door',
              house_a: 'house_a_door', house_b: 'house_b_door',
              house_c: 'house_c_door', user_home: 'user_home_door',
            }
            const mappedKey = tagMap[tag]
            if (mappedKey && WAYPOINTS[mappedKey]) {
              wpKey = mappedKey
              wp = WAYPOINTS[mappedKey]
            }
          }
        }
        const destName = getBuildingName(wpKey) ?? action.place
        recordActivity({ action: 'left_indoor', detail: `前往${destName}（${action.reason}）`, locationName: destName })
        if (wp) {
          npc.moveTo({ x: wp.x, z: wp.z }).then((status) => {
            console.log(`[MainScene] ${npcId} leave_to ${wpKey}: ${status}`)
            this.animalMode.setExecuting(npcId, false)
          })
        } else {
          console.warn(`[MainScene] leave_to: waypoint ${action.place} not found`)
          this.animalMode.setExecuting(npcId, false)
        }
        break
      }
      case 'talk_to': {
        const allNpcs = this.npcManager.getAll()
        const target = allNpcs.find(n => (n.label ?? n.id) === action.target || n.id === action.target)
        recordActivity({ action: 'chatted', detail: `与${action.target}聊天（${action.reason}）` })
        if (target) {
          console.log(`[MainScene] ${npcId} talk_to ${action.target}: ${action.reason}`)
          // Social interaction restores social + belonging needs
          this.animalMode.getNeedsEngine().satisfy(npcId, 'social', 15)
          this.animalMode.getNeedsEngine().satisfy(npcId, 'belonging', 8)
          // Issue 4: notify AutonomyEngine that chat started
          this.animalMode.getAutonomyEngine()?.notifyChatStart(npcId, action.target)
        }
        // Release after a delay (dialogue is async)
        // Issue 4: notify chat end when the dialogue window closes
        window.setTimeout(() => {
          this.animalMode.getAutonomyEngine()?.notifyChatEnd(npcId)
          this.animalMode.setExecuting(npcId, false)
        }, 5000)
        break
      }
      case 'invite_guest': {
        // Issue 7: host invites a guest to their home
        const allNpcs = this.npcManager.getAll()
        const guest = allNpcs.find(n => (n.label ?? n.id) === action.target || n.id === action.target)
        const homeKey = this.animalMode.getHomeBuilding(npcId)
        if (!guest || !homeKey) {
          console.warn(`[MainScene] invite_guest: guest=${action.target} home=${homeKey}`)
          this.animalMode.setExecuting(npcId, false)
          break
        }
        const homeWp = WAYPOINTS[homeKey]
        const homeName = getBuildingName(homeKey) ?? homeKey
        recordActivity({ action: 'chatted', detail: `邀请${action.target}来家里做客（${homeName}）`, locationName: homeName })

        // Host walks home first
        if (homeWp) {
          npc.moveTo({ x: homeWp.x, z: homeWp.z }).then((status) => {
            if (status === 'arrived') {
              this.animalMode.getIndoorTracker().enter(npcId, homeKey)
              npc.mesh.visible = false
              console.log(`[MainScene] ${npcId} (host) went home: ${homeKey}`)
            }
            this.animalMode.setExecuting(npcId, false)
          })
        } else {
          this.animalMode.setExecuting(npcId, false)
        }

        // Guest walks to host's home after a short delay
        const guestId = guest.id
        this.animalMode.setExecuting(guestId, true)
        window.setTimeout(() => {
          if (!homeWp) { this.animalMode.setExecuting(guestId, false); return }
          guest.moveTo({ x: homeWp.x, z: homeWp.z }).then((status) => {
            if (status === 'arrived') {
              this.animalMode.getIndoorTracker().enter(guestId, homeKey)
              guest.mesh.visible = false
              console.log(`[MainScene] ${guestId} (guest) entered ${npcId}'s home: ${homeKey}`)
              // Social boost for both
              this.animalMode.getNeedsEngine().satisfy(npcId, 'social', 20)
              this.animalMode.getNeedsEngine().satisfy(npcId, 'belonging', 15)
              this.animalMode.getNeedsEngine().satisfy(guestId, 'social', 20)
              this.animalMode.getNeedsEngine().satisfy(guestId, 'belonging', 15)
              // Guest leaves after a visit duration (5-10 minutes game-time → 30-60s real)
              const visitMs = 30000 + Math.random() * 30000
              window.setTimeout(() => {
                if (this.animalMode.getIndoorTracker().isIndoor(guestId)) {
                  this.animalMode.getIndoorTracker().leave(guestId)
                  guest.mesh.visible = true
                  guest.transitionTo('idle')
                  console.log(`[MainScene] ${guestId} (guest) left ${npcId}'s home after visit`)
                }
              }, visitMs)
            }
            this.animalMode.setExecuting(guestId, false)
          })
        }, 2000)
        break
      }
      case 'stay':
      default:
        recordActivity({ action: 'staying', detail: action.reason })
        console.log(`[MainScene] ${npcId} staying: ${action.reason}`)
        this.animalMode.setExecuting(npcId, false)
        break
    }
  }

  // ── Topic mode (group discussion) ──

  private topicNpcIds: string[] = []
  private topicGathering = false
  // Issue 5: track mayor's position while topic is active so citizens
  // re-gather around the mayor when the mayor moves.
  private topicMayorPos: THREE.Vector3 | null = null
  private topicFollowTimer = 0

  isTopicActive(): boolean {
    return this.topicNpcIds.length > 0
  }

  isTopicGathering(): boolean {
    return this.topicGathering
  }

  async gatherForTopic(npcIds: string[]): Promise<void> {
    this.topicNpcIds = npcIds
    this.topicGathering = true

    // Issue 5: pause autonomous L2 decisions for topic participants.
    // Note: pauseTopicAutonomy() was already called when the topic setup
    // panel opened (issue 2). We only mark participants as executing here;
    // the refcount ensures we don't double-pause.
    if (this.animalMode.isEnabled()) {
      for (const id of npcIds) this.animalMode.setExecuting(id, true)
    }

    for (const id of npcIds) {
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
      const speed = 2.5
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
    // Issue 5: record mayor's position so citizens can re-gather when mayor moves
    this.topicMayorPos = userNpc.mesh.position.clone()
  }

  dismissTopic(): void {
    const npcIds = [...this.topicNpcIds]
    this.topicNpcIds = []
    this.topicMayorPos = null
    this.topicFollowTimer = 0
    this.topicGathering = false

    // Issue 5: resume autonomous L2 decisions for topic participants.
    // Uses refcount so the resume balances the pause from pauseTopicAutonomy().
    if (this.animalMode.isEnabled()) {
      for (const id of npcIds) this.animalMode.setExecuting(id, false)
      this.resumeTopicAutonomy()
    }

    for (const npcId of npcIds) {
      const npc = this.npcManager.get(npcId)
      if (!npc) continue
      npc.transitionTo('idle')
    }
  }

  /**
   * Issue 2: Pause all citizens' autonomous L2 decisions (called when the
   * steward opens the topic setup panel, before any topic text is entered).
   * This prevents citizens from generating autonomous chat bubbles while the
   * user is still composing the topic. Safe to call multiple times — uses a
   * refcount so nested pause/resume calls don't prematurely resume.
   */
  private topicPauseRefCount = 0
  pauseTopicAutonomy(): void {
    if (!this.animalMode.isEnabled()) return
    this.topicPauseRefCount++
    if (this.topicPauseRefCount === 1) {
      this.animalMode.pauseL2Decisions()
    }
  }
  resumeTopicAutonomy(): void {
    if (!this.animalMode.isEnabled()) return
    if (this.topicPauseRefCount > 0) this.topicPauseRefCount--
    if (this.topicPauseRefCount === 0) {
      this.animalMode.resumeL2Decisions()
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

  // ── Map config loading (async, after hardcoded build) ──

  private _persistTimer: ReturnType<typeof setTimeout> | null = null
  private _mapConfigLoading = false

  private async loadMapConfigAsync(): Promise<void> {
    if (this._mapConfigLoading) return
    this._mapConfigLoading = true
    try {
      const res = await fetch(apiUrl('/town-map/_api/load'))
      if (!res.ok) return
      const data = await res.json()
      const config = data.config as TownMapConfig | null
      if (!config) return
      // Switch to config-driven mode: clear hardcoded scene and rebuild from config
      this.townBuilder.clear()
      this.townBuilder.buildFromConfig(config, this.assets)
      // Update vehicle road network to match the loaded map
      this.vehicleManager.loadRoadNetwork(config)
      // Update NPC waypoints/building registry so NPCs roam across the entire map
      updateWaypointsFromMapConfig(config)
      // Issue 6: install building-aware obstacle query so NPCs avoid walking
      // through buildings. Building rectangles are in world coords (gridX..gridX+widthCells).
      NPC.setObstacleQuery((x, z, radius = 0.5) => {
        for (const b of config.buildings) {
          const minX = b.gridX - radius
          const maxX = b.gridX + b.widthCells + radius
          const minZ = b.gridZ - radius
          const maxZ = b.gridZ + b.depthCells + radius
          if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
            // Issue 1: door zone exemption — allow NPCs to enter a 1.5-cell
            // wide strip in front of the building's door (south side, center).
            // This prevents NPCs from getting stuck circling the building
            // when their target is the door marker (which sits 0.5 cells
            // outside the building footprint).
            const doorX = b.gridX + b.widthCells / 2
            const doorZ = b.gridZ + b.depthCells + 0.5
            const distToDoor = Math.sqrt((x - doorX) ** 2 + (z - doorZ) ** 2)
            if (distToDoor < 1.8) return null
            return {
              minX: b.gridX, maxX: b.gridX + b.widthCells,
              minZ: b.gridZ, maxZ: b.gridZ + b.depthCells,
            }
          }
        }
        return null
      })
      // Update camera pan bounds to match the (possibly resized) map grid.
      this.cameraCtrl.setMapBounds(config.grid.cols, config.grid.rows)
      console.log('[MainScene] Loaded TownMapConfig:', config.grid.cols, '×', config.grid.rows,
        `(${config.buildings.length} buildings, ${config.props.length} props, ${config.roads.length} roads)`)
    } catch (e) {
      console.warn('[MainScene] Failed to load TownMapConfig:', e)
    } finally {
      this._mapConfigLoading = false
    }
  }

  private persistMapConfig(): void {
    const config = this.townBuilder.getMapConfig()
    if (!config) return
    if (this._persistTimer) clearTimeout(this._persistTimer)
    this._persistTimer = setTimeout(() => {
      fetch(apiUrl('/town-map/_api/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      }).catch(() => {})
    }, 1000)
  }

  // ── Scene edit handler (AI steward tools → world_control → scene_edit) ──

  handleSceneEdit(event: GameEvent & { type: 'scene_edit' }): void {
    const builder = this.townBuilder
    let config = builder.getMapConfig()
    if (!config) {
      // No saved config — initialize fresh (happens when town built from hardcoded BUILDINGS)
      config = createDefaultConfig()
      builder.initFromConfig(config, this.assets)
      console.log('[MainScene] handleSceneEdit: initialized fresh TownMapConfig (no saved config found)')
    }

    switch (event.action) {
      case 'place': {
        const id = event.objectId!
        if (event.category === 'building') {
          const b = {
            id, modelKey: event.modelKey!, modelUrl: event.modelUrl,
            gridX: event.gridX!, gridZ: event.gridZ!,
            widthCells: (event as any).widthCells ?? 1, depthCells: (event as any).depthCells ?? 1,
            rotationY: (event.rotationY ?? 0) as any, scale: event.scale ?? 1,
            doorSide: 'south' as const,
            fixRotationX: (event as any).fixRotationX,
            fixRotationY: (event as any).fixRotationY,
            fixRotationZ: (event as any).fixRotationZ,
          }
          config.buildings.push(b)
          builder.addBuilding(b, this.assets)
        } else if (event.category === 'prop') {
          const p = {
            id, modelKey: event.modelKey!, modelUrl: event.modelUrl,
            gridX: event.gridX!, gridZ: event.gridZ!,
            rotationY: event.rotationY ?? 0, scale: event.scale ?? 1,
            fixRotationX: (event as any).fixRotationX,
            fixRotationY: (event as any).fixRotationY,
            fixRotationZ: (event as any).fixRotationZ,
          }
          config.props.push(p)
          builder.addProp(p, this.assets)
        } else {
          const r = {
            id, modelKey: event.modelKey!, modelUrl: event.modelUrl,
            gridX: event.gridX!, gridZ: event.gridZ!,
            rotationY: (event.rotationY ?? 0) as any,
            fixRotationX: (event as any).fixRotationX,
            fixRotationY: (event as any).fixRotationY,
            fixRotationZ: (event as any).fixRotationZ,
          }
          config.roads.push(r)
          builder.addRoad(r, this.assets)
        }
        this.persistMapConfig()
        break
      }
      case 'move': {
        const item = builder.findObjectById(event.objectId!)
        if (item) {
          ;(item.data as any).gridX = event.gridX!
          ;(item.data as any).gridZ = event.gridZ!
          builder.updateObjectTransform(item)
          this.persistMapConfig()
        }
        break
      }
      case 'transform': {
        const item = builder.findObjectById(event.objectId!)
        if (item) {
          const d = item.data as any
          if (event.rotationY != null) d.rotationY = event.rotationY
          if (event.scale != null) d.scale = event.scale
          if (event.flipX != null) d.flipX = event.flipX
          if (event.flipZ != null) d.flipZ = event.flipZ
          builder.updateObjectTransform(item)
          this.persistMapConfig()
        }
        break
      }
      case 'delete': {
        const item = builder.findObjectById(event.objectId!)
        if (item) {
          const arr = item.kind === 'building' ? config.buildings
                     : item.kind === 'prop' ? config.props : config.roads
          const idx = arr.findIndex((x: any) => x.id === event.objectId)
          if (idx >= 0) arr.splice(idx, 1)
          builder.removeObject(event.objectId!)
          this.persistMapConfig()
        }
        break
      }
      case 'set_terrain': {
        for (const cell of event.cells ?? []) {
          if (config.terrain[cell.row]?.[cell.col]) {
            config.terrain[cell.row][cell.col] = { type: cell.type as TerrainType }
            builder.updateTerrainCell(cell.col, cell.row, cell.type as TerrainType)
          }
        }
        this.persistMapConfig()
        break
      }
      case 'expand': {
        builder.expandGrid(event.newCols!, event.newRows!)
        this.persistMapConfig()
        break
      }
    }
  }

  // ── GameEvent handlers ──

  private onNpcSpawn(event: GameEvent & { type: 'npc_spawn' }): void {
    const existing = this.npcManager.get(event.npcId)
    if (existing) {
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
    // Try to pick a home from the dynamic BUILDING_REGISTRY (residential buildings).
    // Fix: exclude userHome (building_G) so citizens don't spawn in the player's house.
    // Distribute evenly across west/east by sorting buildings by gridX and interleaving,
    // so citizens don't all cluster on one side of the map.
    const residentialBuildings = BUILDING_REGISTRY.filter(b =>
      b.category === 'residential' && b.tag !== 'userHome',
    )
    let homeKey: string
    let homeWp: { x: number; z: number } | undefined
    if (residentialBuildings.length > 0) {
      // Sort by gridX (west to east) then interleave: pick from front and back
      // alternately so citizens spread across both sides of the map.
      const sorted = [...residentialBuildings].sort((a, b) => {
        const ax = WAYPOINTS[a.key]?.x ?? 0
        const bx = WAYPOINTS[b.key]?.x ?? 0
        return ax - bx
      })
      const n = sorted.length
      const interleaved: typeof sorted = []
      let lo = 0, hi = n - 1
      let takeFront = true
      while (lo <= hi) {
        interleaved.push(takeFront ? sorted[lo++] : sorted[hi--])
        takeFront = !takeFront
      }
      const chosen = interleaved[citizenIndex % interleaved.length]
      homeKey = chosen.key
      homeWp = WAYPOINTS[homeKey]
    } else {
      homeKey = homeKeys[citizenIndex % homeKeys.length]
      homeWp = WAYPOINTS[homeKey]
    }

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
      // Citizens spawn visible at their home; Animal Mode will drive them to act
      startHidden = false
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

    // Issue 2: register citizen in Animal Mode's NeedsEngine when it spawns.
    // setAnimalModeEnabled may have run before NPCs spawned (empty citizenIds),
    // so we register late-arriving citizens here to ensure they get L2 decisions.
    // Exclude the mayor (user) — the mayor is player-controlled and should not
    // wander or make autonomous LLM decisions.
    if (event.category === 'citizen' && event.npcId !== 'user' && this.animalMode.isEnabled()) {
      this.animalMode.registerCitizen(event.npcId)
      // Issue 2: ensure an ActivityJournal exists for this citizen so autonomy actions are recorded
      if (!this.activityJournals.has(event.npcId)) {
        const npc = this.npcManager.get(event.npcId)
        this.activityJournals.set(event.npcId, new ActivityJournal(event.npcId, npc?.label ?? npc?.name ?? event.npcId, this.gameClock))
      }
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
    this.debugCharacterAssignments.delete(npcId)
    this.personaStore.remove(npcId)
    this.activityJournals.delete(npcId)

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

    if (phase === 'working') {
      if (!isWalking) { npc.playAnim('typing'); this.vfx.workingStream(npc.mesh); audio.play('typing') }
      npc.setGlow('cyan'); npc.indicator.setState('working'); npc.setStatusEmoji('working')
    } else if (phase === 'thinking') {
      if (!isWalking) { npc.playAnim('thinking'); this.vfx.thinkingAura(npc.mesh) }
      npc.setGlow('yellow'); npc.indicator.setState('thinking'); npc.setStatusEmoji('working')
    } else if (phase === 'done') {
      npc.playAnim('cheer'); npc.setGlow('green'); npc.indicator.setState('done')
      npc.setStatusEmoji('celebrate')
      this.vfx.completionFirework(npc.getPosition()); audio.play('complete')
    } else if (phase === 'error') {
      npc.playAnim('frustrated'); npc.setGlow('red'); npc.indicator.setState('error')
      npc.setStatusEmoji('error')
      this.vfx.errorLightning(npc.getPosition()); audio.play('error')
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

  /** Handle a spatial query from plugin tools (town_get_my_status / town_query_nearby_citizens). */
  private onNpcQuery(
    requestId: string,
    query: any,
  ): void {
    if (query.kind === 'self') {
      const npc = this.npcManager.get(query.npcId)
      if (!npc) {
        this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { error: `NPC "${query.npcId}" not found` } })
        return
      }
      const pos = npc.getPosition()
      this.dataSource.sendAction({
        type: 'npc_query_result',
        requestId,
        data: {
          npcId: npc.id,
          name: npc.name,
          state: npc.state,
          npcState: npc.npcState,
          position: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) },
          isMoving: npc.state === 'walking',
          isInActiveScene: npc.isInActiveScene,
        },
      })
      return
    }

    if (query.kind === 'nearby') {
      // nearby query
      let origin: { x: number; z: number }
      if (query.origin) {
        origin = query.origin
      } else if (query.callerNpcId) {
        const caller = this.npcManager.get(query.callerNpcId)
        const cp = caller?.getPosition()
        origin = cp ? { x: cp.x, z: cp.z } : { x: 0, z: 0 }
      } else {
        origin = { x: 0, z: 0 }
      }
      const radius = query.radius
      const results: Array<{ npcId: string; name: string; state: string; position: { x: number; y: number; z: number }; distance: number }> = []
      for (const npc of this.npcManager.getAll()) {
        if (query.callerNpcId && npc.id === query.callerNpcId) continue
        if (!npc.mesh.visible) continue
        const pos = npc.getPosition()
        const dx = pos.x - origin.x
        const dz = pos.z - origin.z
        const distance = Math.sqrt(dx * dx + dz * dz)
        if (distance <= radius) {
          results.push({
            npcId: npc.id,
            name: npc.name,
            state: npc.state,
            position: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) },
            distance: Number(distance.toFixed(2)),
          })
        }
      }
      results.sort((a, b) => a.distance - b.distance)
      this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { citizens: results } })
      return
    }

    if (query.kind === 'citizen_status') {
      // Animal Mode: return citizen needs + mood + location
      if (!this.animalMode.isEnabled()) {
        this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { error: '动森模式未开启' } })
        return
      }
      const npc = this.npcManager.get(query.npcId)
      if (!npc) {
        this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { error: `NPC "${query.npcId}" not found` } })
        return
      }
      const needs = this.animalMode.getNeedsEngine().getSnapshot(query.npcId)
      const mood = this.animalMode.getMoodEngine().compute(query.npcId, this.animalMode.getNeedsEngine())
      const indoor = this.animalMode.getIndoorTracker().getIndoorLocation(query.npcId)
      const pos = npc.getPosition()
      this.dataSource.sendAction({
        type: 'npc_query_result',
        requestId,
        data: {
          npcId: query.npcId,
          needs: needs?.needs ?? {},
          mood: { value: mood.value, level: mood.level },
          location: indoor ?? `(${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`,
        },
      })
      return
    }

    if (query.kind === 'citizen_memory') {
      // Animal Mode: return citizen memories (from in-memory cache)
      // Note: town_recall_memory tool reads directly from plugin-side files,
      // but this query is kept for frontend-side access if needed.
      const mem = this.animalMode.getMemoryStore().getMemory(query.npcId)
      if (!mem) {
        this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { dialogues: [], activities: [] } })
        return
      }
      const dialogues = query.topic
        ? this.animalMode.getMemoryStore().getDialogues(query.npcId, query.topic)
        : mem.dialogues
      this.dataSource.sendAction({
        type: 'npc_query_result',
        requestId,
        data: { dialogues, activities: mem.activities },
      })
      return
    }

    if (query.kind === 'place_occupants') {
      // Animal Mode: return occupants of a building (indoor tracker)
      if (!this.animalMode.isEnabled()) {
        this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { occupants: [] } })
        return
      }
      const occupants = this.animalMode.getIndoorTracker().getIndoorAt(query.buildingKey)
      this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { occupants } })
      return
    }

    if (query.kind === 'festival_status') {
      // Animal Mode: return festival status
      // FestivalEngine is not yet wired into AnimalModeManager; return inactive
      this.dataSource.sendAction({
        type: 'npc_query_result',
        requestId,
        data: { active: false, nextDay: 7 },
      })
      return
    }

    // Unknown query kind
    this.dataSource.sendAction({ type: 'npc_query_result', requestId, data: { error: `Unknown query kind: ${query.kind}` } })
  }

  private onNpcDailyBehaviorReady(_npcId: string): void {
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

  private onCameraMove(target?: { x: number; y: number; z: number }, follow?: string, _durationMs?: number): void {
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
        this.ui.showGamePublish({
          gameName: p.gameName || t('new_game'),
          iframeSrc: p.iframeSrc || '',
        })
        break
      }
    }
  }

  private syncTopHudLayout(): void {
    this.modeIndicator?.setActionCompact(false)
    this.timeHUD?.setCompact(false)
  }

  // ── Tap detection ──

  private isSceneInteractionLocked(): { locked: boolean; reason: string } {
    if (!this.inputEnabled) {
      return { locked: true, reason: 'input_disabled' }
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

      const tapRadius = this.currentSceneType === 'office' ? 1.0 : 1.2
      const npc = this.npcManager.findNearestNPC(worldPos, tapRadius)
      if (npc) {
        this.handleNPCTap(npc)
        return
      }

      const curSceneType = this.currentSceneType

      if (curSceneType === 'town') {
        // Issue 1+3: check door markers — find the NEAREST door within 3 cells.
        // Previously used 5-cell radius which was too large and caused clicks
        // on one building to enter a different building's door.
        let nearestDoorId: string | null = null
        let nearestDoorDist = Infinity
        let nearestDoorPos: THREE.Vector3 | null = null
        for (const [buildingId, marker] of this.townBuilder.getDoorMarkers()) {
          const doorPos = new THREE.Vector3()
          marker.getWorldPosition(doorPos)
          const d = worldPos.distanceTo(doorPos)
          if (d < 3 && d < nearestDoorDist) {
            nearestDoorDist = d
            nearestDoorId = buildingId
            nearestDoorPos = doorPos
          }
        }
        if (nearestDoorId && nearestDoorPos) {
          this.walkToDoor(nearestDoorId, nearestDoorPos)
          return
        }
        // Issue 3: check building label sprites (click name to enter)
        const labelSprites = this.townBuilder.getLabelSprites()
        for (const [buildingId, sprite] of labelSprites) {
          const intersects = raycaster.intersectObject(sprite)
          if (intersects.length > 0) {
            const doorMarker = this.townBuilder.getDoorMarker(buildingId)
            if (doorMarker) {
              const doorPos = new THREE.Vector3()
              doorMarker.getWorldPosition(doorPos)
              this.walkToDoor(buildingId, doorPos)
              return
            }
          }
        }
        // Issue 3: check building models (click building itself to enter)
        const buildingModels = this.townBuilder.getBuildingModels()
        for (const [buildingId, model] of buildingModels) {
          const intersects = raycaster.intersectObject(model, true)
          if (intersects.length > 0) {
            const doorMarker = this.townBuilder.getDoorMarker(buildingId)
            if (doorMarker) {
              const doorPos = new THREE.Vector3()
              doorMarker.getWorldPosition(doorPos)
              this.walkToDoor(buildingId, doorPos)
              return
            }
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

    const agentConfigured = this.bootstrap.agentConfigMap.get(npc.id)
    const agentOnline = npc.id === 'steward'
      ? this.dataSource.connected
      : npc.id === 'user' ? undefined : !!(agentConfigured?.agentEnabled)

    // Gather activity journal data (citizens only)
    let recentActivities: import('../ui/NpcCardPanel').RecentActivity[] | undefined
    let mood: import('../ui/NpcCardPanel').MoodInfo | null = null
    let needs: import('../ui/NpcCardPanel').NeedsInfo | null = null
    let relationships: import('../ui/NpcCardPanel').RelationshipInfo[] | undefined
    if (npc.id !== 'steward' && npc.id !== 'user') {
      const journal = this.activityJournals.get(npc.id)
      recentActivities = journal ? journal.getRecentActivities(6) : undefined
      if (this.animalMode.isEnabled()) {
        const needsEngine = this.animalMode.getNeedsEngine()
        const moodEngine = this.animalMode.getMoodEngine()
        const relEngine = this.animalMode.getRelationshipEngine()
        const needsSnap = needsEngine.getSnapshot(npc.id)
        if (needsSnap) {
          needs = {
            needs: needsSnap.needs as Record<string, number>,
            urgent: needsSnap.urgent,
            lowest: needsSnap.lowest,
            average: needsSnap.average,
          }
          const moodState = moodEngine.compute(npc.id, needsEngine)
          mood = {
            value: moodState.value,
            level: moodState.level,
            dominantNeed: moodState.dominantNeed,
          }
        }
        const allRels = relEngine.getAllRelationships(npc.id)
        if (allRels.length > 0) {
          relationships = allRels.map(r => ({
            npcId: r.npcId, name: r.name, sentiment: r.sentiment,
            level: r.level, label: r.label, interactionCount: r.interactionCount,
          }))
        }
      }
    }

    // Gather chat messages for this NPC (filter by display name + targetNpcId)
    const allChatMessages = this.ui.getChatPanel().getChatMessages()
    const npcLabel = npc.label ?? npc.name ?? npc.id
    const npcName = npc.name ?? npc.id
    const mayorLabel = t('mayor')
    const isUserMsg = (from: string) => from === 'user' || from === '你' || from === 'Jin' || from === 'Mayor' || from === mayorLabel
    // Issue 4: user messages must be tagged with this NPC's targetNpcId.
    // For steward, legacy untagged user messages are included.
    const includeUntagged = npc.id === 'steward'
    const npcChatMessages = allChatMessages.filter(m =>
      (isUserMsg(m.from) && (m.targetNpcId === npc.id || (includeUntagged && !m.targetNpcId))) ||
      m.from === npcLabel || m.from === npcName || m.from === npc.id
    )

    this.ui.showNPCCard({
      npc: config,
      state: npc.state || 'idle',
      specialty: profile?.specialty ?? '',
      persona: profile?.bio ?? this.personaStore.get(npc.id)?.coreSummary,
      workLogs: logs && logs.length > 0 ? logs : undefined,
      agentOnline,
      recentActivities,
      mood,
      needs,
      relationships,
      chatMessages: npcChatMessages.length > 0 ? npcChatMessages : undefined,
    })
  }

  private walkToDoor(buildingId: string, doorPos: THREE.Vector3): void {
    // Map buildingId to target scene.
    // buildingId can be a placement id (bobj_xxx) or a special key (exit_office).
    // Issue 2+4: support all building types — office/museum have interior scenes,
    // residential/commercial use "virtual enter" (mayor becomes invisible,
    // UI shows "在XX中", back button returns to town).
    let targetScene: SceneType | null = null
    let virtualEnter: { buildingName: string; buildingKey: string } | null = null

    if (buildingId === 'exit_office') {
      targetScene = 'town'
    } else if (buildingId === 'exit_museum') {
      targetScene = 'town'
    } else if (buildingId === 'exit_virtual') {
      targetScene = 'town'
    } else {
      // Look up the building's modelKey from the map config to determine scene
      const mapConfig = this.townBuilder.getMapConfig()
      if (mapConfig) {
        const building = mapConfig.buildings.find(b => b.id === buildingId)
        if (building) {
          const role = MODEL_KEY_TO_ROLE[building.modelKey]
          if (role) {
            if (building.modelKey === 'building_A') targetScene = 'office'
            else if (building.modelKey === 'building_H') targetScene = 'museum'
            else {
              // Issue 2+4: residential/commercial — virtual enter
              // Use getBuildingName to get the numbered display name (e.g. "住宅3", "咖啡店1")
              virtualEnter = {
                buildingName: getBuildingName(buildingId),
                buildingKey: buildingId,
              }
            }
          }
        }
      }
    }

    if (!targetScene && !virtualEnter) return
    if (targetScene === 'museum') return // museum not fully implemented yet

    const mayor = this.npcManager.get('user')
    if (!mayor || !mayor.mesh.visible) return

    const dist = mayor.mesh.position.distanceTo(doorPos)
    // Issue 1: increased from 2 to 2.5 so the mayor enters the building
    // sooner when close to the door, preventing circling around the door.
    if (dist < 2.5) {
      this.pendingDoorInteraction = null
      this.followBehavior.stop()
      if (targetScene === 'town') this.postTownReturnDebugFrames = 4
      if (virtualEnter) {
        void this.enterVirtualBuilding(virtualEnter.buildingName, virtualEnter.buildingKey, doorPos)
      } else if (targetScene) {
        void this.switchScene(targetScene)
      }
      return
    }

    this.pendingDoorInteraction = {
      scene: targetScene ?? 'town',
      doorPos,
      virtualEnter: virtualEnter ?? undefined,
    }
    mayor.moveTo({ x: doorPos.x, z: doorPos.z }, 2.5)
    this.cameraCtrl.follow(mayor.mesh)

    const steward = this.npcManager.get('steward')
    if (steward && steward.mesh.visible) {
      this.followBehavior.setTarget(mayor, steward)
      if (!this.followBehavior.isActive()) this.followBehavior.start()
    }
  }

  /** Issue 2+4: Virtual building entry — mayor becomes invisible, UI shows location. */
  private async enterVirtualBuilding(buildingName: string, _buildingKey: string, doorPos: THREE.Vector3): Promise<void> {
    await this.ui.fadeToBlack(300)
    this.bubbles?.clear()

    // Mayor becomes invisible (inside the building)
    const mayor = this.npcManager.get('user')
    const steward = this.npcManager.get('steward')
    if (mayor) mayor.mesh.visible = false
    if (steward) steward.mesh.visible = false

    // Show "在XX中" indicator and back button
    this.ui.showVirtualLocationIndicator(buildingName)
    this.ui.showBackButton(true)
    this.currentSceneType = 'town' // still town scene, just hidden
    this.virtualEnterPos = { x: doorPos.x, z: doorPos.z }
    this.isVirtualEnter = true
    this.inputEnabled = false // disable movement while inside

    await this.ui.fadeFromBlack(300)
  }

  /** Issue 2+4: Exit virtual building — return mayor to door position. */
  async exitVirtualBuilding(): Promise<void> {
    if (!this.isVirtualEnter) return
    await this.ui.fadeToBlack(300)

    const mayor = this.npcManager.get('user')
    const steward = this.npcManager.get('steward')
    if (mayor) {
      mayor.mesh.visible = true
      mayor.stopMoving()
      mayor.mesh.position.set(this.virtualEnterPos.x + 1, 0, this.virtualEnterPos.z + 1)
      mayor.playAnim('idle')
    }
    if (steward) {
      steward.mesh.visible = true
      steward.stopMoving()
      steward.mesh.position.set(this.virtualEnterPos.x - 1, 0, this.virtualEnterPos.z + 1)
      steward.playAnim('idle')
    }

    this.ui.hideVirtualLocationIndicator()
    this.ui.showBackButton(false)
    this.isVirtualEnter = false
    this.inputEnabled = true

    await this.ui.fadeFromBlack(300)
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
        npcPositions,
        gameClockState: this.gameClock.getState(),
      }
      localStorage.setItem(
        this.configStore.getScopedKey('agentshire_snapshot'),
        JSON.stringify(snapshot),
      )
      // Also report ActivityJournal snapshots + clock to plugin (server-side persistence)
      if (this.animalMode.isEnabled()) {
        this.animalMode.reportClockState()
      }
    } catch {
      // localStorage full or unavailable
    }
  }

  /** Restore Animal Mode state received from plugin (snapshots + clock). */
  restoreAnimalState(snapshots: Array<{ npcId: string; snapshot: any }>, clock: { dayCount: number; gameSeconds: number } | null): void {
    // Restore GameClock
    if (clock && typeof clock.dayCount === 'number' && typeof clock.gameSeconds === 'number') {
      this.gameClock.restoreFromPlugin(clock.dayCount, clock.gameSeconds)
    }
    // Reset AnimalMode needs-tick baseline AFTER clock restore to avoid huge delta
    this.animalMode.restoreAnimalState(snapshots, clock)
    console.log(`[MainScene] restoreAnimalState: ${snapshots.length} snapshots, clock=${clock ? 'yes' : 'no'}`)
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
          const ve = this.pendingDoorInteraction.virtualEnter
          const doorPos = this.pendingDoorInteraction.doorPos.clone()
          this.pendingDoorInteraction = null
          this.followBehavior.stop()
          if (target === 'town') this.postTownReturnDebugFrames = 4
          if (ve) {
            void this.enterVirtualBuilding(ve.buildingName, ve.buildingKey, doorPos)
          } else {
            void this.switchScene(target)
          }
          return
        }
      }
    }

    this.gameClock?.update(deltaTime)
    this.animalMode.update(deltaTime)
    const curScene: SceneType = this.currentSceneType

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

    // Issue 5: if topic is active and mayor has moved, re-gather citizens around mayor
    if (this.topicNpcIds.length > 0 && !this.topicGathering && this.topicMayorPos) {
      this.topicFollowTimer += deltaTime
      if (this.topicFollowTimer >= 0.5) {
        this.topicFollowTimer = 0
        const mayor = this.npcManager.get('user')
        if (mayor && mayor.mesh.visible) {
          const mayorPos = mayor.mesh.position
          const moved = mayorPos.distanceTo(this.topicMayorPos)
          if (moved > 1.5) {
            // Mayor moved significantly — re-gather citizens
            this.topicMayorPos = mayorPos.clone()
            const center = mayorPos.clone()
            const RADIUS = 3.0
            const ARC_SPAN = Math.PI
            const startAngle = -ARC_SPAN / 2
            for (let i = 0; i < this.topicNpcIds.length; i++) {
              const npc = this.npcManager.get(this.topicNpcIds[i])
              if (!npc) continue
              const angle = startAngle + (ARC_SPAN / Math.max(this.topicNpcIds.length - 1, 1)) * i
              const tx = center.x + Math.sin(angle) * RADIUS
              const tz = center.z + Math.cos(angle) * RADIUS
              npc.moveTo({ x: tx, z: tz }, 2.5)
            }
          }
        }
      }
    }

    this.timeHUD?.update(this.gameClock, this.weatherSystem?.getDisplayWeather())

    const clockState = this.gameClock?.getState()
    if (clockState && curScene === 'town') {
      this.ambientSound.setEnabled(this.musicEnabled)
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
      // Skip NPC random behaviors when gateway is offline
      if (this.dataSource.connected) {
        // Issue 7: when a topic is active (citizens gathered around mayor),
        // suspend casual encounters and deep dialogues so citizens stay put
        // and don't make autonomous decisions while the topic is in progress.
        const topicActive = this.topicNpcIds.length > 0
        if (!topicActive) {
          this.encounterManager?.update(deltaTime * 1000, allNpcs)
          this.casualEncounter?.update(
            deltaTime * 1000, allNpcs,
            this.weatherSystem?.getDisplayWeather(),
            this.gameClock?.getPeriod(),
          )
        }
      }
    }
    this.vfx?.update(deltaTime)
    this.bubbles?.update()
    if (curScene === 'office') {
      this.officeBuilder?.updateScreens(deltaTime)
      this.ui.updateWhiteboardMirror(this.officeBuilder.whiteboard.getCanvas())
    }
    this._minigameUpdateCb?.(deltaTime)

    // Forward town status to parent React App every ~2s
    this.townStatusTimer += deltaTime
    if (this.platformBridge && this.townStatusTimer >= 2.0) {
      this.townStatusTimer = 0
      const clockState = this.gameClock?.getState()
      const weather = this.weatherSystem?.getDisplayWeather() ?? 'clear'
      const residentCount = this.npcManager?.getAll().filter(n => n.role !== 'user').length ?? 0
      if (clockState) {
        this.platformBridge.sendTownStatus({
          hour: clockState.hour,
          minute: clockState.minute,
          period: clockState.period,
          dayCount: clockState.dayCount,
          weather,
          residentCount,
          timestamp: Date.now(),
        })
      }
    }
  }

  setImplicitChatFn(fn: ((req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }) => Promise<{ text: string; fallback: boolean }>) | null): void {
    this.implicitChatFn = fn
  }

  /** Call the implicit chat function (injected by main.ts via setImplicitChatFn). */
  async callImplicitChat(req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }): Promise<{ text: string; fallback: boolean }> {
    if (!this.implicitChatFn) return { text: '', fallback: true }
    let agentId = req.agentId
    if (!agentId && req.npcId) {
      agentId = this.getAgentIdForNpc(req.npcId)
    }
    return this.implicitChatFn({ ...req, ...(agentId ? { agentId } : {}) })
  }

  /** Switch the active scene with fade transition, NPC repositioning, and camera change. */
  async switchScene(scene: SceneType): Promise<void> {
    if (this.currentSceneType === scene) return

    // Fade to black
    await this.ui.fadeToBlack(300)

    // Clear chat bubbles
    this.bubbles?.clear()

    this.currentSceneType = scene

    let targetScene: THREE.Scene
    if (scene === 'office') {
      targetScene = this.officeScene
      this.vfx?.setScene(this.officeScene)
      this.weatherSystem?.setEnabled(false)

      // Move steward and user into the office scene
      const visitNpcIds = ['steward', 'user']
      this.npcManager.moveNpcsToScene(visitNpcIds, this.officeScene)

      // Position NPCs at the office door, then walk them inside
      const OFFICE_DOOR = this.officeBuilder.doorPos
      const movePromises: Promise<unknown>[] = []
      for (const id of visitNpcIds) {
        const npc = this.npcManager.get(id)
        if (npc) {
          npc.mesh.position.set(
            OFFICE_DOOR.x + (id === 'user' ? 1.5 : -1.5),
            0,
            OFFICE_DOOR.z,
          )
          npc.playAnim('walk')
          movePromises.push(
            npc.moveTo({ x: OFFICE_DOOR.x + (id === 'user' ? 1.5 : -1.5), z: 12 }, 2.5)
            .then(() => npc.playAnim('idle')),
          )
        }
      }
      Promise.allSettled(movePromises).then(() => {
        this.inputEnabled = true
      })

      this.ui.showBackButton(false)
      this.cameraCtrl.enterOfficeMode()
    } else if (scene === 'museum') {
      targetScene = this.museumScene
      this.vfx?.setScene(this.museumScene)
      this.weatherSystem?.setEnabled(false)
      this.npcManager.setScene(this.museumScene)
      this.ui.showBackButton(true)
      this.cameraCtrl.setAutoPilot(false)
      this.cameraCtrl.follow(null)
      this.engine.camera.position.set(12, 20, 18)
      this.engine.camera.lookAt(12, 0, 9)
    } else {
      // Return to town
      targetScene = this.townScene
      this.vfx?.setScene(this.townScene)
      this.weatherSystem?.setEnabled(true)

      // Find the door position to return to
      const mapConfig = this.townBuilder.getMapConfig()
      let returnPos = { x: WAYPOINTS.plaza_center?.x ?? 18, z: WAYPOINTS.plaza_center?.z ?? 13 }

      // Try to find the office building's door position
      if (mapConfig) {
        const officeBuilding = mapConfig.buildings.find(b => b.modelKey === 'building_A')
        if (officeBuilding) {
          returnPos = {
            x: officeBuilding.gridX + officeBuilding.widthCells / 2,
            z: officeBuilding.gridZ + officeBuilding.depthCells + 1,
          }
        }
      }

      this.npcManager.setScene(this.townScene)
      this.ui.showBackButton(false)

      const userNpc = this.npcManager.get('user')
      const stewardNpc = this.npcManager.get('steward')
      if (userNpc) {
        userNpc.stopMoving()
        userNpc.mesh.position.set(returnPos.x + 1, 0, returnPos.z + 1)
        userNpc.playAnim('idle')
      }
      if (stewardNpc) {
        stewardNpc.stopMoving()
        stewardNpc.mesh.position.set(returnPos.x - 1, 0, returnPos.z + 1)
        stewardNpc.playAnim('idle')
      }
      this.cameraCtrl.leaveOfficeMode()
      this.cameraCtrl.setAutoPilot(false)
      this.cameraCtrl.moveTo({ x: returnPos.x, z: returnPos.z + 4 })
    }

    this.engine.world.scene = targetScene
    this.bubbles?.updateCamera(this.engine.camera)

    // Fade from black
    await this.ui.fadeFromBlack(300)
  }

  /** Get NPCs within a radius of the given NPC (for AnimalMode spatial awareness). */
  getNearbyNpcs(npcId: string, radius: number): Array<{ npcId: string; name: string; distance: number }> {
    const npc = this.npcManager?.get(npcId)
    if (!npc) return []
    const allNpcs = this.npcManager?.getAll() ?? []
    const result: Array<{ npcId: string; name: string; distance: number }> = []
    for (const other of allNpcs) {
      if (other.id === npcId || other.id === 'steward' || other.id === 'user') continue
      const dist = npc.getPosition().distanceTo(other.getPosition())
      if (dist < radius) {
        result.push({ npcId: other.id, name: other.label ?? other.id, distance: dist })
      }
    }
    return result.sort((a, b) => a.distance - b.distance)
  }

  /** Called when the WebSocket connection state changes. */
  onConnectionChange(connected: boolean): void {
    console.log(`[MainScene] onConnectionChange(${connected})`)
    if (!connected) {
      // Gateway disconnected — stop casual encounters
      this.encounterManager?.setExcludedNpcs(new Set(this.npcManager?.getAll().map((n) => n.id) ?? []))
      console.log('[MainScene] Gateway offline: stopped CasualEncounter')
    } else {
      // Gateway reconnected — resume casual encounters only if Animal Mode is NOT enabled.
      if (!this.animalMode.isEnabled()) {
        this.encounterManager?.setExcludedNpcs(new Set())
        console.log('[MainScene] Gateway online: resumed CasualEncounter (Animal Mode off)')
      } else {
        console.log('[MainScene] Gateway online: Animal Mode active, keeping CasualEncounter stopped')
      }
    }
  }

  destroy(): void {
    this.stopSnapshotSaving()
    this.citizenChat.destroy()
    this.encounterManager?.destroy()
    this.townJournal?.destroy()
    this.minigame?.unmount()
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
