import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FestivalEngine } from '../FestivalEngine'
import { MoveEngine } from '../MoveEngine'
import { NeedsEngine } from '../NeedsEngine'
import { MoodEngine } from '../MoodEngine'
import { RelationshipEngine } from '../RelationshipEngine'
import { IndoorTracker } from '../IndoorTracker'
import type { ActivityJournal } from '../../../npc/ActivityJournal'

// Mock window for setInterval
;(globalThis as any).window = {
  setInterval: vi.fn(() => 1),
  clearInterval: vi.fn(),
}

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

/**
 * Phase 7 端到端集成测试：跨子系统场景验证
 * 场景：节日释放室内居民 → 心情改善 → 搬家判定变化
 */
describe('跨子系统端到端场景', () => {
  let festival: FestivalEngine
  let move: MoveEngine
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
    festival = new FestivalEngine()
    move = new MoveEngine({ minDaysBeforeMove: 5, moodThreshold: -30, negativeRelThreshold: 2, moveChancePerCheck: 1.0 })

    move.setEngines(needs, mood, rels, indoor)
    needs.registerCitizen('alice')
    rels.registerJournal('alice', journal)
    move.recordArrival('alice', 0)
  })

  it('场景：节日释放室内居民', () => {
    // Alice 在室内
    indoor.enter('alice', 'house_a_door')
    expect(indoor.isIndoor('alice')).toBe(true)

    // FestivalEngine 需要绑定 IndoorTracker 才能在 startFestival 时自动释放
    festival.setIndoorTracker(indoor)
    festival.startFestival(null, 10)
    expect(festival.isActive()).toBe(true)

    // 节日已自动释放所有室内居民
    expect(indoor.isIndoor('alice')).toBe(false)
  })

  it('场景：节日共度提升好感度', () => {
    // Alice 和 Bob 共度节日
    rels.recordFestivalTogether('alice', 'bob', 'Bob')
    const rel = rels.getRelationship('alice', 'bob')
    expect(rel).not.toBeNull()
    expect(rel!.sentiment).toBeGreaterThan(0)
    expect(rel!.level).toBe('acquaintance')
  })

  it('场景：心情低落+负面关系 → 搬家', () => {
    // 模拟长期低落：需求耗尽
    needs.tick(50)
    // 3 个负面关系
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'bob', 'Bob')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'carol', 'Carol')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'dave', 'Dave')

    // 第 10 天检查
    const candidate = move.checkMoveOutEligibility('alice', 10)
    expect(candidate).not.toBeNull()

    // 概率判定（moveChancePerCheck=1.0）
    expect(move.shouldMoveOut(candidate!)).toBe(true)

    // 执行搬家
    indoor.enter('alice', 'house_a_door')
    const event = move.moveOut('alice', 'Alice')
    expect(event.type).toBe('moved_out')
    expect(indoor.isIndoor('alice')).toBe(false)
    expect(needs.getSnapshot('alice')).toBeNull()
  })

  it('场景：节日改善心情后搬家判定变化', () => {
    // 先让心情低落
    needs.tick(50)
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'bob', 'Bob')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'carol', 'Carol')
    for (let i = 0; i < 10; i++) rels.recordUnpleasantChat('alice', 'dave', 'Dave')

    // 确认此时可搬家
    expect(move.checkMoveOutEligibility('alice', 10)).not.toBeNull()

    // 节日改善心情：添加正面事件
    mood.applyEvent('alice', 80, 60_000)
    const moodState = mood.compute('alice', needs)
    // 心情因节日事件提升
    expect(moodState.value).toBeGreaterThan(-30) // 现在高于搬家阈值
    expect(move.checkMoveOutEligibility('alice', 10)).toBeNull()
  })

  it('场景：新居民搬入并注册', () => {
    const event = move.moveIn('eve', 'Eve', 15)
    expect(event.type).toBe('moved_in')
    expect(needs.getSnapshot('eve')).not.toBeNull()
    expect(move.getArrivalDay('eve')).toBe(15)
  })
})
