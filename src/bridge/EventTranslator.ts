// @desc Lightweight AgentEvent → GameEvent translator used as fallback by DirectorBridge
import type { AgentEvent } from '../contracts/events.js'
import type { StateTracker } from './StateTracker.js'
import type { GameEvent } from '../../town-frontend/src/data/GameProtocol.js'

export type { GameEvent } from '../../town-frontend/src/data/GameProtocol.js'

const FILE_TOOLS = new Set(['read_file', 'write_file', 'edit_file'])

function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (FILE_TOOLS.has(toolName)) return (input.path ?? input.file) as string | null
  if (toolName === 'bash') {
    const cmd = String(input.command ?? '')
    const m = cmd.match(/(?:cat|head|tail|vi|vim|nano|code)\s+["']?([^\s"']+)/)
    return m ? m[1] : null
  }
  return null
}

/** Translates AgentEvent (from the agent protocol) into GameEvent[] (consumed by the 3D frontend). Used by DirectorBridge as a default/fallback handler for event types it doesn't process directly. */
export class EventTranslator {
  private tracker: StateTracker

  constructor(tracker: StateTracker) {
    this.tracker = tracker
  }

  /** Main entry: switch on event type and return corresponding GameEvents */
  translate(event: AgentEvent, contextNpcId?: string): GameEvent[] {
    switch (event.type) {
      case 'system':
        return this.handleSystem(event)
      case 'sub_agent':
        return this.handleSubAgent(event)
      case 'text_delta':
        return [{ type: 'dialog_message', npcId: contextNpcId ?? this.tracker.stewardNpcId, text: event.delta, isStreaming: true }]
      case 'text':
        return [{ type: 'dialog_message', npcId: contextNpcId ?? this.tracker.stewardNpcId, text: event.content, isStreaming: false }]
      case 'tool_use':
        return this.handleToolUse(event, contextNpcId)
      case 'tool_result':
        return this.handleToolResult(event, contextNpcId)
      case 'thinking_delta':
        return contextNpcId
          ? [{ type: 'npc_phase', npcId: contextNpcId, phase: 'thinking' }]
          : [{ type: 'npc_phase', npcId: this.tracker.stewardNpcId, phase: 'thinking' }]
      case 'turn_end':
        return contextNpcId
          ? [{ type: 'npc_phase', npcId: contextNpcId, phase: 'idle' }, { type: 'workstation_screen', stationId: '', state: { mode: 'off' } }]
          : []
      case 'bus_message': {
        const fromNpc = this.tracker.resolveNpcId(event.from)
        if (fromNpc) return [{ type: 'dialog_message', npcId: fromNpc, text: event.summary, isStreaming: false }]
        return []
      }
      case 'world_control': {
        if (event.target === 'time') {
          return [{ type: 'set_time' as const, action: event.action, hour: event.hour }]
        }
        if (event.target === 'weather') {
          return [{ type: 'set_weather' as const, action: event.action, weather: event.weather }]
        }
        if (event.target === 'scene') {
          const e = event as Extract<AgentEvent, { type: 'world_control'; target: 'scene' }>
          return [{
            type: 'scene_edit' as const,
            action: e.action,
            objectId: (e as any).objectId,
            category: (e as any).category,
            modelKey: (e as any).modelKey,
            modelUrl: (e as any).modelUrl,
            gridX: (e as any).gridX,
            gridZ: (e as any).gridZ,
            rotationY: (e as any).rotationY,
            scale: (e as any).scale,
            flipX: (e as any).flipX,
            flipZ: (e as any).flipZ,
            widthCells: (e as any).widthCells,
            depthCells: (e as any).depthCells,
            fixRotationX: (e as any).fixRotationX,
            fixRotationY: (e as any).fixRotationY,
            fixRotationZ: (e as any).fixRotationZ,
            cells: (e as any).cells,
            newCols: (e as any).newCols,
            newRows: (e as any).newRows,
          }]
        }
        return []
      }
      case 'error':
        return contextNpcId
          ? [{ type: 'npc_phase', npcId: contextNpcId, phase: 'error' }, { type: 'npc_emote', npcId: contextNpcId, emote: 'frustrated' }]
          : []
      default:
        return []
    }
  }

  private handleSystem(event: Extract<AgentEvent, { type: 'system' }>): GameEvent[] {
    if (event.subtype === 'init') {
      console.log('[EventTranslator] handleSystem init, sending world_init (NPCs already spawned by MainScene from town-defaults.json)')
      return [
        { type: 'world_init', config: { townName: '夏尔', stewardName: 'OpenClaw', citizenCount: 5 } },
      ]
    }
    return []
  }

  private handleSubAgent(event: Extract<AgentEvent, { type: 'sub_agent' }>): GameEvent[] {
    const { subtype, agentId } = event

    if (subtype === 'started') {
      const displayName = event.displayName ?? agentId
      const npcId = agentId.replace(/^agent_/, '')
      this.tracker.registerMapping(agentId, npcId)
      const stationId = this.tracker.allocateStation()

      const events: GameEvent[] = [
        { type: 'npc_spawn', npcId, name: displayName, role: 'programming', category: 'citizen', task: event.task },
      ]
      if (stationId) {
        this.tracker.setStationForNpc(npcId, stationId)
        events.push({ type: 'workstation_assign', npcId, stationId })
      }
      return events
    }

    if (subtype === 'done') {
      const npcId = this.tracker.resolveNpcId(agentId)
      if (!npcId) return []
      const status = event.status as string
      const isError = status === 'failed'
      this.tracker.removeMapping(agentId)
      return [
        { type: 'npc_phase', npcId, phase: isError ? 'error' : 'done' },
        { type: 'npc_glow', npcId, color: isError ? 'red' : 'green' },
        { type: 'fx', effect: isError ? 'error_sparks' : 'completion_stars', params: { npcId } },
      ]
    }

    if (subtype === 'progress') {
      const npcId = this.tracker.resolveNpcId(agentId)
      if (!npcId) return []
      return this.translate(event.event, npcId)
    }

    return []
  }

  private handleToolUse(event: Extract<AgentEvent, { type: 'tool_use' }>, contextNpcId?: string): GameEvent[] {
    const npcId = contextNpcId ?? this.tracker.stewardNpcId
    const filePath = extractFilePath(event.name, event.input)
    const events: GameEvent[] = [{ type: 'npc_phase', npcId, phase: 'working' }]
    if (filePath) {
      const fileName = filePath.split('/').pop() ?? filePath
      events.push({ type: 'workstation_screen', stationId: '', state: { mode: 'coding', fileName } })
    }
    return events
  }

  private handleToolResult(event: Extract<AgentEvent, { type: 'tool_result' }>, _contextNpcId?: string): GameEvent[] {
    if (event.meta?.filePath) {
      return [{ type: 'workstation_screen', stationId: '', state: { mode: 'done' } }]
    }
    return []
  }
}
