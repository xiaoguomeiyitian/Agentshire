import { describe, it, expect, beforeEach } from 'vitest'
import { NeedsEngine, type NeedKey } from '../NeedsEngine'

describe('NeedsEngine', () => {
  let engine: NeedsEngine

  beforeEach(() => {
    engine = new NeedsEngine()
    engine.registerCitizen('alice')
  })

  it('initializes needs with default values', () => {
    const snap = engine.getSnapshot('alice')
    expect(snap).not.toBeNull()
    expect(snap!.needs.hunger).toBe(80)
    expect(snap!.needs.fatigue).toBe(90)
    expect(snap!.average).toBeGreaterThan(0)
  })

  it('decays needs over game-hours', () => {
    engine.tick(1) // 1 game-hour
    const snap = engine.getSnapshot('alice')
    // hunger decays at 8/hour, so should be 72
    expect(snap!.needs.hunger).toBe(72)
    expect(snap!.needs.fatigue).toBe(84)
  })

  it('does not decay below 0', () => {
    engine.tick(100) // huge decay
    const snap = engine.getSnapshot('alice')
    expect(snap!.needs.hunger).toBe(0)
    expect(snap!.needs.fatigue).toBe(0)
  })

  it('restores a need via satisfy()', () => {
    engine.tick(5) // hunger -> 40
    engine.satisfy('alice', 'hunger', 50)
    const snap = engine.getSnapshot('alice')
    expect(snap!.needs.hunger).toBe(90) // 40 + 50
  })

  it('does not exceed 100 when satisfying', () => {
    engine.satisfy('alice', 'hunger', 50)
    const snap = engine.getSnapshot('alice')
    expect(snap!.needs.hunger).toBe(100)
  })

  it('identifies urgent needs', () => {
    // Drain hunger to urgent level
    engine.tick(7) // hunger 80 - 56 = 24 (< 30 threshold)
    const snap = engine.getSnapshot('alice')
    expect(snap!.urgent).toContain('hunger')
  })

  it('returns the most urgent need', () => {
    engine.tick(7) // hunger becomes lowest
    const urgent = engine.getMostUrgent('alice')
    expect(urgent).toBe('hunger')
  })

  it('returns null when no needs are urgent', () => {
    const urgent = engine.getMostUrgent('alice')
    expect(urgent).toBeNull()
  })

  it('unregisters a citizen', () => {
    engine.unregisterCitizen('alice')
    expect(engine.getSnapshot('alice')).toBeNull()
    expect(engine.getCitizens()).not.toContain('alice')
  })

  it('handles multiple citizens independently', () => {
    engine.registerCitizen('bob')
    engine.tick(2)
    const aliceSnap = engine.getSnapshot('alice')
    const bobSnap = engine.getSnapshot('bob')
    expect(aliceSnap!.needs.hunger).toBe(bobSnap!.needs.hunger)
  })
})
