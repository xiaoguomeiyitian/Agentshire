import type { SceneType, Vec3, GlowColor, GlobalMode, WorkSubState, TimePeriod } from '../types'

// ── NPC classification ──

export type NPCCategory = 'steward' | 'citizen'

export type GameNPCRole = string

export type NPCPhase =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'talking'
  | 'waiting'
  | 'done'
  | 'error'
  | 'sleeping'

// ── Workstation screen ──

export type ScreenState =
  | { mode: 'off' }
  | { mode: 'waiting'; label?: string }
  | { mode: 'thinking' }
  | { mode: 'coding'; fileName: string }
  | { mode: 'done' }
  | { mode: 'error' }

// ── World init config ──

export interface WorldInitConfig {
  townName: string
  stewardName: string
  citizenCount: number
}

// ── GameEvent: everything the game layer consumes ──

export type GameEvent =
  // NPC lifecycle
  | {
      type: 'npc_spawn'
      npcId: string
      name: string
      role: GameNPCRole
      category: NPCCategory
      specialty?: string
      persona?: string
      avatarId?: string
      task?: string
      spawn?: Vec3
      arrivalFanfare?: boolean
      modelUrl?: string
      modelTransform?: { scale: number; rotationX: number; rotationY: number; rotationZ: number; offsetX: number; offsetY: number; offsetZ: number }
      animMapping?: Partial<Record<string, string>>
      animFileUrls?: string[]
    }
  | { type: 'npc_despawn'; npcId: string }

  // NPC state
  | { type: 'npc_phase'; npcId: string; phase: NPCPhase; message?: string }
  | { type: 'npc_move_to'; npcId: string; target: Vec3; speed?: number; requestId?: string }
  // NPC spatial query (plugin tools → frontend → result back via GameAction)
  | { type: 'npc_query'; requestId: string; query: { kind: 'self'; npcId: string } | { kind: 'nearby'; radius: number; origin?: { x: number; z: number }; callerNpcId?: string } }
  | { type: 'npc_daily_behavior_ready'; npcId: string }
  | { type: 'npc_emote'; npcId: string; emote: string }
  | { type: 'npc_emoji'; npcId: string; emoji: string | null }
  | { type: 'npc_glow'; npcId: string; color: GlowColor }
  | { type: 'npc_anim'; npcId: string; anim: string }
  | { type: 'npc_look_at'; npcId: string; targetNpcId: string }
  | { type: 'npc_work_done'; npcId: string; status: 'completed' | 'failed'; stationId?: string; isTempWorker?: boolean }

  // Dialog (player-NPC)
  | { type: 'dialog_message'; npcId: string; text: string; isStreaming: boolean }
  | { type: 'dialog_end'; npcId: string }

  // NPC encounter (NPC-NPC)
  | { type: 'npc_encounter_start'; encounterId?: string; initiatorId: string; responderId: string; location?: string }
  | { type: 'npc_encounter_message'; encounterId?: string; npcId: string; text: string; turnNumber: number; isLast: boolean }
  | { type: 'npc_encounter_end'; encounterId?: string; initiatorId: string; responderId: string; turns: number; reason?: 'natural' | 'timeout' | 'interrupted' | 'system_limit' }

  // Time system
  | { type: 'time_period_changed'; period: TimePeriod; gameTime: string; dayCount: number }

  // World control (time & weather)
  | { type: 'set_time'; action: 'set' | 'pause' | 'resume'; hour?: number }
  | { type: 'set_weather'; action: 'set' | 'reset'; weather?: string }

  // Building occupancy
  | { type: 'npc_building_enter'; npcId: string; buildingKey: string; stayDurationMs: number }
  | { type: 'npc_building_leave'; npcId: string; buildingKey: string; actualStayMs: number }

  // Mode system
  | { type: 'mode_change'; mode: GlobalMode; workSubState?: WorkSubState; summonedNpcIds?: string[]; taskDescription?: string }
  | { type: 'mode_switch'; mode: 'life' | 'work'; taskDescription?: string; workSubState?: WorkSubState }

  // Gathering (topic mode)
  | { type: 'npc_gathered'; npcId: string; stewardId: string }
  | { type: 'all_npcs_gathered'; npcIds: string[] }

  // Task assignment (legacy, kept as no-op events for backward compat)
  | { type: 'task_assign_start'; stewardId: string; npcIds: string[] }
  | { type: 'task_assign_message'; stewardId: string; npcId: string; npcName: string; task: string; index: number; total: number }
  | { type: 'task_assign_complete'; stewardId: string }

  // Office work flow
  | { type: 'office_transition_start'; npcIds: string[]; stewardId: string }
  | { type: 'work_status_update'; updates: Array<{ npcId: string; phase: string; message?: string }> }
  | { type: 'work_complete'; taskDescription: string; gameUrl?: string }

  // Office workstations
  | { type: 'workstation_assign'; npcId: string; stationId: string }
  | { type: 'workstation_screen'; stationId: string; state: ScreenState }

  // Celebration
  | { type: 'celebration_start'; npcIds: string[] }
  | { type: 'celebration_end' }
  | { type: 'game_completion_popup'; gameName: string; gameUrl: string; developers: string[]; previewImageUrl?: string }

  // Scene / FX / progress / world / camera
  | { type: 'scene_switch'; target: SceneType }
  | { type: 'fx'; effect: string; params: Record<string, unknown> }
  | { type: 'progress'; current: number; total: number; label?: string }
  | { type: 'world_init'; config: WorldInitConfig }
  | { type: 'camera_move'; target?: Vec3; follow?: string; durationMs?: number }

  // Town journal
  | { type: 'town_journal_entry'; gameTime: string; eventType: string; actors: string[]; description: string }
  | { type: 'town_journal_summary'; dayCount: number; text: string; eventCount: number }

  // Deliverable card (unified presentation for project outputs and media)
  | { type: 'deliverable_card';
      cardType: 'game' | 'app' | 'website' | 'image' | 'video' | 'audio' | 'file';
      name?: string;
      url?: string;
      filePath?: string;
      mimeType?: string;
      thumbnailData?: string;
      data?: string }

  // NPC activity log (for card panel)
  | { type: 'npc_activity'; npcId: string; icon: string; message: string; time: string }
  | { type: 'npc_activity_stream'; npcId: string; delta: string }
  | { type: 'npc_activity_stream_end'; npcId: string }
  | { type: 'npc_activity_status'; npcId: string; success: boolean }
  | { type: 'npc_activity_todo'; npcId: string; todos: Array<{ id: number; content: string; status: string }> }
  | { type: 'npc_activity_restore'; npcId: string; entries: Array<{ kind: string; icon?: string; message?: string; status?: string; todos?: Array<{ id: number; content: string; status: string }> }> }

  // NPC persona update
  | { type: 'npc_persona_update'; npcId: string; name: string; personaFile: string }
  | { type: 'setup_complete' }

  // Skill learning
  | { type: 'skill_learned'; slug: string }

  // Steward management
  | { type: 'steward_rename'; npcId: string; newName: string; characterKey?: string }

  // Town configuration
  | { type: 'town_config_ready'; config: TownConfig }

  // Work state restoration (legacy, kept for backward compat — no longer emitted)
  // Session management
  | { type: 'set_session_id'; sessionId: string }

  // NPC model change (as GameEvent, mirrored from GameAction)
  | { type: 'npc_change_model'; npcId: string; characterKey: string; modelUrl?: string; modelTransform?: { scale: number; rotationX: number; rotationY: number; rotationZ: number; offsetX: number; offsetY: number; offsetZ: number }; animMapping?: Partial<Record<string, string>>; animFileUrls?: string[] }

  // Scene editing (AI steward tools → world_control → scene_edit)
  | { type: 'scene_edit'; action: 'place' | 'move' | 'transform' | 'delete' | 'set_terrain' | 'expand';
      objectId?: string; category?: string; modelKey?: string; modelUrl?: string;
      gridX?: number; gridZ?: number; rotationY?: number; scale?: number;
      flipX?: boolean; flipZ?: boolean;
      widthCells?: number; depthCells?: number;
      fixRotationX?: number; fixRotationY?: number; fixRotationZ?: number;
      cells?: Array<{ col: number; row: number; type: string }>;
      newCols?: number; newRows?: number }

// ── GameAction: everything the game layer emits ──

export type GameAction =
  // User interaction
  | { type: 'user_message'; targetNpcId: string; text: string }
  | { type: 'npc_clicked'; npcId: string }
  | { type: 'abort_requested' }
  | { type: 'building_door_clicked'; scene: SceneType }
  | { type: 'return_to_town' }

  // NPC encounter (World → Bridge)
  | { type: 'npc_encounter_triggered'; initiatorId: string; responderId: string; location: string }

  // Building occupancy (World → Bridge)
  | { type: 'npc_building_status'; buildings: Record<string, { occupants: string[]; capacity: number }> }

  // Work mode (World → Bridge)
  | { type: 'game_popup_action'; action: 'play_now' | 'later'; gameUrl?: string }
  | { type: 'work_abort_requested' }

  // Town setup
  | { type: 'town_setup_complete' }
  | { type: 'npc_change_model'; npcId: string; characterKey: string }
  | { type: 'npc_move_completed'; npcId: string; requestId?: string; status: 'arrived' | 'interrupted' }
  | { type: 'npc_query_result'; requestId: string; data: unknown }
  | { type: 'workstation_released'; npcId: string; stationId?: string }

  // Animal Mode persistence (World → Plugin via WS)
  | { type: 'animal_memory_event'; npcId: string; entry: { type: 'dialogue'; partnerName: string; summary: string; timestamp: number } | { type: 'activity'; action: string; location: string; detail?: string; timestamp: number } }
  | { type: 'animal_snapshot_save'; npcId: string; snapshot: unknown }
  | { type: 'animal_clock_save'; state: { dayCount: number; gameSeconds: number; savedAt: number } }
  | { type: 'animal_state_load' }
  | { type: 'animal_memory_clear_all' }
  | { type: 'economy_state_save'; state: {
      citizens: Record<string, {
        coins: number
        reputation: number
        savingsGoal: number
        todayWorkReward: number
        frugal: boolean
      }>
      savedAt: number
    } }

  // Context compaction (World → Plugin via WS)
  // Actively trigger /compact for a citizen's chat session at lifecycle
  // moments (sleep, action end, dialog end) to manage context without
  // lowering contextTokens.
  | { type: 'compact_citizen'; npcId: string }

  // Town runtime state persistence (World → Plugin via WS)
  // NPC positions, scene type, topic state, indoor citizens — survives
  // openclaw restart, page refresh, and device switching.
  | { type: 'town_runtime_save'; state: {
      sceneType: string
      mayorPos: { x: number; z: number }
      npcPositions: Record<string, { x: number; z: number }>
      topicNpcIds: string[]
      indoorCitizens: string[]
      savedAt: number
    } }

// Re-export config types used in GameAction
import type { StewardConfig, CitizenConfig, TownConfig } from './TownConfig'
export type { StewardConfig, CitizenConfig }
