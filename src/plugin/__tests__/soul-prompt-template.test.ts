import { describe, it, expect } from 'vitest'
import {
  buildSoulPrompt,
  buildPersonaPrompt,
  type SoulPromptInput,
  type PersonaPromptInput,
} from '../soul-prompt-template.js'

describe('buildSoulPrompt', () => {
  const sampleInput: SoulPromptInput = {
    name: '小明',
    bio: '热爱编程的全栈工程师',
    industry: '互联网',
    specialty: '全栈开发',
  }

  it('returns a non-empty string', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(100)
  })

  it('includes the character name', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('小明')
  })

  it('includes the bio', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('热爱编程的全栈工程师')
  })

  it('includes the industry', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('互联网')
  })

  it('includes the specialty', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('全栈开发')
  })

  it('includes the current date', () => {
    const result = buildSoulPrompt(sampleInput)
    const today = new Date().toISOString().split('T')[0]
    expect(result).toContain(today)
  })

  it('includes output format instructions', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('Markdown')
  })

  it('includes the soul example', () => {
    const result = buildSoulPrompt(sampleInput)
    expect(result).toContain('海棠')
  })

  it('handles empty bio', () => {
    const result = buildSoulPrompt({ ...sampleInput, bio: '' })
    expect(result).toContain('角色名: 小明')
  })

  it('handles special characters in name', () => {
    const result = buildSoulPrompt({ ...sampleInput, name: 'A&B<C>' })
    expect(result).toContain('A&B<C>')
  })

  it('handles unicode names', () => {
    const result = buildSoulPrompt({ ...sampleInput, name: '🌟星🌟' })
    expect(result).toContain('🌟星🌟')
  })
})

describe('buildPersonaPrompt', () => {
  const sampleInput: PersonaPromptInput = {
    name: '小红',
    bio: '细心的木工',
    specialty: '木工与搭建',
  }

  it('returns an object with system and user fields', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('user')
    expect(typeof result.system).toBe('string')
    expect(typeof result.user).toBe('string')
  })

  it('user prompt includes the name', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.user).toContain('小红')
  })

  it('user prompt includes the bio', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.user).toContain('细心的木工')
  })

  it('user prompt includes the specialty', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.user).toContain('木工与搭建')
  })

  it('system prompt includes format instructions', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.system).toContain('人设核心')
    expect(result.system).toContain('性格详细设定')
    expect(result.system).toContain('小镇生活')
  })

  it('system prompt includes the persona example', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.system).toContain('海棠')
  })

  it('system prompt includes core principles', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.system).toContain('核心原则')
  })

  it('system prompt is non-empty', () => {
    const result = buildPersonaPrompt(sampleInput)
    expect(result.system.length).toBeGreaterThan(100)
  })

  it('handles empty bio', () => {
    const result = buildPersonaPrompt({ ...sampleInput, bio: '' })
    expect(result.user).toContain('小红')
    expect(result.user).toContain('木工与搭建')
  })

  it('handles special characters in name', () => {
    const result = buildPersonaPrompt({ ...sampleInput, name: 'A&B' })
    expect(result.user).toContain('A&B')
  })
})
