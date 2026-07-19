import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveTownRuntimeState,
  loadTownRuntimeState,
  clearTownRuntimeState,
} from '../town-runtime-state'
import type { TownRuntimeState } from '../town-runtime-state'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Mock stateDir to use a temp directory
const tmpDir = path.join(__dirname, '.tmp-town-runtime-state-test')
vi.mock('../paths', () => ({
  stateDir: () => tmpDir,
}))

function makeState(overrides: Partial<TownRuntimeState> = {}): TownRuntimeState {
  return {
    sceneType: 'town',
    mayorPos: { x: 15, z: 5 },
    npcPositions: {
      user: { x: 15, z: 5 },
      steward: { x: 10, z: 10 },
      citizen_1: { x: 20, z: 15 },
    },
    topicNpcIds: [],
    indoorCitizens: [],
    savedAt: 1784177296910,
    ...overrides,
  }
}

describe('town-runtime-state (plugin-side persistence)', () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('save / load round-trip', () => {
    it('returns null when no state file exists', () => {
      expect(loadTownRuntimeState()).toBeNull()
    })

    it('saves and loads a full runtime state', () => {
      const state = makeState()
      saveTownRuntimeState(state)
      const loaded = loadTownRuntimeState()
      expect(loaded).not.toBeNull()
      expect(loaded!.sceneType).toBe('town')
      expect(loaded!.mayorPos).toEqual({ x: 15, z: 5 })
      expect(loaded!.npcPositions).toEqual(state.npcPositions)
      expect(loaded!.topicNpcIds).toEqual([])
      expect(loaded!.indoorCitizens).toEqual([])
      expect(loaded!.savedAt).toBe(1784177296910)
    })

    it('preserves topic and indoor citizens', () => {
      const state = makeState({
        topicNpcIds: ['citizen_1', 'citizen_2'],
        indoorCitizens: ['citizen_3', 'citizen_4'],
      })
      saveTownRuntimeState(state)
      const loaded = loadTownRuntimeState()
      expect(loaded!.topicNpcIds).toEqual(['citizen_1', 'citizen_2'])
      expect(loaded!.indoorCitizens).toEqual(['citizen_3', 'citizen_4'])
    })

    it('overwrites previous state on subsequent saves', () => {
      saveTownRuntimeState(makeState({ sceneType: 'office' }))
      saveTownRuntimeState(makeState({ sceneType: 'town' }))
      const loaded = loadTownRuntimeState()
      expect(loaded!.sceneType).toBe('town')
    })

    it('creates the agents directory if it does not exist', () => {
      // Remove the agents subdir to verify it gets created
      const agentsDir = path.join(tmpDir, 'agents')
      fs.rmSync(agentsDir, { recursive: true, force: true })
      expect(fs.existsSync(agentsDir)).toBe(false)
      saveTownRuntimeState(makeState())
      expect(fs.existsSync(path.join(agentsDir, 'town-runtime-state.json'))).toBe(true)
      expect(loadTownRuntimeState()).not.toBeNull()
    })
  })

  describe('load validation', () => {
    it('returns null for a corrupt JSON file', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'town-runtime-state.json'),
        '{ not valid json',
        'utf-8',
      )
      expect(loadTownRuntimeState()).toBeNull()
    })

    it('returns null when sceneType is missing', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'town-runtime-state.json'),
        JSON.stringify({ npcPositions: {} }),
        'utf-8',
      )
      expect(loadTownRuntimeState()).toBeNull()
    })

    it('returns null when npcPositions is missing or not an object', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'town-runtime-state.json'),
        JSON.stringify({ sceneType: 'town' }),
        'utf-8',
      )
      expect(loadTownRuntimeState()).toBeNull()
    })

    it('fills defaults for optional fields (mayorPos, topic, indoor, savedAt)', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'town-runtime-state.json'),
        JSON.stringify({ sceneType: 'office', npcPositions: { user: { x: 1, z: 2 } } }),
        'utf-8',
      )
      const loaded = loadTownRuntimeState()
      expect(loaded).not.toBeNull()
      expect(loaded!.mayorPos).toEqual({ x: 0, z: 0 })
      expect(loaded!.topicNpcIds).toEqual([])
      expect(loaded!.indoorCitizens).toEqual([])
      expect(loaded!.savedAt).toBe(0)
    })

    it('coerces non-array topicNpcIds to empty array', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentsDir, 'town-runtime-state.json'),
        JSON.stringify({ sceneType: 'town', npcPositions: {}, topicNpcIds: 'not-an-array' }),
        'utf-8',
      )
      const loaded = loadTownRuntimeState()
      expect(loaded!.topicNpcIds).toEqual([])
    })
  })

  describe('clear', () => {
    it('removes an existing state file', () => {
      saveTownRuntimeState(makeState())
      expect(loadTownRuntimeState()).not.toBeNull()
      clearTownRuntimeState()
      expect(loadTownRuntimeState()).toBeNull()
    })

    it('does not throw when no state file exists', () => {
      expect(() => clearTownRuntimeState()).not.toThrow()
    })
  })
})
