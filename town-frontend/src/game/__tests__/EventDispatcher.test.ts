// @desc Tests for EventDispatcher: GameEvent routing to handler callbacks
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventDispatcher, type EventHandlers } from '../EventDispatcher'
import type { GameEvent } from '../../data/GameProtocol'

function createMockHandlers(): EventHandlers {
  return {
    onNpcSpawn: vi.fn(),
    onNpcDespawn: vi.fn(),
    onNpcPhase: vi.fn(),
    onNpcMoveTo: vi.fn(),
    onNpcDailyBehaviorReady: vi.fn(),
    onNpcQuery: vi.fn(),
    onNpcEmote: vi.fn(),
    onNpcEmoji: vi.fn(),
    onNpcGlow: vi.fn(),
    onNpcAnim: vi.fn(),
    onNpcLookAt: vi.fn(),
    onDialogMessage: vi.fn(),
    onDialogEnd: vi.fn(),
    onWorkstationAssign: vi.fn(),
    onWorkstationScreen: vi.fn(),
    onSceneSwitch: vi.fn(),
    onFx: vi.fn(),
    onProgress: vi.fn(),
    onCameraMove: vi.fn(),
    onNpcPersonaUpdate: vi.fn(),
    onSetupComplete: vi.fn(),
    onModeChange: vi.fn(),
    onSummonNpcs: vi.fn(),
    onTaskBriefing: vi.fn(),
    onWorkStatusUpdate: vi.fn(),
    onWorkComplete: vi.fn(),
    onGameCompletionPopup: vi.fn(),
    onDeliverableCard: vi.fn(),
    onNpcActivity: vi.fn(),
    onNpcActivityStatus: vi.fn(),
    onNpcActivityStream: vi.fn(),
    onNpcActivityStreamEnd: vi.fn(),
    onNpcActivityTodo: vi.fn(),
    onNpcActivityRestore: vi.fn(),
    onSkillLearned: vi.fn(),
    onModeSwitch: vi.fn(),
    onRestoreWorkState: vi.fn(),
    onSetSessionId: vi.fn(),
    onTownConfigReady: vi.fn(),
    onNpcChangeModel: vi.fn(),
    onStewardRename: vi.fn(),
    onNpcWorkDone: vi.fn(),
    onWorkflowIntent: vi.fn(),
    onSetTime: vi.fn(),
    onSetWeather: vi.fn(),
    onSceneEdit: vi.fn(),
  }
}

describe('EventDispatcher', () => {
  let handlers: EventHandlers
  let dispatcher: EventDispatcher

  beforeEach(() => {
    handlers = createMockHandlers()
    dispatcher = new EventDispatcher(handlers)
  })

  it('npc_spawn → calls onNpcSpawn with the full event', () => {
    const event: GameEvent = {
      type: 'npc_spawn',
      npcId: 'alice',
      name: 'Alice',
      role: 'programming',
      category: 'citizen',
      task: 'Build UI',
    }
    dispatcher.dispatch(event)

    expect(handlers.onNpcSpawn).toHaveBeenCalledOnce()
    expect(handlers.onNpcSpawn).toHaveBeenCalledWith(event)
  })

  it('dialog_message → calls onDialogMessage with npcId, text, isStreaming', () => {
    const event: GameEvent = {
      type: 'dialog_message',
      npcId: 'steward',
      text: 'Hello!',
      isStreaming: true,
    }
    dispatcher.dispatch(event)

    expect(handlers.onDialogMessage).toHaveBeenCalledOnce()
    expect(handlers.onDialogMessage).toHaveBeenCalledWith('steward', 'Hello!', true)
  })

  it('scene_switch → calls onSceneSwitch with target', () => {
    const event: GameEvent = { type: 'scene_switch', target: 'office' }
    dispatcher.dispatch(event)

    expect(handlers.onSceneSwitch).toHaveBeenCalledOnce()
    expect(handlers.onSceneSwitch).toHaveBeenCalledWith('office')
  })

  it('fx → calls onFx with effect and params', () => {
    const event: GameEvent = {
      type: 'fx',
      effect: 'completion_stars',
      params: { npcId: 'alice' },
    }
    dispatcher.dispatch(event)

    expect(handlers.onFx).toHaveBeenCalledOnce()
    expect(handlers.onFx).toHaveBeenCalledWith('completion_stars', { npcId: 'alice' })
  })

  it('mode_change → calls onModeChange with the full event', () => {
    const event: GameEvent = {
      type: 'mode_change',
      mode: 'work',
      taskDescription: 'Build a game',
    }
    dispatcher.dispatch(event)

    expect(handlers.onModeChange).toHaveBeenCalledOnce()
    expect(handlers.onModeChange).toHaveBeenCalledWith(event)
  })

  it('npc_phase → calls onNpcPhase with npcId and phase', () => {
    const event: GameEvent = { type: 'npc_phase', npcId: 'bob', phase: 'working' }
    dispatcher.dispatch(event)

    expect(handlers.onNpcPhase).toHaveBeenCalledOnce()
    expect(handlers.onNpcPhase).toHaveBeenCalledWith('bob', 'working')
  })

  it('workstation_assign → calls onWorkstationAssign', () => {
    const event: GameEvent = { type: 'workstation_assign', npcId: 'alice', stationId: 'B' }
    dispatcher.dispatch(event)

    expect(handlers.onWorkstationAssign).toHaveBeenCalledOnce()
    expect(handlers.onWorkstationAssign).toHaveBeenCalledWith('alice', 'B')
  })

  it('npc_glow → calls onNpcGlow with npcId and color', () => {
    const event: GameEvent = { type: 'npc_glow', npcId: 'alice', color: 'green' }
    dispatcher.dispatch(event)

    expect(handlers.onNpcGlow).toHaveBeenCalledOnce()
    expect(handlers.onNpcGlow).toHaveBeenCalledWith('alice', 'green')
  })

  it('npc_emote → calls onNpcEmote with the full event', () => {
    const event: GameEvent = { type: 'npc_emote', npcId: 'bob', emote: 'happy' }
    dispatcher.dispatch(event)

    expect(handlers.onNpcEmote).toHaveBeenCalledOnce()
    expect(handlers.onNpcEmote).toHaveBeenCalledWith(event)
  })

  it('unknown event type → does not throw', () => {
    const event = { type: 'totally_unknown_event' } as unknown as GameEvent
    expect(() => dispatcher.dispatch(event)).not.toThrow()
  })

  it('world_init → does not call any handler (silently consumed)', () => {
    const event: GameEvent = {
      type: 'world_init',
      config: { townName: 'Test', stewardName: 'Bot', citizenCount: 3 },
    }
    dispatcher.dispatch(event)

    for (const fn of Object.values(handlers)) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('npc_despawn → calls onNpcDespawn with npcId', () => {
    const event: GameEvent = { type: 'npc_despawn', npcId: 'charlie' }
    dispatcher.dispatch(event)

    expect(handlers.onNpcDespawn).toHaveBeenCalledOnce()
    expect(handlers.onNpcDespawn).toHaveBeenCalledWith('charlie')
  })

  it('dialog_end → calls onDialogEnd with npcId', () => {
    const event: GameEvent = { type: 'dialog_end', npcId: 'steward' }
    dispatcher.dispatch(event)

    expect(handlers.onDialogEnd).toHaveBeenCalledOnce()
    expect(handlers.onDialogEnd).toHaveBeenCalledWith('steward')
  })

  it('progress → calls onProgress with current, total, label', () => {
    const event: GameEvent = { type: 'progress', current: 3, total: 10, label: 'Loading...' }
    dispatcher.dispatch(event)

    expect(handlers.onProgress).toHaveBeenCalledOnce()
    expect(handlers.onProgress).toHaveBeenCalledWith(3, 10, 'Loading...')
  })

  it('npc_query (self) → calls onNpcQuery with requestId and self query', () => {
    const event: GameEvent = {
      type: 'npc_query',
      requestId: 'q-1',
      query: { kind: 'self', npcId: 'citizen_1' },
    }
    dispatcher.dispatch(event)

    expect(handlers.onNpcQuery).toHaveBeenCalledOnce()
    expect(handlers.onNpcQuery).toHaveBeenCalledWith('q-1', { kind: 'self', npcId: 'citizen_1' })
  })

  it('npc_query (nearby) → calls onNpcQuery with requestId and nearby query', () => {
    const event: GameEvent = {
      type: 'npc_query',
      requestId: 'q-2',
      query: { kind: 'nearby', radius: 10, callerNpcId: 'citizen_1' },
    }
    dispatcher.dispatch(event)

    expect(handlers.onNpcQuery).toHaveBeenCalledOnce()
    expect(handlers.onNpcQuery).toHaveBeenCalledWith('q-2', { kind: 'nearby', radius: 10, callerNpcId: 'citizen_1' })
  })
})
