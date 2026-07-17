import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  appendDialogue,
  appendActivity,
  loadRecentMemories,
  loadAllEntries,
  clearCitizenMemory,
  clearAllMemories,
  listCitizensWithMemories,
  saveActivityJournalSnapshot,
  loadActivityJournalSnapshot,
  loadAllActivityJournalSnapshots,
  saveClockState,
  loadClockState,
} from '../animal-memory'
import type { ActivityJournalSnapshot, Relationship } from '../animal-snapshot-types'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Mock stateDir to use a temp directory
const tmpDir = path.join(__dirname, '.tmp-animal-memory-test')
vi.mock('../paths', () => ({
  stateDir: () => tmpDir,
}))

describe('animal-memory (plugin-side persistence)', () => {
  beforeEach(() => {
    // Clean temp dir before each test
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('dialogue & activity entries', () => {
    it('appends and loads dialogue entries', () => {
      appendDialogue('alice', 'Bob', '聊了天气')
      appendDialogue('alice', 'Carol', '聊了工作')
      const entries = loadAllEntries('alice')
      expect(entries).toHaveLength(2)
      expect(entries[0].type).toBe('dialogue')
      expect((entries[0] as any).partnerName).toBe('Bob')
    })

    it('appends and loads activity entries', () => {
      appendActivity('alice', 'walking', 'plaza', '散步')
      const entries = loadAllEntries('alice')
      expect(entries).toHaveLength(1)
      expect(entries[0].type).toBe('activity')
      expect((entries[0] as any).action).toBe('walking')
    })

    it('returns empty for unknown citizen', () => {
      expect(loadAllEntries('unknown')).toHaveLength(0)
    })

    it('loads recent memories with topic filter', () => {
      appendDialogue('alice', 'Bob', '聊了天气')
      appendDialogue('alice', 'Carol', '聊了工作')
      appendActivity('alice', 'walking', 'plaza')
      const mem = loadRecentMemories('alice', { topic: '天气' })
      expect(mem.dialogues).toHaveLength(1)
      expect(mem.dialogues[0].partnerName).toBe('Bob')
      expect(mem.activities).toHaveLength(1)
    })

    it('limits returned entries', () => {
      for (let i = 0; i < 15; i++) appendDialogue('alice', 'Bob', `对话${i}`)
      for (let i = 0; i < 25; i++) appendActivity('alice', 'walking', 'plaza')
      const mem = loadRecentMemories('alice', { dialogueCount: 5, activityCount: 10 })
      expect(mem.dialogues).toHaveLength(5)
      expect(mem.activities).toHaveLength(10)
    })
  })

  describe('clear operations', () => {
    it('clears a single citizen memory', () => {
      appendDialogue('alice', 'Bob', '测试')
      appendDialogue('bob', 'Alice', '测试2')
      clearCitizenMemory('alice')
      expect(loadAllEntries('alice')).toHaveLength(0)
      expect(loadAllEntries('bob')).toHaveLength(1)
    })

    it('clears all memories', () => {
      appendDialogue('alice', 'Bob', '测试')
      appendDialogue('bob', 'Alice', '测试2')
      clearAllMemories()
      expect(listCitizensWithMemories()).toHaveLength(0)
    })
  })

  describe('list citizens', () => {
    it('lists citizens with memories', () => {
      appendDialogue('alice', 'Bob', '测试')
      appendDialogue('bob', 'Alice', '测试2')
      const citizens = listCitizensWithMemories()
      expect(citizens).toContain('alice')
      expect(citizens).toContain('bob')
    })
  })

  describe('ActivityJournal snapshots', () => {
    it('saves and loads a snapshot', () => {
      const rel: Relationship = { npcId: 'bob', name: 'Bob', label: '邻居', sentiment: 0.5, lastInteraction: Date.now(), interactionCount: 3, recentTopics: [] }
      const snapshot: ActivityJournalSnapshot = {
        npcId: 'alice',
        npcName: 'Alice',
        entries: [],
        dialogues: [],
        relationships: [['bob', rel]],
        reflections: [],
        currentPlan: null,
      }
      saveActivityJournalSnapshot('alice', snapshot)
      const loaded = loadActivityJournalSnapshot('alice')
      expect(loaded).not.toBeNull()
      expect(loaded!.npcId).toBe('alice')
      expect(loaded!.relationships).toHaveLength(1)
      expect(loaded!.relationships[0][1].sentiment).toBe(0.5)
    })

    it('returns null for unknown citizen', () => {
      expect(loadActivityJournalSnapshot('unknown')).toBeNull()
    })

    it('loads all snapshots', () => {
      const snap1: ActivityJournalSnapshot = { npcId: 'alice', npcName: 'Alice', entries: [], dialogues: [], relationships: [], reflections: [], currentPlan: null }
      const snap2: ActivityJournalSnapshot = { npcId: 'bob', npcName: 'Bob', entries: [], dialogues: [], relationships: [], reflections: [], currentPlan: null }
      saveActivityJournalSnapshot('alice', snap1)
      saveActivityJournalSnapshot('bob', snap2)
      const all = loadAllActivityJournalSnapshots()
      expect(all).toHaveLength(2)
      expect(all.map(s => s.npcId).sort()).toEqual(['alice', 'bob'])
    })
  })

  describe('GameClock state', () => {
    it('saves and loads clock state', () => {
      saveClockState({ dayCount: 5, gameSeconds: 43200, savedAt: Date.now() })
      const loaded = loadClockState()
      expect(loaded).not.toBeNull()
      expect(loaded!.dayCount).toBe(5)
      expect(loaded!.gameSeconds).toBe(43200)
    })

    it('returns null when no clock state', () => {
      expect(loadClockState()).toBeNull()
    })
  })
})
