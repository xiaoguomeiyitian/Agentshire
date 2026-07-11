// @desc Tests for SettingsPanel: loadSettings / saveSettings persistence
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock browser globals
const mockLocalStorage: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (k in mockLocalStorage ? mockLocalStorage[k] : null),
  setItem: (k: string, v: string) => { mockLocalStorage[k] = v },
  removeItem: (k: string) => { delete mockLocalStorage[k] },
})

const { loadSettings, saveSettings } = await import('../SettingsPanel')

describe('SettingsPanel', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k])
  })

  describe('loadSettings', () => {
    it('returns defaults when no stored settings', () => {
      const s = loadSettings()
      expect(s).toEqual({ language: 'zh-CN', music: true, soulMode: true })
    })

    it('returns defaults when stored value is invalid JSON', () => {
      mockLocalStorage['agentshire_settings'] = '{invalid'
      const s = loadSettings()
      expect(s).toEqual({ language: 'zh-CN', music: true, soulMode: true })
    })

    it('loads music=false from storage', () => {
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ music: false })
      const s = loadSettings()
      expect(s.music).toBe(false)
    })

    it('treats music=undefined as true (default)', () => {
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ language: 'en' })
      const s = loadSettings()
      expect(s.music).toBe(true)
    })

    it('loads soulMode=false from storage', () => {
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ soulMode: false })
      const s = loadSettings()
      expect(s.soulMode).toBe(false)
    })

    it('loads language from storage', () => {
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ language: 'en' })
      const s = loadSettings()
      expect(s.language).toBe('en')
    })

    it('defaults language to zh-CN when missing', () => {
      mockLocalStorage['agentshire_settings'] = JSON.stringify({ music: true })
      const s = loadSettings()
      expect(s.language).toBe('zh-CN')
    })
  })

  describe('saveSettings', () => {
    it('persists settings to localStorage', () => {
      saveSettings({ language: 'en', music: false, soulMode: true })
      const raw = mockLocalStorage['agentshire_settings']
      expect(raw).toBeDefined()
      expect(JSON.parse(raw!)).toEqual({ language: 'en', music: false, soulMode: true })
    })

    it('round-trips through loadSettings', () => {
      const original = { language: 'zh-CN', music: false, soulMode: false }
      saveSettings(original)
      const loaded = loadSettings()
      expect(loaded).toEqual(original)
    })
  })
})
