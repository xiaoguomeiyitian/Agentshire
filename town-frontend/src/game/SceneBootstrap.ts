// @desc Initialization flow: startFlow, spawnFromConfig, playReturnAnimation, setup actions
import type { UIManager } from '../ui/UIManager'
import type { TownSetupUI } from '../ui/TownSetupUI'
import type { NPCManager } from '../npc/NPCManager'
import type { CameraController } from './visual/CameraController'
import type { IWorldDataSource } from '../data/IWorldDataSource'
import type { TownConfigStore } from '../data/TownConfigStore'
import type { MockDataSource } from '../data/MockDataSource'
import type { GameEvent, GameAction } from '../data/GameProtocol'
import { createDefaultTownConfig, publishedToTownView, setHasPublished } from '../data/TownConfig'
import type { TownConfig } from '../data/TownConfig'
import type { PublishedCitizenConfig } from '../data/CitizenWorkshopConfig'
import { t } from '../i18n'

export interface SceneBootstrapDeps {
  ui: UIManager
  setupUI: TownSetupUI
  npcManager: NPCManager
  cameraCtrl: CameraController
  dataSource: IWorldDataSource
  configStore: TownConfigStore
  dispatchGameEvent: (event: GameEvent) => void
  addEligibleNpcId: (id: string) => void
  scheduleStartDailyBehaviors: (delayMs: number) => void
  startSnapshotSaving: () => void
  setInputEnabled: (v: boolean) => void
  setDialogTarget: (id: string, name: string) => void
}

export interface AgentConfigEntry {
  agentEnabled: boolean
  agentId?: string
}

export class SceneBootstrap {
  private flowStarted = false
  private deps: SceneBootstrapDeps
  private _agentConfigMap = new Map<string, AgentConfigEntry>()

  constructor(deps: SceneBootstrapDeps) {
    this.deps = deps
  }

  get agentConfigMap(): Map<string, AgentConfigEntry> {
    return this._agentConfigMap
  }

  async loadFinalConfig(): Promise<TownConfig> {
    try {
      const res = await fetch('/citizen-workshop/_api/load-published', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) {
        const data = await res.json()
        const published = data.config as PublishedCitizenConfig | null
        if (published?.characters?.length) {
          setHasPublished(true)
          this.buildAgentConfigMap(published)
          const config = publishedToTownView(published)
          this.deps.configStore.save(config)
          return config
        }
      }
    } catch {
      // fetch failed — fall through to local/default
    }
    setHasPublished(false)
    const fallback = this.deps.configStore.load() ?? createDefaultTownConfig()
    return fallback
  }

  private buildAgentConfigMap(published: PublishedCitizenConfig): void {
    this._agentConfigMap.clear()
    for (const ch of published.characters) {
      if (ch.role === 'citizen') {
        this._agentConfigMap.set(ch.id, {
          agentEnabled: !!ch.agentEnabled,
          agentId: ch.agentId,
        })
      }
    }
  }

  async startFlow(): Promise<void> {
    if (this.flowStarted) return
    this.flowStarted = true

    const { dataSource, configStore } = this.deps
    const isMock = 'startFirstVisit' in dataSource

    if (isMock) {
      const existingConfig = configStore.load()
      if (!existingConfig) {
        const defaultConfig = createDefaultTownConfig()
        defaultConfig.citizens = []
        configStore.save(defaultConfig)
        await dataSource.connect(defaultConfig)
        ;(dataSource as MockDataSource).startFirstVisit()
      } else {
        await dataSource.connect(existingConfig)
        for (const c of existingConfig.citizens) {
          this.deps.addEligibleNpcId(c.id)
        }
        ;(dataSource as MockDataSource).startReturn()
        this.deps.scheduleStartDailyBehaviors(5000)
        this.deps.startSnapshotSaving()
      }
      return
    }

    const finalConfig = await this.loadFinalConfig()
    configStore.save(finalConfig)
    const result = await dataSource.connect(finalConfig)
    this.spawnFromConfig(finalConfig)

    if (result.hasWorkRestore) {
      const executeRestore = (dataSource as any)._executeRestore as (() => void) | undefined
      executeRestore?.()
      this.deps.setInputEnabled(true)
      this.deps.setDialogTarget('steward', finalConfig.steward.name)
      this.deps.startSnapshotSaving()
    } else {
      this.playReturnAnimation(finalConfig)
    }
  }

  spawnFromConfig(config: TownConfig): void {
    const { dispatchGameEvent } = this.deps

    dispatchGameEvent({
      type: 'npc_spawn', npcId: 'steward', name: config.steward.name,
      role: 'steward', category: 'steward',
      avatarId: config.steward.avatarId,
      modelUrl: config.steward.modelUrl,
      modelTransform: config.steward.modelTransform as any,
      animMapping: config.steward.animMapping as any,
      animFileUrls: config.steward.animFileUrls,
    })
    dispatchGameEvent({
      type: 'npc_spawn', npcId: 'user', name: config.user?.name ?? t('mayor'),
      role: 'general', category: 'citizen',
      avatarId: config.user?.avatarId,
      modelUrl: config.user?.modelUrl,
      modelTransform: config.user?.modelTransform as any,
      animMapping: config.user?.animMapping as any,
      animFileUrls: config.user?.animFileUrls,
    })
    for (const c of config.citizens) {
      this.deps.addEligibleNpcId(c.id)
      dispatchGameEvent({
        type: 'npc_spawn', npcId: c.id, name: c.name,
        role: c.specialty as any, category: 'citizen',
        specialty: c.specialty, persona: c.persona, avatarId: c.avatarId,
        modelUrl: c.modelUrl,
        modelTransform: c.modelTransform as any,
        animMapping: c.animMapping as any,
        animFileUrls: c.animFileUrls,
      })
    }
  }

  async playReturnAnimation(config: TownConfig): Promise<void> {
    const { cameraCtrl, npcManager } = this.deps

    cameraCtrl.setAutoPilot(false)
    cameraCtrl.follow(null)

    const userNpc = npcManager.get('user')
    const stewardNpc = npcManager.get('steward')

    if (userNpc) userNpc.setVisible(true)
    cameraCtrl.moveTo({ x: 39, z: 32 })

    await Promise.all([
      userNpc?.moveTo({ x: 40, z: 34 }, 2.5),
      stewardNpc?.moveTo({ x: 38, z: 34 }, 3),
    ])

    if (stewardNpc) stewardNpc.lookAtTarget?.({ x: 40, z: 34 })
    if (userNpc) userNpc.lookAtTarget?.({ x: 38, z: 34 })

    await this.delay(200)

    if (stewardNpc) {
      cameraCtrl.follow(stewardNpc.mesh)
    }

    this.deps.setInputEnabled(true)
    this.deps.setDialogTarget('steward', config.steward.name)
    this.deps.scheduleStartDailyBehaviors(500)
    this.deps.startSnapshotSaving()
  }

  async handleSetupAction(action: GameAction): Promise<void> {
    const { setupUI, dataSource, configStore } = this.deps
    if (action.type === 'town_setup_complete') {
      const config = setupUI.getTownConfig()
      configStore.save(config)

      if ('updateTownConfig' in dataSource) {
        ;(dataSource as MockDataSource).updateTownConfig(config)
      }

      const isMock = 'startFirstVisit' in dataSource

      if (!isMock) {
        this.showTownInitLoading()
      }

      if (!dataSource.connected) {
        await dataSource.connect(config)
      }

      dataSource.sendAction(action)
    }
  }

  showTownInitLoading(): void {
    const el = document.getElementById('town-init-loading')
    if (el) el.classList.add('visible')
  }

  hideTownInitLoading(): void {
    const el = document.getElementById('town-init-loading')
    if (el) el.classList.remove('visible')
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }
}
