// @desc Tests for hook-translator: OpenClaw hooks → AgentEvent translation
import { describe, it, expect } from 'vitest'
import { hookToAgentEvent } from '../hook-translator.js'
import type { AgentEvent } from '../../contracts/events.js'

describe('hookToAgentEvent', () => {
  it('before_agent_start → system.init AgentEvent', () => {
    const result = hookToAgentEvent('before_agent_start', {
      sessionId: 'sess-1',
      model: 'claude-3',
      persona: 'steward',
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'system',
      subtype: 'init',
      sessionId: 'sess-1',
      model: 'claude-3',
      persona: 'steward',
    })
  })

  it('before_agent_start uses defaults when payload is empty', () => {
    const result = hookToAgentEvent('before_agent_start', {}) as AgentEvent
    expect(result).toMatchObject({
      type: 'system',
      subtype: 'init',
      model: 'unknown',
    })
    expect((result as any).sessionId).toMatch(/^oc-session-/)
  })

  it('llm_output with text content → text event', () => {
    const result = hookToAgentEvent('llm_output', {
      assistantTexts: ['first chunk', 'full response'],
    }) as AgentEvent[]

    expect(Array.isArray(result)).toBe(true)
    const textEvent = result.find((e: any) => e.type === 'text')
    expect(textEvent).toEqual({ type: 'text', content: 'full response' })
  })

  it('llm_output with empty text → null', () => {
    const result = hookToAgentEvent('llm_output', { assistantTexts: [''] })
    expect(result).toBeNull()
  })

  it('llm_output with usage + contextTokenBudget → context_update event', () => {
    const result = hookToAgentEvent('llm_output', {
      assistantTexts: ['response'],
      usage: { input: 5000, output: 200, totalTokens: 5200 },
      contextTokenBudget: 200000,
    }) as AgentEvent[]

    expect(Array.isArray(result)).toBe(true)
    const ctxEvent = result.find((e: any) => e.type === 'context_update')
    expect(ctxEvent).toMatchObject({
      type: 'context_update',
      tokens: { used: 5000, limit: 200000, percent: 3 },
      usage: { inputTokens: 5000, outputTokens: 200 },
    })
  })

  it('before_tool_call → tool_use event', () => {
    const result = hookToAgentEvent('before_tool_call', {
      toolCallId: 'tc-1',
      toolName: 'read_file',
      params: { path: '/foo.ts' },
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'tool_use',
      toolUseId: 'tc-1',
      name: 'read_file',
      input: { path: '/foo.ts' },
    })
  })

  it('after_tool_call → tool_result event (array)', () => {
    const result = hookToAgentEvent('after_tool_call', {
      toolCallId: 'tc-1',
      toolName: 'bash',
      result: 'ok',
    }) as AgentEvent[]

    expect(Array.isArray(result)).toBe(true)
    expect(result[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'tc-1',
      name: 'bash',
      output: 'ok',
    })
  })

  it('after_tool_call with media output includes media_output event', () => {
    const result = hookToAgentEvent('after_tool_call', {
      toolCallId: 'tc-2',
      toolName: 'image',
      result: 'saved to /tmp/output.png',
      params: {},
    }) as AgentEvent[]

    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      type: 'media_output',
      kind: 'image',
      path: '/tmp/output.png',
    })
  })

  it('subagent_spawned → sub_agent.started event', () => {
    const result = hookToAgentEvent('subagent_spawned', {
      childSessionKey: 'child-1',
      agentType: 'researcher',
      task: 'find bugs',
      model: 'gpt-4',
      label: 'Bug Hunter',
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'sub_agent',
      subtype: 'started',
      agentId: 'child-1',
      agentType: 'researcher',
      task: 'find bugs',
      model: 'gpt-4',
      displayName: 'Bug Hunter',
    })
  })

  it('subagent_ended → sub_agent.done event', () => {
    const result = hookToAgentEvent('subagent_ended', {
      targetSessionKey: 'child-1',
      outcome: 'ok',
      result: 'found 3 bugs',
      toolCalls: 5,
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'sub_agent',
      subtype: 'done',
      agentId: 'child-1',
      result: 'found 3 bugs',
      toolCalls: 5,
      status: 'completed',
    })
  })

  it('subagent_ended with error outcome → status=failed', () => {
    const result = hookToAgentEvent('subagent_ended', {
      targetSessionKey: 'child-2',
      outcome: 'error',
      reason: 'timeout',
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'sub_agent',
      subtype: 'done',
      status: 'failed',
    })
  })

  it('agent_end → turn_end event', () => {
    const result = hookToAgentEvent('agent_end', {
      usage: { inputTokens: 100, outputTokens: 50 },
      toolCalls: 3,
      durationMs: 1200,
    }) as AgentEvent[]

    expect(Array.isArray(result)).toBe(true)
    const turnEnd = result.find((e: any) => e.type === 'turn_end')
    expect(turnEnd).toMatchObject({
      type: 'turn_end',
      usage: { inputTokens: 100, outputTokens: 50 },
      toolCalls: 3,
      durationMs: 1200,
    })
  })

  it('agent_end with error includes error event before turn_end', () => {
    const result = hookToAgentEvent('agent_end', {
      success: false,
      error: 'Out of tokens',
    }) as AgentEvent[]

    expect(result[0]).toMatchObject({
      type: 'error',
      message: 'Out of tokens',
      recoverable: false,
    })
    expect(result[result.length - 1]).toMatchObject({ type: 'turn_end' })
  })

  it('unknown hook → null', () => {
    expect(hookToAgentEvent('some_random_hook', {})).toBeNull()
  })

  it('llm_input → thinking_delta event', () => {
    const result = hookToAgentEvent('llm_input', {}) as AgentEvent
    expect(result).toEqual({ type: 'thinking_delta', delta: '' })
  })

  it('session_end → system.done event', () => {
    const result = hookToAgentEvent('session_end', {
      sessionId: 'sess-1',
    }) as AgentEvent

    expect(result).toMatchObject({
      type: 'system',
      subtype: 'done',
      result: 'session_end',
      sessionId: 'sess-1',
    })
  })
})
