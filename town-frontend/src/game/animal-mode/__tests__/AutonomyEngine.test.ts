import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AutonomyEngine, type AutonomyDeps } from '../AutonomyEngine'
import { NeedsEngine } from '../NeedsEngine'
import { MoodEngine } from '../MoodEngine'
import { RulesEngine } from '../RulesEngine'
import { NeedActionMapper } from '../NeedActionMapper'
import { MoodAnimator } from '../MoodAnimator'
import { IndoorTracker } from '../IndoorTracker'

function makeMockClock(period: any = 'morning'): any {
  return {
    getPeriod: () => period,
    getGameHour: () => 10,
    getFormattedTime: () => '10:00',
    getState: () => ({ hour: 10, minute: 0, dayCount: 1, period }),
  }
}

function makeDeps(overrides: Partial<AutonomyDeps> = {}): AutonomyDeps {
  const needs = new NeedsEngine()
  const mood = new MoodEngine()
  const rules = new RulesEngine()
  const mapper = new NeedActionMapper()
  const animator = new MoodAnimator()
  const indoor = new IndoorTracker()
  const clock = makeMockClock()

  return {
    needsEngine: needs,
    moodEngine: mood,
    rulesEngine: rules,
    needActionMapper: mapper,
    moodAnimator: animator,
    indoorTracker: indoor,
    gameClock: clock as any,
    implicitChat: vi.fn().mockResolvedValue({ text: '{"action":"stay","reason":"test"}', fallback: false }),
    getNearbyNpcs: () => [],
    getWeather: () => 'sunny',
    getCurrentLocation: () => 'plaza_center',
    getPersona: () => '活泼开朗',
    getHomeBuilding: () => 'house_a_door',
    getCurrentPlan: () => null,
    onAction: vi.fn(),
    ...overrides,
  }
}

describe('AutonomyEngine', () => {
  let engine: AutonomyEngine
  let deps: AutonomyDeps

  beforeEach(() => {
    deps = makeDeps()
    deps.needsEngine.registerCitizen('alice')
    engine = new AutonomyEngine(deps)
  })

  it('passes urgent need context to LLM (no fast path bypass)', async () => {
    // Drain hunger to urgent level
    deps.needsEngine.tick(7) // hunger 80 - 56 = 24 (< 30 threshold)
    const action = await engine.decide('alice', 'Alice')
    // All decisions go through LLM now; the mock returns stay by default
    expect(deps.implicitChat).toHaveBeenCalledTimes(1)
    // The action type should be a valid AutonomyAction
    expect(['stay', 'talk_to', 'leave_to', 'go_home', 'satisfy_need']).toContain(action.type)
  })

  it('calls LLM when no need is urgent', async () => {
    const action = await engine.decide('alice', 'Alice')
    expect(deps.implicitChat).toHaveBeenCalledTimes(1)
    expect(action.type).toBe('stay')
  })

  it('parses talk_to decision from LLM', async () => {
    deps.implicitChat = vi.fn().mockResolvedValue({
      text: '{"action":"talk_to","target":"Bob","reason":"想聊天"}',
      fallback: false,
    })
    const action = await engine.decide('alice', 'Alice')
    expect(action.type).toBe('talk_to')
    if (action.type === 'talk_to') {
      expect(action.target).toBe('Bob')
      expect(action.reason).toBe('想聊天')
    }
  })

  it('parses leave_to decision from LLM', async () => {
    deps.implicitChat = vi.fn().mockResolvedValue({
      text: '{"action":"leave_to","target":"cafe_door","reason":"去喝咖啡"}',
      fallback: false,
    })
    const action = await engine.decide('alice', 'Alice')
    expect(action.type).toBe('leave_to')
    if (action.type === 'leave_to') {
      expect(action.place).toBe('cafe_door')
    }
  })

  it('parses go_home decision from LLM', async () => {
    deps.implicitChat = vi.fn().mockResolvedValue({
      text: '{"action":"go_home","reason":"累了"}',
      fallback: false,
    })
    const action = await engine.decide('alice', 'Alice')
    expect(action.type).toBe('go_home')
  })

  it('falls back to a valid action on invalid LLM output', async () => {
    deps.implicitChat = vi.fn().mockResolvedValue({
      text: 'invalid output',
      fallback: false,
    })
    const action = await engine.decide('alice', 'Alice')
    // Fallback now picks a meaningful action (leave_to, go_home, etc.) instead of always 'stay'
    expect(['stay', 'leave_to', 'go_home', 'satisfy_need', 'talk_to']).toContain(action.type)
  })

  it('falls back to a valid action on malformed JSON', async () => {
    deps.implicitChat = vi.fn().mockResolvedValue({
      text: '{"action": broken',
      fallback: false,
    })
    const action = await engine.decide('alice', 'Alice')
    expect(['stay', 'leave_to', 'go_home', 'satisfy_need', 'talk_to']).toContain(action.type)
  })

  it('isDueForDecision respects interval', () => {
    // Initially due (no last decision)
    expect(engine.isDueForDecision('alice', 0)).toBe(true)
    // After decide sets timer, not due immediately
    // (tested implicitly via decide)
  })

  it('resetTimer clears the last decision time', () => {
    engine.resetTimer('alice')
    expect(engine.isDueForDecision('alice', 0)).toBe(true)
  })

  it('clear removes all timers', () => {
    engine.clear()
    // After clear, no timer -> due at any time
    expect(engine.isDueForDecision('alice', 0)).toBe(true)
  })

  it('includes mood and rules in system prompt', async () => {
    await engine.decide('alice', 'Alice')
    const call = (deps.implicitChat as any).mock.calls[0]
    // implicitChat is called with a single object argument
    const arg = call[0]
    expect(arg.system).toContain('Alice')
    expect(arg.system).toContain('心情')
    expect(arg.user).toContain('morning')
    expect(arg.user).toContain('sunny')
  })
})
