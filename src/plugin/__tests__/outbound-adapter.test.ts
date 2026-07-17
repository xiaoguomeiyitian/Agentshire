import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing
vi.mock('../ws-server.js', () => ({
  broadcastAgentEvent: vi.fn(),
  getActiveTownSessionId: vi.fn(() => 'default'),
}))

vi.mock('../town-session.js', () => ({
  extractTownSessionId: vi.fn((v: unknown) => (typeof v === 'string' ? v.split(':').pop() ?? null : null)),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => Buffer.from('fake-content')),
  existsSync: vi.fn(() => false),
}))

vi.mock('../paths.js', () => ({
  stateDir: vi.fn(() => '/root/.openclaw'),
}))

import { createOutboundAdapter, resolveFileData } from '../outbound-adapter.js'
import { broadcastAgentEvent, getActiveTownSessionId } from '../ws-server.js'
import { existsSync, readFileSync } from 'node:fs'

describe('resolveFileData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts file name from path', () => {
    const result = resolveFileData('/path/to/file.txt')
    expect(result.fileName).toBe('file.txt')
  })

  it('detects image media type', () => {
    const result = resolveFileData('/path/to/photo.png')
    expect(result.mediaType).toBe('image')
  })

  it('detects video media type', () => {
    const result = resolveFileData('/path/to/clip.mp4')
    expect(result.mediaType).toBe('video')
  })

  it('detects audio media type', () => {
    const result = resolveFileData('/path/to/song.mp3')
    expect(result.mediaType).toBe('audio')
  })

  it('defaults to file media type for unknown extension', () => {
    const result = resolveFileData('/path/to/doc.pdf')
    expect(result.mediaType).toBe('file')
  })

  it('defaults to file media type for no extension', () => {
    const result = resolveFileData('/path/to/README')
    expect(result.mediaType).toBe('file')
  })

  it('returns correct mime type for png', () => {
    expect(resolveFileData('/x/a.png').mimeType).toBe('image/png')
  })

  it('returns correct mime type for jpg', () => {
    expect(resolveFileData('/x/a.jpg').mimeType).toBe('image/jpeg')
  })

  it('returns correct mime type for mp4', () => {
    expect(resolveFileData('/x/a.mp4').mimeType).toBe('video/mp4')
  })

  it('returns correct mime type for mp3', () => {
    expect(resolveFileData('/x/a.mp3').mimeType).toBe('audio/mpeg')
  })

  it('returns correct mime type for md', () => {
    expect(resolveFileData('/x/a.md').mimeType).toBe('text/markdown')
  })

  it('returns application/octet-stream for unknown extension', () => {
    expect(resolveFileData('/x/a.xyz').mimeType).toBe('application/octet-stream')
  })

  it('reads file data as base64 when file exists', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    const result = resolveFileData('/path/to/file.txt')
    expect(existsSync).toHaveBeenCalledWith('/path/to/file.txt')
    expect(readFileSync).toHaveBeenCalledWith('/path/to/file.txt')
    expect(result.data).toBe(Buffer.from('fake-content').toString('base64'))
  })

  it('returns undefined data when file does not exist', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    const result = resolveFileData('/path/to/missing.txt')
    expect(result.data).toBeUndefined()
  })

  it('returns thumbnailData for images with data', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    const result = resolveFileData('/path/to/photo.png')
    expect(result.thumbnailData).toContain('data:image/png;base64,')
  })

  it('returns undefined thumbnailData for non-images', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true)
    const result = resolveFileData('/path/to/file.txt')
    expect(result.thumbnailData).toBeUndefined()
  })

  it('returns undefined thumbnailData for image without data', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false)
    const result = resolveFileData('/path/to/photo.png')
    expect(result.thumbnailData).toBeUndefined()
  })

  it('handles empty path gracefully', () => {
    const result = resolveFileData('')
    expect(result.fileName).toBe('')
    expect(result.mediaType).toBe('file')
  })
})

describe('createOutboundAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveTownSessionId).mockReturnValue('default')
  })

  describe('outbound.resolveTarget', () => {
    it('resolves valid agentshire target', () => {
      const { outbound } = createOutboundAdapter()
      const result = outbound.resolveTarget({ to: 'agentshire:steward' })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.to).toBe('agentshire:steward')
    })

    it('resolves bare channel name', () => {
      const { outbound } = createOutboundAdapter()
      const result = outbound.resolveTarget({ to: 'agentshire' })
      expect(result.ok).toBe(true)
    })

    it('rejects invalid target', () => {
      const { outbound } = createOutboundAdapter()
      const result = outbound.resolveTarget({ to: 'other:channel' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBeInstanceOf(Error)
    })

    it('rejects undefined target', () => {
      const { outbound } = createOutboundAdapter()
      const result = outbound.resolveTarget({ to: undefined })
      expect(result.ok).toBe(false)
    })
  })

  describe('outbound.sendText', () => {
    it('broadcasts text event and returns message id', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendText({ text: 'hello', to: 'agentshire:steward' })
      expect(broadcastAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text', content: 'hello' }),
        expect.any(String),
      )
      expect(result.channel).toBe('agentshire')
      expect(result.messageId).toMatch(/^town-msg-/)
    })

    it('uses sessionKey when sessionId is absent', async () => {
      const { outbound } = createOutboundAdapter()
      await outbound.sendText({
        text: 'hi',
        to: 'agentshire:steward',
        sessionKey: 'agent:town-steward:town:user:mysession',
      })
      expect(broadcastAgentEvent).toHaveBeenCalledWith(
        expect.anything(),
        'mysession',
      )
    })
  })

  describe('outbound.sendMedia', () => {
    it('broadcasts deliverable_card event for media', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendMedia({
        text: 'caption',
        mediaUrl: '/path/to/photo.png',
        to: 'agentshire:steward',
      })
      expect(broadcastAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'deliverable_card',
          cardType: 'image',
          name: 'photo.png',
        }),
        expect.any(String),
      )
      expect(result.channel).toBe('agentshire')
      expect(result.messageId).toMatch(/^town-media-/)
    })

    it('also broadcasts text when caption is provided', async () => {
      const { outbound } = createOutboundAdapter()
      await outbound.sendMedia({
        text: 'my caption',
        mediaUrl: '/x/a.png',
        to: 'agentshire:steward',
      })
      const calls = vi.mocked(broadcastAgentEvent).mock.calls
      // Should have both deliverable_card and text events
      const textCall = calls.find(c => (c[0] as any).type === 'text')
      expect(textCall).toBeDefined()
      expect((textCall![0] as any).content).toBe('my caption')
    })

    it('does not broadcast text when no caption', async () => {
      const { outbound } = createOutboundAdapter()
      await outbound.sendMedia({
        mediaUrl: '/x/a.png',
        to: 'agentshire:steward',
      })
      const calls = vi.mocked(broadcastAgentEvent).mock.calls
      const textCall = calls.find(c => (c[0] as any).type === 'text')
      expect(textCall).toBeUndefined()
    })

    it('handles empty mediaUrl', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendMedia({
        mediaUrl: '',
        to: 'agentshire:steward',
      })
      expect(result.channel).toBe('agentshire')
    })
  })

  describe('outbound.sendPayload', () => {
    it('delegates to sendMedia when payload has mediaUrl', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendPayload({
        payload: { mediaUrl: '/x/a.png', text: 'desc' },
        to: 'agentshire:steward',
      })
      expect(result.messageId).toMatch(/^town-media-/)
    })

    it('delegates to sendText when payload has text but no mediaUrl', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendPayload({
        payload: { text: 'hello' },
        to: 'agentshire:steward',
      })
      expect(result.messageId).toMatch(/^town-msg-/)
    })

    it('delegates to sendText when payload has body but no mediaUrl', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendPayload({
        payload: { body: 'hello body' },
        to: 'agentshire:steward',
      })
      expect(result.messageId).toMatch(/^town-msg-/)
    })

    it('returns payload message id when no text or media', async () => {
      const { outbound } = createOutboundAdapter()
      const result = await outbound.sendPayload({
        payload: { foo: 'bar' },
        to: 'agentshire:steward',
      })
      expect(result.messageId).toMatch(/^town-payload-/)
    })
  })

  describe('messaging.normalizeTarget', () => {
    it('returns trimmed value as-is when it starts with channel prefix', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.normalizeTarget('agentshire:steward')).toBe('agentshire:steward')
    })

    it('prefixes "steward" with channel', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.normalizeTarget('steward')).toBe('agentshire:steward')
    })

    it('prefixes "user" with channel', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.normalizeTarget('user')).toBe('agentshire:user')
    })

    it('trims whitespace before normalizing', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.normalizeTarget('  steward  ')).toBe('agentshire:steward')
    })

    it('returns other values as-is (trimmed)', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.normalizeTarget('  other-target  ')).toBe('other-target')
    })
  })

  describe('messaging.targetResolver', () => {
    it('looksLikeId returns true for channel-prefixed id', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.targetResolver.looksLikeId('agentshire:steward')).toBe(true)
    })

    it('looksLikeId returns true for bare channel name', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.targetResolver.looksLikeId('agentshire')).toBe(true)
    })

    it('looksLikeId returns false for other targets', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.targetResolver.looksLikeId('other:target')).toBe(false)
    })

    it('looksLikeId uses normalized value when provided', () => {
      const { messaging } = createOutboundAdapter()
      expect(messaging.targetResolver.looksLikeId('steward', 'agentshire:steward')).toBe(true)
    })

    it('exposes a hint string', () => {
      const { messaging } = createOutboundAdapter()
      expect(typeof messaging.targetResolver.hint).toBe('string')
      expect(messaging.targetResolver.hint).toContain('agentshire:')
    })

    it('resolveTarget returns resolved target with display name', async () => {
      const { messaging } = createOutboundAdapter()
      const result = await messaging.targetResolver.resolveTarget({
        input: 'steward',
        normalized: 'agentshire:steward',
      })
      expect(result.to).toBe('agentshire:steward')
      expect(result.display).toBe('steward')
      expect(result.kind).toBe('user')
      expect(result.source).toBe('normalized')
    })

    it('resolveTarget prefixes non-channel normalized values', async () => {
      const { messaging } = createOutboundAdapter()
      const result = await messaging.targetResolver.resolveTarget({
        input: 'user',
        normalized: 'user',
      })
      expect(result.to).toBe('agentshire:user')
      expect(result.display).toBe('user')
    })
  })
})
