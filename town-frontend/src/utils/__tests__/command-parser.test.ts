import { describe, it, expect, vi } from 'vitest'
import {
  parseCommand,
  getHelpText,
  getCommandSuggestions,
  HELP_TEXT,
} from '../command-parser'

// Mock getLocale to control language
vi.mock('../../i18n', () => ({
  getLocale: vi.fn(() => 'zh-CN'),
}))

describe('parseCommand', () => {
  it('returns null for non-command input (no leading slash)', () => {
    expect(parseCommand('hello world')).toBeNull()
    expect(parseCommand('')).toBeNull()
    expect(parseCommand('  ')).toBeNull()
  })

  it('returns null for slash without command name', () => {
    expect(parseCommand('/')).toBeNull()
    expect(parseCommand('/ ')).toBeNull()
    expect(parseCommand('/123')).toBeNull()
  })

  it('parses frontend command /new', () => {
    const result = parseCommand('/new')
    expect(result).toEqual({
      type: 'frontend',
      command: 'new',
      args: '',
      raw: '/new',
    })
  })

  it('parses frontend command /clear', () => {
    const result = parseCommand('/clear')
    expect(result).toEqual({
      type: 'frontend',
      command: 'clear',
      args: '',
      raw: '/clear',
    })
  })

  it('parses frontend command /help', () => {
    const result = parseCommand('/help')
    expect(result?.type).toBe('frontend')
    expect(result?.command).toBe('help')
  })

  it('parses gateway command /reset', () => {
    const result = parseCommand('/reset')
    expect(result).toEqual({
      type: 'gateway',
      command: 'reset',
      args: '',
      raw: '/reset',
    })
  })

  it('parses gateway command with args', () => {
    const result = parseCommand('/model gpt-4')
    expect(result).toEqual({
      type: 'gateway',
      command: 'model',
      args: 'gpt-4',
      raw: '/model gpt-4',
    })
  })

  it('parses gateway command with multi-word args', () => {
    const result = parseCommand('/name My Session Title')
    expect(result?.command).toBe('name')
    expect(result?.args).toBe('My Session Title')
    expect(result?.type).toBe('gateway')
  })

  it('lowercases the command name', () => {
    const result = parseCommand('/NEW')
    expect(result?.command).toBe('new')
    expect(result?.type).toBe('frontend')
  })

  it('handles mixed-case command names', () => {
    const result = parseCommand('/MoDeL')
    expect(result?.command).toBe('model')
    expect(result?.type).toBe('gateway')
  })

  it('handles commands with hyphens', () => {
    const result = parseCommand('/export-session')
    expect(result?.command).toBe('export-session')
    expect(result?.type).toBe('gateway')
  })

  it('handles commands with underscores', () => {
    const result = parseCommand('/export_trajectory')
    expect(result?.command).toBe('export_trajectory')
    expect(result?.type).toBe('gateway')
  })

  it('trims trailing whitespace from args', () => {
    const result = parseCommand('/compact   ')
    expect(result?.args).toBe('')
  })

  it('preserves internal whitespace in args', () => {
    const result = parseCommand('/steer Please  fix  this')
    expect(result?.args).toBe('Please  fix  this')
  })

  it('treats unknown commands as gateway type', () => {
    const result = parseCommand('/unknowncmd')
    expect(result?.type).toBe('gateway')
    expect(result?.command).toBe('unknowncmd')
  })

  it('preserves the raw input', () => {
    const raw = '/think high'
    const result = parseCommand(raw)
    expect(result?.raw).toBe(raw)
  })
})

describe('HELP_TEXT', () => {
  it('is a non-empty string', () => {
    expect(typeof HELP_TEXT).toBe('string')
    expect(HELP_TEXT.length).toBeGreaterThan(0)
  })

  it('contains key command references', () => {
    expect(HELP_TEXT).toContain('/new')
    expect(HELP_TEXT).toContain('/clear')
    expect(HELP_TEXT).toContain('/help')
    expect(HELP_TEXT).toContain('/reset')
    expect(HELP_TEXT).toContain('/compact')
  })
})

describe('getHelpText', () => {
  it('returns Chinese help text for zh-CN locale', async () => {
    const { getLocale } = await import('../../i18n')
    vi.mocked(getLocale).mockReturnValue('zh-CN')
    const text = getHelpText()
    expect(text).toContain('可用指令')
  })

  it('returns English help text for en locale', async () => {
    const { getLocale } = await import('../../i18n')
    vi.mocked(getLocale).mockReturnValue('en')
    const text = getHelpText()
    expect(text).toContain('Available commands')
  })
})

describe('getCommandSuggestions', () => {
  it('returns empty array for non-command input', () => {
    expect(getCommandSuggestions('hello')).toEqual([])
    expect(getCommandSuggestions('')).toEqual([])
  })

  it('returns all commands when input is just "/"', () => {
    const result = getCommandSuggestions('/')
    expect(result.length).toBeGreaterThan(30)
    // Should include frontend commands
    expect(result.some(c => c.name === 'new')).toBe(true)
    expect(result.some(c => c.name === 'clear')).toBe(true)
    expect(result.some(c => c.name === 'help')).toBe(true)
  })

  it('returns all commands when "/" is followed by non-letter', () => {
    const result = getCommandSuggestions('/1')
    expect(result.length).toBeGreaterThan(30)
  })

  it('filters commands by prefix', () => {
    const result = getCommandSuggestions('/mo')
    const names = result.map(c => c.name)
    expect(names).toContain('model')
    expect(names).toContain('models')
    // Should not include commands that don't start with "mo"
    expect(names).not.toContain('reset')
    expect(names).not.toContain('clear')
  })

  it('is case-insensitive for prefix matching', () => {
    const result = getCommandSuggestions('/MO')
    const names = result.map(c => c.name)
    expect(names).toContain('model')
    expect(names).toContain('models')
  })

  it('returns empty array when full command is typed (exact match, single result)', () => {
    // "new" is unique — typing /new exactly should return []
    const result = getCommandSuggestions('/new')
    expect(result).toEqual([])
  })

  it('returns empty array when command is followed by space (typing args)', () => {
    const result = getCommandSuggestions('/model ')
    expect(result).toEqual([])
  })

  it('returns empty array when command + args are being typed', () => {
    const result = getCommandSuggestions('/model gpt')
    expect(result).toEqual([])
  })

  it('returns multiple matches for ambiguous prefix', () => {
    // "s" matches: stop, status, skill, subagents, steer
    const result = getCommandSuggestions('/s')
    const names = result.map(c => c.name)
    expect(names).toContain('stop')
    expect(names).toContain('status')
    expect(names).toContain('skill')
    expect(names.length).toBeGreaterThan(1)
  })

  it('returns commands with hyphens for matching prefix', () => {
    const result = getCommandSuggestions('/export')
    const names = result.map(c => c.name)
    expect(names).toContain('export-session')
    expect(names).toContain('export-trajectory')
  })

  it('each suggestion has required fields', () => {
    const result = getCommandSuggestions('/')
    for (const s of result) {
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('description')
      expect(s).toHaveProperty('argsHint')
      expect(s).toHaveProperty('frontend')
      expect(typeof s.name).toBe('string')
      expect(typeof s.description).toBe('string')
      expect(typeof s.frontend).toBe('boolean')
    }
  })

  it('frontend flag is true only for new/clear/help', () => {
    const result = getCommandSuggestions('/')
    const frontendCmds = result.filter(c => c.frontend)
    const frontendNames = frontendCmds.map(c => c.name).sort()
    expect(frontendNames).toEqual(['clear', 'help', 'new'])
  })

  it('returns all commands for non-letter after slash', () => {
    // Non-letter after slash doesn't match the command-name regex, so all commands are returned
    expect(getCommandSuggestions('/!').length).toBeGreaterThan(30)
  })

  it('handles /c prefix (clear vs commands vs config)', () => {
    const result = getCommandSuggestions('/c')
    const names = result.map(c => c.name)
    expect(names).toContain('clear')
    expect(names).toContain('commands')
    expect(names).toContain('config')
    expect(names).toContain('context')
  })
})
