import { describe, it, expect, beforeEach } from 'vitest'
import { NeedActionMapper } from '../NeedActionMapper'
import type { NeedKey } from '../NeedsEngine'

describe('NeedActionMapper', () => {
  let mapper: NeedActionMapper

  beforeEach(() => {
    mapper = new NeedActionMapper()
  })

  it('maps fatigue to home (goIndoor=true)', () => {
    const action = mapper.resolveAction('fatigue', 'house_a_door')
    expect(action).not.toBeNull()
    expect(action!.need).toBe('fatigue')
    expect(action!.targetPlace).toBe('house_a_door')
    expect(action!.goIndoor).toBe(true)
    expect(action!.satisfyAmount).toBe(90)
  })

  it('maps hunger to cafe (goIndoor=false)', () => {
    const action = mapper.resolveAction('hunger', 'house_a_door')
    expect(action).not.toBeNull()
    expect(action!.targetPlace).toBe('cafe_door')
    expect(action!.goIndoor).toBe(false)
    expect(action!.anim).toBe('sitting')
  })

  it('maps fun to museum (goIndoor=false)', () => {
    const action = mapper.resolveAction('fun', 'house_a_door')
    expect(action).not.toBeNull()
    expect(action!.targetPlace).toBe('museum_door')
    expect(action!.goIndoor).toBe(false)
    expect(action!.anim).toBe('thinking')
  })

  it('maps social to plaza (outdoor)', () => {
    const action = mapper.resolveAction('social', 'house_a_door')
    expect(action).not.toBeNull()
    expect(action!.targetPlace).toBe('plaza_center')
    expect(action!.goIndoor).toBe(false)
  })

  it('maps esteem to office', () => {
    const action = mapper.resolveAction('esteem', 'house_a_door')
    expect(action).not.toBeNull()
    expect(action!.targetPlace).toBe('office_door')
    expect(action!.anim).toBe('typing')
  })

  it('returns null for home-based need when no home building', () => {
    const action = mapper.resolveAction('fatigue', null)
    expect(action).toBeNull()
  })

  it('returns null for home-based need with invalid home key', () => {
    const action = mapper.resolveAction('fatigue', 'nonexistent_door')
    expect(action).toBeNull()
  })

  it('identifies residential buildings', () => {
    expect(mapper.isResidential('house_a_door')).toBe(true)
    expect(mapper.isResidential('house_b_door')).toBe(true)
    expect(mapper.isResidential('user_home_door')).toBe(true)
    expect(mapper.isResidential('cafe_door')).toBe(false)
    expect(mapper.isResidential('museum_door')).toBe(false)
    expect(mapper.isResidential('office_door')).toBe(false)
  })

  it('all needs have valid mappings', () => {
    const allNeeds: NeedKey[] = [
      'hunger', 'fatigue', 'social', 'fun',
      'hygiene', 'safety', 'esteem', 'belonging',
    ]
    for (const need of allNeeds) {
      const action = mapper.resolveAction(need, 'house_a_door')
      expect(action, `need ${need} should resolve`).not.toBeNull()
      expect(action!.satisfyAmount).toBeGreaterThan(0)
      expect(action!.satisfyDurationMs).toBeGreaterThan(0)
    }
  })
})
