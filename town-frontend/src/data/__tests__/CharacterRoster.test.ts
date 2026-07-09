// @desc Tests for CharacterRoster: character model registry
import { describe, it, expect } from 'vitest'
import {
  getCharacterKeyForNpc,
  pickUnusedCharacterKey,
  listCharacterModels,
} from '../CharacterRoster'

describe('CharacterRoster', () => {
  describe('getCharacterKeyForNpc', () => {
    it('returns explicit key when provided', () => {
      expect(getCharacterKeyForNpc('npc-1', 'char-female-b')).toBe('char-female-b')
    })

    it('returns default when no explicit key', () => {
      expect(getCharacterKeyForNpc('npc-1')).toBe('char-male-a')
    })

    it('falls back to default when explicit key is empty string', () => {
      expect(getCharacterKeyForNpc('npc-1', '')).toBe('char-male-a')
    })
  })

  describe('pickUnusedCharacterKey', () => {
    it('returns first model not in used set', () => {
      const models = listCharacterModels()
      if (models.length > 1) {
        const used = new Set([models[0].id])
        const picked = pickUnusedCharacterKey(used)
        expect(picked).not.toBe(models[0].id)
      } else {
        expect(pickUnusedCharacterKey(new Set())).toBeTruthy()
      }
    })

    it('accepts Map as usedKeys', () => {
      const models = listCharacterModels()
      const used = new Map<string, string>()
      used.set('npc-1', models[0]?.id ?? 'char-male-a')
      const picked = pickUnusedCharacterKey(used)
      expect(picked).toBeTruthy()
    })

    it('falls back to default when all used', () => {
      const models = listCharacterModels()
      const allIds = new Set(models.map((m) => m.id))
      const picked = pickUnusedCharacterKey(allIds)
      expect(picked).toBe('char-male-a')
    })
  })

  describe('listCharacterModels', () => {
    it('returns array of models', () => {
      const models = listCharacterModels()
      expect(Array.isArray(models)).toBe(true)
    })

    it('returns copies with independent tags arrays', () => {
      const models = listCharacterModels()
      if (models.length > 0) {
        const m0 = models[0]
        m0.tags.push('__test__')
        const models2 = listCharacterModels()
        expect(models2[0].tags).not.toContain('__test__')
      }
    })
  })
})
