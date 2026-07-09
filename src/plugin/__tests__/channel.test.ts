// @desc Tests for channel.ts: resolveAccount port/config resolution
import { describe, it, expect, vi } from 'vitest'

// Mock all heavy dependencies that channel.ts pulls in at module load
vi.mock('openclaw/plugin-sdk/core', () => ({ type: {} }))
vi.mock('openclaw/plugin-sdk', () => ({ createPluginRuntimeStore: () => ({ setRuntime: () => {}, getRuntime: () => ({}) }) }))
vi.mock('../runtime.js', () => ({ setTownRuntime: () => {}, getTownRuntime: () => ({}) }))
vi.mock('../ws-server.js', () => ({ broadcastAgentEvent: () => {}, getActiveTownSessionId: () => null }))
vi.mock('../outbound-adapter.js', () => ({ createOutboundAdapter: () => ({ outbound: {}, messaging: {} }) }))
vi.mock('../town-session.js', () => ({ createTownSessionKey: () => '', sanitizeTownSessionId: (v: string) => v }))

const { resolveAccount } = await import('../channel.js')

const CHANNEL_ID = 'agentshire'

describe('resolveAccount', () => {
  it('uses defaults when no config provided', () => {
    const acc = resolveAccount({}, 'default')
    expect(acc).toMatchObject({
      accountId: 'default',
      wsPort: 20008,
      townPort: 20009,
      autoLaunch: true,
    })
  })

  it('reads from plugins.entries.agentshire.config path', () => {
    const cfg = {
      plugins: {
        entries: {
          [CHANNEL_ID]: {
            config: { wsPort: 18080, townPort: 18090, autoLaunch: false },
          },
        },
      },
    }
    const acc = resolveAccount(cfg, 'default')
    expect(acc).toMatchObject({
      wsPort: 18080,
      townPort: 18090,
      autoLaunch: false,
    })
  })

  it('reads from legacy channels.agentshire path', () => {
    const cfg = {
      channels: {
        [CHANNEL_ID]: { wsPort: 55211, townPort: 55210 },
      },
    }
    const acc = resolveAccount(cfg, 'default')
    expect(acc).toMatchObject({
      wsPort: 55211,
      townPort: 55210,
    })
  })

  it('prefers channels.agentshire over plugins.entries when both present', () => {
    const cfg = {
      channels: {
        [CHANNEL_ID]: { wsPort: 11111, townPort: 11110 },
      },
      plugins: {
        entries: {
          [CHANNEL_ID]: {
            config: { wsPort: 22222, townPort: 22220 },
          },
        },
      },
    }
    const acc = resolveAccount(cfg, 'default')
    expect(acc).toMatchObject({
      wsPort: 11111,
      townPort: 11110,
    })
  })

  it('falls back to plugins.entries when channels path missing', () => {
    const cfg = {
      plugins: {
        entries: {
          [CHANNEL_ID]: { config: { wsPort: 33333 } },
        },
      },
    }
    const acc = resolveAccount(cfg, 'default')
    expect(acc.wsPort).toBe(33333)
    expect(acc.townPort).toBe(20009) // default
  })

  it('handles partial config (only wsPort)', () => {
    const cfg = {
      plugins: {
        entries: {
          [CHANNEL_ID]: { config: { wsPort: 44444 } },
        },
      },
    }
    const acc = resolveAccount(cfg, 'default')
    expect(acc.wsPort).toBe(44444)
    expect(acc.townPort).toBe(20009)
    expect(acc.autoLaunch).toBe(true)
  })

  it('preserves accountId from argument', () => {
    const acc = resolveAccount({}, 'custom-account')
    expect(acc.accountId).toBe('custom-account')
  })
})
