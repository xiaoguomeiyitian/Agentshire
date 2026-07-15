// @desc Tests for buildTownInboundContext: the helper that maps flat legacy
// finalizeInboundContext params to structured facts for buildChannelInboundEventContext
import { describe, it, expect, vi } from 'vitest'

// Mock the SDK import — we only need to verify that buildChannelInboundEventContext
// is called with the correct structured facts, not that the SDK itself works.
const mockBuild = vi.fn((..._args: any[]) => ({ _built: true }))
vi.mock('openclaw/plugin-sdk/channel-inbound', () => ({
  buildChannelInboundEventContext: mockBuild,
}))

// Mock other dependencies that channel.ts pulls in at module load
vi.mock('openclaw/plugin-sdk/core', () => ({ type: {} }))
vi.mock('openclaw/plugin-sdk', () => ({
  createPluginRuntimeStore: () => ({ setRuntime: () => {}, getRuntime: () => ({}) }),
}))
vi.mock('../runtime.js', () => ({ setTownRuntime: () => {}, getTownRuntime: () => ({}) }))
vi.mock('../ws-server.js', () => ({
  broadcastAgentEvent: () => {},
  getActiveTownSessionId: () => null,
}))
vi.mock('../outbound-adapter.js', () => ({
  createOutboundAdapter: () => ({ outbound: {}, messaging: {} }),
}))
vi.mock('../town-session.js', () => ({
  createTownSessionKey: () => '',
  sanitizeTownSessionId: (v: string) => v,
}))

const { buildTownInboundContext } = await import('../channel.js')

describe('buildTownInboundContext', () => {
  it('maps flat params to structured facts for steward session', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'hello',
      from: 'agentshire:user',
      to: 'agentshire:steward',
      sessionKey: 'town-sess-123',
      accountId: 'default',
    })

    expect(mockBuild).toHaveBeenCalledTimes(1)
    const args = mockBuild.mock.calls[0][0]
    expect(args).toMatchObject({
      channel: 'agentshire',
      accountId: 'default',
      provider: 'agentshire',
      surface: 'agentshire',
      from: 'agentshire:user',
      sender: { id: 'user', isSelf: false, isBot: false },
      conversation: { kind: 'direct', id: 'town-sess-123' },
      route: {
        agentId: 'town-steward',
        accountId: 'default',
        routeSessionKey: 'town-sess-123',
        dispatchSessionKey: 'town-sess-123',
        createIfMissing: true,
      },
      reply: { to: 'agentshire:steward', originatingTo: 'agentshire:steward' },
      message: {
        rawBody: 'hello',
        body: 'hello',
        bodyForAgent: 'hello',
        commandBody: 'hello',
      },
      access: {
        commands: {
          authorized: true,
          useAccessGroups: false,
          allowTextCommands: true,
          authorizers: [],
        },
      },
    })
  })

  it('extracts agentId from sessionKey for citizen sessions', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'hi',
      from: 'agentshire:user',
      to: 'agentshire:yan',
      sessionKey: 'agent:citizen-yan:sess-456',
      accountId: 'default',
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.route.agentId).toBe('citizen-yan')
    expect(args.conversation.id).toBe('agent:citizen-yan:sess-456')
  })

  it('extracts agentId from sessionKey with group chat prefix', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'group msg',
      from: 'agentshire:user',
      to: 'agentshire:chengzi',
      sessionKey: 'agent:citizen-chengzi:group:town-square:sess-789',
      accountId: 'default',
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.route.agentId).toBe('citizen-chengzi')
  })

  it('defaults accountId to "default" when not provided', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'test',
      from: 'agentshire:user',
      to: 'agentshire:steward',
      sessionKey: 'sess-1',
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.accountId).toBe('default')
    expect(args.route.accountId).toBe('default')
  })

  it('maps mediaPaths to media facts with kind "unknown"', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'msg with image',
      from: 'agentshire:user',
      to: 'agentshire:steward',
      sessionKey: 'sess-1',
      mediaPaths: ['/tmp/img1.png', '/tmp/img2.jpg'],
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.media).toEqual([
      { path: '/tmp/img1.png', kind: 'unknown' },
      { path: '/tmp/img2.jpg', kind: 'unknown' },
    ])
  })

  it('omits media when mediaPaths is empty or undefined', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'text only',
      from: 'agentshire:user',
      to: 'agentshire:steward',
      sessionKey: 'sess-1',
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.media).toBeUndefined()
  })

  it('defaults agentId to "town-steward" for non-agent session keys', () => {
    mockBuild.mockClear()
    buildTownInboundContext({
      rt: {} as any,
      body: 'msg',
      from: 'agentshire:user',
      to: 'agentshire:steward',
      sessionKey: 'plain-session-key',
    })

    const args = mockBuild.mock.calls[0][0]
    expect(args.route.agentId).toBe('town-steward')
  })
})
