import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'

// Mock openclaw peer dependencies so editor-serve.js can be imported in test env
vi.mock('openclaw/plugin-sdk/core', () => ({ type: {} }))
vi.mock('openclaw/plugin-sdk/channel-inbound', () => ({
  buildChannelInboundEventContext: () => ({}),
}))
vi.mock('openclaw/plugin-sdk/runtime-store', () => ({
  createPluginRuntimeStore: () => ({
    setRuntime: () => {},
    getRuntime: () => ({ channel: { reply: {} }, config: { current: () => ({}) } }),
  }),
}))
vi.mock('../runtime.js', () => ({
  setTownRuntime: () => {},
  getTownRuntime: () => ({ channel: { reply: {} }, config: { current: () => ({}) } }),
}))
vi.mock('../channel.js', () => ({
  buildTownInboundContext: () => ({}),
}))
vi.mock('../ws-server.js', () => ({
  broadcastAgentEvent: () => {},
  getActiveTownSessionId: () => null,
}))
vi.mock('../paths.js', () => ({
  stateDir: () => '/tmp/agentshire-test',
  initStateDir: () => {},
}))
vi.mock('../auth.js', () => ({
  parseSessionToken: () => null,
  isValidSession: () => true,
  isPasswordAuthEnabled: () => false,
  requireAuth: () => false,
}))
vi.mock('../subagent-tracker.js', () => ({
  getActivityLogForAgent: () => [],
}))
vi.mock('../session-history.js', () => ({
  loadChatHistory: () => [],
  loadNewMessages: () => [],
  invalidateSessionCache: () => {},
  loadCitizenHistory: () => [],
  loadCitizenNewMessages: () => [],
  loadSubagentFinalMessage: () => null,
  loadChatItemHistory: () => [],
  loadCitizenItemHistory: () => [],
}))
vi.mock('../chat-session-watcher.js', () => ({
  ChatSessionWatcher: class { start() {} stop() {} },
}))

const TEST_PLUGIN_DIR = join(import.meta.dirname, '__fixtures_megapack__')
const MAP1_DIR = join(TEST_PLUGIN_DIR, 'assets', 'Map_1')

function createMockRes() {
  const res: any = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: null as Buffer | string | null,
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status
      if (headers) Object.assign(res._headers, headers)
    },
    end(body?: any) {
      res._body = body ?? null
    },
  }
  return res
}

function createMockReq(method: string, url: string): any {
  return { method, url }
}

describe('editor-serve megapack route', () => {
  beforeEach(() => {
    mkdirSync(join(MAP1_DIR, 'Buildings', 'Building 1'), { recursive: true })
    writeFileSync(
      join(MAP1_DIR, 'Buildings', 'Building 1', 'Building_1.gltf'),
      '{"asset":{"version":"2.0"}}',
    )
    writeFileSync(
      join(MAP1_DIR, 'Buildings', 'Building 1', 'Building_1.bin'),
      Buffer.from([0x00, 0x01, 0x02]),
    )
    mkdirSync(join(MAP1_DIR, 'Roads'), { recursive: true })
    writeFileSync(
      join(MAP1_DIR, 'Roads', 'Road_Straight.gltf'),
      '{"asset":{"version":"2.0"}}',
    )
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-data', 'custom-assets', 'models'), { recursive: true })
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-data', 'custom-assets', 'characters'), { recursive: true })
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-data', 'custom-assets', 'animations'), { recursive: true })
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-data', 'souls'), { recursive: true })
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-souls'), { recursive: true })
    mkdirSync(join(TEST_PLUGIN_DIR, 'town-data', 'citizen-workshop', 'avatars'), { recursive: true })
    if (!existsSync(join(TEST_PLUGIN_DIR, 'town-data', 'custom-assets', '_catalog.json'))) {
      writeFileSync(
        join(TEST_PLUGIN_DIR, 'town-data', 'custom-assets', '_catalog.json'),
        '{"version":1,"assets":[]}',
      )
    }
  })

  afterEach(() => {
    rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true })
  })

  async function handle(method: string, url: string) {
    const { handleEditorRequest } = await import('../editor-serve.js')
    const req = createMockReq(method, url)
    const res = createMockRes()
    const handled = await handleEditorRequest(req, res, TEST_PLUGIN_DIR)
    return { handled, res }
  }

  it('serves megapack gltf file when assets exist', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Buildings/Building%201/Building_1.gltf',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toContain('gltf')
  })

  it('serves megapack bin file when assets exist', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Buildings/Building%201/Building_1.bin',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(200)
    expect(res._headers['Content-Type']).toBe('application/octet-stream')
  })

  it('returns 404 for non-existent megapack file', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Buildings/NoSuch/model.gltf',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(404)
  })

  it('correctly decodes URL-encoded paths with spaces', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Buildings/Building%201/Building_1.gltf',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(200)
  })

  it('blocks path traversal attempts', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/../../../../../../etc/passwd',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(404)
  })

  it('does not intercept non-megapack asset requests', async () => {
    const { handled } = await handle(
      'GET',
      '/assets/models/buildings/building_A.gltf',
    )
    expect(handled).toBe(false)
  })

  it('does not intercept ext-assets requests (existing route)', async () => {
    const { handled, res } = await handle(
      'GET',
      '/ext-assets/Characters_1/gLTF/Animations/Animations.glb',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(404)
  })

  it('serves simple path without URL encoding', async () => {
    const { handled, res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Roads/Road_Straight.gltf',
    )
    expect(handled).toBe(true)
    expect(res._status).toBe(200)
  })

  it('sets cache header on megapack responses', async () => {
    const { res } = await handle(
      'GET',
      '/assets/models/megapack/gltf/Roads/Road_Straight.gltf',
    )
    expect(res._headers['Cache-Control']).toBe('public, max-age=86400')
  })
})
