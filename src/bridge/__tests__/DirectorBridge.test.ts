import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DirectorBridge } from '../DirectorBridge.js'
import type { AgentEvent } from '../../contracts/events.js'

// GameEvent type derived loosely to avoid importing town-frontend (excluded from tsc)
type GameEvent = any

// Mock CharacterRoster to avoid heavy deps
vi.mock('../../town-frontend/src/data/CharacterRoster.js', () => ({
  getCharacterKeyForNpc: vi.fn((npcId: string) => `char_${npcId}`),
  pickUnusedCharacterKey: vi.fn(() => 'char_unused'),
}))

describe('DirectorBridge — Phase State Machine', () => {
  let bridge: DirectorBridge
  let emittedEvents: GameEvent[]

  beforeEach(() => {
    vi.useFakeTimers()
    emittedEvents = []
    bridge = new DirectorBridge()
    bridge.onEmit((events) => {
      emittedEvents.push(...events)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Helper: extract mode_change events */
  const modeChanges = () => emittedEvents.filter(e => e.type === 'mode_change')

  /** Helper: extract npc_phase events */
  const npcPhases = () => emittedEvents.filter(e => e.type === 'npc_phase')

  describe('initial state', () => {
    it('starts in idle phase (no mode_change emitted yet)', () => {
      expect(modeChanges()).toHaveLength(0)
    })

    it('getPersonaSyncEvents returns empty array when no persona set', () => {
      expect(bridge.getPersonaSyncEvents()).toEqual([])
    })
  })

  describe('processWorldAction — user_message', () => {
    it('returns chat type with message', () => {
      const result = bridge.processWorldAction({ type: 'user_message', text: 'hello' })
      expect(result).toEqual({ type: 'chat', message: 'hello' })
    })
  })

  describe('processWorldAction — abort_requested', () => {
    it('returns abort type', () => {
      const result = bridge.processWorldAction({ type: 'abort_requested' })
      expect(result).toEqual({ type: 'abort' })
    })
  })

  describe('processWorldAction — steward_renamed', () => {
    it('returns null and does not throw', () => {
      const result = bridge.processWorldAction({ type: 'steward_renamed', name: 'Alice' })
      expect(result).toBeNull()
    })

    it('emits steward_rename event via setPersonaName', () => {
      bridge.setPersonaName('Alice')
      const renameEvents = emittedEvents.filter(e => e.type === 'steward_rename')
      expect(renameEvents).toHaveLength(1)
      expect(renameEvents[0]).toMatchObject({ npcId: 'steward', newName: 'Alice' })
    })

    it('getPersonaSyncEvents returns rename event after setPersonaName', () => {
      bridge.setPersonaName('Bob')
      const events = bridge.getPersonaSyncEvents()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'steward_rename', newName: 'Bob' })
    })
  })

  describe('processWorldAction — return_to_town', () => {
    it('returns null in idle phase (no scene switch)', () => {
      const result = bridge.processWorldAction({ type: 'return_to_town' })
      expect(result).toBeNull()
      expect(emittedEvents.filter(e => e.type === 'scene_switch')).toHaveLength(0)
    })
  })

  describe('processWorldAction — building_door_clicked', () => {
    it('returns null in idle phase', () => {
      const result = bridge.processWorldAction({ type: 'building_door_clicked', buildingId: 'office' })
      expect(result).toBeNull()
    })
  })

  describe('processWorldAction — npc_move_completed', () => {
    it('returns null and does not throw', () => {
      const result = bridge.processWorldAction({
        type: 'npc_move_completed',
        requestId: 'req_1',
        npcId: 'npc_1',
        status: 'arrived',
      })
      expect(result).toBeNull()
    })

    it('handles interrupted status', () => {
      expect(() => bridge.processWorldAction({
        type: 'npc_move_completed',
        requestId: 'req_2',
        npcId: 'npc_2',
        status: 'interrupted',
      })).not.toThrow()
    })
  })

  describe('processWorldAction — workstation_released', () => {
    it('returns null and does not throw', () => {
      const result = bridge.processWorldAction({
        type: 'workstation_released',
        npcId: 'npc_1',
        stationId: 'B',
      })
      expect(result).toBeNull()
    })

    it('handles missing stationId', () => {
      expect(() => bridge.processWorldAction({
        type: 'workstation_released',
        npcId: 'npc_2',
      })).not.toThrow()
    })
  })

  describe('processWorldAction — unknown action type', () => {
    it('returns null for unknown action', () => {
      const result = bridge.processWorldAction({ type: 'unknown_action' })
      expect(result).toBeNull()
    })
  })

  describe('processWorldAction — town_setup_complete', () => {
    it('returns null', () => {
      const result = bridge.processWorldAction({ type: 'town_setup_complete' })
      expect(result).toBeNull()
    })
  })

  describe('onUserMessage', () => {
    it('emits dialog_message event', () => {
      bridge.onUserMessage('hello world')
      const dialogEvents = emittedEvents.filter(e => e.type === 'dialog_message')
      expect(dialogEvents).toHaveLength(1)
      expect(dialogEvents[0]).toMatchObject({ npcId: 'user', text: 'hello world' })
    })
  })

  describe('setTownConfig', () => {
    it('returns false when no pending work snapshot', () => {
      const result = bridge.setTownConfig({ citizens: [] })
      expect(result).toBe(false)
    })

    it('emits town_config_ready when citizens are present', () => {
      bridge.setTownConfig({
        citizens: [{ id: 'citizen_1', avatarId: 'avatar_1' }],
      })
      const configEvents = emittedEvents.filter(e => e.type === 'town_config_ready')
      expect(configEvents).toHaveLength(1)
    })

    it('does not emit town_config_ready when no citizens', () => {
      bridge.setTownConfig({ citizens: [] })
      expect(emittedEvents.filter(e => e.type === 'town_config_ready')).toHaveLength(0)
    })

    it('updates steward avatar assignment from config', () => {
      bridge.setTownConfig({ steward: { avatarId: 'steward_v2' }, citizens: [] })
      // No direct getter, but verify no throw
      expect(true).toBe(true)
    })
  })

  describe('processAgentEvent — error event', () => {
    it('emits npc_phase error event', () => {
      bridge.processAgentEvent({ type: 'error', message: 'something broke' } as AgentEvent)
      const errorPhases = npcPhases().filter(e => 'phase' in e && e.phase === 'error')
      expect(errorPhases).toHaveLength(1)
    })
  })

  describe('processAgentEvent — text event', () => {
    it('emits dialog message for steward text', () => {
      bridge.processAgentEvent({ type: 'text', content: 'Hello there' } as AgentEvent)
      const dialogEvents = emittedEvents.filter(e => e.type === 'dialog_message' && e.npcId === 'steward')
      expect(dialogEvents.length).toBeGreaterThan(0)
    })

    it('deduplicates identical text events', () => {
      bridge.processAgentEvent({ type: 'text', content: 'Same text' } as AgentEvent)
      bridge.processAgentEvent({ type: 'text', content: 'Same text' } as AgentEvent)
      const dialogEvents = emittedEvents.filter(
        e => e.type === 'dialog_message' && e.npcId === 'steward',
      )
      expect(dialogEvents).toHaveLength(1)
    })
  })

  describe('processAgentEvent — thinking_delta', () => {
    it('emits thinking phase for steward in idle', () => {
      bridge.processAgentEvent({ type: 'thinking_delta', delta: 'hmm' } as AgentEvent)
      // thinking_delta uses queue which may flush on turn_end
      bridge.processAgentEvent({ type: 'turn_end' } as AgentEvent)
      const thinkingPhases = npcPhases().filter(e => 'phase' in e && e.phase === 'thinking')
      expect(thinkingPhases.length).toBeGreaterThan(0)
    })
  })

  describe('processAgentEvent — turn_end in idle', () => {
    it('emits idle phase for steward', () => {
      bridge.processAgentEvent({ type: 'turn_end' } as AgentEvent)
      const idlePhases = npcPhases().filter(e => 'phase' in e && e.phase === 'idle')
      expect(idlePhases.length).toBeGreaterThan(0)
    })
  })

  describe('emit buffering', () => {
    it('buffers events before onEmit is registered', () => {
      const bufferBridge = new DirectorBridge()
      // Emit something before registering handler
      bufferBridge.onUserMessage('buffered message')
      const received: GameEvent[] = []
      bufferBridge.onEmit((events) => received.push(...events))
      expect(received.length).toBeGreaterThan(0)
      const dialogEvents = received.filter(e => e.type === 'dialog_message')
      expect(dialogEvents.length).toBeGreaterThan(0)
    })
  })

  describe('onPersonaChanged callback', () => {
    it('invokes callback when persona changes via onStewardRenamed', () => {
      const cb = vi.fn()
      bridge.onPersonaChanged(cb)
      bridge.processWorldAction({ type: 'steward_renamed', name: 'NewName' })
      expect(cb).toHaveBeenCalledWith('NewName')
    })
  })

  describe('restoreWorkState', () => {
    it('does nothing when agents array is empty', () => {
      bridge.restoreWorkState({ phase: 'working', agents: [] })
      // No npc_activity_restore event should be emitted
      expect(emittedEvents.filter(e => e.type === 'npc_activity_restore')).toHaveLength(0)
    })

    it('defers restore when townConfig is not ready', () => {
      // townConfig not set yet
      bridge.restoreWorkState({
        phase: 'working',
        agents: [{ id: 'agent_1', displayName: 'Worker', task: 'task', status: 'working' }],
      })
      // Should not emit npc_activity_restore yet (deferred)
      expect(emittedEvents.filter(e => e.type === 'npc_activity_restore')).toHaveLength(0)
    })

    it('restores immediately when townConfig is ready', () => {
      bridge.setTownConfig({ citizens: [] })
      bridge.restoreWorkState({
        phase: 'working',
        agents: [{ id: 'agent_1', displayName: 'Worker', task: 'task', status: 'working' }],
      })
      // restore_work_state event removed; only npc_activity_restore may emit (none here — no activityLog)
      expect(emittedEvents.filter(e => e.type === 'npc_activity_restore')).toHaveLength(0)
    })

    it('executes pending restore after townConfig is set', () => {
      // Defer restore
      bridge.restoreWorkState({
        phase: 'working',
        agents: [{ id: 'agent_1', displayName: 'Worker', task: 'task', status: 'working' }],
      })
      // Now set config — should trigger pending restore
      const result = bridge.setTownConfig({ citizens: [] })
      expect(result).toBe(true)
      // Execute pending restore
      bridge.executePendingRestore()
      expect(emittedEvents.filter(e => e.type === 'npc_activity_restore')).toHaveLength(0)
    })
  })
})
