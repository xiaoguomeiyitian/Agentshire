import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../llm-agent-proxy.js', () => ({
  chat: vi.fn(),
}))

vi.mock('../group-chat-history.js', () => ({
  loadSummary: vi.fn(() => null),
  saveSummary: vi.fn(),
}))

import {
  parseMentionsFromText,
  isSkipResponse,
  buildContextForCitizen,
  type GroupMessage,
  type Participant,
} from '../group-chat-context.js'

describe('parseMentionsFromText', () => {
  const participants: Participant[] = [
    { npcId: 'npc_1', name: '海棠', agentId: 'a1', specialty: '设计' },
    { npcId: 'npc_2', name: '小明', agentId: 'a2', specialty: '开发' },
    { npcId: 'npc_3', name: 'Alice', agentId: 'a3', specialty: 'PM' },
  ]

  it('returns empty array for text without mentions', () => {
    expect(parseMentionsFromText('hello world', participants)).toEqual([])
  })

  it('returns empty array for empty text', () => {
    expect(parseMentionsFromText('', participants)).toEqual([])
  })

  it('detects @所有人 mention', () => {
    expect(parseMentionsFromText('@所有人 来开会', participants)).toContain('all')
  })

  it('detects @all mention', () => {
    expect(parseMentionsFromText('@all please review', participants)).toContain('all')
  })

  it('detects @全体 mention', () => {
    expect(parseMentionsFromText('@全体 注意', participants)).toContain('all')
  })

  it('is case-insensitive for @ALL', () => {
    expect(parseMentionsFromText('@ALL check this', participants)).toContain('all')
  })

  it('detects @resident name mention', () => {
    expect(parseMentionsFromText('@海棠 你觉得呢', participants)).toContain('npc_1')
  })

  it('detects @小明 mention', () => {
    expect(parseMentionsFromText('@小明 修复bug', participants)).toContain('npc_2')
  })

  it('detects English name mention', () => {
    expect(parseMentionsFromText('@Alice please review', participants)).toContain('npc_3')
  })

  it('detects multiple mentions', () => {
    const result = parseMentionsFromText('@海棠 @小明 开会', participants)
    expect(result).toContain('npc_1')
    expect(result).toContain('npc_2')
  })

  it('detects @all plus individual mentions', () => {
    const result = parseMentionsFromText('@所有人 @海棠 开会', participants)
    expect(result).toContain('all')
    expect(result).toContain('npc_1')
  })

  it('deduplicates mentions', () => {
    const result = parseMentionsFromText('@海棠 @海棠 你好', participants)
    const npc1Count = result.filter(m => m === 'npc_1').length
    expect(npc1Count).toBe(1)
  })

  it('does not match partial name (prefix only)', () => {
    // @海棠 should not match if followed by more chars without boundary
    expect(parseMentionsFromText('@海棠花开了', participants)).not.toContain('npc_1')
  })

  it('matches name followed by punctuation', () => {
    expect(parseMentionsFromText('@海棠, 你好', participants)).toContain('npc_1')
    expect(parseMentionsFromText('@海棠。你好', participants)).toContain('npc_1')
    expect(parseMentionsFromText('@海棠! 快来', participants)).toContain('npc_1')
  })

  it('matches name at end of text', () => {
    expect(parseMentionsFromText('呼叫 @海棠', participants)).toContain('npc_1')
  })

  it('handles empty participants array', () => {
    expect(parseMentionsFromText('@someone hello', [])).toEqual([])
  })

  it('handles special regex characters in name', () => {
    const specialParticipants: Participant[] = [
      { npcId: 'npc_special', name: 'A.B+C', agentId: 'a4' },
    ]
    expect(parseMentionsFromText('@A.B+C hello', specialParticipants)).toContain('npc_special')
  })
})

describe('isSkipResponse', () => {
  it('returns true for "[skip]"', () => {
    expect(isSkipResponse('[skip]')).toBe(true)
  })

  it('returns true for "skip"', () => {
    expect(isSkipResponse('skip')).toBe(true)
  })

  it('returns true for "跳过"', () => {
    expect(isSkipResponse('跳过')).toBe(true)
  })

  it('returns true for "  [skip]  " (with whitespace)', () => {
    expect(isSkipResponse('  [skip]  ')).toBe(true)
  })

  it('returns true for "SKIP" (uppercase)', () => {
    expect(isSkipResponse('SKIP')).toBe(true)
  })

  it('returns true for "  跳过  " (with whitespace)', () => {
    expect(isSkipResponse('  跳过  ')).toBe(true)
  })

  it('returns false for normal text', () => {
    expect(isSkipResponse('我觉得这个方案不错')).toBe(false)
  })

  it('returns false for text containing skip but not equal', () => {
    expect(isSkipResponse('please skip this')).toBe(false)
    expect(isSkipResponse('[skip] please')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSkipResponse('')).toBe(false)
  })

  it('returns false for whitespace-only string', () => {
    expect(isSkipResponse('   ')).toBe(false)
  })

  it('returns false for partial match', () => {
    expect(isSkipResponse('skipme')).toBe(false)
    expect(isSkipResponse('跳过去')).toBe(false)
  })
})

describe('buildContextForCitizen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const participants: Participant[] = [
    { npcId: 'npc_1', name: '海棠', agentId: 'a1', specialty: '设计' },
    { npcId: 'npc_2', name: '小明', agentId: 'a2', specialty: '开发' },
  ]

  const makeMessage = (
    sequenceId: number,
    speakerNpcId: string,
    speakerName: string,
    text: string,
    mentions: string[] = [],
  ): GroupMessage => ({
    sequenceId,
    timestamp: sequenceId * 1000,
    speakerNpcId,
    speakerName,
    text,
    mentions,
  })

  it('returns non-empty string for simple history', () => {
    const history: GroupMessage[] = [
      makeMessage(1, 'npc_1', '海棠', '大家好'),
      makeMessage(2, 'npc_2', '小明', '你好'),
    ]
    const result = buildContextForCitizen('group_1', history, participants, 'npc_1')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('includes topic when provided', () => {
    const history: GroupMessage[] = [
      makeMessage(1, 'npc_1', '海棠', '开始讨论'),
    ]
    const result = buildContextForCitizen('group_1', history, participants, 'npc_1', '设计评审')
    expect(result).toContain('设计评审')
  })

  it('handles empty history', () => {
    const result = buildContextForCitizen('group_1', [], participants, 'npc_1')
    expect(typeof result).toBe('string')
  })

  it('handles isDirectlyMentioned flag', () => {
    const history: GroupMessage[] = [
      makeMessage(1, 'npc_2', '小明', '@海棠 你好', ['npc_1']),
      makeMessage(2, 'npc_1', '海棠', '你好小明'),
    ]
    const result = buildContextForCitizen('group_1', history, participants, 'npc_1', undefined, true)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
