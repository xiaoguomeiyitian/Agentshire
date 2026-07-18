import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FestivalEngine } from '../FestivalEngine'
import { IndoorTracker } from '../IndoorTracker'

describe('FestivalEngine', () => {
  let engine: FestivalEngine
  let indoor: IndoorTracker

  beforeEach(() => {
    vi.useFakeTimers()
    indoor = new IndoorTracker()
    engine = new FestivalEngine({ intervalDays: 7, durationMs: 120_000 })
    engine.setIndoorTracker(indoor)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts inactive', () => {
    expect(engine.isActive()).toBe(false)
    expect(engine.getCurrentType()).toBeNull()
  })

  it('triggers festival when interval days passed', () => {
    expect(engine.shouldTriggerFestival(7)).toBe(true)
    expect(engine.shouldTriggerFestival(6)).toBe(false)
  })

  it('does not trigger when already active', () => {
    engine.startFestival('cherryBlossom', 7)
    expect(engine.shouldTriggerFestival(14)).toBe(false)
  })

  it('starts a festival and releases indoor citizens', () => {
    indoor.enter('alice', 'house_a_door')
    indoor.enter('bob', 'house_b_door')
    expect(indoor.indoorCount).toBe(2)

    engine.startFestival('cherryBlossom', 7)
    expect(engine.isActive()).toBe(true)
    expect(engine.getCurrentType()).toBe('cherryBlossom')
    expect(indoor.indoorCount).toBe(0) // all released
  })

  it('auto-rotates festival type when not specified', () => {
    engine.startFestival(null, 7)
    expect(engine.getCurrentType()).toBe('cherryBlossom')

    engine.endFestival()
    engine.startFestival(null, 14)
    expect(engine.getCurrentType()).toBe('harvest')
  })

  it('calls onFestivalStart callback', () => {
    const onStart = vi.fn()
    engine.setCallbacks(onStart, () => {})
    engine.startFestival('starNight', 7)
    expect(onStart).toHaveBeenCalledWith('starNight')
  })

  it('calls onFestivalEnd callback', () => {
    const onEnd = vi.fn()
    engine.setCallbacks(() => {}, onEnd)
    engine.startFestival('harvest', 7)
    engine.endFestival()
    expect(onEnd).toHaveBeenCalled()
  })

  it('auto-ends after duration', () => {
    engine.startFestival('flower', 7)
    expect(engine.isActive()).toBe(true)
    vi.advanceTimersByTime(130_000) // past 120s duration
    engine.update(1000)
    expect(engine.isActive()).toBe(false)
  })

  it('does not auto-end before duration', () => {
    engine.startFestival('flower', 7)
    vi.advanceTimersByTime(60_000) // only 60s
    engine.update(1000)
    expect(engine.isActive()).toBe(true)
  })

  it('builds prompt fragment when active', () => {
    engine.startFestival('cherryBlossom', 7)
    const fragment = engine.buildPromptFragment()
    expect(fragment).toContain('樱花节')
    expect(fragment).toContain('广场')
  })

  it('returns empty fragment when inactive', () => {
    expect(engine.buildPromptFragment()).toBe('')
  })

  it('supports English labels', () => {
    engine.startFestival('starNight', 7)
    const fragment = engine.buildPromptFragment('en')
    expect(fragment).toContain('Starry Night')
  })

  it('returns all festival types', () => {
    const types = engine.getAllTypes()
    expect(types).toHaveLength(5)
    expect(types).toContain('cherryBlossom')
    expect(types).toContain('starNight')
  })

  it('does not start when already active', () => {
    engine.startFestival('cherryBlossom', 7)
    const state1 = engine.getState()
    engine.startFestival('harvest', 8) // should be ignored
    const state2 = engine.getState()
    expect(state2.type).toBe(state1.type)
  })
})
