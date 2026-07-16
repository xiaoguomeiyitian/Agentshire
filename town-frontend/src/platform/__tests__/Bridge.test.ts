// @desc Tests for PlatformBridge: sendBubble forwards townPeriod/townWeather
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.parent to simulate embedded iframe
let postedMessages: any[] = []
const mockParent = { postMessage: vi.fn((data: any) => postedMessages.push(data)) }

vi.stubGlobal('window', {
  parent: mockParent,
  addEventListener: vi.fn(),
  location: { origin: 'http://localhost' },
})

const { PlatformBridge } = await import('../Bridge')

describe('PlatformBridge', () => {
  beforeEach(() => {
    postedMessages = []
    mockParent.postMessage.mockClear()
  })

  describe('sendBubble', () => {
    it('forwards townPeriod and townWeather in bubble data', () => {
      const bridge = new PlatformBridge()
      bridge.sendBubble({
        npcId: 'c1',
        npcName: '岩',
        text: '你好',
        timestamp: 1000,
        townHour: 14,
        townMinute: 30,
        townPeriod: 'afternoon',
        townWeather: 'rain',
      })

      expect(postedMessages).toHaveLength(1)
      const msg = postedMessages[0]
      expect(msg.type).toBe('town_bubble')
      expect(msg.npcId).toBe('c1')
      expect(msg.townHour).toBe(14)
      expect(msg.townMinute).toBe(30)
      expect(msg.townPeriod).toBe('afternoon')
      expect(msg.townWeather).toBe('rain')
    })

    it('works without townPeriod/townWeather (backward compatible)', () => {
      const bridge = new PlatformBridge()
      bridge.sendBubble({
        npcId: 'c2',
        npcName: '橙子',
        text: '下午好',
        timestamp: 2000,
        townHour: 15,
        townMinute: 0,
      })

      expect(postedMessages).toHaveLength(1)
      const msg = postedMessages[0]
      expect(msg.type).toBe('town_bubble')
      expect(msg.townPeriod).toBeUndefined()
      expect(msg.townWeather).toBeUndefined()
    })
  })

  describe('sendTownStatus', () => {
    it('forwards period and weather in status data', () => {
      const bridge = new PlatformBridge()
      bridge.sendTownStatus({
        hour: 16,
        minute: 0,
        period: 'afternoon',
        dayCount: 1,
        weather: 'cloudy',
        residentCount: 8,
        timestamp: 3000,
      })

      expect(postedMessages).toHaveLength(1)
      const msg = postedMessages[0]
      expect(msg.type).toBe('town_status')
      expect(msg.period).toBe('afternoon')
      expect(msg.weather).toBe('cloudy')
    })
  })
})
