// @desc Tests for citizen-chat-router: findCitizenAgentId agent resolution
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock file system
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))
vi.mock('node:url', () => ({
  fileURLToPath: (p: string) => p,
}))

// Mock other dependencies
vi.mock('openclaw/plugin-sdk/core', () => ({ type: {} }))
vi.mock('openclaw/plugin-sdk/channel-inbound', () => ({
  buildChannelInboundEventContext: () => ({}),
}))
vi.mock('../runtime.js', () => ({ getTownRuntime: () => ({}) }))
vi.mock('../ws-server.js', () => ({ pushCitizenMessages: () => {} }))
vi.mock('../town-session.js', () => ({ sanitizeTownSessionId: (v: string) => v }))
vi.mock('../channel.js', () => ({
  buildTownInboundContext: vi.fn(() => ({ _ctx: true })),
}))
vi.mock('../paths.js', () => ({
  stateDir: () => '/fake/state',
  initStateDir: () => {},
}))

const { findCitizenAgentId } = await import('../citizen-chat-router.js')
const { readFileSync, existsSync } = await import('node:fs')

describe('findCitizenAgentId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when citizen-config.json does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(findCitizenAgentId('yan')).toBeNull()
  })

  it('returns "town-steward" for steward role when registered in openclaw.json', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({
          characters: [
            { id: 'steward', role: 'steward' },
            { id: 'yan', role: 'citizen', agentEnabled: true, agentId: 'citizen-yan' },
          ],
        })
      }
      if (String(path).includes('openclaw.json')) {
        return JSON.stringify({
          agents: { list: [{ id: 'town-steward' }, { id: 'citizen-yan' }] },
        })
      }
      return '{}'
    })

    expect(findCitizenAgentId('steward')).toBe('town-steward')
  })

  it('returns null for steward when town-steward not in openclaw.json', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({
          characters: [{ id: 'steward', role: 'steward' }],
        })
      }
      if (String(path).includes('openclaw.json')) {
        return JSON.stringify({ agents: { list: [] } })
      }
      return '{}'
    })

    expect(findCitizenAgentId('steward')).toBeNull()
  })

  it('returns agentId for enabled citizen with agentId', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({
          characters: [
            { id: 'chengzi', role: 'citizen', agentEnabled: true, agentId: 'citizen-chengzi' },
          ],
        })
      }
      return '{}'
    })

    expect(findCitizenAgentId('chengzi')).toBe('citizen-chengzi')
  })

  it('returns null for disabled citizen (agentEnabled=false)', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({
          characters: [
            { id: 'diandian', role: 'citizen', agentEnabled: false, agentId: 'citizen-diandian' },
          ],
        })
      }
      return '{}'
    })

    // Falls through to openclaw.json fallback, which returns {} (no agents)
    expect(findCitizenAgentId('diandian')).toBeNull()
  })

  it('falls back to openclaw.json agents.list for citizen not in config', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({ characters: [] })
      }
      if (String(path).includes('openclaw.json')) {
        return JSON.stringify({
          agents: { list: [{ id: 'citizen-haitang' }] },
        })
      }
      return '{}'
    })

    expect(findCitizenAgentId('haitang')).toBe('citizen-haitang')
  })

  it('sanitizes npcId for fallback agentId lookup', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({ characters: [] })
      }
      if (String(path).includes('openclaw.json')) {
        return JSON.stringify({
          agents: { list: [{ id: 'citizen-special-char' }] },
        })
      }
      return '{}'
    })

    // npcId "special char" → expectedAgentId "citizen-special-char"
    expect(findCitizenAgentId('special char')).toBe('citizen-special-char')
  })

  it('returns null for unknown npcId not in any config', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('citizen-config.json')) {
        return JSON.stringify({ characters: [] })
      }
      if (String(path).includes('openclaw.json')) {
        return JSON.stringify({ agents: { list: [] } })
      }
      return '{}'
    })

    expect(findCitizenAgentId('unknown_npc')).toBeNull()
  })

  it('returns null on JSON parse error', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('{ invalid json')

    expect(findCitizenAgentId('yan')).toBeNull()
  })
})
