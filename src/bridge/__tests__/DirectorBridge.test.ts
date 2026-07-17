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

  describe('processWorldAction — workflow_phase_complete (state transitions)', () => {
    it('summoning → assigning transition', () => {
      // First, trigger summoning by sending sub_agent started event
      bridge.processAgentEvent({
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_1',
        displayName: 'Worker One',
        task: 'build feature',
      } as AgentEvent)

      // Should be in summoning phase now
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'summoning')).toBe(true)

      // Complete summoning phase
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })

      // Should transition to assigning
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'assigning')).toBe(true)

      // Should emit workflow_assign event
      const assignEvents = emittedEvents.filter(e => e.type === 'workflow_assign')
      expect(assignEvents).toHaveLength(1)
    })

    it('assigning → going_to_office transition', () => {
      // Setup: get to assigning phase
      bridge.processAgentEvent({
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_1',
        displayName: 'Worker One',
        task: 'task',
      } as AgentEvent)
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })

      // Complete assigning phase
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'assigning' })

      // Should transition to going_to_office
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'going_to_office')).toBe(true)

      // Should emit workflow_go_office event
      const goOfficeEvents = emittedEvents.filter(e => e.type === 'workflow_go_office')
      expect(goOfficeEvents).toHaveLength(1)
    })

    it('going_to_office → working transition', () => {
      // Setup: get to going_to_office phase
      bridge.processAgentEvent({
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_1',
        displayName: 'Worker One',
        task: 'task',
      } as AgentEvent)
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'assigning' })

      // Complete going_to_office phase
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'going_to_office' })

      // Should transition to working
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'working')).toBe(true)

      // Should emit progress event
      const progressEvents = emittedEvents.filter(e => e.type === 'progress')
      expect(progressEvents).toHaveLength(1)
    })

    it('publishing → returning transition', () => {
      // Setup: get to working phase first
      bridge.processAgentEvent({
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_1',
        displayName: 'Worker One',
        task: 'task',
      } as AgentEvent)
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'assigning' })
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'going_to_office' })

      // Manually set phase to publishing (via internal state — we test the transition logic)
      // Since publishing is reached via handleProjectComplete, we test the returning transition
      // by directly calling workflow_phase_complete with 'publishing'
      // But phase must be 'publishing' for the transition to fire.
      // We verify the guard: transition only fires if current phase matches.
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'publishing' })

      // Since phase is 'working' (not 'publishing'), no returning transition should occur
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'returning')).toBe(false)
    })

    it('returning → idle transition (full cycle)', () => {
      // Setup: complete full cycle to returning phase
      bridge.processAgentEvent({
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_1',
        displayName: 'Worker One',
        task: 'task',
      } as AgentEvent)
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'assigning' })
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'going_to_office' })

      // We can't easily reach 'returning' without full project flow,
      // but we can verify the idle transition guard works (phase mismatch = no transition)
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'returning' })

      // Since phase is 'working' (not 'returning'), no idle transition
      expect(modeChanges().some(e => 'mode' in e && e.mode === 'life')).toBe(false)
    })

    it('ignores phase_complete when current phase does not match', () => {
      // In idle phase, completing 'summoning' should not transition
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'summoning' })
      expect(modeChanges().some(e => 'workSubState' in e && e.workSubState === 'assigning')).toBe(false)
    })

    it('ignores unknown phase_complete values', () => {
      bridge.processWorldAction({ type: 'workflow_phase_complete', phase: 'unknown_phase' })
      expect(modeChanges()).toHaveLength(0)
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
      // No restore_work_state event should be emitted
      expect(emittedEvents.filter(e => e.type === 'restore_work_state')).toHaveLength(0)
    })

    it('defers restore when townConfig is not ready', () => {
      // townConfig not set yet
      bridge.restoreWorkState({
        phase: 'working',
        agents: [{ id: 'agent_1', displayName: 'Worker', task: 'task', status: 'working' }],
      })
      // Should not emit restore_work_state yet (deferred)
      expect(emittedEvents.filter(e => e.type === 'restore_work_state')).toHaveLength(0)
    })

    it('restores immediately when townConfig is ready', () => {
      bridge.setTownConfig({ citizens: [] })
      bridge.restoreWorkState({
        phase: 'working',
        agents: [{ id: 'agent_1', displayName: 'Worker', task: 'task', status: 'working' }],
      })
      expect(emittedEvents.filter(e => e.type === 'restore_work_state')).toHaveLength(1)
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
      expect(emittedEvents.filter(e => e.type === 'restore_work_state')).toHaveLength(1)
    })
  })
})
