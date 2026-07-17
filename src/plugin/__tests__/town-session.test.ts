import { describe, it, expect } from 'vitest'
import {
  sanitizeTownSessionId,
  createTownSessionKey,
  extractTownSessionId,
} from '../town-session.js'

describe('sanitizeTownSessionId', () => {
  it('returns "default" for empty string', () => {
    expect(sanitizeTownSessionId('')).toBe('default')
  })

  it('returns "default" for whitespace-only string', () => {
    expect(sanitizeTownSessionId('   ')).toBe('default')
    expect(sanitizeTownSessionId('\t\n')).toBe('default')
  })

  it('trims surrounding whitespace', () => {
    expect(sanitizeTownSessionId('  hello  ')).toBe('hello')
  })

  it('preserves alphanumeric, colon, underscore, hyphen', () => {
    expect(sanitizeTownSessionId('abc123')).toBe('abc123')
    expect(sanitizeTownSessionId('a:b_c-d')).toBe('a:b_c-d')
  })

  it('replaces invalid characters with hyphen', () => {
    expect(sanitizeTownSessionId('hello world')).toBe('hello-world')
    expect(sanitizeTownSessionId('a/b@c')).toBe('a-b-c')
    expect(sanitizeTownSessionId('a.b')).toBe('a-b')
  })

  it('preserves valid characters while replacing invalid ones', () => {
    expect(sanitizeTownSessionId('session:1_2-3 test')).toBe('session:1_2-3-test')
  })
})

describe('createTownSessionKey', () => {
  it('creates a key with the expected format', () => {
    const key = createTownSessionKey('user123', 'session456')
    expect(key).toBe('agent:town-steward:town:user123:session456')
  })

  it('sanitizes the townSessionId', () => {
    const key = createTownSessionKey('user123', 'session with spaces')
    expect(key).toBe('agent:town-steward:town:user123:session-with-spaces')
  })

  it('uses "default" for empty townSessionId', () => {
    const key = createTownSessionKey('user123', '')
    expect(key).toBe('agent:town-steward:town:user123:default')
  })

  it('handles special characters in accountId', () => {
    // accountId is used as-is (not sanitized)
    const key = createTownSessionKey('user@123', 'session1')
    expect(key).toBe('agent:town-steward:town:user@123:session1')
  })
})

describe('extractTownSessionId', () => {
  it('extracts from new format key', () => {
    const key = 'agent:town-steward:town:user123:session456'
    expect(extractTownSessionId(key)).toBe('session456')
  })

  it('extracts from new format key with sanitized session id', () => {
    const key = 'agent:town-steward:town:user123:my-session'
    expect(extractTownSessionId(key)).toBe('my-session')
  })

  it('extracts from legacy format key (town:accountId:sessionId)', () => {
    const key = 'town:user123:session456'
    expect(extractTownSessionId(key)).toBe('session456')
  })

  it('returns "default" for legacy town-xxx format (no colon)', () => {
    expect(extractTownSessionId('town-steward')).toBe('default')
  })

  it('returns null for non-string input', () => {
    expect(extractTownSessionId(null as any)).toBeNull()
    expect(extractTownSessionId(undefined as any)).toBeNull()
    expect(extractTownSessionId(123 as any)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractTownSessionId('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(extractTownSessionId('   ')).toBeNull()
  })

  it('returns null for unrecognized format', () => {
    expect(extractTownSessionId('random-string')).toBeNull()
    expect(extractTownSessionId('user:123:session')).toBeNull()
  })

  it('sanitizes the extracted session id', () => {
    const key = 'agent:town-steward:town:user123:session with spaces'
    expect(extractTownSessionId(key)).toBe('session-with-spaces')
  })

  it('handles session id with special characters in new format', () => {
    const key = 'agent:town-steward:town:acct:my@session'
    // @ is invalid, gets replaced with -
    expect(extractTownSessionId(key)).toBe('my-session')
  })

  it('handles session id with special characters in legacy format', () => {
    const key = 'town:acct:my@session'
    expect(extractTownSessionId(key)).toBe('my-session')
  })

  it('trims whitespace before parsing', () => {
    expect(extractTownSessionId('  agent:town-steward:town:user:session  ')).toBe('session')
  })

  it('handles session id containing colons (new format captures rest)', () => {
    const key = 'agent:town-steward:town:user:session:with:colons'
    expect(extractTownSessionId(key)).toBe('session:with:colons')
  })
})
