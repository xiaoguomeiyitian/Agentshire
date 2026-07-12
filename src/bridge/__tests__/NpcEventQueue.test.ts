// @desc Tests for NpcEventQueue: dialog protection and phase event buffering
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NpcEventQueue, calcDialogDuration } from '../NpcEventQueue.js'

describe('calcDialogDuration', () => {
  it('returns minimum 1500 for very short text', () => {
    expect(calcDialogDuration(0)).toBe(1500)
    expect(calcDialogDuration(5)).toBe(1500)
  })

  it('scales linearly with text length', () => {
    expect(calcDialogDuration(20)).toBe(2400) // 20 * 120
  })

  it('caps at 8000 for long text', () => {
    expect(calcDialogDuration(200)).toBe(8000)
    expect(calcDialogDuration(1000)).toBe(8000)
  })
})

describe('NpcEventQueue', () => {
  let emitFn: ReturnType<typeof vi.fn>
  let queue: NpcEventQueue

  beforeEach(() => {
    vi.useFakeTimers()
    emitFn = vi.fn()
    queue = new NpcEventQueue(emitFn as any)
  })

  describe('enqueueDialog', () => {
    it('emits events immediately', () => {
      const events = [{ type: 'dialog_message', npcId: 'npc1', text: 'hi' }] as any
      queue.enqueueDialog(events, 5)
      expect(emitFn).toHaveBeenCalledWith(events)
    })

    it('starts protection timer that unblocks pending phases after duration', () => {
      queue.enqueueDialog([{ type: 'dialog_message' }] as any, 20)

      const phaseEvents = [{ type: 'npc_phase' }] as any
      queue.enqueuePhase(phaseEvents)
      expect(emitFn).toHaveBeenCalledTimes(1) // only dialog emitted

      vi.advanceTimersByTime(calcDialogDuration(20))
      expect(emitFn).toHaveBeenCalledTimes(2)
      expect(emitFn).toHaveBeenLastCalledWith(phaseEvents)
    })
  })

  describe('enqueuePhase', () => {
    it('buffers events during dialog protection', () => {
      queue.enqueueDialog([{ type: 'dialog_message' }] as any, 10)
      emitFn.mockClear()

      queue.enqueuePhase([{ type: 'phase_a' }] as any)
      queue.enqueuePhase([{ type: 'phase_b' }] as any)
      expect(emitFn).not.toHaveBeenCalled()
    })

    it('emits immediately when no dialog protection active', () => {
      const events = [{ type: 'npc_phase' }] as any
      queue.enqueuePhase(events)
      expect(emitFn).toHaveBeenCalledWith(events)
    })
  })

  describe('flush', () => {
    it('drains all pending events immediately and cancels protection', () => {
      queue.enqueueDialog([{ type: 'dialog_message' }] as any, 30)
      emitFn.mockClear()

      queue.enqueuePhase([{ type: 'phase_a' }] as any)
      queue.enqueuePhase([{ type: 'phase_b' }] as any)

      queue.flush()

      expect(emitFn).toHaveBeenCalledTimes(2)
      expect(emitFn).toHaveBeenNthCalledWith(1, [{ type: 'phase_a' }])
      expect(emitFn).toHaveBeenNthCalledWith(2, [{ type: 'phase_b' }])
    })

    it('allows subsequent enqueuePhase to emit immediately after flush', () => {
      queue.enqueueDialog([{ type: 'dialog_message' }] as any, 10)
      queue.flush()
      emitFn.mockClear()

      queue.enqueuePhase([{ type: 'phase_c' }] as any)
      expect(emitFn).toHaveBeenCalledWith([{ type: 'phase_c' }])
    })
  })
})
