// @desc Tests for ActivityStream: thinking buffer and activity log
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityStream } from '../ActivityStream.js'

describe('ActivityStream', () => {
  let emitFn: ReturnType<typeof vi.fn>
  let stream: ActivityStream

  beforeEach(() => {
    vi.useFakeTimers()
    emitFn = vi.fn()
    stream = new ActivityStream(emitFn as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('emitActivity', () => {
    it('emits npc_activity event with correct fields', () => {
      stream.emitActivity('npc1', 'wrench', '执行命令')
      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'npc_activity',
          npcId: 'npc1',
          icon: 'wrench',
          message: '执行命令',
          time: expect.any(String),
        }),
      ])
    })
  })

  describe('emitActivityStatus', () => {
    it('marks last activity entry as success', () => {
      stream.emitActivity('npc1', 'wrench', 'task')
      emitFn.mockClear()

      stream.emitActivityStatus('npc1', true)
      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'npc_activity_status',
          npcId: 'npc1',
          success: true,
        }),
      ])

      const replay = stream.getActivityReplayEvents()
      const activityEntry = replay.find(
        (e: any) => e.type === 'npc_activity' && e.npcId === 'npc1',
      )
      expect(activityEntry.status).toBe(true)
    })

    it('marks last activity entry as failure', () => {
      stream.emitActivity('npc1', 'wrench', 'task')
      stream.emitActivityStatus('npc1', false)

      const replay = stream.getActivityReplayEvents()
      const activityEntry = replay.find(
        (e: any) => e.type === 'npc_activity' && e.npcId === 'npc1',
      )
      expect(activityEntry.status).toBe(false)
    })
  })

  describe('appendThinkingDelta + flushThinking', () => {
    it('buffers text and flushes on interval', () => {
      stream.appendThinkingDelta('npc1', 'hello ')
      stream.appendThinkingDelta('npc1', 'world')

      // startThinkingStream emits initial activity
      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'npc_activity', npcId: 'npc1', icon: 'brain' }),
      ])

      emitFn.mockClear()
      vi.advanceTimersByTime(500)

      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'npc_activity_stream',
          npcId: 'npc1',
          delta: 'hello world',
        }),
      ])
    })

    it('flushThinking emits remaining buffer and stream_end', () => {
      stream.appendThinkingDelta('npc1', 'remaining')
      emitFn.mockClear()

      stream.flushThinking('npc1')

      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'npc_activity_stream', delta: 'remaining' }),
      ])
      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'npc_activity_stream_end', npcId: 'npc1' }),
      ])
    })
  })

  describe('getActivityReplayEvents', () => {
    it('returns cached events as a copy', () => {
      stream.emitActivity('npc1', 'wrench', 'a')
      stream.emitActivity('npc1', 'wrench', 'b')

      const replay = stream.getActivityReplayEvents()
      expect(replay).toHaveLength(2)
      expect(replay[0].message).toBe('a')
      expect(replay[1].message).toBe('b')

      replay.push({ type: 'fake' })
      expect(stream.getActivityReplayEvents()).toHaveLength(2)
    })
  })

  describe('activity log cap', () => {
    it('does not exceed MAX_ACTIVITY_LOG (500)', () => {
      for (let i = 0; i < 520; i++) {
        stream.emitActivity('npc1', 'wrench', `msg-${i}`)
      }
      const replay = stream.getActivityReplayEvents()
      expect(replay.length).toBeLessThanOrEqual(500)
    })
  })

  describe('emitTodoActivity', () => {
    it('emits npc_activity_todo event with todos', () => {
      stream.emitTodoActivity('npc1', {
        todos: [
          { id: 1, content: 'task one', status: 'pending' },
          { id: 2, content: 'task two', status: 'completed' },
        ],
      })

      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'npc_activity_todo',
          npcId: 'npc1',
          todos: [
            { id: 1, content: 'task one', status: 'pending' },
            { id: 2, content: 'task two', status: 'completed' },
          ],
        }),
      ])
    })

    it('does not emit when todos is missing or not an array', () => {
      stream.emitTodoActivity('npc1', {})
      stream.emitTodoActivity('npc1', { todos: 'invalid' })
      expect(emitFn).not.toHaveBeenCalled()
    })
  })
})
