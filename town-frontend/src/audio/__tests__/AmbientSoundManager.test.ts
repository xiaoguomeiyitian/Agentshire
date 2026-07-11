// @desc Tests for AmbientSoundManager: setEnabled toggles output gain
import { describe, it, expect, vi } from 'vitest'
import { AmbientSoundManager } from '../AmbientSoundManager'

function createMockGain() {
  return {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
}

describe('AmbientSoundManager', () => {
  describe('setEnabled', () => {
    it('sets enabled flag to false and mutes output', () => {
      const ambient = new AmbientSoundManager()
      const mockGain = createMockGain()
      ;(ambient as any).outputGain = mockGain
      ;(ambient as any)._volume = 0.5

      ambient.setEnabled(false)

      expect((ambient as any).enabled).toBe(false)
      expect(mockGain.gain.value).toBe(0)
    })

    it('sets enabled flag to true and restores volume', () => {
      const ambient = new AmbientSoundManager()
      const mockGain = createMockGain()
      ;(ambient as any).outputGain = mockGain
      ;(ambient as any)._volume = 0.5

      ambient.setEnabled(false)
      ambient.setEnabled(true)

      expect((ambient as any).enabled).toBe(true)
      expect(mockGain.gain.value).toBe(0.5)
    })

    it('does not throw when outputGain is null', () => {
      const ambient = new AmbientSoundManager()
      ;(ambient as any).outputGain = null

      expect(() => ambient.setEnabled(false)).not.toThrow()
      expect(() => ambient.setEnabled(true)).not.toThrow()
    })
  })

  describe('setVolume', () => {
    it('clamps volume to [0, 1]', () => {
      const ambient = new AmbientSoundManager()
      const mockGain = createMockGain()
      ;(ambient as any).outputGain = mockGain

      ambient.setVolume(1.5)
      expect((ambient as any)._volume).toBe(1)

      ambient.setVolume(-0.5)
      expect((ambient as any)._volume).toBe(0)

      ambient.setVolume(0.3)
      expect((ambient as any)._volume).toBe(0.3)
      expect(mockGain.gain.value).toBe(0.3)
    })

    it('does not throw when outputGain is null', () => {
      const ambient = new AmbientSoundManager()
      ;(ambient as any).outputGain = null

      expect(() => ambient.setVolume(0.5)).not.toThrow()
      expect((ambient as any)._volume).toBe(0.5)
    })
  })

  describe('update', () => {
    it('returns early when disabled', () => {
      const ambient = new AmbientSoundManager()
      ambient.setEnabled(false)
      // update should be a no-op when disabled
      expect(() => ambient.update(0.1, 'clear', 'morning')).not.toThrow()
    })
  })
})
