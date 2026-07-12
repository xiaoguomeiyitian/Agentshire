// @desc Tests for RouteManager: A* pathfinding and NPC movement
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouteManager } from '../RouteManager.js'

vi.mock('../data/route-config.js', () => ({
  CITIZEN_DESTINATION_POINTS: [
    { id: 'dest_a', x: 30, z: 20 },
    { id: 'dest_b', x: 35, z: 25 },
    { id: 'dest_c', x: 40, z: 30 },
  ],
  ROUTE_GRAPHS: {
    town: {
      node_a: { x: 10, z: 10, neighbors: ['node_b'] },
      node_b: { x: 15, z: 10, neighbors: ['node_a', 'node_c'] },
      node_c: { x: 20, z: 10, neighbors: ['node_b', 'node_d'] },
      node_d: { x: 20, z: 15, neighbors: ['node_c'] },
    },
    office: {
      off_a: { x: 5, z: 3, neighbors: ['off_b'] },
      off_b: { x: 8, z: 3, neighbors: ['off_a'] },
    },
  },
}))

describe('RouteManager', () => {
  let emitFn: ReturnType<typeof vi.fn>
  let rm: RouteManager

  beforeEach(() => {
    emitFn = vi.fn()
    rm = new RouteManager(emitFn as any)
  })

  describe('distance2D', () => {
    it('computes euclidean distance', () => {
      expect(rm.distance2D({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5)
    })

    it('returns 0 for same point', () => {
      expect(rm.distance2D({ x: 5, z: 5 }, { x: 5, z: 5 })).toBe(0)
    })
  })

  describe('planRouteNodePath', () => {
    it('returns [startId] when start equals end', () => {
      expect(rm.planRouteNodePath('node_a', 'node_a', 'town')).toEqual(['node_a'])
    })

    it('returns correct path through graph', () => {
      const path = rm.planRouteNodePath('node_a', 'node_d', 'town')
      expect(path[0]).toBe('node_a')
      expect(path[path.length - 1]).toBe('node_d')
      expect(path.length).toBeGreaterThanOrEqual(3)
    })

    it('returns direct [start, end] for disconnected nodes', () => {
      const path = rm.planRouteNodePath('off_a', 'off_b', 'office')
      expect(path).toEqual(['off_a', 'off_b'])
    })
  })

  describe('chooseCitizenDestination', () => {
    it('returns a destination object with id, x, z, score', () => {
      const dest = rm.chooseCitizenDestination('npc1', { x: 10, z: 10 })
      expect(dest).toHaveProperty('id')
      expect(dest).toHaveProperty('x')
      expect(dest).toHaveProperty('z')
      expect(dest).toHaveProperty('score')
    })

    it('avoids claimed destinations when unclaimed alternatives exist', () => {
      rm.claimDestinationForNpc('other_npc', 'dest_a')
      const results = new Set<string>()
      for (let i = 0; i < 20; i++) {
        results.add(rm.chooseCitizenDestination('npc1', { x: 10, z: 10 }).id)
      }
      expect(results.has('dest_a')).toBe(false)
    })
  })

  describe('moveNpcAndWait', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('resolves as interrupted on timeout', async () => {
      const promise = rm.moveNpcAndWait('npc1', { x: 0, y: 0, z: 0 }, 5, 1000)

      expect(emitFn).toHaveBeenCalledWith([
        expect.objectContaining({ type: 'npc_move_to', npcId: 'npc1' }),
      ])

      vi.advanceTimersByTime(1000)
      await expect(promise).resolves.toBe('interrupted')
    })

    it('resolves as arrived when resolveMoveRequest is called', async () => {
      const promise = rm.moveNpcAndWait('npc1', { x: 0, y: 0, z: 0 }, 5, 5000)

      const requestId = emitFn.mock.calls[0][0][0].requestId
      rm.resolveMoveRequest(requestId, 'npc1', 'arrived')

      await expect(promise).resolves.toBe('arrived')
    })
  })
})
