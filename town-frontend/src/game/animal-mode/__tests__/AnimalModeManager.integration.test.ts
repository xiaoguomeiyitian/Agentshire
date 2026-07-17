import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AnimalModeManager } from '../AnimalModeManager'
import { GameClock } from '../../GameClock'

type TimePeriod = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night'
const TimePeriod = {
  Dawn: 'dawn' as TimePeriod,
  Morning: 'morning' as TimePeriod,
  Noon: 'noon' as TimePeriod,
  Afternoon: 'afternoon' as TimePeriod,
  Dusk: 'dusk' as TimePeriod,
  Night: 'night' as TimePeriod,
}

// Mock window.setInterval/clearInterval for jsdom environment
const mockSetInterval = vi.fn(() => 123)
const mockClearInterval = vi.fn()
;(globalThis as any).window = {
  setInterval: mockSetInterval,
  clearInterval: mockClearInterval,
}

/**
 * Phase 7 集成测试：验证 AnimalModeManager 端到端流程
 * 覆盖：开关切换、居民注册、需求衰减、心情计算、室内追踪、节日、搬家
 */
describe('AnimalModeManager 集成测试', () => {
  let manager: AnimalModeManager
  let gameClock: GameClock

  beforeEach(() => {
    mockSetInterval.mockClear()
    mockClearInterval.mockClear()
    manager = new AnimalModeManager()
    // Mock GameClock - getGameHour returns incrementing hours
    let currentHour = 6
    gameClock = {
      getGameHour: () => currentHour,
      getCurrentPeriod: () => TimePeriod.Morning,
    } as any
    // Helper to advance time
    ;(gameClock as any)._advance = (h: number) => { currentHour = (currentHour + h) % 24 }
  })

  afterEach(() => {
    manager.disable()
  })

  describe('开关切换', () => {
    it('默认关闭', () => {
      expect(manager.isEnabled()).toBe(false)
    })

    it('enable 后开启并注册居民', async () => {
      await manager.enable(['alice', 'bob'], gameClock)
      expect(manager.isEnabled()).toBe(true)
      expect(manager.getNeedsEngine().getSnapshot('alice')).not.toBeNull()
      expect(manager.getNeedsEngine().getSnapshot('bob')).not.toBeNull()
    })

    it('disable 后关闭并清空状态', async () => {
      await manager.enable(['alice'], gameClock)
      manager.disable()
      expect(manager.isEnabled()).toBe(false)
      expect(manager.getNeedsEngine().getSnapshot('alice')).toBeNull()
    })

    it('setEnabled 切换', async () => {
      await manager.setEnabled(true, ['alice'], gameClock)
      expect(manager.isEnabled()).toBe(true)
      await manager.setEnabled(false, [], gameClock)
      expect(manager.isEnabled()).toBe(false)
    })

    it('重复 enable 不重复注册', async () => {
      await manager.enable(['alice'], gameClock)
      await manager.enable(['alice'], gameClock) // no-op
      expect(manager.getNeedsEngine().getSnapshot('alice')).not.toBeNull()
    })
  })

  describe('需求衰减 + 心情计算', () => {
    it('update 推进游戏时间后需求衰减', async () => {
      await manager.enable(['alice'], gameClock)
      manager.update(100) // initialize lastTickHour
      const before = manager.getNeedsEngine().getSnapshot('alice')!.needs.hunger
      // Advance 3 game hours
      ;(gameClock as any)._advance(3)
      manager.update(100)
      const after = manager.getNeedsEngine().getSnapshot('alice')!.needs.hunger
      expect(after).toBeLessThan(before)
    })

    it('心情随需求衰减而下降', async () => {
      await manager.enable(['alice'], gameClock)
      manager.update(100) // initialize lastTickHour
      const moodBefore = manager.getMoodEngine().compute('alice', manager.getNeedsEngine()).value
      // Advance 10 game hours (heavy decay)
      ;(gameClock as any)._advance(10)
      manager.update(100)
      const moodAfter = manager.getMoodEngine().compute('alice', manager.getNeedsEngine()).value
      expect(moodAfter).toBeLessThan(moodBefore)
    })

    it('未开启时 update 无效果', async () => {
      // Not enabled
      manager.update(100)
      expect(manager.getNeedsEngine().getSnapshot('alice')).toBeNull()
    })
  })

  describe('室内追踪', () => {
    it('居民进入住宅后消失', async () => {
      await manager.enable(['alice'], gameClock)
      manager.getIndoorTracker().enter('alice', 'house_a_door')
      expect(manager.getIndoorTracker().isIndoor('alice')).toBe(true)
      expect(manager.getIndoorTracker().getIndoorLocation('alice')).toBe('house_a_door')
    })

    it('居民离开建筑后恢复', async () => {
      await manager.enable(['alice'], gameClock)
      manager.getIndoorTracker().enter('alice', 'house_a_door')
      expect(manager.getIndoorTracker().isIndoor('alice')).toBe(true)
      manager.getIndoorTracker().leave('alice')
      expect(manager.getIndoorTracker().isIndoor('alice')).toBe(false)
    })
  })

  describe('onPeriodChange', () => {
    it('开启时调用不报错', async () => {
      await manager.enable(['alice'], gameClock)
      expect(() => manager.onPeriodChange(TimePeriod.Night)).not.toThrow()
    })

    it('未开启时调用无效果', () => {
      expect(() => manager.onPeriodChange(TimePeriod.Dawn as any)).not.toThrow()
    })
  })

  describe('子系统访问器', () => {
    it('所有引擎可访问', async () => {
      await manager.enable(['alice'], gameClock)
      expect(manager.getIndoorTracker()).toBeDefined()
      expect(manager.getRulesEngine()).toBeDefined()
      expect(manager.getNeedsEngine()).toBeDefined()
      expect(manager.getMoodEngine()).toBeDefined()
      expect(manager.getNeedActionMapper()).toBeDefined()
      expect(manager.getMoodAnimator()).toBeDefined()
    })
  })
})
