/**
 * RelationshipEngine — manages sentiment between citizens.
 *
 * Wraps the existing ActivityJournal.updateRelationship() but uses a
 * -100..+100 scale (more intuitive for game design) and provides
 * higher-level operations: gift, visit, reject, etc.
 *
 * Sentiment levels:
 *   >= 60   : close friend (亲密)
 *   20..59  : friend (朋友)
 *   -19..19 : acquaintance (熟人)
 *   -59..-20: dislike (不喜)
 *   <= -60  : enemy (敌对)
 *
 * Events that affect sentiment:
 *   successful visit (knock accepted) : +3
 *   rejected visit                    : -2
 *   uninvited visit                   : -1
 *   gift given                        : +5 to +15 (based on gift value)
 *   pleasant conversation             : +2
 *   unpleasant conversation           : -3
 *   festival together                 : +4
 */

import type { ActivityJournal } from '../../npc/ActivityJournal'

export type RelationshipLevel = 'close' | 'friend' | 'acquaintance' | 'dislike' | 'enemy'

export interface RelationshipSummary {
  npcId: string
  name: string
  sentiment: number       // -100..+100
  level: RelationshipLevel
  label: string
  interactionCount: number
  lastInteraction: number
  recentTopics: string[]
}

// Convert ActivityJournal's -1..1 sentiment to -100..100
const SCALE = 100

export class RelationshipEngine {
  private journals: Map<string, ActivityJournal> = new Map()

  /** Register a citizen's journal for relationship tracking. */
  registerJournal(npcId: string, journal: ActivityJournal): void {
    this.journals.set(npcId, journal)
  }

  /** Get the sentiment from npcA's perspective toward npcB (-100..100). */
  getSentiment(npcA: string, npcB: string): number {
    const journal = this.journals.get(npcA)
    if (!journal) return 0
    const rel = journal.getRelationship(npcB)
    return rel ? Math.round(rel.sentiment * SCALE) : 0
  }

  /** Get a relationship summary from npcA's perspective toward npcB. */
  getRelationship(npcA: string, npcB: string): RelationshipSummary | null {
    const journal = this.journals.get(npcA)
    if (!journal) return null
    const rel = journal.getRelationship(npcB)
    if (!rel) return null
    const sentiment = Math.round(rel.sentiment * SCALE)
    return {
      npcId: rel.npcId,
      name: rel.name,
      sentiment,
      level: this.sentimentToLevel(sentiment),
      label: rel.label,
      interactionCount: rel.interactionCount,
      lastInteraction: rel.lastInteraction,
      recentTopics: rel.recentTopics,
    }
  }

  /** Adjust sentiment from npcA toward npcB by delta (-100..100 scale). */
  adjustSentiment(npcA: string, npcB: string, nameB: string, delta: number, topic?: string): void {
    const journal = this.journals.get(npcA)
    if (!journal) return
    // Convert -100..100 delta to -1..1
    journal.updateRelationship({ npcId: npcB, name: nameB }, {
      sentimentDelta: delta / SCALE,
      topic,
    })
  }

  /** Record a successful visit (knock accepted). */
  recordVisitAccepted(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, 3, '串门')
  }

  /** Record a rejected visit. */
  recordVisitRejected(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, -2, '被拒')
  }

  /** Record an uninvited visit. */
  recordVisitUninvited(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, -1, '不请自来')
  }

  /** Record a gift given (value 1-10, maps to +5..+15). */
  recordGift(npcA: string, npcB: string, nameB: string, giftValue: number): void {
    const delta = 5 + Math.min(10, Math.max(0, giftValue))
    this.adjustSentiment(npcA, npcB, nameB, delta, '送礼')
  }

  /** Record a pleasant conversation. */
  recordPleasantChat(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, 2, '愉快交谈')
  }

  /** Record an unpleasant conversation. */
  recordUnpleasantChat(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, -3, '不快')
  }

  /** Record a festival shared together. */
  recordFestivalTogether(npcA: string, npcB: string, nameB: string): void {
    this.adjustSentiment(npcA, npcB, nameB, 4, '共度节日')
  }

  /** Get all relationships from a citizen's perspective. */
  getAllRelationships(npcA: string): RelationshipSummary[] {
    const journal = this.journals.get(npcA)
    if (!journal) return []
    return journal.getRelationships().map((rel) => {
      const sentiment = Math.round(rel.sentiment * SCALE)
      return {
        npcId: rel.npcId,
        name: rel.name,
        sentiment,
        level: this.sentimentToLevel(sentiment),
        label: rel.label,
        interactionCount: rel.interactionCount,
        lastInteraction: rel.lastInteraction,
        recentTopics: rel.recentTopics,
      }
    })
  }

  /** Build a relationship description fragment for LLM prompts. */
  buildPromptFragment(npcA: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
    const rels = this.getAllRelationships(npcA)
    if (rels.length === 0) return ''
    const lines = rels.map((r) => {
      if (locale === 'en') {
        return `${r.name}: ${r.level} (${r.sentiment})`
      }
      return `${r.name}：${this.levelLabel(r.level)}（好感度 ${r.sentiment}）`
    })
    return locale === 'en'
      ? `Your relationships:\n${lines.join('\n')}`
      : `你的人际关系：\n${lines.join('\n')}`
  }

  private sentimentToLevel(s: number): RelationshipLevel {
    if (s >= 60) return 'close'
    if (s >= 20) return 'friend'
    if (s >= -19) return 'acquaintance'
    if (s >= -59) return 'dislike'
    return 'enemy'
  }

  private levelLabel(level: RelationshipLevel): string {
    const labels: Record<RelationshipLevel, string> = {
      close: '亲密',
      friend: '朋友',
      acquaintance: '熟人',
      dislike: '不喜',
      enemy: '敌对',
    }
    return labels[level]
  }
}

export const RELATIONSHIP_LABELS_ZH: Record<RelationshipLevel, string> = {
  close: '亲密', friend: '朋友', acquaintance: '熟人', dislike: '不喜', enemy: '敌对',
}
