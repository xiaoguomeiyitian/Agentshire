// @desc Tests for i18n: locale resolution and translation
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock browser globals via vi.stubGlobal (must run before import)
const mockLocalStorage: Record<string, string> = {}
const mockLocation: { search: string } = { search: '' }

vi.stubGlobal('location', mockLocation)
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k in mockLocalStorage ? mockLocalStorage[k] : null),
  setItem: (k: string, v: string) => { mockLocalStorage[k] = v },
  removeItem: (k: string) => { delete mockLocalStorage[k] },
})

const { initLocale, getLocale, setLocale, t } = await import('../../i18n/index')

describe('i18n', () => {
  beforeEach(() => {
    // Reset state
    Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k])
    mockLocation.search = ''
    setLocale('zh-CN')
  })

  describe('initLocale', () => {
    it('defaults to zh-CN when no params/storage', () => {
      mockLocation.search = ''
      delete mockLocalStorage['agentshire_settings']
      initLocale()
      expect(getLocale()).toBe('zh-CN')
    })

    it('uses lang from URL param', () => {
      mockLocation.search = '?lang=en'
      initLocale()
      expect(getLocale()).toBe('en')
    })

    it('falls back to storage when URL has no lang', () => {
      mockLocation.search = ''
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ language: 'en' })
      initLocale()
      expect(getLocale()).toBe('en')
    })

    it('URL param takes priority over storage', () => {
      mockLocation.search = '?lang=zh-CN'
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ language: 'en' })
      initLocale()
      expect(getLocale()).toBe('zh-CN')
    })

    it('ignores unknown locale', () => {
      mockLocation.search = '?lang=xx-XX'
      initLocale()
      expect(getLocale()).toBe('zh-CN')
    })
  })

  describe('setLocale', () => {
    it('switches to valid locale', () => {
      setLocale('en')
      expect(getLocale()).toBe('en')
    })

    it('ignores invalid locale', () => {
      setLocale('xx-XX')
      expect(getLocale()).toBe('zh-CN') // stays at previous (reset in beforeEach)
    })
  })

  describe('t', () => {
    it('returns zh-CN translation by default', () => {
      setLocale('zh-CN')
      const result = t('ws.error') // key that exists in zh-CN
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('returns en translation when locale is en', () => {
      setLocale('en')
      const result = t('ws.error')
      expect(typeof result).toBe('string')
    })

    it('falls back to key when missing in current locale', () => {
      setLocale('zh-CN')
      expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz')
    })

    it('interpolates variables', () => {
      setLocale('zh-CN')
      const result = t('ws.error', { url: 'ws://localhost:20008' })
      expect(result).toContain('ws://localhost:20008')
    })

    it('interpolates multiple variables', () => {
      setLocale('zh-CN')
      const result = t('ws.error', { url: 'ws://x', extra: 'y' })
      expect(result).toContain('ws://x')
    })
  })
})
