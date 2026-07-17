import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryStore } from '../MemoryStore'
import type { MemoryEventReporter } from '../MemoryStore'

describe('MemoryStore', () => {
  let store: MemoryStore
  let reportedEvents: Array<{ npcId: string; entry: any }>

  beforeEach(() => {
    reportedEvents = []
    store = new MemoryStore()
    // Mock reporter captures all events
    const reporter: MemoryEventReporter = (npcId, entry) => {
      reportedEvents.push({ npcId, entry })
    }
    store.setReporter(reporter)
  })

  it('starts empty', () => {
    expect(store.getMemory('alice')).toBeNull()
    expect(store.getCitizens()).toHaveLength(0)
  })

  it('records a dialogue', () => {
    store.recordDialogue('alice', 'Bob', '聊了天气')
    const mem = store.getMemory('alice')
    expect(mem).not.toBeNull()
    expect(mem!.dialogues).toHaveLength(1)
    expect(mem!.dialogues[0].partnerName).toBe('Bob')
    expect(mem!.dialogues[0].summary).toBe('聊了天气')
  })

  it('records an activity', () => {
    store.recordActivity('alice', 'arrived', 'cafe_door', '到达咖啡馆')
    const mem = store.getMemory('alice')
    expect(mem).not.toBeNull()
    expect(mem!.activities).toHaveLength(1)
    expect(mem!.activities[0].action).toBe('arrived')
  })

  it('limits dialogues to 10', () => {
    for (let i = 0; i < 15; i++) {
      store.recordDialogue('alice', 'Bob', `对话${i}`)
    }
    const mem = store.getMemory('alice')
    expect(mem!.dialogues).toHaveLength(10)
    expect(mem!.dialogues[0].summary).toBe('对话5') // first 5 shifted out
  })

  it('limits activities to 20', () => {
    for (let i = 0; i < 25; i++) {
      store.recordActivity('alice', 'walking', 'plaza')
    }
    const mem = store.getMemory('alice')
    expect(mem!.activities).toHaveLength(20)
  })

  it('filters dialogues by topic', () => {
    store.recordDialogue('alice', 'Bob', '聊了天气')
    store.recordDialogue('alice', 'Carol', '聊了工作')
    const filtered = store.getDialogues('alice', '天气')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].partnerName).toBe('Bob')
  })

  it('reports events via reporter', () => {
    store.recordDialogue('alice', 'Bob', '测试')
    store.recordActivity('alice', 'walking', 'plaza', '散步')
    expect(reportedEvents).toHaveLength(2)
    expect(reportedEvents[0].npcId).toBe('alice')
    expect(reportedEvents[0].entry.type).toBe('dialogue')
    expect(reportedEvents[1].entry.type).toBe('activity')
  })

  it('does not report when reporter is null', () => {
    store.setReporter(null)
    store.recordDialogue('alice', 'Bob', '测试')
    // Should not throw, just silently skip reporting
    expect(store.getMemory('alice')).not.toBeNull()
  })

  it('loads from snapshot', () => {
    store.loadFromSnapshot({
      alice: {
        dialogues: [{ partnerName: 'Bob', summary: '旧对话', timestamp: 1000 }],
        activities: [],
        updatedAt: 1000,
      },
    })
    const mem = store.getMemory('alice')
    expect(mem).not.toBeNull()
    expect(mem!.dialogues).toHaveLength(1)
    expect(mem!.dialogues[0].summary).toBe('旧对话')
  })

  it('clears a citizen memory', () => {
    store.recordDialogue('alice', 'Bob', '测试')
    store.clearCitizen('alice')
    expect(store.getMemory('alice')).toBeNull()
  })

  it('clears all memories', () => {
    store.recordDialogue('alice', 'Bob', '测试')
    store.recordDialogue('carol', 'Dave', '测试2')
    store.clear()
    expect(store.getCitizens()).toHaveLength(0)
  })
})
