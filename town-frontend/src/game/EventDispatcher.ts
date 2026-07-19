// @desc Central GameEvent dispatcher — routes events to handler callbacks with zero business logic
import type { GameEvent, ScreenState } from '../data/GameProtocol'
import type { TownConfig } from '../data/TownConfig'

/** Query types supported by onNpcQuery (plugin tools → frontend → result back). */
export type NpcQuery =
  | { kind: 'self'; npcId: string }
  | { kind: 'nearby'; radius: number; origin?: { x: number; z: number }; callerNpcId?: string }
  | { kind: 'citizen_status'; npcId: string }
  | { kind: 'citizen_memory'; npcId: string; topic?: string }
  | { kind: 'place_occupants'; buildingKey: string }
  | { kind: 'festival_status' }

export interface EventHandlers {
  onNpcSpawn(event: GameEvent & { type: 'npc_spawn' }): void
  onNpcDespawn(npcId: string): void
  onNpcPhase(npcId: string, phase: string): void
  onNpcMoveTo(npcId: string, target: { x: number; y: number; z: number }, speed?: number, requestId?: string): void
  onNpcQuery(requestId: string, query: NpcQuery): void
  onNpcDailyBehaviorReady(npcId: string): void
  onNpcEmote(event: GameEvent & { type: 'npc_emote' }): void
  onNpcEmoji(npcId: string, emoji: string | null): void
  onNpcGlow(npcId: string, color: string): void
  onNpcAnim(npcId: string, anim: string): void
  onNpcLookAt(npcId: string, targetNpcId: string): void
  onNpcWorkDone(npcId: string, status: string, stationId?: string, isTempWorker?: boolean): void
  onDialogMessage(npcId: string, text: string, isStreaming: boolean): void
  onDialogEnd(npcId: string): void
  onWorkstationAssign(npcId: string, stationId: string): void
  onWorkstationScreen(stationId: string, state: ScreenState): void
  onSceneSwitch(target: string): void
  onFx(effect: string, params: Record<string, unknown>): void
  onProgress(current: number, total: number, label?: string): void
  onCameraMove(target?: { x: number; y: number; z: number }, follow?: string, durationMs?: number): void
  onNpcPersonaUpdate(npcId: string, name: string): void
  onSetupComplete(): void
  onModeChange(event: GameEvent & { type: 'mode_change' }): void
  onWorkStatusUpdate(updates: Array<{ npcId: string; phase: string; message?: string }>): void
  onWorkComplete(taskDescription: string, gameUrl?: string): void
  onGameCompletionPopup(gameName: string, gameUrl: string, previewImageUrl?: string): void
  onDeliverableCard(event: GameEvent & { type: 'deliverable_card' }): void
  onNpcActivity(event: GameEvent & { type: 'npc_activity' }): void
  onNpcActivityStatus(npcId: string, success: boolean): void
  onNpcActivityStream(npcId: string, delta: string): void
  onNpcActivityStreamEnd(npcId: string): void
  onNpcActivityTodo(npcId: string, todos: Array<{ id: number; content: string; status: string }>): void
  onNpcActivityRestore(npcId: string, entries: Array<{ kind: string; icon?: string; message?: string; status?: string; todos?: Array<{ id: number; content: string; status: string }> }>): void
  onSkillLearned(slug: string): void
  onModeSwitch(mode: string, taskDescription?: string): void
  onSetSessionId(sessionId: string): void
  onTownConfigReady(config: TownConfig): void
  onNpcChangeModel(npcId: string, characterKey: string, modelUrl?: string, modelTransform?: any, animMapping?: any, animFileUrls?: string[]): void
  onStewardRename(newName: string, characterKey?: string): void
  onSetTime(event: GameEvent & { type: 'set_time' }): void
  onSetWeather(event: GameEvent & { type: 'set_weather' }): void
  onSceneEdit(event: GameEvent & { type: 'scene_edit' }): void
}

export class EventDispatcher {
  constructor(private handlers: EventHandlers) {}

  dispatch(event: GameEvent): void {
    switch (event.type) {
      case 'npc_spawn':
        this.handlers.onNpcSpawn(event)
        break
      case 'npc_despawn':
        this.handlers.onNpcDespawn(event.npcId)
        break
      case 'npc_phase':
        this.handlers.onNpcPhase(event.npcId, event.phase)
        break
      case 'npc_move_to':
        this.handlers.onNpcMoveTo(event.npcId, event.target, event.speed, event.requestId)
        break
      case 'npc_query':
        this.handlers.onNpcQuery(event.requestId, event.query)
        break
      case 'npc_daily_behavior_ready':
        this.handlers.onNpcDailyBehaviorReady(event.npcId)
        break
      case 'npc_emote':
        this.handlers.onNpcEmote(event)
        break
      case 'npc_emoji':
        this.handlers.onNpcEmoji(event.npcId, event.emoji)
        break
      case 'npc_glow':
        this.handlers.onNpcGlow(event.npcId, event.color)
        break
      case 'npc_anim':
        this.handlers.onNpcAnim(event.npcId, event.anim)
        break
      case 'npc_look_at':
        this.handlers.onNpcLookAt(event.npcId, event.targetNpcId)
        break
      case 'npc_work_done':
        this.handlers.onNpcWorkDone(event.npcId, event.status, event.stationId, event.isTempWorker)
        break
      case 'dialog_message':
        this.handlers.onDialogMessage(event.npcId, event.text, event.isStreaming)
        break
      case 'dialog_end':
        this.handlers.onDialogEnd(event.npcId)
        break
      case 'workstation_assign':
        this.handlers.onWorkstationAssign(event.npcId, event.stationId)
        break
      case 'workstation_screen':
        this.handlers.onWorkstationScreen(event.stationId, event.state)
        break
      case 'scene_switch':
        this.handlers.onSceneSwitch(event.target)
        break
      case 'fx':
        this.handlers.onFx(event.effect, event.params)
        break
      case 'progress':
        this.handlers.onProgress(event.current, event.total, event.label)
        break
      case 'world_init':
        break
      case 'camera_move':
        this.handlers.onCameraMove(event.target, event.follow, event.durationMs)
        break
      case 'npc_persona_update':
        this.handlers.onNpcPersonaUpdate(event.npcId, event.name)
        break
      case 'setup_complete':
        this.handlers.onSetupComplete()
        break
      case 'mode_change':
        this.handlers.onModeChange(event)
        break
      case 'time_period_changed':
      case 'npc_encounter_start':
      case 'npc_encounter_message':
      case 'npc_encounter_end':
      case 'npc_building_enter':
      case 'npc_building_leave':
        break
      case 'mode_switch':
        this.handlers.onModeSwitch(event.mode, event.taskDescription)
        break
      case 'npc_gathered':
      case 'all_npcs_gathered':
      case 'task_assign_start':
      case 'task_assign_message':
      case 'task_assign_complete':
      case 'office_transition_start':
        break
      case 'work_status_update':
        this.handlers.onWorkStatusUpdate(event.updates)
        break
      case 'work_complete':
        this.handlers.onWorkComplete(event.taskDescription, event.gameUrl)
        break
      case 'celebration_start':
      case 'celebration_end':
        break
      case 'game_completion_popup':
        this.handlers.onGameCompletionPopup(event.gameName, event.gameUrl, event.previewImageUrl)
        break
      case 'deliverable_card':
        this.handlers.onDeliverableCard(event)
        break
      case 'town_journal_entry':
      case 'town_journal_summary':
        break
      case 'npc_activity':
        this.handlers.onNpcActivity(event)
        break
      case 'npc_activity_status':
        this.handlers.onNpcActivityStatus(event.npcId, event.success)
        break
      case 'npc_activity_stream':
        this.handlers.onNpcActivityStream(event.npcId, event.delta)
        break
      case 'npc_activity_stream_end':
        this.handlers.onNpcActivityStreamEnd(event.npcId)
        break
      case 'npc_activity_todo':
        this.handlers.onNpcActivityTodo(event.npcId, event.todos)
        break
      case 'npc_activity_restore':
        this.handlers.onNpcActivityRestore(event.npcId, event.entries ?? [])
        break
      case 'skill_learned':
        this.handlers.onSkillLearned(event.slug)
        break
      case 'set_session_id':
        this.handlers.onSetSessionId(event.sessionId)
        break
      case 'town_config_ready':
        this.handlers.onTownConfigReady(event.config)
        break
      case 'npc_change_model':
        this.handlers.onNpcChangeModel(event.npcId, event.characterKey, event.modelUrl, event.modelTransform, event.animMapping, event.animFileUrls)
        break
      case 'steward_rename':
        this.handlers.onStewardRename(event.newName, event.characterKey)
        break
      case 'set_time':
        this.handlers.onSetTime(event)
        break
      case 'set_weather':
        this.handlers.onSetWeather(event)
        break
      case 'scene_edit':
        this.handlers.onSceneEdit(event)
        break
      default:
        break
    }
  }
}
