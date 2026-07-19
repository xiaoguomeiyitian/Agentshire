import { describe, it, expect } from 'vitest'
import { BUILDING_REGISTRY, WAYPOINTS, NPC_CONFIGS, WORK_SUB_STATE_LABELS } from '../types'
import type { GameEvent, GameAction } from './GameProtocol'

describe('BUILDING_REGISTRY data integrity', () => {
  it('contains exactly 8 buildings', () => {
    expect(BUILDING_REGISTRY).toHaveLength(8)
  })

  it('each building has a matching WAYPOINT', () => {
    for (const b of BUILDING_REGISTRY) {
      const wp = WAYPOINTS[b.key]
      expect(wp, `WAYPOINT missing for building ${b.key}`).toBeDefined()
      expect(wp.x).toBeGreaterThan(0)
      expect(wp.z).toBeGreaterThan(0)
    }
  })

  it('building keys are unique', () => {
    const keys = BUILDING_REGISTRY.map(b => b.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('each building has valid stayRange [min < max]', () => {
    for (const b of BUILDING_REGISTRY) {
      expect(b.stayRange[0]).toBeLessThan(b.stayRange[1])
      expect(b.stayRange[0]).toBeGreaterThan(0)
    }
  })

  it('each building has positive capacity', () => {
    for (const b of BUILDING_REGISTRY) {
      expect(b.capacity).toBeGreaterThan(0)
    }
  })

  it('covers all 4 building categories', () => {
    const categories = new Set(BUILDING_REGISTRY.map(b => b.category))
    expect(categories).toContain('residential')
    expect(categories).toContain('commercial')
    expect(categories).toContain('public')
    expect(categories).toContain('workspace')
  })
})

describe('WAYPOINTS data integrity', () => {
  it('contains gathering_point at (24,19) avoiding fountain', () => {
    expect(WAYPOINTS.gathering_point).toBeDefined()
    expect(WAYPOINTS.gathering_point.x).toBe(24)
    expect(WAYPOINTS.gathering_point.z).toBe(19)
  })

  it('gathering_point is far from plaza_fountain', () => {
    const gp = WAYPOINTS.gathering_point
    const pf = WAYPOINTS.plaza_fountain
    const dist = Math.sqrt((gp.x - pf.x) ** 2 + (gp.z - pf.z) ** 2)
    expect(dist).toBeGreaterThan(5)
  })

  it('all critical waypoints exist', () => {
    const required = [
      'road_entrance', 'plaza_center', 'office_door',
      'house_a_door', 'house_b_door', 'house_c_door',
      'market_door', 'cafe_door', 'user_home_door', 'museum_door',
      'gathering_point',
    ]
    for (const key of required) {
      expect(WAYPOINTS[key], `Missing waypoint: ${key}`).toBeDefined()
    }
  })
})

describe('NPC_CONFIGS data integrity', () => {
  it('contains 6 NPCs (1 steward + 4 workers + 1 user)', () => {
    expect(NPC_CONFIGS).toHaveLength(6)
    const roles = NPC_CONFIGS.map(c => c.role)
    expect(roles.filter(r => r === 'steward')).toHaveLength(1)
    expect(roles.filter(r => r === 'worker')).toHaveLength(4)
    expect(roles.filter(r => r === 'user')).toHaveLength(1)
  })

  it('NPC IDs are unique', () => {
    const ids = NPC_CONFIGS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all NPCs have labels', () => {
    for (const c of NPC_CONFIGS) {
      expect(c.label).toBeTruthy()
    }
  })
})

describe('WORK_SUB_STATE_LABELS completeness', () => {
  it('covers all 7 work sub-states', () => {
    const expected: string[] = [
      'summoning', 'assigning', 'going_to_office', 'working',
      'publishing', 'celebrating', 'returning',
    ]
    for (const s of expected) {
      expect(WORK_SUB_STATE_LABELS[s as keyof typeof WORK_SUB_STATE_LABELS]).toBeTruthy()
    }
  })
})

describe('GameProtocol type coverage', () => {
  it('GameEvent type handles all expected event types at compile time', () => {
    const eventTypes: Array<GameEvent['type']> = [
      'npc_spawn', 'npc_despawn', 'npc_phase', 'npc_move_to',
      'npc_daily_behavior_ready', 'npc_emote', 'npc_emoji', 'npc_glow',
      'npc_anim', 'npc_look_at',
      'dialog_message', 'dialog_end',
      'npc_encounter_start', 'npc_encounter_message', 'npc_encounter_end',
      'time_period_changed',
      'npc_building_enter', 'npc_building_leave',
      'mode_change', 'mode_switch',
      'npc_gathered', 'all_npcs_gathered',
      'task_assign_start', 'task_assign_message', 'task_assign_complete',
      'office_transition_start', 'work_status_update', 'work_complete',
      'workstation_assign', 'workstation_screen',
      'celebration_start', 'celebration_end', 'game_completion_popup',
      'scene_switch', 'fx', 'progress', 'world_init', 'camera_move',
      'npc_persona_update', 'setup_complete',
    ]
    expect(eventTypes.length).toBeGreaterThanOrEqual(35)
    const uniqueTypes = new Set(eventTypes)
    expect(uniqueTypes.size).toBe(eventTypes.length)
  })

  it('GameAction type handles all expected action types at compile time', () => {
    const actionTypes: Array<GameAction['type']> = [
      'user_message', 'npc_clicked', 'abort_requested',
      'building_door_clicked', 'return_to_town',
      'npc_encounter_triggered', 'npc_building_status',
      'game_popup_action', 'work_abort_requested',
      'town_setup_complete', 'npc_change_model', 'npc_move_completed',
    ]
    expect(actionTypes.length).toBeGreaterThanOrEqual(12)
    const uniqueTypes = new Set(actionTypes)
    expect(uniqueTypes.size).toBe(actionTypes.length)
  })
})

describe('GameEvent field validation (compile-time type safety)', () => {
  it('npc_encounter_start has required fields', () => {
    const event: GameEvent = {
      type: 'npc_encounter_start',
      initiatorId: 'citizen_1',
      responderId: 'citizen_2',
    }
    expect(event.initiatorId).toBeTruthy()
    expect(event.responderId).toBeTruthy()
  })

  it('npc_encounter_end has reason field', () => {
    const event: GameEvent = {
      type: 'npc_encounter_end',
      initiatorId: 'a',
      responderId: 'b',
      turns: 3,
      reason: 'natural',
    }
    expect(event.reason).toBe('natural')
  })

  it('mode_switch supports both life and work', () => {
    const workEvt: GameEvent = { type: 'mode_switch', mode: 'work', taskDescription: '做游戏' }
    const lifeEvt: GameEvent = { type: 'mode_switch', mode: 'life' }
    expect(workEvt.mode).toBe('work')
    expect(lifeEvt.mode).toBe('life')
  })

  it('work_status_update carries batch updates', () => {
    const event: GameEvent = {
      type: 'work_status_update',
      updates: [
        { npcId: 'citizen_1', phase: 'thinking', message: '正在思考' },
        { npcId: 'citizen_2', phase: 'coding' },
      ],
    }
    expect(event.updates).toHaveLength(2)
  })

  it('game_completion_popup has all required fields', () => {
    const event: GameEvent = {
      type: 'game_completion_popup',
      gameName: '贪吃蛇',
      gameUrl: 'https://example.com',
      developers: ['citizen_1', 'citizen_2'],
      previewImageUrl: 'https://example.com/cover.png',
    }
    expect(event.gameName).toBeTruthy()
    expect(event.developers).toHaveLength(2)
  })

  it('game_popup_action supports play_now and later', () => {
    const action1: GameAction = { type: 'game_popup_action', action: 'play_now', gameUrl: 'https://x.com' }
    const action2: GameAction = { type: 'game_popup_action', action: 'later' }
    expect(action1.action).toBe('play_now')
    expect(action2.action).toBe('later')
  })
})
