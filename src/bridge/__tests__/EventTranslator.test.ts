// @desc Tests for EventTranslator: AgentEvent → GameEvent mapping
import { describe, it, expect, beforeEach } from 'vitest'
import { EventTranslator } from '../EventTranslator.js'
import { StateTracker } from '../StateTracker.js'
import type { AgentEvent } from '../../contracts/events.js'

describe('EventTranslator', () => {
  let tracker: StateTracker
  let translator: EventTranslator

  beforeEach(() => {
    tracker = new StateTracker()
    translator = new EventTranslator(tracker)
  })

  describe('system.init', () => {
    it('should return world_init GameEvent', () => {
      const event: AgentEvent = { type: 'system', subtype: 'init', sessionId: 'sess-1', model: 'test' }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'world_init',
        config: { townName: '夏尔', stewardName: 'OpenClaw', citizenCount: 5 },
      })
    })
  })

  describe('sub_agent.started', () => {
    it('should return npc_spawn and workstation_assign when station available', () => {
      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_alice',
        agentType: 'sub',
        parentToolUseId: 'tool-1',
        task: 'Build the frontend',
        model: 'test',
        displayName: 'Alice',
      }
      const result = translator.translate(event)

      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0]).toMatchObject({
        type: 'npc_spawn',
        npcId: 'alice',
        name: 'Alice',
        role: 'citizen',
        category: 'citizen',
        task: 'Build the frontend',
      })
      expect(result[1]).toMatchObject({
        type: 'workstation_assign',
        npcId: 'alice',
      })
      expect((result[1] as any).stationId).toBeTruthy()
    })

    it('should register agent→NPC mapping in StateTracker', () => {
      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_bob',
        agentType: 'sub',
        parentToolUseId: 'tool-2',
        task: 'Write tests',
        model: 'test',
      }
      translator.translate(event)

      expect(tracker.resolveNpcId('agent_bob')).toBe('bob')
    })

    it('should use agentId as displayName when displayName is absent', () => {
      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_charlie',
        agentType: 'sub',
        parentToolUseId: 'tool-3',
        task: 'Deploy',
        model: 'test',
      }
      const result = translator.translate(event)

      expect(result[0]).toMatchObject({ type: 'npc_spawn', name: 'agent_charlie' })
    })

    it('should allocate all 6 office workstations before running out', () => {
      const assignedStations = new Set<string>()

      for (let i = 0; i < 6; i++) {
        const event: AgentEvent = {
          type: 'sub_agent',
          subtype: 'started',
          agentId: `agent_worker_${i}`,
          agentType: 'sub',
          parentToolUseId: `tool-${i}`,
          task: 'Test allocation',
          model: 'test',
        }
        const result = translator.translate(event)
        const workstationAssign = result.find(e => e.type === 'workstation_assign')
        expect(workstationAssign).toBeTruthy()
        assignedStations.add((workstationAssign as { stationId: string }).stationId)
      }

      expect(assignedStations.size).toBe(6)

      const overflowEvent: AgentEvent = {
        type: 'sub_agent',
        subtype: 'started',
        agentId: 'agent_worker_overflow',
        agentType: 'sub',
        parentToolUseId: 'tool-overflow',
        task: 'Overflow allocation',
        model: 'test',
      }
      const overflowResult = translator.translate(overflowEvent)

      expect(overflowResult.some(e => e.type === 'workstation_assign')).toBe(false)
    })
  })

  describe('sub_agent.done (success)', () => {
    it('should return npc_phase(done) + npc_glow(green) + fx(completion_stars)', () => {
      tracker.registerMapping('agent_alice', 'alice')

      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'done',
        agentId: 'agent_alice',
        result: 'All done',
        toolCalls: 5,
        status: 'completed',
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'alice', phase: 'done' })
      expect(result[1]).toMatchObject({ type: 'npc_glow', npcId: 'alice', color: 'green' })
      expect(result[2]).toMatchObject({ type: 'fx', effect: 'completion_stars', params: { npcId: 'alice' } })
    })
  })

  describe('sub_agent.done (failed)', () => {
    it('should return npc_phase(error) + npc_glow(red) + fx(error_sparks)', () => {
      tracker.registerMapping('agent_bob', 'bob')

      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'done',
        agentId: 'agent_bob',
        result: 'Crashed',
        toolCalls: 2,
        status: 'failed',
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'bob', phase: 'error' })
      expect(result[1]).toMatchObject({ type: 'npc_glow', npcId: 'bob', color: 'red' })
      expect(result[2]).toMatchObject({ type: 'fx', effect: 'error_sparks', params: { npcId: 'bob' } })
    })

    it('should return empty array when agentId has no mapping', () => {
      const event: AgentEvent = {
        type: 'sub_agent',
        subtype: 'done',
        agentId: 'unknown_agent',
        result: '',
        toolCalls: 0,
        status: 'completed',
      }
      const result = translator.translate(event)

      expect(result).toEqual([])
    })
  })

  describe('text_delta', () => {
    it('should return dialog_message with isStreaming: true', () => {
      const event: AgentEvent = { type: 'text_delta', delta: 'Hello world' }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'dialog_message',
        npcId: 'steward',
        text: 'Hello world',
        isStreaming: true,
      })
    })

    it('should use contextNpcId when provided', () => {
      const event: AgentEvent = { type: 'text_delta', delta: 'Working...' }
      const result = translator.translate(event, 'alice')

      expect(result[0]).toMatchObject({ type: 'dialog_message', npcId: 'alice', isStreaming: true })
    })
  })

  describe('text', () => {
    it('should return dialog_message with isStreaming: false', () => {
      const event: AgentEvent = { type: 'text', content: 'Final answer' }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'dialog_message',
        npcId: 'steward',
        text: 'Final answer',
        isStreaming: false,
      })
    })
  })

  describe('tool_use', () => {
    it('should return npc_phase(working)', () => {
      const event: AgentEvent = {
        type: 'tool_use',
        toolUseId: 'tu-1',
        name: 'bash',
        input: { command: 'echo hello' },
      }
      const result = translator.translate(event)

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'steward', phase: 'working' })
    })

    it('should include workstation_screen when tool targets a file', () => {
      const event: AgentEvent = {
        type: 'tool_use',
        toolUseId: 'tu-2',
        name: 'read_file',
        input: { path: '/src/index.ts' },
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(2)
      expect(result[1]).toMatchObject({
        type: 'workstation_screen',
        state: { mode: 'coding', fileName: 'index.ts' },
      })
    })
  })

  describe('thinking_delta', () => {
    it('should return npc_phase(thinking) for steward when no contextNpcId', () => {
      const event: AgentEvent = { type: 'thinking_delta', delta: 'hmm...' }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'steward', phase: 'thinking' })
    })

    it('should use contextNpcId when provided', () => {
      const event: AgentEvent = { type: 'thinking_delta', delta: 'considering...' }
      const result = translator.translate(event, 'bob')

      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'bob', phase: 'thinking' })
    })
  })

  describe('error', () => {
    it('should return npc_phase(error) + npc_emote(frustrated) when contextNpcId provided', () => {
      const event: AgentEvent = { type: 'error', message: 'Something broke', recoverable: false }
      const result = translator.translate(event, 'alice')

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ type: 'npc_phase', npcId: 'alice', phase: 'error' })
      expect(result[1]).toMatchObject({ type: 'npc_emote', npcId: 'alice', emote: 'frustrated' })
    })

    it('should return empty array when no contextNpcId', () => {
      const event: AgentEvent = { type: 'error', message: 'fail', recoverable: true }
      const result = translator.translate(event)

      expect(result).toEqual([])
    })
  })

  describe('unknown event type', () => {
    it('should return empty array', () => {
      const event = { type: 'debug', category: 'test', message: 'blah' } as AgentEvent
      const result = translator.translate(event)

      expect(result).toEqual([])
    })
  })

  describe('world_control.query_npc', () => {
    it('should translate self query to npc_query GameEvent', () => {
      const event: AgentEvent = {
        type: 'world_control',
        target: 'query_npc',
        requestId: 'q-self-1',
        query: { kind: 'self', npcId: 'citizen_1' },
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'npc_query',
        requestId: 'q-self-1',
        query: { kind: 'self', npcId: 'citizen_1' },
      })
    })

    it('should translate nearby query (with origin) to npc_query GameEvent', () => {
      const event: AgentEvent = {
        type: 'world_control',
        target: 'query_npc',
        requestId: 'q-near-1',
        query: { kind: 'nearby', radius: 15, origin: { x: 10, z: 5 }, callerNpcId: 'citizen_2' },
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'npc_query',
        requestId: 'q-near-1',
        query: { kind: 'nearby', radius: 15, origin: { x: 10, z: 5 }, callerNpcId: 'citizen_2' },
      })
    })

    it('should translate nearby query (no origin) to npc_query GameEvent', () => {
      const event: AgentEvent = {
        type: 'world_control',
        target: 'query_npc',
        requestId: 'q-near-2',
        query: { kind: 'nearby', radius: 8, callerNpcId: 'steward' },
      }
      const result = translator.translate(event)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        type: 'npc_query',
        requestId: 'q-near-2',
        query: { kind: 'nearby', radius: 8, callerNpcId: 'steward' },
      })
    })
  })
})
