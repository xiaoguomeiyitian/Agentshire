// @desc Tests for model-config: OpenClaw openclaw.json models.providers CRUD
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TMP = mkdtempSync(join(tmpdir(), 'agentshire-model-config-'))

// Mock paths.js so stateDir() points at our temp dir
vi.mock('../paths.js', () => ({
  stateDir: () => TMP,
  initStateDir: () => {},
}))

import {
  addProvider,
  updateProvider,
  deleteProvider,
  addModel,
  updateModel,
  deleteModel,
  readModelsConfig,
  writeModelsConfig,
  importModels,
  exportModels,
  ModelConfigError,
  PROVIDER_ID_PATTERN,
} from '../model-config.js'

function writeConfig(cfg: any): void {
  writeFileSync(join(TMP, 'openclaw.json'), JSON.stringify(cfg, null, 2))
}

function readConfig(): any {
  return JSON.parse(readFileSync(join(TMP, 'openclaw.json'), 'utf-8'))
}

const BASE_CONFIG = {
  plugins: {},
  models: { providers: {} },
  agents: { list: [] },
}

beforeEach(() => {
  writeConfig(BASE_CONFIG)
})

describe('provider CRUD', () => {
  it('addProvider writes a provider with normalized shape', () => {
    const next = addProvider('openai', {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '${API_KEY}',
      api: 'openai-completions',
      models: [],
    })
    expect(next.openai.baseUrl).toBe('https://api.openai.com/v1')
    expect(next.openai.apiKey).toBe('${API_KEY}')
    expect(next.openai.api).toBe('openai-completions')
    expect(next.openai.models).toEqual([])
    // persisted to disk
    expect(readConfig().models.providers.openai).toBeDefined()
  })

  it('addProvider rejects invalid id', () => {
    expect(() => addProvider('Bad ID', { baseUrl: 'x' })).toThrow(ModelConfigError)
  })

  it('addProvider rejects missing baseUrl', () => {
    expect(() => addProvider('p1', { baseUrl: '' })).toThrow(ModelConfigError)
  })

  it('addProvider rejects duplicate', () => {
    addProvider('p1', { baseUrl: 'https://x' })
    expect(() => addProvider('p1', { baseUrl: 'https://y' })).toThrow(ModelConfigError)
  })

  it('updateProvider merges models', () => {
    addProvider('p1', { baseUrl: 'https://x', models: [{ id: 'm1' }] })
    const next = updateProvider('p1', { baseUrl: 'https://y' })
    expect(next.p1.baseUrl).toBe('https://y')
    expect(next.p1.models).toEqual([{ id: 'm1' }])
  })

  it('updateProvider throws on missing provider', () => {
    expect(() => updateProvider('nope', { baseUrl: 'x' })).toThrow(ModelConfigError)
  })

  it('deleteProvider removes provider', () => {
    addProvider('p1', { baseUrl: 'https://x' })
    const next = deleteProvider('p1')
    expect(next.p1).toBeUndefined()
    expect(readConfig().models.providers.p1).toBeUndefined()
  })
})

describe('model CRUD', () => {
  beforeEach(() => {
    addProvider('p1', { baseUrl: 'https://x', models: [] })
  })

  it('addModel appends a model', () => {
    const next = addModel('p1', { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 })
    expect(next.p1.models).toHaveLength(1)
    expect(next.p1.models![0].id).toBe('gpt-4o')
  })

  it('addModel rejects duplicate id', () => {
    addModel('p1', { id: 'gpt-4o' })
    expect(() => addModel('p1', { id: 'gpt-4o' })).toThrow(ModelConfigError)
  })

  it('updateModel keeps id but merges fields', () => {
    addModel('p1', { id: 'gpt-4o', name: 'Old' })
    const next = updateModel('p1', 'gpt-4o', { id: 'gpt-4o', name: 'New', maxTokens: 4096 })
    const m = next.p1.models!.find((x) => x.id === 'gpt-4o')!
    expect(m.name).toBe('New')
    expect(m.maxTokens).toBe(4096)
  })

  it('deleteModel removes model', () => {
    addModel('p1', { id: 'gpt-4o' })
    const next = deleteModel('p1', 'gpt-4o')
    expect(next.p1.models).toHaveLength(0)
  })

  it('model ops throw on unknown provider', () => {
    expect(() => addModel('ghost', { id: 'm' })).toThrow(ModelConfigError)
    expect(() => updateModel('ghost', 'm', { id: 'm' })).toThrow(ModelConfigError)
    expect(() => deleteModel('ghost', 'm')).toThrow(ModelConfigError)
  })
})

describe('import / export', () => {
  it('import append merges without overwriting existing', () => {
    addProvider('p1', { baseUrl: 'https://x' })
    importModels({ providers: { p1: { baseUrl: 'https://overwrite' }, p2: { baseUrl: 'https://y' } } }, 'append')
    const { providers } = readModelsConfig()
    expect(providers.p1.baseUrl).toBe('https://x') // not overwritten
    expect(providers.p2.baseUrl).toBe('https://y')
  })

  it('import new skips existing ids', () => {
    addProvider('p1', { baseUrl: 'https://x' })
    importModels({ providers: { p1: { baseUrl: 'https://overwrite' }, p3: { baseUrl: 'https://z' } } }, 'new')
    const { providers } = readModelsConfig()
    expect(providers.p1.baseUrl).toBe('https://x')
    expect(providers.p3.baseUrl).toBe('https://z')
  })

  it('import replace swaps entire map', () => {
    addProvider('p1', { baseUrl: 'https://x' })
    importModels({ providers: { only: { baseUrl: 'https://only' } } }, 'replace')
    const { providers } = readModelsConfig()
    expect(Object.keys(providers)).toEqual(['only'])
  })

  it('export strips machine-specific secret refs', () => {
    addProvider('p1', { baseUrl: 'https://x', apiKey: '${input:secret.ABC123}' })
    const file = exportModels()
    expect(file.providers.p1.apiKey).toBe('')
  })

  it('export keeps ${ENV} refs', () => {
    addProvider('p1', { baseUrl: 'https://x', apiKey: '${API_KEY}' })
    const file = exportModels()
    expect(file.providers.p1.apiKey).toBe('${API_KEY}')
  })
})

describe('read / write whole file', () => {
  it('writeModelsConfig preserves other top-level keys', () => {
    writeModelsConfig({ p1: { baseUrl: 'https://x' } })
    const cfg = readConfig()
    expect(cfg.plugins).toBeDefined()
    expect(cfg.agents).toBeDefined()
    expect(cfg.models.providers.p1.baseUrl).toBe('https://x')
  })
})

describe('PROVIDER_ID_PATTERN', () => {
  it('accepts valid ids', () => {
    expect(PROVIDER_ID_PATTERN.test('openai')).toBe(true)
    expect(PROVIDER_ID_PATTERN.test('my-provider_1')).toBe(true)
  })
  it('rejects invalid ids', () => {
    expect(PROVIDER_ID_PATTERN.test('OpenAI')).toBe(false)
    expect(PROVIDER_ID_PATTERN.test('bad id')).toBe(false)
    expect(PROVIDER_ID_PATTERN.test('bad.id')).toBe(false)
  })
})
