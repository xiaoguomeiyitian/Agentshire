// @desc Tests for requestNpcQuery: plugin→frontend spatial queries with timeout
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the openclaw peer dependency chain so ws-server.js can be imported
vi.mock('openclaw/plugin-sdk/runtime-store', () => ({
  createPluginRuntimeStore: () => ({
    setRuntime: () => {},
    getRuntime: () => ({ channel: { reply: {} }, config: {} }),
  }),
}))
vi.mock('../runtime.js', () => ({
  setTownRuntime: () => {},
  getTownRuntime: () => ({ channel: { reply: {} }, config: {} }),
}))
vi.mock('../paths.js', () => ({
  stateDir: () => '/tmp/agentshire-test',
}))
vi.mock('../auth.js', () => ({
  parseSessionToken: () => null,
  isValidSession: () => true,
  isPasswordAuthEnabled: () => false,
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

describe('requestNpcQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects immediately when no frontend is connected', async () => {
    const { requestNpcQuery } = await import('../ws-server.js')
    // In test env, no WS clients are connected → immediate rejection
    await expect(requestNpcQuery({ kind: 'self', npcId: 'x' })).rejects.toThrow('前端未连接')
  })

  it('rejects for nearby query too when no frontend is connected', async () => {
    const { requestNpcQuery } = await import('../ws-server.js')
    await expect(
      requestNpcQuery({ kind: 'nearby', radius: 10, callerNpcId: 'c1' }),
    ).rejects.toThrow('前端未连接')
  })

  it('is exported as a function from ws-server', async () => {
    const wsModule: any = await import('../ws-server.js')
    expect(typeof wsModule.requestNpcQuery).toBe('function')
    expect(typeof wsModule.findCitizenNpcId).toBe('function')
  })
})
