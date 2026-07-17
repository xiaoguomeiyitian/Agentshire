import { describe, it, expect, beforeEach } from 'vitest'
import { IndoorTracker } from '../IndoorTracker'

describe('IndoorTracker', () => {
  let tracker: IndoorTracker

  beforeEach(() => {
    tracker = new IndoorTracker()
  })

  it('records and queries indoor citizens', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.enter('bob', 'house_b_door')

    expect(tracker.isIndoor('alice')).toBe(true)
    expect(tracker.isIndoor('bob')).toBe(true)
    expect(tracker.isIndoor('carol')).toBe(false)
    expect(tracker.indoorCount).toBe(2)
  })

  it('returns the indoor location for a citizen', () => {
    tracker.enter('alice', 'house_a_door')
    expect(tracker.getIndoorLocation('alice')).toBe('house_a_door')
    expect(tracker.getIndoorLocation('bob')).toBeNull()
  })

  it('lists all citizens inside a specific building', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.enter('bob', 'house_a_door')
    tracker.enter('carol', 'house_b_door')

    const inHouseA = tracker.getIndoorAt('house_a_door')
    expect(inHouseA).toContain('alice')
    expect(inHouseA).toContain('bob')
    expect(inHouseA).not.toContain('carol')
    expect(inHouseA).toHaveLength(2)
  })

  it('removes a citizen when they leave', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.leave('alice')
    expect(tracker.isIndoor('alice')).toBe(false)
    expect(tracker.getIndoorLocation('alice')).toBeNull()
    expect(tracker.indoorCount).toBe(0)
  })

  it('lists all indoor citizens', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.enter('bob', 'cafe_door')
    const all = tracker.getAllIndoor()
    expect(all).toHaveLength(2)
    expect(all.map((e) => e.npcId).sort()).toEqual(['alice', 'bob'])
  })

  it('clears all records', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.enter('bob', 'house_b_door')
    tracker.clear()
    expect(tracker.indoorCount).toBe(0)
    expect(tracker.isIndoor('alice')).toBe(false)
  })

  it('re-entering updates the building location', () => {
    tracker.enter('alice', 'house_a_door')
    tracker.enter('alice', 'cafe_door')
    expect(tracker.getIndoorLocation('alice')).toBe('cafe_door')
    expect(tracker.indoorCount).toBe(1)
  })
})
