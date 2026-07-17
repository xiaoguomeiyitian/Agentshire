import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReconnectManager } from '../ReconnectManager.js'

describe('ReconnectManager', () => {
  let callback: ReturnType<typeof vi.fn>
  let manager: ReconnectManager
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    callback = vi.fn()
    manager = new ReconnectManager(callback as any)
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('scheduleReconnect', () => {
    it('calls the callback after the delay', () => {
      manager.scheduleReconnect()
      expect(callback).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('uses exponential backoff — first delay is 1s', () => {
      manager.scheduleReconnect()
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
    })

    it('uses exponential backoff — second delay is 2s', () => {
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      const calls = setTimeoutSpy.mock.calls
      expect(calls[0][1]).toBe(1000)
      expect(calls[1][1]).toBe(2000)
    })

    it('uses exponential backoff — third delay is 4s', () => {
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      const calls = setTimeoutSpy.mock.calls
      expect(calls[2][1]).toBe(4000)
    })

    it('caps delay at 30s (maxDelay)', () => {
      for (let i = 0; i < 20; i++) manager.scheduleReconnect()
      const calls = setTimeoutSpy.mock.calls
      // 2^14 = 16384, 2^15 = 32768 > 30000
      const maxDelay = Math.max(...calls.map((c: any) => c[1] as number))
      expect(maxDelay).toBe(30000)
    })

    it('increments attempt counter', () => {
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      // After 3 attempts, the 4th delay should be 2^3 = 8000
      manager.scheduleReconnect()
      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1]
      expect(lastCall[1]).toBe(8000)
    })
  })

  describe('onSuccess', () => {
    it('resets the attempt counter', () => {
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      manager.onSuccess()
      manager.scheduleReconnect()
      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1]
      // After reset, first delay should be 1s again
      expect(lastCall[1]).toBe(1000)
    })

    it('cancels pending reconnect timer', () => {
      manager.scheduleReconnect()
      manager.onSuccess()
      vi.advanceTimersByTime(5000)
      expect(callback).not.toHaveBeenCalled()
    })

    it('is safe to call without pending timer', () => {
      expect(() => manager.onSuccess()).not.toThrow()
    })
  })

  describe('stop', () => {
    it('cancels pending reconnect timer', () => {
      manager.scheduleReconnect()
      manager.stop()
      vi.advanceTimersByTime(5000)
      expect(callback).not.toHaveBeenCalled()
    })

    it('resets attempt counter', () => {
      manager.scheduleReconnect()
      manager.scheduleReconnect()
      manager.stop()
      manager.scheduleReconnect()
      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1]
      expect(lastCall[1]).toBe(1000)
    })

    it('is safe to call without pending timer', () => {
      expect(() => manager.stop()).not.toThrow()
    })

    it('is safe to call multiple times', () => {
      manager.scheduleReconnect()
      manager.stop()
      expect(() => manager.stop()).not.toThrow()
    })
  })

  describe('multiple reconnect cycles', () => {
    it('supports schedule → success → schedule cycle', () => {
      manager.scheduleReconnect()
      vi.advanceTimersByTime(1000)
      expect(callback).toHaveBeenCalledTimes(1)

      manager.onSuccess()
      manager.scheduleReconnect()
      vi.advanceTimersByTime(1000)
      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('supports schedule → stop → schedule cycle', () => {
      manager.scheduleReconnect()
      manager.stop()
      manager.scheduleReconnect()
      vi.advanceTimersByTime(1000)
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })
})
