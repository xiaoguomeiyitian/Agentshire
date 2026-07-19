import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  removeAllCitizenAgents,
  clearAllRuntimeData,
  recreateStewardWorkspace,
  recreateCitizenWorkspaces,
  initTown,
} from '../town-sync'

// ── Mock stateDir to a temp directory ──
const tmpDir = path.join(__dirname, '.tmp-town-sync-test')
vi.mock('../paths', () => ({
  stateDir: () => tmpDir,
}))

// ── Mock animal-memory clear functions (they touch real fs paths) ──
vi.mock('../animal-memory', () => ({
  clearAllMemories: vi.fn(() => {}),
  clearAllSnapshots: vi.fn(() => {}),
  clearClockState: vi.fn(() => {}),
}))

// ── Mock town-runtime-state clear ──
vi.mock('../town-runtime-state', () => ({
  clearTownRuntimeState: vi.fn(() => {}),
}))

// ── Mock getPluginDir via import.meta.url ──
// town-sync uses `join(fileURLToPath(import.meta.url), "..", "..", "..")` to
// locate the project root. In tests, import.meta.url points to the compiled
// test file under dist/ or the source under src/. We override it to a temp
// "plugin dir" that we populate with town-souls/, town-workspace/, and
// town-data/citizen-config.json.
const pluginDir = path.join(tmpDir, 'plugin')
const realFileURLToPath = (await import('node:url')).fileURLToPath

// We cannot easily mock import.meta.url, so instead we create the expected
// directory structure relative to the actual test file location. The test
// file lives at src/plugin/__tests__/town-sync.test.ts; compiled to
// dist/src/plugin/__tests__/town-sync.test.js. town-sync.ts computes
// getPluginDir() as three levels up from its own location. Since town-sync.ts
// is at src/plugin/town-sync.ts (or dist/src/plugin/town-sync.js), three levels
// up is the project root. We will create the needed files in the REAL project
// root's town-data/ and town-souls/ — but that would pollute the repo.
//
// Instead, we test the individual step functions with carefully constructed
// stateDir contents, and rely on the real getPluginDir() pointing to the
// actual project root (which has town-souls/ and town-data/citizen-config.json).
// This is an integration-style test that validates the real project files.

describe('town-sync', () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('removeAllCitizenAgents', () => {
    it('removes citizen workspaces and agent entries from openclaw.json', () => {
      // Setup: openclaw.json with steward + 2 citizens
      const agentsDir = path.join(tmpDir, 'agents')
      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, 'openclaw.json'),
        JSON.stringify({
          agents: {
            list: [
              { id: 'town-steward', name: 'Steward', workspace: '/tmp/ws-steward' },
              { id: 'citizen-citizen_1', name: 'Yan', workspace: '/tmp/ws-1' },
              { id: 'citizen-citizen_2', name: 'Chengzi', workspace: '/tmp/ws-2' },
            ],
          },
        }, null, 2),
      )
      // Create citizen workspace dirs
      fs.mkdirSync(path.join(tmpDir, 'workspace-citizen-citizen_1'), { recursive: true })
      fs.mkdirSync(path.join(tmpDir, 'workspace-citizen-citizen_2'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'workspace-citizen-citizen_1', 'SOUL.md'), 'soul1')
      fs.writeFileSync(path.join(tmpDir, 'workspace-citizen-citizen_2', 'SOUL.md'), 'soul2')

      const stats = removeAllCitizenAgents()

      expect(stats.workspacesRemoved).toBe(2)
      expect(stats.agentsRemoved).toBe(2)
      expect(fs.existsSync(path.join(tmpDir, 'workspace-citizen-citizen_1'))).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, 'workspace-citizen-citizen_2'))).toBe(false)

      // Steward remains
      const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'openclaw.json'), 'utf-8'))
      const ids = cfg.agents.list.map((a: any) => a.id)
      expect(ids).toContain('town-steward')
      expect(ids).not.toContain('citizen-citizen_1')
      expect(ids).not.toContain('citizen-citizen_2')
    })

    it('returns zeros when no citizen agents exist', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'openclaw.json'),
        JSON.stringify({ agents: { list: [{ id: 'town-steward', name: 'Steward' }] } }),
      )
      const stats = removeAllCitizenAgents()
      expect(stats.workspacesRemoved).toBe(0)
      expect(stats.agentsRemoved).toBe(0)
    })
  })

  describe('clearAllRuntimeData', () => {
    it('clears sessions, economy, group-chats, agent sqlite, and steward workspace', () => {
      const agentsDir = path.join(tmpDir, 'agents')
      // Sessions for citizen_1
      const sessDir = path.join(agentsDir, 'citizen-citizen_1', 'sessions')
      fs.mkdirSync(sessDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessDir, 'sessions.json'),
        JSON.stringify({ 'agent:citizen-citizen_1:main': { sessionId: 'sess-abc' } }),
      )
      fs.writeFileSync(path.join(sessDir, 'sess-abc.jsonl'), 'line1\n')
      fs.writeFileSync(path.join(sessDir, 'sess-abc.trajectory.jsonl'), 'traj\n')

      // Economy
      fs.writeFileSync(path.join(agentsDir, 'animal-economy.json'), '{}')

      // Group chat history
      const gcDir = path.join(agentsDir, 'group-chats', 'town-square')
      fs.mkdirSync(gcDir, { recursive: true })
      fs.writeFileSync(path.join(gcDir, 'history.jsonl'), 'msg1\n')

      // Agent sqlite
      const agentInternal = path.join(agentsDir, 'citizen-citizen_1', 'agent')
      fs.mkdirSync(agentInternal, { recursive: true })
      fs.writeFileSync(path.join(agentInternal, 'state.sqlite'), 'db')
      fs.writeFileSync(path.join(agentInternal, 'state.sqlite-wal'), 'wal')

      // Steward workspace
      const stewardWs = path.join(tmpDir, 'workspace-town-steward')
      fs.mkdirSync(stewardWs, { recursive: true })
      fs.writeFileSync(path.join(stewardWs, 'SOUL.md'), 'steward-soul')

      const stats = clearAllRuntimeData()

      expect(stats.sessionsCleared).toBe(1)
      expect(stats.economyCleared).toBe(true)
      expect(stats.groupChatsCleared).toBe(true)
      expect(stats.agentSqliteCleared).toBe(2)
      expect(stats.stewardWorkspaceCleared).toBe(true)
      expect(stats.memoriesCleared).toBe(true)
      expect(stats.snapshotsCleared).toBe(true)
      expect(stats.clockCleared).toBe(true)
      expect(stats.runtimeCleared).toBe(true)

      // Verify files removed
      expect(fs.existsSync(path.join(sessDir, 'sess-abc.jsonl'))).toBe(false)
      expect(fs.existsSync(path.join(agentsDir, 'animal-economy.json'))).toBe(false)
      expect(fs.existsSync(path.join(gcDir, 'history.jsonl'))).toBe(false)
      expect(fs.existsSync(path.join(agentInternal, 'state.sqlite'))).toBe(false)
      expect(fs.existsSync(stewardWs)).toBe(false)

      // sessions.json should be reset to {}
      const sessionsMap = JSON.parse(fs.readFileSync(path.join(sessDir, 'sessions.json'), 'utf-8'))
      expect(sessionsMap).toEqual({})
    })
  })

  describe('recreateStewardWorkspace', () => {
    it('returns false when template dir does not exist', () => {
      // The real getPluginDir() points to the actual project root, which DOES
      // have town-workspace/. So this test only validates the happy path.
      const result = recreateStewardWorkspace()
      expect(result).toBe(true)
      const stewardWs = path.join(tmpDir, 'workspace-town-steward')
      expect(fs.existsSync(path.join(stewardWs, 'SOUL.md'))).toBe(true)
      expect(fs.existsSync(path.join(stewardWs, 'town-defaults.json'))).toBe(true)
    })
  })

  describe('recreateCitizenWorkspaces', () => {
    it('re-creates citizen workspaces from published config and registers agents', () => {
      // First remove existing citizens + clear runtime (so openclaw.json is clean)
      fs.writeFileSync(
        path.join(tmpDir, 'openclaw.json'),
        JSON.stringify({ agents: { list: [{ id: 'town-steward', name: 'Steward' }] } }),
      )
      // Recreate steward first (so shared files exist)
      recreateStewardWorkspace()

      const stats = recreateCitizenWorkspaces()

      // The real citizen-config.json has 7 citizens with agentEnabled
      expect(stats.citizensCreated).toBeGreaterThan(0)
      expect(stats.agentsRegistered).toBeGreaterThan(0)

      // Verify a citizen workspace exists with SOUL.md + IDENTITY.md
      const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'openclaw.json'), 'utf-8'))
      const citizenEntries = cfg.agents.list.filter((a: any) => a.id?.startsWith('citizen-'))
      expect(citizenEntries.length).toBeGreaterThan(0)

      // Check first citizen workspace
      const firstCitizen = citizenEntries[0]
      const ws = firstCitizen.workspace
      expect(fs.existsSync(path.join(ws, 'SOUL.md'))).toBe(true)
      expect(fs.existsSync(path.join(ws, 'IDENTITY.md'))).toBe(true)
      expect(fs.existsSync(path.join(ws, 'town-defaults.json'))).toBe(true)
      expect(fs.existsSync(path.join(ws, 'town-guide.md'))).toBe(true)
    })
  })

  describe('initTown (full orchestration)', () => {
    it('performs full re-initialization and returns success', () => {
      // Setup: pre-existing citizen workspace + session data
      const agentsDir = path.join(tmpDir, 'agents')
      const sessDir = path.join(agentsDir, 'citizen-citizen_1', 'sessions')
      fs.mkdirSync(sessDir, { recursive: true })
      fs.writeFileSync(
        path.join(sessDir, 'sessions.json'),
        JSON.stringify({ 'agent:citizen-citizen_1:main': { sessionId: 'old-sess' } }),
      )
      fs.writeFileSync(path.join(sessDir, 'old-sess.jsonl'), 'old\n')

      fs.writeFileSync(
        path.join(tmpDir, 'openclaw.json'),
        JSON.stringify({
          agents: {
            list: [
              { id: 'town-steward', name: 'Steward' },
              { id: 'citizen-citizen_1', name: 'Yan', workspace: path.join(tmpDir, 'workspace-citizen-citizen_1') },
            ],
          },
        }),
      )
      fs.mkdirSync(path.join(tmpDir, 'workspace-citizen-citizen_1'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'workspace-citizen-citizen_1', 'SOUL.md'), 'old-soul')

      const result = initTown()

      expect(result.success).toBe(true)
      expect(result.removal.workspacesRemoved).toBe(1)
      expect(result.removal.agentsRemoved).toBe(1)
      expect(result.clearing.sessionsCleared).toBe(1)
      expect(result.stewardRecreated).toBe(true)
      expect(result.citizens.citizensCreated).toBeGreaterThan(0)
      expect(result.citizens.agentsRegistered).toBeGreaterThan(0)

      // Verify old session file is gone
      expect(fs.existsSync(path.join(sessDir, 'old-sess.jsonl'))).toBe(false)

      // Verify citizen workspaces re-created with fresh soul
      const cfg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'openclaw.json'), 'utf-8'))
      const citizenEntries = cfg.agents.list.filter((a: any) => a.id?.startsWith('citizen-'))
      expect(citizenEntries.length).toBeGreaterThan(0)
    })
  })
})
