/**
 * Unified LLM call layer for implicit NPC behavior.
 * Uses dependency injection for the actual chat function so it works
 * in both Node.js (direct provider) and browser (WS proxy) environments.
 */

export type ImplicitScene =
  | 'daily_plan' | 'tactical_decision' | 'daily_reflection'
  | 'encounter_init' | 'encounter_reply' | 'dialogue_summary'
  | 'town_journal'
  | 'task_assign' | 'work_thought' | 'supervision_comment'
  | 'autonomy_decide' | 'knock_door'

export interface ImplicitChatRequest {
  scene: ImplicitScene
  system: string
  user: string
  /** Override per-scene maxTokens */
  maxTokens?: number
  /** Override default temperature */
  temperature?: number
  /** Extra stop sequences appended to defaults */
  extraStop?: string[]
}

export interface ImplicitChatResult {
  text: string
  latencyMs: number
  tokenUsage?: { input: number; output: number }
  fallback: boolean
}

export interface ImplicitChatFn {
  (req: {
    model: string
    system: string
    user: string
    maxTokens: number
    temperature: number
    stop: string[]
  }): Promise<{
    text: string
    usage?: { input: number; output: number }
  }>
}

const SCENE_MAX_TOKENS: Record<ImplicitScene, number> = {
  daily_plan: 200,
  tactical_decision: 80,
  daily_reflection: 60,
  encounter_init: 80,
  encounter_reply: 80,
  dialogue_summary: 60,
  town_journal: 300,
  task_assign: 100,
  work_thought: 60,
  supervision_comment: 80,
  autonomy_decide: 100,
  knock_door: 60,
}

const DEFAULT_STOP = ['\n\n']

const FALLBACK: Partial<Record<ImplicitScene, string[]>> = {
  encounter_init: ['嗨，好久不见！', '哟，你也在这啊', '今天天气不错呢', '嘿！在干嘛呢？'],
  encounter_reply: ['是呀！', '哈哈对', '嗯嗯', '说得也是', '确实如此'],
  dialogue_summary: ['闲聊了几句'],
  daily_reflection: ['今天过得还不错', '充实的一天', '平淡但安心'],
  daily_plan: [],
  tactical_decision: [],
  autonomy_decide: [],
  knock_door: ['请问有人在家吗？'],
}

function pickFallback(scene: ImplicitScene): string {
  const pool = FALLBACK[scene]
  if (!pool || pool.length === 0) return ''
  return pool[Math.floor(Math.random() * pool.length)]
}

export interface ImplicitChatConfig {
  model: string
  temperature: number
  timeoutMs: number
}

const DEFAULT_CONFIG: ImplicitChatConfig = {
  model: 'qwen-turbo',
  temperature: 0.85,
  timeoutMs: 8000,
}

let _chatFn: ImplicitChatFn | null = null
let _config: ImplicitChatConfig = { ...DEFAULT_CONFIG }

let _totalCalls = 0
let _totalTokensIn = 0
let _totalTokensOut = 0
let _totalLatencyMs = 0
let _fallbackCount = 0

export function setImplicitChatFn(fn: ImplicitChatFn): void {
  _chatFn = fn
}

export function setImplicitChatConfig(config: Partial<ImplicitChatConfig>): void {
  _config = { ..._config, ...config }
}

export function getImplicitChatStats() {
  return {
    totalCalls: _totalCalls,
    totalTokensIn: _totalTokensIn,
    totalTokensOut: _totalTokensOut,
    totalLatencyMs: _totalLatencyMs,
    fallbackCount: _fallbackCount,
    avgLatencyMs: _totalCalls > 0 ? Math.round(_totalLatencyMs / _totalCalls) : 0,
  }
}

export function resetImplicitChatStats(): void {
  _totalCalls = 0
  _totalTokensIn = 0
  _totalTokensOut = 0
  _totalLatencyMs = 0
  _fallbackCount = 0
}

export async function implicitChat(req: ImplicitChatRequest): Promise<ImplicitChatResult> {
  _totalCalls++

  if (!_chatFn) {
    _fallbackCount++
    return {
      text: pickFallback(req.scene),
      latencyMs: 0,
      fallback: true,
    }
  }

  const maxTokens = req.maxTokens ?? SCENE_MAX_TOKENS[req.scene]
  const temperature = req.temperature ?? _config.temperature
  const stop = [...DEFAULT_STOP, ...(req.extraStop ?? [])]

  const start = performance.now()

  try {
    const result = await Promise.race([
      _chatFn({
        model: _config.model,
        system: req.system,
        user: req.user,
        maxTokens,
        temperature,
        stop,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('implicit_chat_timeout')), _config.timeoutMs)
      ),
    ])

    const latencyMs = Math.round(performance.now() - start)
    _totalLatencyMs += latencyMs

    const text = (result.text ?? '').trim()

    if (!text) {
      _fallbackCount++
      return { text: pickFallback(req.scene), latencyMs, fallback: true }
    }

    if (result.usage) {
      _totalTokensIn += result.usage.input
      _totalTokensOut += result.usage.output
    }

    return {
      text,
      latencyMs,
      tokenUsage: result.usage,
      fallback: false,
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    _totalLatencyMs += latencyMs
    _fallbackCount++

    const tag = err instanceof Error && err.message === 'implicit_chat_timeout' ? '[timeout]' : '[error]'
    console.warn(`implicitChat ${tag} scene=${req.scene} ${latencyMs}ms`, err)

    return {
      text: pickFallback(req.scene),
      latencyMs,
      fallback: true,
    }
  }
}
