import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RelationshipEngine } from '../RelationshipEngine'
import type { ActivityJournal } from '../../../npc/ActivityJournal'

function makeMockJournal(): ActivityJournal {
  const relationships = new Map<string, any>()
  return {
    getRelationship: (npcId: string) => relationships.get(npcId),
    getRelationships: () => Array.from(relationships.values()),
    updateRelationship: (partner: { npcId: string; name: string }, update: any) => {
      let rel = relationships.get(partner.npcId)
      if (!rel) {
        rel = {
          npcId: partner.npcId,
          name: partner.name,
          label: '邻居',
          sentiment: 0,
          lastInteraction: Date.now(),
          interactionCount: 0,
          recentTopics: [],
        }
      }
      rel.lastInteraction = Date.now()
      rel.interactionCount++
      if (update.label) rel.label = update.label
      if (update.sentimentDelta != null) {
        rel.sentiment = Math.max(-1, Math.min(1, rel.sentiment + update.sentimentDelta))
      }
      if (update.topic) {
        rel.recentTopics.push(update.topic)
        if (rel.recentTopics.length > 3) rel.recentTopics.shift()
      }
      relationships.set(partner.npcId, rel)
    },
  } as any
}

describe('RelationshipEngine', () => {
  let engine: RelationshipEngine
  let journal: ActivityJournal

  beforeEach(() => {
    engine = new RelationshipEngine()
    journal = makeMockJournal()
    engine.registerJournal('alice', journal)
  })

  it('returns 0 sentiment for unknown relationship', () => {
    expect(engine.getSentiment('alice', 'bob')).toBe(0)
  })

  it('records a successful visit (+3)', () => {
    engine.recordVisitAccepted('alice', 'bob', 'Bob')
    expect(engine.getSentiment('alice', 'bob')).toBe(3)
  })

  it('records a rejected visit (-2)', () => {
    engine.recordVisitRejected('alice', 'bob', 'Bob')
    expect(engine.getSentiment('alice', 'bob')).toBe(-2)
  })

  it('records a gift (+5 to +15 based on value)', () => {
    engine.recordGift('alice', 'bob', 'Bob', 1)
    expect(engine.getSentiment('alice', 'bob')).toBe(6) // 5 + 1

    engine.recordGift('alice', 'bob', 'Bob', 10)
    // Previous 6 + (5 + 10) = 21, but sentiment clamps at 100
    expect(engine.getSentiment('alice', 'bob')).toBe(21)
  })

  it('records a pleasant chat (+2)', () => {
    engine.recordPleasantChat('alice', 'bob', 'Bob')
    expect(engine.getSentiment('alice', 'bob')).toBe(2)
  })

  it('records an unpleasant chat (-3)', () => {
    engine.recordUnpleasantChat('alice', 'bob', 'Bob')
    expect(engine.getSentiment('alice', 'bob')).toBe(-3)
  })

  it('records a festival together (+4)', () => {
    engine.recordFestivalTogether('alice', 'bob', 'Bob')
    expect(engine.getSentiment('alice', 'bob')).toBe(4)
  })

  it('classifies sentiment into levels', () => {
    // Build up sentiment to close friend
    for (let i = 0; i < 20; i++) {
      engine.recordVisitAccepted('alice', 'bob', 'Bob')
    }
    const rel = engine.getRelationship('alice', 'bob')
    expect(rel).not.toBeNull()
    expect(rel!.sentiment).toBeGreaterThanOrEqual(60)
    expect(rel!.level).toBe('close')
  })

  it('classifies negative sentiment as dislike/enemy', () => {
    for (let i = 0; i < 10; i++) {
      engine.recordUnpleasantChat('alice', 'bob', 'Bob')
    }
    const rel = engine.getRelationship('alice', 'bob')
    expect(rel!.sentiment).toBeLessThanOrEqual(-30)
    expect(['dislike', 'enemy']).toContain(rel!.level)
  })

  it('builds prompt fragment with relationships', () => {
    engine.recordVisitAccepted('alice', 'bob', 'Bob')
    const fragment = engine.buildPromptFragment('alice')
    expect(fragment).toContain('Bob')
    expect(fragment).toContain('好感度')
  })

  it('returns empty fragment for citizen with no relationships', () => {
    const fragment = engine.buildPromptFragment('unknown')
    expect(fragment).toBe('')
  })

  it('returns null for unregistered citizen', () => {
    expect(engine.getRelationship('unknown', 'bob')).toBeNull()
  })
})
