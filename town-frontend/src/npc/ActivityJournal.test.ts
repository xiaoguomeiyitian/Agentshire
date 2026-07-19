import { describe, it, expect, beforeEach } from 'vitest'
import { ActivityJournal } from './ActivityJournal'
import { GameClock } from '../game/GameClock'

describe('ActivityJournal', () => {
  let clock: GameClock
  let journal: ActivityJournal

  beforeEach(() => {
    clock = new GameClock({ startHour: 10 })
    journal = new ActivityJournal('citizen_1', '小策', clock)
  })

  it('records activity entries', () => {
    journal.record({
      location: 'cafe_door',
      locationName: '咖啡店',
      action: 'arrived',
      detail: '到达咖啡店',
    })
    const entries = journal.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('arrived')
    expect(entries[0].location).toBe('cafe_door')
    expect(entries[0].time).toMatch(/^\d{2}:\d{2}$/)
    expect(entries[0].timestamp).toBeGreaterThan(0)
  })

  it('enforces MAX_ENTRIES=20 limit', () => {
    for (let i = 0; i < 25; i++) {
      journal.record({
        location: `loc_${i}`,
        locationName: `地点${i}`,
        action: 'staying',
      })
    }
    expect(journal.getEntries()).toHaveLength(20)
    expect(journal.getEntries()[0].location).toBe('loc_5')
  })

  it('records dialogue entries', () => {
    journal.recordDialogue({
      timestamp: Date.now(),
      partnerNpcId: 'citizen_2',
      partnerName: '小画',
      location: 'town',
      turns: [
        { speaker: '小策', text: '你好！' },
        { speaker: '小画', text: '嗨！' },
      ],
      summary: '闲聊了几句',
    })
    expect(journal.getDialogues()).toHaveLength(1)
    expect(journal.getDialogues()[0].partnerName).toBe('小画')
  })

  it('enforces MAX_DIALOGUES=5 limit', () => {
    for (let i = 0; i < 7; i++) {
      journal.recordDialogue({
        timestamp: Date.now(),
        partnerNpcId: `npc_${i}`,
        partnerName: `NPC${i}`,
        location: 'town',
        turns: [],
        summary: `对话${i}`,
      })
    }
    expect(journal.getDialogues()).toHaveLength(5)
    expect(journal.getDialogues()[0].summary).toBe('对话2')
  })

  it('toContextJSON generates valid context', () => {
    journal.record({ location: 'market_door', locationName: '市场', action: 'arrived' })
    journal.recordDialogue({
      timestamp: Date.now(),
      partnerNpcId: 'citizen_2',
      partnerName: '小画',
      location: 'town',
      turns: [{ speaker: '小策', text: '最近怎样' }],
      summary: '打了个招呼',
    })

    const ctx = journal.toContextJSON({
      currentLocation: 'cafe_door',
      currentLocationName: '咖啡店',
      encounteredNpc: { name: '阿码' },
    }) as any

    expect(ctx.current_time).toMatch(/^\d{2}:\d{2}$/)
    expect(ctx.current_period).toBe('morning')
    expect(ctx.current_location).toBe('cafe_door')
    expect(ctx.encountered_npc.name).toBe('阿码')
    expect(ctx.my_recent_activities).toBeInstanceOf(Array)
    expect(ctx.my_recent_dialogues).toBeInstanceOf(Array)
  })

  it('getRecentActivities de-duplicates consecutive staying at same location', () => {
    for (let i = 0; i < 5; i++) {
      journal.record({ location: 'cafe_door', locationName: '咖啡店', action: 'staying' })
    }
    journal.record({ location: 'market_door', locationName: '市场', action: 'staying' })
    const recent = journal.getRecentActivities(5)
    const cafes = recent.filter(e => e.location === '咖啡店' && e.action === 'staying')
    expect(cafes.length).toBeLessThanOrEqual(1)
  })

  it('getRecentActivities prioritizes chatted entries', () => {
    journal.record({ location: 'town', locationName: '小镇', action: 'arrived' })
    journal.record({ location: 'town', locationName: '小镇', action: 'chatted', detail: '和小画聊天' })
    journal.record({ location: 'cafe_door', locationName: '咖啡店', action: 'staying' })
    const recent = journal.getRecentActivities(3)
    const chatIdx = recent.findIndex(e => e.action === 'chatted')
    expect(chatIdx).toBeLessThanOrEqual(1) // chatted should appear near the top
  })

  it('clear removes all entries', () => {
    journal.record({ location: 'town', locationName: '小镇', action: 'arrived' })
    journal.recordDialogue({
      timestamp: Date.now(), partnerNpcId: 'x', partnerName: 'X',
      location: 'town', turns: [], summary: '',
    })
    journal.clear()
    expect(journal.getEntries()).toHaveLength(0)
    expect(journal.getDialogues()).toHaveLength(0)
  })

  it('supports work-mode activity actions', () => {
    const workActions = ['summoned', 'assigned_task', 'started_working', 'completed_task', 'celebrating', 'returned_from_work'] as const
    for (const action of workActions) {
      journal.record({ location: 'office_door', locationName: '工坊', action })
    }
    expect(journal.getEntries()).toHaveLength(6)
    expect(journal.getEntries().map(e => e.action)).toEqual(workActions)
  })
})
