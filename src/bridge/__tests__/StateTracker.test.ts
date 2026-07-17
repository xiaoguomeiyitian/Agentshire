import { describe, it, expect, beforeEach } from 'vitest'
import { StateTracker } from '../StateTracker.js'

describe('StateTracker', () => {
  let tracker: StateTracker

  beforeEach(() => {
    tracker = new StateTracker()
  })

  describe('registerMapping / resolveNpcId / resolveAgentId', () => {
    it('registers and resolves bidirectional mapping', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      expect(tracker.resolveNpcId('agent_1')).toBe('npc_1')
      expect(tracker.resolveAgentId('npc_1')).toBe('agent_1')
    })

    it('returns undefined for unregistered agentId', () => {
      expect(tracker.resolveNpcId('unknown')).toBeUndefined()
    })

    it('returns undefined for unregistered npcId', () => {
      expect(tracker.resolveAgentId('unknown')).toBeUndefined()
    })

    it('overwrites previous mapping for same agentId', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      tracker.registerMapping('agent_1', 'npc_2')
      expect(tracker.resolveNpcId('agent_1')).toBe('npc_2')
      // Note: npcToAgent map still has old npc_1 → agent_1 entry (registerMapping doesn't clean up)
      expect(tracker.resolveAgentId('npc_2')).toBe('agent_1')
    })

    it('handles multiple mappings', () => {
      tracker.registerMapping('a1', 'n1')
      tracker.registerMapping('a2', 'n2')
      tracker.registerMapping('a3', 'n3')
      expect(tracker.resolveNpcId('a1')).toBe('n1')
      expect(tracker.resolveNpcId('a2')).toBe('n2')
      expect(tracker.resolveNpcId('a3')).toBe('n3')
    })
  })

  describe('removeMapping', () => {
    it('removes mapping by agentId', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      tracker.removeMapping('agent_1')
      expect(tracker.resolveNpcId('agent_1')).toBeUndefined()
      expect(tracker.resolveAgentId('npc_1')).toBeUndefined()
    })

    it('releases associated station on removal', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      const station = tracker.allocateStation()
      expect(station).not.toBeNull()
      tracker.setStationForNpc('npc_1', station!)
      tracker.removeMapping('agent_1')
      // Station should be released and available again
      const station2 = tracker.allocateStation()
      expect(station2).toBe(station)
    })

    it('is safe to call for non-existent agentId', () => {
      expect(() => tracker.removeMapping('unknown')).not.toThrow()
    })
  })

  describe('removeMappingByNpcId', () => {
    it('removes mapping by npcId', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      tracker.removeMappingByNpcId('npc_1')
      expect(tracker.resolveNpcId('agent_1')).toBeUndefined()
      expect(tracker.resolveAgentId('npc_1')).toBeUndefined()
    })

    it('is safe to call for non-existent npcId', () => {
      expect(() => tracker.removeMappingByNpcId('unknown')).not.toThrow()
    })
  })

  describe('allocateStation', () => {
    it('returns a station ID', () => {
      const station = tracker.allocateStation()
      expect(station).not.toBeNull()
      expect(typeof station).toBe('string')
    })

    it('returns different station IDs on subsequent calls', () => {
      const s1 = tracker.allocateStation()
      const s2 = tracker.allocateStation()
      expect(s1).not.toBe(s2)
    })

    it('returns null when all stations are exhausted', () => {
      // WORKSTATION_IDS has 10 entries
      const allocated: string[] = []
      for (let i = 0; i < 10; i++) {
        const s = tracker.allocateStation()
        expect(s).not.toBeNull()
        allocated.push(s!)
      }
      expect(tracker.allocateStation()).toBeNull()
    })

    it('reuses released stations', () => {
      const s1 = tracker.allocateStation()
      tracker.releaseStation(s1!)
      const s2 = tracker.allocateStation()
      expect(s2).toBe(s1)
    })
  })

  describe('releaseStation', () => {
    it('is safe to release a non-allocated station', () => {
      expect(() => tracker.releaseStation('X')).not.toThrow()
    })

    it('allows re-allocation after release', () => {
      const s1 = tracker.allocateStation()
      tracker.releaseStation(s1!)
      const s2 = tracker.allocateStation()
      expect(s2).toBe(s1)
    })
  })

  describe('setStationForNpc / getStationForNpc', () => {
    it('sets and gets station for npc', () => {
      tracker.setStationForNpc('npc_1', 'B')
      expect(tracker.getStationForNpc('npc_1')).toBe('B')
    })

    it('returns undefined for npc without station', () => {
      expect(tracker.getStationForNpc('unknown')).toBeUndefined()
    })

    it('overwrites previous station', () => {
      tracker.setStationForNpc('npc_1', 'B')
      tracker.setStationForNpc('npc_1', 'C')
      expect(tracker.getStationForNpc('npc_1')).toBe('C')
    })
  })

  describe('updatePhase', () => {
    it('updates phase for existing npc state', () => {
      tracker.registerMapping('agent_1', 'npc_1')
      tracker.setStationForNpc('npc_1', 'B')
      tracker.updatePhase('npc_1', 'working')
      const states = tracker.getAllNpcStates()
      expect(states[0].phase).toBe('working')
    })

    it('is safe for non-existing npc', () => {
      expect(() => tracker.updatePhase('unknown', 'idle')).not.toThrow()
    })
  })

  describe('getAllNpcStates', () => {
    it('returns empty array initially', () => {
      expect(tracker.getAllNpcStates()).toEqual([])
    })

    it('returns all registered npc states', () => {
      tracker.registerMapping('a1', 'n1')
      tracker.registerMapping('a2', 'n2')
      tracker.setStationForNpc('n1', 'B')
      tracker.setStationForNpc('n2', 'C')
      const states = tracker.getAllNpcStates()
      expect(states).toHaveLength(2)
      const npcIds = states.map(s => s.npcId).sort()
      expect(npcIds).toEqual(['n1', 'n2'])
    })
  })

  describe('clear', () => {
    it('clears all mappings and states', () => {
      tracker.registerMapping('a1', 'n1')
      tracker.setStationForNpc('n1', 'B')
      tracker.allocateStation()
      tracker.clear()
      expect(tracker.resolveNpcId('a1')).toBeUndefined()
      expect(tracker.resolveAgentId('n1')).toBeUndefined()
      expect(tracker.getAllNpcStates()).toEqual([])
      // After clear, all 10 stations should be available
      let count = 0
      while (tracker.allocateStation() !== null) count++
      expect(count).toBe(10)
    })
  })

  describe('stewardNpcId', () => {
    it('exposes steward as the steward NPC id', () => {
      expect(tracker.stewardNpcId).toBe('steward')
    })
  })
})
