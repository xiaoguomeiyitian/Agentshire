import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  estimateInputTokens,
  estimateOutputTokens,
  withEstimatedFallback,
} from '../token-estimate.js'

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns 0 for non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(estimateTokens(null)).toBe(0)
    // @ts-expect-error testing runtime guard
    expect(estimateTokens(undefined)).toBe(0)
  })

  it('estimates Latin text (~4 chars per token)', () => {
    const text = 'hello world' // 11 chars
    const tokens = estimateTokens(text)
    expect(tokens).toBe(Math.ceil(11 / 4))
  })

  it('estimates CJK text (~1.5 tokens per char)', () => {
    const text = '你好世界' // 4 CJK chars
    const tokens = estimateTokens(text)
    expect(tokens).toBe(Math.ceil(4 * 1.5))
  })

  it('estimates mixed CJK and Latin text', () => {
    const text = 'hello 你好' // 5 Latin + 2 CJK + 1 space = 8 chars, 2 CJK
    const cjk = 2
    const other = text.length - cjk
    const expected = Math.ceil(cjk * 1.5 + other / 4)
    expect(estimateTokens(text)).toBe(expected)
  })

  it('handles Japanese hiragana', () => {
    const text = 'こんにちは' // 5 hiragana chars
    expect(estimateTokens(text)).toBe(Math.ceil(5 * 1.5))
  })

  it('handles Japanese katakana', () => {
    const text = 'コンニチハ' // 5 katakana chars
    expect(estimateTokens(text)).toBe(Math.ceil(5 * 1.5))
  })

  it('returns positive value for long text', () => {
    const text = 'a'.repeat(1000)
    expect(estimateTokens(text)).toBeGreaterThan(0)
  })
})

describe('estimateInputTokens', () => {
  it('returns 0 for all empty inputs', () => {
    expect(estimateInputTokens('', '', [])).toBe(0)
  })

  it('estimates systemPrompt + prompt', () => {
    const result = estimateInputTokens('system', 'prompt', [])
    expect(result).toBe(estimateTokens('system') + estimateTokens('prompt'))
  })

  it('adds 4 tokens overhead per history message', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const result = estimateInputTokens('', '', history)
    const contentTokens = estimateTokens('hi') + estimateTokens('hello')
    expect(result).toBe(contentTokens + 2 * 4)
  })

  it('handles string content in history', () => {
    const history = [{ role: 'user', content: 'test message' }]
    const result = estimateInputTokens('', '', history)
    expect(result).toBe(estimateTokens('test message') + 4)
  })

  it('handles array content in history', () => {
    const history = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }],
      },
    ]
    const result = estimateInputTokens('', '', history)
    expect(result).toBe(estimateTokens('part1part2') + 4)
  })

  it('handles object content with content field', () => {
    const history = [{ role: 'user', content: { content: 'obj content' } }]
    const result = estimateInputTokens('', '', history)
    expect(result).toBe(estimateTokens(JSON.stringify({ content: 'obj content' })) + 4)
  })

  it('handles null/undefined content in history', () => {
    const history = [{ role: 'user', content: null }, { role: 'assistant', content: undefined }]
    const result = estimateInputTokens('', '', history)
    expect(result).toBe(2 * 4) // only overhead, no content tokens
  })

  it('defaults historyMessages to empty array', () => {
    const result = estimateInputTokens('sys', 'prompt')
    expect(result).toBe(estimateTokens('sys') + estimateTokens('prompt'))
  })
})

describe('estimateOutputTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateOutputTokens([])).toBe(0)
  })

  it('returns 0 for undefined input', () => {
    expect(estimateOutputTokens(undefined)).toBe(0)
  })

  it('sums tokens for all assistant texts', () => {
    const texts = ['hello world', '你好世界']
    const expected = estimateTokens('hello world') + estimateTokens('你好世界')
    expect(estimateOutputTokens(texts)).toBe(expected)
  })

  it('handles single text', () => {
    expect(estimateOutputTokens(['test'])).toBe(estimateTokens('test'))
  })

  it('handles empty strings in array', () => {
    expect(estimateOutputTokens(['', ''])).toBe(0)
  })
})

describe('withEstimatedFallback', () => {
  it('returns estimated values when API usage is 0/0', () => {
    const result = withEstimatedFallback({ input: 0, output: 0 }, 100, 50)
    expect(result).toEqual({ input: 100, output: 50 })
  })

  it('returns estimated values when API usage is undefined', () => {
    const result = withEstimatedFallback(undefined, 100, 50)
    expect(result).toEqual({ input: 100, output: 50 })
  })

  it('returns API values when input is non-zero', () => {
    const result = withEstimatedFallback({ input: 200, output: 0 }, 100, 50)
    expect(result).toEqual({ input: 200, output: 0 })
  })

  it('returns API values when output is non-zero', () => {
    const result = withEstimatedFallback({ input: 0, output: 80 }, 100, 50)
    expect(result).toEqual({ input: 0, output: 80 })
  })

  it('returns API values when both are non-zero', () => {
    const result = withEstimatedFallback({ input: 200, output: 80 }, 100, 50)
    expect(result).toEqual({ input: 200, output: 80 })
  })

  it('handles null apiUsage', () => {
    // @ts-expect-error testing runtime guard
    const result = withEstimatedFallback(null, 100, 50)
    expect(result).toEqual({ input: 100, output: 50 })
  })
})
