// @desc Tests for BGMManager: setEnabled stops sources when disabled
import { describe, it, expect, vi } from 'vitest'
import { BGMManager } from '../BGMManager'

// Minimal mock for AudioBufferSourceNode
function createMockSource() {
  return {
    buffer: null as AudioBuffer | null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

function createMockGain() {
  return {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
}

function createMockAudioContext() {
  const sources: any[] = []
  return {
    currentTime: 0,
    state: 'running',
    createGain: vi.fn(() => {
      const g = createMockGain()
      return g
    }),
    createBufferSource: vi.fn(() => {
      const s = createMockSource()
      sources.push(s)
      return s
    }),
    decodeAudioData: vi.fn(async (_buf: ArrayBuffer) => ({
      duration: 100,
      getChannelData: () => new Float32Array(100),
    } as unknown as AudioBuffer)),
    _sources: sources,
  }
}

describe('BGMManager', () => {
  describe('setEnabled', () => {
    it('sets enabled flag to false', () => {
      const bgm = new BGMManager()
      bgm.setEnabled(false)
      // No crash, enabled is now false (internal state verified via update behavior)
      expect(() => bgm.setEnabled(false)).not.toThrow()
    })

    it('sets enabled flag back to true', () => {
      const bgm = new BGMManager()
      bgm.setEnabled(false)
      bgm.setEnabled(true)
      expect(() => bgm.setEnabled(true)).not.toThrow()
    })

    it('stops current source when disabled', () => {
      const bgm = new BGMManager()
      const mockCtx = createMockAudioContext() as any

      // Manually inject a "current" source to verify stopSource is called
      const source = createMockSource()
      const gain = createMockGain()
      ;(bgm as any).ctx = mockCtx
      ;(bgm as any).current = { source, gain, track: 'day', startedAt: 0 }

      bgm.setEnabled(false)

      expect(source.stop).toHaveBeenCalled()
      expect(source.disconnect).toHaveBeenCalled()
      expect((bgm as any).current).toBeNull()
    })

    it('stops fading source when disabled', () => {
      const bgm = new BGMManager()
      const source = createMockSource()
      const gain = createMockGain()
      ;(bgm as any).fading = { source, gain, track: 'dusk', startedAt: 0 }

      bgm.setEnabled(false)

      expect(source.stop).toHaveBeenCalled()
      expect((bgm as any).fading).toBeNull()
    })

    it('does not throw when disabling with no active sources', () => {
      const bgm = new BGMManager()
      expect(() => bgm.setEnabled(false)).not.toThrow()
    })
  })

  describe('setVolume', () => {
    it('clamps volume to [0, 1]', () => {
      const bgm = new BGMManager()
      const mockGain = createMockGain()
      ;(bgm as any).output = mockGain

      bgm.setVolume(1.5)
      expect((bgm as any)._volume).toBe(1)

      bgm.setVolume(-0.5)
      expect((bgm as any)._volume).toBe(0)

      bgm.setVolume(0.5)
      expect((bgm as any)._volume).toBe(0.5)
    })

    it('updates output gain when set', () => {
      const bgm = new BGMManager()
      const mockGain = createMockGain()
      ;(bgm as any).output = mockGain

      bgm.setVolume(0.3)
      expect(mockGain.gain.value).toBe(0.3)
    })
  })

  describe('destroy', () => {
    it('disables and clears buffers', () => {
      const bgm = new BGMManager()
      const source = createMockSource()
      const gain = createMockGain()
      ;(bgm as any).current = { source, gain, track: 'day', startedAt: 0 }
      ;(bgm as any).buffers.set('day', {} as AudioBuffer)

      bgm.destroy()

      expect(source.stop).toHaveBeenCalled()
      expect((bgm as any).current).toBeNull()
      expect((bgm as any).buffers.size).toBe(0)
    })
  })
})
