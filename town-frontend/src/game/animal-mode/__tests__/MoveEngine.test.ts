import { describe, it, expect, beforeEach } from 'vitest'
import { MoveEngine } from '../MoveEngine'
import { NeedsEngine } from '../NeedsEngine'
import { MoodEngine } from '../MoodEngine'
import { RelationshipEngine } from '../RelationshipEngine'
import { IndoorTracker } from '../IndoorTracker'
import type { ActivityJournal } from '../../../npc/ActivityJournal'

function makeMockJournal(): ActivityJournal {
  const relationships = new Map<string, any>()
  return {
    getRelationship: (id: string) => relationships.get(id),
    getRelationships: () => Array.from(relationships.values()),
    updateRelationship: (partner: { npcId: string; name: string }, update: any) => {
      let rel = relationships.get(partner.npcId)
      if (!rel) {
        rel = { npcId: partner.npcId, name: partner.name, label: '邻居', sentiment: 0, lastInteraction: Date.now(), interactionCount: 0, recentTopics: [] }
      }
      rel.interactionCount++
      if (update.sentimentDelta != null) rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + update.sentimentDelta))
      relationships.set(partner.npcId, rel)
    },
  } as any
}

describe('MoveEngine', () => {
  let engine: MoveEngine
  let needs: NeedsEngine
  let mood: MoodEngine
  let rels: RelationshipEngine
  let indoor: IndoorTracker
  let journal: ActivityJournal

  beforeEach(() => {
    needs = new NeedsEngine()
    mood = new MoodEngine()
    rels = new RelationshipEngine()
    indoor = new IndoorTracker()
    journal = makeMockJournal()
    engine = new MoveEngine({ minDaysBeforeMove: 5, moodThreshold: -30, negativeRelThreshold: 2, moveChancePerCheck: 1.0 })
    engine.setEngines(needs, mood, rels, indoor)
    needs.registerCitizen('alice')
    rels.registerJournal('alice', journal)
    engine.recordArrival('alice', 0)
  })

  it('returns null when citizen has not lived long enough', () => {
    const candidate = engine.checkMoveOutEligibility('alice', 3) // only 3 days
    expect(candidate).toBeNull()
  })

  it('returns null when mood is not low enough', () => {
    const candidate = engine.checkMoveOutEligibility('alice', 10)
    // Default mood is positive, so not eligible
    expect(candidate).toBeNull()
  })

  it('returns candidate when mood is low and has negative relationships', () => {
    // Drain needs to make mood bad
    needs.tick(50) // heavy decay -> all needs at 0 -> mood ~ -100
    // Add negative relationships (need sentiment < -20, i.e. < -0.2 on -1..1 scale)
    // Each recordUnpleasantChat is -3/100 = -0.03, so need ~7 to reach -0.21
    // Need > negativeRelThreshold (strictly greater), so 3 negative relationships
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'bob', 'Bob')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'carol', 'Carol')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'dave', 'Dave')

    const candidate = engine.checkMoveOutEligibility('alice', 10)
    expect(candidate).not.toBeNull()
    expect(candidate!.npcId).toBe('alice')
    expect(candidate!.negativeRelationships).toBeGreaterThanOrEqual(2)
  })

  it('returns null when not enough negative relationships', () => {
    needs.tick(30)
    // Only one negative relationship
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'bob', 'Bob')

    const candidate = engine.checkMoveOutEligibility('alice', 10)
    expect(candidate).toBeNull()
  })

  it('shouldMoveOut respects probability', () => {
    const candidate: any = { npcId: 'alice', reason: 'test', avgMood: -50, negativeRelationships: 3, positiveRelationships: 0 }
    // With moveChancePerCheck = 1.0, always true
    expect(engine.shouldMoveOut(candidate)).toBe(true)
  })

  it('moveOut removes citizen from all systems', () => {
    indoor.enter('alice', 'house_a_door')
    const event = engine.moveOut('alice', 'Alice')
    expect(event.type).toBe('moved_out')
    expect(event.name).toBe('Alice')
    expect(indoor.isIndoor('alice')).toBe(false)
    expect(needs.getSnapshot('alice')).toBeNull()
    expect(engine.getArrivalDay('alice')).toBeNull()
  })

  it('moveIn registers a new citizen', () => {
    const event = engine.moveIn('dave', 'Dave', 10)
    expect(event.type).toBe('moved_in')
    expect(event.name).toBe('Dave')
    expect(needs.getSnapshot('dave')).not.toBeNull()
    expect(engine.getArrivalDay('dave')).toBe(10)
  })

  it('records move history', () => {
    engine.moveOut('alice', 'Alice')
    engine.moveIn('dave', 'Dave', 10)
    const history = engine.getMoveHistory()
    expect(history).toHaveLength(2)
    expect(history[0].type).toBe('moved_out')
    expect(history[1].type).toBe('moved_in')
  })

  it('clears all state', () => {
    engine.moveOut('alice', 'Alice')
    engine.clear()
    expect(engine.getMoveHistory()).toHaveLength(0)
    expect(engine.getArrivalDay('alice')).toBeNull()
  })

  it('returns null when engines not set', () => {
    const engineNoDeps = new MoveEngine()
    expect(engineNoDeps.checkMoveOutEligibility('alice', 100)).toBeNull()
  })
})
