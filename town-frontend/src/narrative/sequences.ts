import type { NarrativeStep } from './NarrativeEngine'

// Act 1: Enter World - user walks from road to plaza
export const ACT_1_ENTER: NarrativeStep[] = [
  { type: 'callback', params: { action: 'start_daily_behavior' } },
  { type: 'camera_move', params: { target: { x: 20, z: 23 } }, durationMs: 500 },
  { type: 'npc_move', params: { id: 'user', target: { x: 20, z: 18 }, speed: 2.5 } },
  { type: 'wait', params: {}, durationMs: 500 },
  { type: 'npc_move', params: { id: 'user', target: { x: 17, z: 18 }, speed: 2.5 } },
  { type: 'camera_move', params: { target: { x: 17, z: 17 }, follow: 'user' } },
]

// Act 2: Steward Greeting
export const ACT_2_GREETING: NarrativeStep[] = [
  { type: 'callback', params: { action: 'stop_daily_behavior' } },
  { type: 'npc_move', params: { id: 'steward', target: { x: 17, z: 15.8 }, speed: 3 } },
  { type: 'wait', params: {}, durationMs: 300 },
  { type: 'npc_state', params: { id: 'steward', action: 'lookAt', target: { x: 17, z: 18 } } },
  { type: 'npc_state', params: { id: 'user', action: 'lookAt', target: { x: 17, z: 15.8 } } },
  { type: 'dialog', params: { from: 'Steward', text: '嗨！欢迎来到小镇！我是这里的管家。想了解谁、想改造哪里，跟我说就行！' }, durationMs: 3000 },
  { type: 'callback', params: { action: 'enable_input' } },
]
