import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SceneBootstrap } from '../SceneBootstrap'
import type { PublishedCitizenConfig, PublishedCharacterEntry } from '../../data/CitizenWorkshopConfig'
import { createDefaultModelTransform } from '../../data/CitizenWorkshopConfig'

function makeEntry(overrides: Partial<PublishedCharacterEntry> & { id: string; role: 'user' | 'steward' | 'citizen' }): PublishedCharacterEntry {
  return {
    name: '', avatarUrl: '', modelUrl: '', avatarId: '', modelSource: 'builtin',
    bio: '', specialty: '', persona: '', personaFile: '', homeId: '',
    agentEnabled: false, animMapping: {}, animFileUrls: [],
    modelTransform: createDefaultModelTransform(),
    ...overrides,
  }
}

function makePublished(chars: PublishedCharacterEntry[]): PublishedCitizenConfig {
  return { version: 1, publishedAt: new Date().toISOString(), characters: chars }
}

function createMockDeps(overrides?: Partial<any>) {
  return {
    ui: {} as any,
    setupUI: { getTownConfig: vi.fn() } as any,
    npcManager: { get: vi.fn() } as any,
    cameraCtrl: { setAutoPilot: vi.fn(), follow: vi.fn(), moveTo: vi.fn() } as any,
    dataSource: {
      connect: vi.fn().mockResolvedValue({ hasWorkRestore: false }),
      connected: true,
      sendAction: vi.fn(),
      onGameEvent: vi.fn(),
      disconnect: vi.fn(),
    } as any,
    configStore: {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn(),
      setSessionId: vi.fn(),
    } as any,
    dispatchGameEvent: vi.fn(),
    addEligibleNpcId: vi.fn(),
    scheduleStartDailyBehaviors: vi.fn(),
    startSnapshotSaving: vi.fn(),
    setInputEnabled: vi.fn(),
    setDialogTarget: vi.fn(),
    isRuntimeStateRestored: vi.fn().mockReturnValue(false),
    ...overrides,
  }
}

describe('SceneBootstrap.loadFinalConfig', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns published config when fetch succeeds', async () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: '管家', avatarId: 'char-female-b' }),
      makeEntry({ id: 'user', role: 'user', name: '镇长', avatarId: 'char-male-c' }),
      makeEntry({ id: 'c1', role: 'citizen', name: '岩', avatarId: 'char-male-b', specialty: '木工与搭建' }),
    ])

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: published }),
    }) as any

    const deps = createMockDeps()
    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    expect(config.steward.name).toBe('管家')
    expect(config.user.name).toBe('镇长')
    expect(config.citizens).toHaveLength(1)
    expect(config.citizens[0].name).toBe('岩')
    expect(config.citizens[0].specialty).toBe('木工与搭建')
    expect(deps.configStore.save).toHaveBeenCalledWith(config)
  })

  it('falls back to localStorage when fetch returns null config', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: null }),
    }) as any

    const localConfig = { townName: '旧镇', steward: { name: 'Old', persona: '', avatarId: 'char-female-b' }, user: { name: '旧镇长', avatarId: 'char-male-c' }, citizens: [], createdAt: 1, version: 4 }
    const deps = createMockDeps()
    deps.configStore.load.mockReturnValue(localConfig)

    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    expect(config.steward.name).toBe('Old')
  })

  it('falls back to default when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error')) as any

    const deps = createMockDeps()
    deps.configStore.load.mockReturnValue(null)

    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    expect(config.steward).toBeDefined()
    expect(config.user).toBeDefined()
    expect(config.citizens.length).toBeGreaterThanOrEqual(0)
  })

  it('falls back to default when fetch returns non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as any

    const deps = createMockDeps()
    deps.configStore.load.mockReturnValue(null)

    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    expect(config.steward).toBeDefined()
    expect(config.version).toBe(4)
  })

  it('falls back when published characters is empty array', async () => {
    const published = makePublished([])
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: published }),
    }) as any

    const localConfig = { townName: '本地', steward: { name: 'Local', persona: '', avatarId: 'a' }, user: { name: 'U', avatarId: 'b' }, citizens: [], createdAt: 1, version: 4 }
    const deps = createMockDeps()
    deps.configStore.load.mockReturnValue(localConfig)

    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    expect(config.steward.name).toBe('Local')
  })

  it('published config with lib-*/custom-* models carries modelUrl/modelTransform/animMapping/animFileUrls', async () => {
    const transform = { scale: 1.6, rotationX: 0, rotationY: 180, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 }
    const anim = { idle: 'Idle_A', walk: 'Walk_A' }
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({
        id: 'c1', role: 'citizen', name: '橙子', avatarId: 'lib-5',
        modelUrl: '/ext-assets/Characters_1/gLTF/Characters/Character_5_1_1.glb',
        modelTransform: transform, animMapping: anim, animFileUrls: ['/a.glb'],
      }),
    ])

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: published }),
    }) as any

    const deps = createMockDeps()
    const bootstrap = new SceneBootstrap(deps)
    const config = await bootstrap.loadFinalConfig()

    const c = config.citizens[0]
    expect(c.avatarId).toBe('lib-5')
    expect(c.modelUrl).toBe('/ext-assets/Characters_1/gLTF/Characters/Character_5_1_1.glb')
    expect(c.modelTransform).toEqual(transform)
    expect(c.animMapping).toEqual(anim)
    expect(c.animFileUrls).toEqual(['/a.glb'])
  })

  it('connect and spawnFromConfig receive the same config object in startFlow', async () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: '管家' }),
      makeEntry({ id: 'user', role: 'user', name: '镇长' }),
      makeEntry({ id: 'c1', role: 'citizen', name: '岩', specialty: '架构' }),
    ])

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ config: published }),
    }) as any

    const deps = createMockDeps()
    const bootstrap = new SceneBootstrap(deps)
    await bootstrap.startFlow()

    const connectCall = deps.dataSource.connect.mock.calls[0][0]
    expect(connectCall.steward.name).toBe('管家')
    expect(connectCall.citizens).toHaveLength(1)
    expect(deps.dispatchGameEvent).toHaveBeenCalled()
    const spawnEvents = deps.dispatchGameEvent.mock.calls.filter(
      (c: any[]) => c[0].type === 'npc_spawn'
    )
    expect(spawnEvents.length).toBe(3)
  })

  it('mock mode does NOT fetch published config', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as any

    const deps = createMockDeps({
      dataSource: {
        connect: vi.fn().mockResolvedValue({ hasWorkRestore: false }),
        connected: true,
        sendAction: vi.fn(),
        onGameEvent: vi.fn(),
        disconnect: vi.fn(),
        startFirstVisit: vi.fn(),
      },
    })

    const bootstrap = new SceneBootstrap(deps)
    await bootstrap.startFlow()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
