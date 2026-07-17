import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MoodEngine, type MoodLevel } from '../MoodEngine'
import { NeedsEngine } from '../NeedsEngine'

describe('MoodEngine', () => {
  let mood: MoodEngine
  let needs: NeedsEngine

  beforeEach(() => {
    vi.useFakeTimers()
    mood = new MoodEngine()
    needs = new NeedsEngine()
    needs.registerCitizen('alice')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes neutral mood when needs are balanced', () => {
    const state = mood.compute('alice', needs)
    // Default needs average ~80 -> mood ~60 -> 'great' or 'good'
    expect(state.value).toBeGreaterThan(0)
    expect(['great', 'good', 'neutral']).toContain(state.level)
  })

  it('computes bad mood when needs are low', () => {
    needs.tick(20) // drain all needs heavily
    const state = mood.compute('alice', needs)
    expect(state.value).toBeLessThan(0)
    expect(['bad', 'terrible']).toContain(state.level)
  })

  it('applies transient event modifiers', () => {
    const baseState = mood.compute('alice', needs)
    mood.applyEvent('alice', 30, 60_000) // +30 festival
    const state = mood.compute('alice', needs)
    // With modifier, mood should be higher than base
    expect(state.value).toBeGreaterThan(baseState.value)
  })

  it('prunes expired event modifiers', () => {
    mood.applyEvent('alice', 30, 60_000)
    vi.advanceTimersByTime(70_000) // past expiry
    mood.pruneExpired()
    const state = mood.compute('alice', needs)
    // Modifier should be gone; base mood ~60, so without modifier it should be ~60
    expect(state.value).toBeLessThan(65) // not the +30 boosted value
  })

  it('identifies dominant urgent need', () => {
    needs.tick(10) // make needs urgent
    const state = mood.compute('alice', needs)
    expect(state.dominantNeed).not.toBeNull()
  })

  it('returns neutral for unknown citizen', () => {
    const state = mood.compute('unknown', needs)
    expect(state.value).toBe(0)
    expect(state.level).toBe('neutral')
  })

  it('clears citizen state', () => {
    mood.applyEvent('alice', 30, 60_000)
    mood.clearCitizen('alice')
    const state = mood.compute('alice', needs)
    expect(state.value).toBeLessThan(65) // modifier cleared
  })
})
