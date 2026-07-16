// @desc Central orchestrator: translates AgentEvents into a phased town narrative (idle → summoning → assigning → working → publishing → returning)
import { EventTranslator } from './EventTranslator.js'
import type { GameEvent, NPCPhase } from '../../town-frontend/src/data/GameProtocol.js'
import type { AgentEvent } from '../contracts/events.js'
import { StateTracker } from './StateTracker.js'
import { getCharacterKeyForNpc, pickUnusedCharacterKey } from '../../town-frontend/src/data/CharacterRoster.js'
import { NpcEventQueue } from './NpcEventQueue.js'
import { RouteManager } from './RouteManager.js'
import { toolToVfxEvents, toolEmoji, inferDeliverableCardType, CARD_TYPES } from './ToolVfxMapper.js'
import { ActivityStream } from './ActivityStream.js'
import { CitizenManager } from './CitizenManager.js'

type Phase = 'idle' | 'summoning' | 'assigning' | 'going_to_office' | 'working' | 'publishing' | 'returning'

function isToolSuccess(name: string, output: string): boolean {
  if (['read', 'read_file', 'grep', 'glob'].includes(name)) return true
  if (['write', 'write_file', 'edit', 'edit_file'].includes(name)) return /^Successfully/.test(output)
  const errorPatterns = [
    /^Error:/i, /^node:/, /EADDRINUSE/, /ENOENT/, /EACCES/,
    /throw\s+er;/, /command not found/i, /permission denied/i,
    /^fatal:/i, /^SyntaxError:/, /^TypeError:/, /^ReferenceError:/,
  ]
  return !errorPatterns.some(p => p.test(output))
}

interface AgentInfo {
  agentId: string
  npcId: string
  displayName: string
  task: string
  status: 'pending' | 'working' | 'completed' | 'failed'
  avatarId?: string
}

const OFFICE_DOOR_SPAWN = { x: 15, z: 24 }

const SUMMON_COLLECT_WINDOW = 3000



/** Facade that orchestrates the town's response to agent events. Delegates to RouteManager (pathfinding), ActivityStream (logs), CitizenManager (citizen lifecycle), and ToolVfxMapper (VFX). Manages the phase state machine and sub-agent lifecycle. */
export class DirectorBridge {
  private tracker = new StateTracker()
  private translator = new EventTranslator(this.tracker)
  private phase: Phase = 'idle'
  private agents = new Map<string, AgentInfo>()
  private agentOrder: string[] = []
  private summonTimer: ReturnType<typeof setTimeout> | null = null
  private emitFn: ((events: GameEvent[]) => void) | null = null
  private emitBuffer: GameEvent[][] = []
  private stewardName = 'steward'
  private activeToolCount = 0
  private personaName: string | null = null
  private stewardPersonaConfirmed = true
  private townConfig: any = null
  private personaChangedFn: ((name: string) => void) | null = null
  private npcQueues = new Map<string, NpcEventQueue>()
  private lastToolInput: Record<string, unknown> = {}
  private pendingProjectName = ''
  private pendingProjectType = ''
  private bubbleDebugEnabled = this.readBubbleDebugFlag()
  private systemInitReceived = false
  private workflowSummonEmitted = false
  private npcCharacterAssignments = new Map<string, string>([
    ['user', getCharacterKeyForNpc('user')],
    ['steward', getCharacterKeyForNpc('steward')],
  ])
  private tempWorkerNpcIds = new Set<string>()
  private lastStewardText = ''
  private pendingWorkSnapshot: {
    phase: string
    stewardPersona?: string
    agents: Array<{ id: string; displayName: string; task: string; status: string; activityLog?: Array<{ name: string; input: Record<string, unknown>; output?: string; success?: boolean }> }>
  } | null = null
  private routes = new RouteManager((events) => this.emit(events))
  private activity = new ActivityStream((events) => this.emit(events))
  private citizens = new CitizenManager({
    emit: (events) => this.emit(events),
    routes: this.routes,
    getConfig: () => this.townConfig,
    getCharacterAssignments: () => this.npcCharacterAssignments,
    isStewardConfirmed: () => this.stewardPersonaConfirmed,
    getPersonaName: () => this.personaName,
    getStewardName: () => this.stewardName,
    onPersonaChanged: (name) => this.personaChangedFn?.(name),
    delayMs: (ms) => this.delayMs(ms),
    scheduleDelayedEmit: (delay, events) => this.scheduleDelayedEmit(delay, events),
    getLastToolInput: () => this.lastToolInput,
  })

  private readBubbleDebugFlag(): boolean {
    try {
      const g = globalThis as unknown as { location?: { search?: string }; localStorage?: { getItem?: (key: string) => string | null } }
      const search = typeof g.location?.search === 'string'
        ? new URLSearchParams(g.location.search)
        : null
      if (search?.get('bubbleDebug') === '1') return true
      const local = g.localStorage?.getItem?.('agentshire_bubble_debug')
      return local === '1' || local === 'true'
    } catch {
      return false
    }
  }

  private logBubbleIngress(stage: string, text: string): void {
    if (!this.bubbleDebugEnabled) return
    console.log(`[BubbleDebug][Bridge][${stage}] ${JSON.stringify(text)}`)
  }

  onEmit(fn: (events: GameEvent[]) => void): void {
    this.emitFn = fn
    if (this.emitBuffer.length > 0) {
      const buffered = this.emitBuffer
      this.emitBuffer = []
      for (const events of buffered) {
        fn(events)
      }
    }
  }

  onPersonaChanged(fn: (name: string) => void): void {
    this.personaChangedFn = fn
  }

  setPersonaName(name: string): void {
    this.personaName = name
    this.emit([{ type: 'steward_rename', npcId: 'steward', newName: name }])
  }

  setTownConfig(config: any): boolean {
    this.townConfig = config
    if (config?.steward?.avatarId) {
      this.npcCharacterAssignments.set('steward', config.steward.avatarId)
    }
    if (config?.user?.avatarId) {
      this.npcCharacterAssignments.set('user', config.user.avatarId)
    }
    if (config?.citizens?.length > 0) {
      for (const c of config.citizens) {
        if (c.id && c.avatarId) {
          this.npcCharacterAssignments.set(c.id, c.avatarId)
        }
      }
      this.emit([{ type: 'town_config_ready', config }])
    }
    return !!this.pendingWorkSnapshot
  }

  executePendingRestore(): void {
    if (!this.pendingWorkSnapshot) return
    const snap = this.pendingWorkSnapshot
    this.pendingWorkSnapshot = null
    this.doRestoreWorkState(snap)
  }

  onStewardRenamed(name: string): void {
    this.personaName = name
    this.personaChangedFn?.(name)
  }

  onUserMessage(text: string): void {
    this.emit([{ type: 'dialog_message', npcId: 'user', text, isStreaming: false }])
  }

  private getQueue(npcId: string): NpcEventQueue {
    let q = this.npcQueues.get(npcId)
    if (!q) {
      q = new NpcEventQueue((events) => this.emit(events))
      this.npcQueues.set(npcId, q)
    }
    return q
  }

  /** Handle a GameAction from the frontend (user message, abort, door click, move ack) */
  processWorldAction(action: any): { type: string; message?: string } | null {
    switch (action.type) {
      case 'user_message':
        return { type: 'chat', message: action.text }
      case 'abort_requested':
        return { type: 'abort' }
      case 'steward_renamed':
        this.onStewardRenamed(action.name)
        return null
      case 'town_setup_complete':
        return null
      case 'return_to_town':
        if (this.phase === 'working') {
          this.emit([{ type: 'scene_switch', target: 'town' }])
        }
        return null
      case 'building_door_clicked':
        if (this.phase === 'working' && action.buildingId === 'office') {
          this.emit([{ type: 'scene_switch', target: 'office' }])
        }
        return null
      case 'npc_move_completed':
        this.routes.resolveMoveRequest(String(action.requestId ?? ''), String(action.npcId ?? ''), action.status === 'arrived' ? 'arrived' : 'interrupted')
        return null
      case 'workstation_released': {
        const npcId = String(action.npcId ?? '')
        const stationId = String(action.stationId ?? this.tracker.getStationForNpc(npcId) ?? '')
        if (stationId) {
          this.tracker.releaseStation(stationId)
        }
        if (npcId) {
          this.tracker.removeMappingByNpcId(npcId)
        }
        return null
      }
      case 'workflow_phase_complete': {
        const completedPhase = String(action.phase ?? '')
        console.log(`[DirectorBridge] workflow_phase_complete: ${completedPhase}, current phase: ${this.phase}`)
        if (completedPhase === 'summoning' && this.phase === 'summoning') {
          this.phase = 'assigning'
          this.emit([{ type: 'mode_change', mode: 'work', workSubState: 'assigning' }])
          const agents = this.agentOrder.map(id => this.agents.get(id)!).filter(Boolean)
          this.emit([{
            type: 'workflow_assign',
            agents: agents.map(a => ({ npcId: a.npcId, displayName: a.displayName, task: a.task })),
          } as GameEvent])
        } else if (completedPhase === 'assigning' && this.phase === 'assigning') {
          this.phase = 'going_to_office'
          const agents = this.agentOrder.map(id => this.agents.get(id)!).filter(Boolean)
          this.emit([
            { type: 'mode_change', mode: 'work', workSubState: 'going_to_office' },
            { type: 'workflow_go_office', agents: agents.map(a => ({ npcId: a.npcId })) } as GameEvent,
          ])
        } else if (completedPhase === 'going_to_office' && this.phase === 'going_to_office') {
          this.phase = 'working'
          const doneCount = [...this.agents.values()].filter(a => a.status === 'completed' || a.status === 'failed').length
          const totalCount = this.agents.size
          this.emit([
            { type: 'mode_change', mode: 'work', workSubState: 'working' },
            { type: 'progress', current: doneCount, total: totalCount, label: `${doneCount}/${totalCount} 完成` },
          ])
        } else if (completedPhase === 'publishing' && this.phase === 'publishing') {
          this.phase = 'returning'
          this.emit([{ type: 'mode_change', mode: 'work', workSubState: 'returning' }])
          const retAgents = this.agentOrder.map(id => this.agents.get(id)!).filter(Boolean)
          this.emit([{
            type: 'workflow_return',
            agents: retAgents.map(a => ({ npcId: a.npcId })),
            wasInOffice: true,
          } as GameEvent])
        } else if (completedPhase === 'returning' && this.phase === 'returning') {
          this.phase = 'idle'
          this.activeToolCount = 0
          this.emit([
            { type: 'mode_change', mode: 'life' },
            { type: 'npc_phase', npcId: this.stewardName, phase: 'idle' },
          ])
          this.agents.clear()
          this.agentOrder = []
          this.tracker.clear()
          this.pendingProjectName = ''
          this.pendingProjectType = ''
          if (this.citizens.pendingStewardRenameTimer) {
            clearTimeout(this.citizens.pendingStewardRenameTimer)
            this.citizens.pendingStewardRenameTimer = null
          }
          this.routes.destinationClaimCount.clear()
          this.routes.npcDestinationClaim.clear()
          this.routes.npcLastDestination.clear()
          for (const q of this.npcQueues.values()) q.flush()
          this.npcQueues.clear()
          this.workflowSummonEmitted = false
        }
        return null
      }
      default:
        return null
    }
  }

  getPersonaSyncEvents(): GameEvent[] {
    if (this.personaName) {
      return [{ type: 'steward_rename', npcId: 'steward', newName: this.personaName }]
    }
    return []
  }

  restoreWorkState(snapshot: {
    phase: string
    stewardPersona?: string
    agents: Array<{ id: string; displayName: string; task: string; status: string; activityLog?: Array<{ name: string; input: Record<string, unknown>; output?: string; success?: boolean }> }>
  }): void {
    if (!snapshot.agents?.length) return

    if (!this.townConfig) {
      console.log('[DirectorBridge] restoreWorkState: townConfig not ready, deferring')
      this.pendingWorkSnapshot = snapshot
      return
    }

    this.doRestoreWorkState(snapshot)
  }

  private doRestoreWorkState(snapshot: {
    phase: string
    stewardPersona?: string
    agents: Array<{ id: string; displayName: string; task: string; status: string; activityLog?: Array<{ name: string; input: Record<string, unknown>; output?: string; success?: boolean }> }>
  }): void {
    console.log('[DirectorBridge] doRestoreWorkState: restoring', snapshot.agents.length, 'agents')

    this.agents.clear()
    this.agentOrder = []
    this.tracker.clear()

    if (snapshot.stewardPersona) {
      this.personaName = snapshot.stewardPersona
      this.stewardPersonaConfirmed = true
    }

    const agentInfos: Array<{ npcId: string; displayName: string; task: string; status: string; avatarId: string }> = []

    for (const a of snapshot.agents) {
      const rawName = a.displayName ?? a.id.replace(/^agent_/, '')
      const displayName = rawName.replace(/^agent_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
      let npcId = this.citizens.findCitizenNpcId(displayName) ?? this.citizens.findCitizenNpcId(rawName) ?? a.id.replace(/^agent_/, '')
      if (npcId === 'steward' || npcId === 'user') {
        npcId = `temp_${a.id.replace(/^agent_/, '').slice(0, 8)}_${Date.now().toString(36)}`
      }

      const isTempWorker = !this.citizens.findCitizenNpcId(displayName) && !this.citizens.findCitizenNpcId(rawName)
      if (isTempWorker) this.tempWorkerNpcIds.add(npcId)

      this.tracker.registerMapping(a.id, npcId)
      const resolvedStatus = (a.status === 'completed' || a.status === 'failed') ? a.status : 'working'
      const info: AgentInfo = {
        agentId: a.id,
        npcId,
        displayName,
        task: a.task,
        status: resolvedStatus as AgentInfo['status'],
      }
      this.agents.set(a.id, info)
      this.agentOrder.push(a.id)

      let avatarId: string
      if (isTempWorker) {
        avatarId = pickUnusedCharacterKey(this.npcCharacterAssignments)
      } else {
        const configured = this.townConfig?.citizens?.find((c: any) => c.id === npcId)
        avatarId = configured?.avatarId ?? getCharacterKeyForNpc(npcId)
      }
      this.npcCharacterAssignments.set(npcId, avatarId)
      agentInfos.push({ npcId, displayName, task: a.task, status: resolvedStatus, avatarId })
    }

    this.phase = 'working'

    this.emit([{
      type: 'restore_work_state',
      agents: agentInfos,
    }])

    for (const a of snapshot.agents) {
      const log = a.activityLog
      if (!log || log.length === 0) continue
      const info = this.agents.get(a.id)
      if (!info) continue

      const entries: Array<{ kind: string; icon?: string; message?: string; status?: string }> = []
      for (const entry of log) {
        const icon = this.activity.toolActivityIcon(entry.name)
        const message = this.activity.toolActivityMsg(entry.name, entry.input)
        const status = entry.success === true ? 'success' : entry.success === false ? 'error' : 'none'
        entries.push({ kind: 'activity', icon, message, status })
      }
      if (entries.length > 0) {
        this.emit([{ type: 'npc_activity_restore', npcId: info.npcId, entries }])
      }
    }
  }

  /** Main entry point: dispatch an AgentEvent to the appropriate handler based on type */
  processAgentEvent(event: AgentEvent): void {
    if (event.type !== 'text_delta' && event.type !== 'thinking_delta' && event.type !== 'tool_input_delta') {
      console.log('[DirectorBridge] event:', event.type, 'phase:', this.phase, 'name' in event ? (event as { name?: string }).name ?? '' : '')
    }
    if (event.type !== 'text' && event.type !== 'text_delta') {
      this.lastStewardText = ''
    }
    switch (event.type) {
      case 'sub_agent':
        this.handleSubAgent(event)
        return
      case 'text_delta':
        this.lastStewardText = ''
        this.handleStewardText(event)
        return
      case 'text': {
        const content = (event as { content?: string }).content ?? ''
        if (content && content === this.lastStewardText) return
        this.lastStewardText = content
        this.handleStewardText(event)
        return
      }
      case 'thinking_delta':
        this.activity.appendThinkingDelta(this.stewardName, event.delta ?? '')
        if (this.phase === 'idle' || this.phase === 'working') {
          console.log('[DirectorBridge] → steward thinking')
          this.getQueue(this.stewardName).enqueuePhase([
            { type: 'npc_phase', npcId: this.stewardName, phase: 'thinking' },
          ])
        }
        return
      case 'tool_input_delta':
        if (this.phase === 'idle' || this.phase === 'working') {
          if (this.activeToolCount === 0) {
            this.getQueue(this.stewardName).enqueuePhase([
              { type: 'npc_phase', npcId: this.stewardName, phase: 'thinking' },
            ])
          }
        }
        return
      case 'tool_use':
        console.log('[DirectorBridge] tool_use:', event.name, 'phase:', this.phase, 'toolCount:', this.activeToolCount)
        this.activity.flushThinking(this.stewardName)
        this.lastToolInput = event.input ?? {}
        if (this.activity.isTodoWrite(event.name ?? '')) {
          this.activity.emitTodoActivity(this.stewardName, event.input ?? {})
        } else {
          this.activity.emitActivity(this.stewardName, this.activity.toolActivityIcon(event.name ?? ''), this.activity.toolActivityMsg(event.name ?? '', event.input), false, event.toolUseId)
        }
        if (this.phase === 'idle' || this.phase === 'working') {
          this.activeToolCount++
          const { events: toolEvents, phase: toolPhase } = toolToVfxEvents(event.name ?? '', this.stewardName, event.input)
          this.getQueue(this.stewardName).enqueuePhase([
            { type: 'npc_phase', npcId: this.stewardName, phase: toolPhase as NPCPhase },
            ...toolEvents,
          ])
        }
        return
      case 'tool_result':
        console.log('[DirectorBridge] tool_result:', event.name, 'phase:', this.phase)
        this.activity.emitActivityStatus(this.stewardName, isToolSuccess(event.name ?? '', event.output ?? ''), event.toolUseId)
        void this.citizens.detectPersonaSwitch(event)
        this.citizens.detectCitizenCreated(event)
        if (event.name === 'register_project') {
          if (this.lastToolInput.name) this.pendingProjectName = String(this.lastToolInput.name)
          if (this.lastToolInput.type) this.pendingProjectType = String(this.lastToolInput.type)
        }
        if (event.name === 'project_complete') {
          if (this.phase === 'idle' || this.phase === 'working') {
            this.activeToolCount = Math.max(0, this.activeToolCount - 1)
          }
          this.handleProjectComplete(event)
          return
        }
        if (event.name === 'deliver_output') {
          if (this.phase === 'idle' || this.phase === 'working') {
            this.activeToolCount = Math.max(0, this.activeToolCount - 1)
          }
          this.handleDeliverOutput()
          return
        }
        
        if (this.phase === 'idle' || this.phase === 'working') {
          this.activeToolCount = Math.max(0, this.activeToolCount - 1)
          if (this.activeToolCount === 0) {
            this.getQueue(this.stewardName).enqueuePhase([
              { type: 'npc_phase', npcId: this.stewardName, phase: 'thinking' },
              { type: 'npc_emoji', npcId: this.stewardName, emoji: null },
            ])
          }
        }
        return
      case 'turn_end':
        this.activity.flushThinking(this.stewardName)
        for (const q of this.npcQueues.values()) q.flush()
        this.citizens.flushPendingCitizens()
        if (this.phase === 'summoning') {
          if (this.summonTimer) { clearTimeout(this.summonTimer); this.summonTimer = null }
          this.emitWorkflowSummon()
          return
        }
        if (this.phase === 'idle' || this.phase === 'working') {
          this.activeToolCount = 0
          this.emit([{ type: 'npc_phase', npcId: this.stewardName, phase: 'idle' }])
        }
        return
      case 'llm_call':
        if (event.subtype === 'start') {
          if (this.phase === 'idle' || this.phase === 'working') {
            this.getQueue(this.stewardName).enqueuePhase([
              { type: 'npc_phase', npcId: this.stewardName, phase: 'thinking' },
            ])
          }
        }
        return
      case 'error':
        this.emit([{ type: 'npc_phase', npcId: this.stewardName, phase: 'error' }])
        return
      case 'bus_message':
        if (event.from && event.to) {
          this.emit([
            { type: 'npc_look_at', npcId: event.from, targetNpcId: event.to },
            { type: 'fx', effect: 'connectionBeam', params: { fromNpcId: event.from, toNpcId: event.to } },
          ])
          if (event.summary) {
            this.emit([{ type: 'dialog_message', npcId: event.from, text: event.summary, isStreaming: false }])
          }
        }
        return
      case 'hook_activity':
        if (this.phase !== 'working') {
          this.emit([{ type: 'fx', effect: 'hookFlash', params: { npcId: this.stewardName } }])
        }
        return
      case 'media_output': {
        if (event.role !== 'assistant') return
        if (event.source === 'tts') return
        const kindMap: Record<string, string> = { image: 'image', video: 'video', audio: 'audio', file: 'file' }
        const mediaCardType = kindMap[event.kind] ?? 'file'
        console.log('[DirectorBridge] media_output → deliverable_card:', mediaCardType, event.path)
        this.emit([
          {
            type: 'deliverable_card',
            cardType: mediaCardType,
            name: event.meta?.filename || (typeof event.meta?.originalPath === 'string' ? event.meta.originalPath.split('/').pop() : undefined) || event.path?.split('/').pop(),
            filePath: event.path,
            mimeType: event.mimeType,
            thumbnailData: event.kind === 'image' ? event.data : undefined,
            data: event.data,
          } as GameEvent,
        ])
        return
      }
      case 'system': {
        const sysEvent = event as Extract<AgentEvent, { type: 'system' }>
        if (sysEvent.subtype === 'init') {
          if (this.systemInitReceived) return
          this.systemInitReceived = true
        }
        if (sysEvent.subtype === 'done') {
          this.systemInitReceived = false
        }
        this.emit(this.translator.translate(event))
        return
      }
      default:
        this.emit(this.translator.translate(event))
        return
    }
  }

  processCitizenEvent(npcId: string, event: AgentEvent): void {
    const q = this.getQueue(npcId)
    switch (event.type) {
      case 'thinking_delta':
        this.activity.appendThinkingDelta(npcId, event.delta ?? '')
        q.enqueuePhase([
          { type: 'npc_phase', npcId, phase: 'thinking' as NPCPhase },
        ])
        return
      case 'tool_use':
        this.activity.flushThinking(npcId)
        if (this.activity.isTodoWrite(event.name ?? '')) {
          this.activity.emitTodoActivity(npcId, event.input ?? {})
        } else {
          this.activity.emitActivity(npcId, this.activity.toolActivityIcon(event.name ?? ''), this.activity.toolActivityMsg(event.name ?? '', event.input), false, event.toolUseId)
        }
        q.enqueuePhase([
          { type: 'npc_phase', npcId, phase: 'working' as NPCPhase },
        ])
        return
      case 'tool_result':
        this.activity.emitActivityStatus(npcId, isToolSuccess(event.name ?? '', event.output ?? ''), event.toolUseId)
        q.enqueuePhase([
          { type: 'npc_phase', npcId, phase: 'thinking' as NPCPhase },
        ])
        return
      case 'text_delta': {
        const text = event.delta ?? ''
        if (!text) return
        q.enqueueDialog([
          { type: 'dialog_message', npcId, text, isStreaming: true },
          { type: 'npc_look_at', npcId, targetNpcId: 'user' },
        ], text.length)
        return
      }
      case 'text': {
        const text = (event as { content?: string }).content ?? ''
        if (!text) return
        if (text) {
          this.activity.emitActivity(npcId, 'message-circle', text, true)
        }
        q.enqueueDialog([
          { type: 'dialog_message', npcId, text, isStreaming: false },
          { type: 'npc_look_at', npcId, targetNpcId: 'user' },
        ], text.length)
        return
      }
      case 'media_output': {
        if (event.role !== 'assistant') return
        if (event.source === 'tts') return
        const kindMap: Record<string, string> = { image: 'image', video: 'video', audio: 'audio', file: 'file' }
        const mediaCardType = kindMap[event.kind] ?? 'file'
        this.emit([{
          type: 'deliverable_card',
          cardType: mediaCardType,
          name: event.meta?.filename || (typeof event.meta?.originalPath === 'string' ? event.meta.originalPath.split('/').pop() : undefined) || event.path?.split('/').pop(),
          filePath: event.path,
          mimeType: event.mimeType,
          thumbnailData: event.kind === 'image' ? event.data : undefined,
        } as GameEvent])
        return
      }
      case 'turn_end':
        this.activity.flushThinking(npcId)
        q.flush()
        this.emit([{ type: 'npc_phase', npcId, phase: 'idle' as NPCPhase }])
        return
      case 'error':
        this.emit([{ type: 'npc_phase', npcId, phase: 'error' as NPCPhase }])
        return
    }
  }

  private handleStewardText(event: Extract<AgentEvent, { type: 'text_delta' }> | Extract<AgentEvent, { type: 'text' }>): void {
    const q = this.getQueue(this.stewardName)
    if (event.type === 'text_delta') {
      const text = event.delta ?? ''
      this.logBubbleIngress(`steward:text_delta:${this.stewardName}`, text)
      q.enqueueDialog(
        [
          { type: 'dialog_message', npcId: this.stewardName, text, isStreaming: true },
          { type: 'npc_look_at', npcId: this.stewardName, targetNpcId: 'user' },
        ],
        text.length,
      )
    } else if (event.type === 'text') {
      const text = event.content ?? ''
      this.logBubbleIngress(`steward:text:${this.stewardName}`, text)
      if (text) {
        this.activity.emitActivity(this.stewardName, 'message-circle', text, true)
      }
      q.enqueueDialog(
        [
          { type: 'dialog_message', npcId: this.stewardName, text, isStreaming: false },
          { type: 'npc_look_at', npcId: this.stewardName, targetNpcId: 'user' },
        ],
        text.length,
      )
    }
  }

  /** Handle sub_agent started/progress/done events: spawn NPCs, relay tool/text events, track completion */
  private handleSubAgent(event: Extract<AgentEvent, { type: 'sub_agent' }>): void {
    const { subtype, agentId } = event

    if (subtype === 'started') {
      const rawName = event.displayName ?? agentId.replace(/^agent_/, '')
      let displayName = rawName.replace(/^agent_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
      const fallbackNpcId = agentId.replace(/^agent_/, '')
      const task = event.task ?? ''
      const extra = event as Extract<AgentEvent, { type: 'sub_agent'; subtype: 'started' }> & { avatarId?: string; metadata?: { avatarId?: string } }
      const avatarId = extra.avatarId ?? extra.metadata?.avatarId ?? undefined

      let citizenNpcId = this.citizens.findCitizenNpcId(displayName) ?? this.citizens.findCitizenNpcId(rawName)

      if (!citizenNpcId) {
        citizenNpcId = this.citizens.fuzzyMatchCitizen(displayName) ?? this.citizens.fuzzyMatchCitizen(rawName)
      }

      if (!citizenNpcId && this.citizens.looksLikeIdFragment(displayName)) {
        displayName = `临时工 ${this.agents.size + 1}`
      }

      const PROTECTED_IDS = new Set(['steward', 'user'])
      let npcId = citizenNpcId ?? fallbackNpcId
      if (PROTECTED_IDS.has(npcId)) {
        npcId = `temp_${agentId.replace(/^agent_/, '').slice(0, 8)}_${Date.now().toString(36)}`
      }
      const isTempWorker = !citizenNpcId

      if (isTempWorker) {
        this.tempWorkerNpcIds.add(npcId)
        if (!displayName || this.citizens.looksLikeIdFragment(rawName)) {
          displayName = `临时工 ${this.tempWorkerNpcIds.size}`
        }
      }

      this.tracker.registerMapping(agentId, npcId)
      const info: AgentInfo = { agentId, npcId, displayName, task, status: 'pending', avatarId }
      this.agents.set(agentId, info)
      this.agentOrder.push(agentId)

      if (this.phase === 'idle') {
        this.phase = 'summoning'
        this.emit([
          { type: 'npc_phase', npcId: this.stewardName, phase: 'idle' },
          { type: 'npc_emoji', npcId: this.stewardName, emoji: null },
          { type: 'mode_change', mode: 'work', workSubState: 'summoning' },
          { type: 'dialog_message', npcId: this.stewardName, text: '好，我来召唤团队！', isStreaming: false },
        ])
        const RIPPLE_COUNT = 5
        const RIPPLE_INTERVAL = 350
        for (let i = 0; i < RIPPLE_COUNT; i++) {
          this.scheduleDelayedEmit(800 + i * RIPPLE_INTERVAL, [
            { type: 'fx', effect: 'summon_ripple', params: { npcId: this.stewardName } },
          ])
        }
      }

      this.emitArrival(
        info,
        this.phase === 'working' ? OFFICE_DOOR_SPAWN : undefined,
      )

      if (this.phase === 'working') {
        this.assignLateArrival(info)
        const doneCount = [...this.agents.values()].filter(a => a.status === 'completed' || a.status === 'failed').length
        const totalCount = this.agents.size
        this.emit([
          { type: 'progress', current: doneCount, total: totalCount, label: `${doneCount}/${totalCount} 完成` },
        ])
        return
      }

      if (this.phase === 'going_to_office' || this.phase === 'assigning') {
        return
      }

      if (this.workflowSummonEmitted) return

      if (this.summonTimer) clearTimeout(this.summonTimer)
      this.summonTimer = setTimeout(() => {
        this.summonTimer = null
        if (this.phase === 'summoning') {
          this.emitWorkflowSummon()
        }
      }, SUMMON_COLLECT_WINDOW)
      return
    }

    if (subtype === 'progress') {
      const info = this.agents.get(agentId)
      if (!info) return
      const npcId = info.npcId
      const inner = event.event
      if (!inner) return
      const q = this.getQueue(npcId)
      const inWorkPhase = this.phase === 'working' || this.phase === 'going_to_office'
      const canDriveNpcWorkingState = this.phase === 'working'

      switch (inner.type) {
        case 'thinking_delta':
          if (inWorkPhase) {
            this.activity.appendThinkingDelta(npcId, inner.delta ?? '')
            q.enqueuePhase([
              { type: 'npc_phase', npcId, phase: 'thinking' },
              { type: 'npc_emoji', npcId, emoji: '💭' },
            ])
          }
          break
        case 'tool_use': {
          this.activity.flushThinking(npcId)
            const isThinking = inner.name === '__thinking__' || inner.name === '__thinking_placeholder__'
          if (this.activity.isTodoWrite(inner.name)) {
            this.activity.emitTodoActivity(npcId, inner.input ?? {})
          } else {
            this.activity.emitActivity(npcId, this.activity.toolActivityIcon(inner.name), this.activity.toolActivityMsg(inner.name, inner.input ?? {}), isThinking, inner.toolUseId)
          }
          if (!isThinking && canDriveNpcWorkingState) {
            const toolEmojiStr = toolEmoji(inner.name)
            q.enqueuePhase([
              { type: 'npc_phase', npcId, phase: 'working' },
              { type: 'npc_emoji', npcId, emoji: toolEmojiStr },
            ])
          }
          break
        }
        case 'tool_result': {
          const isThinkingResult = inner.name === '__thinking__'
          if (!isThinkingResult) {
            this.activity.emitActivityStatus(npcId, isToolSuccess(inner.name ?? '', inner.output ?? ''), inner.toolUseId)
          }
          if (inWorkPhase) {
            q.enqueuePhase([{ type: 'npc_emoji', npcId, emoji: null }])
          }
          break
        }
        case 'text_delta': {
          const text = inner.delta ?? ''
          this.logBubbleIngress(`subagent:text_delta:${npcId}`, text)
          if (inWorkPhase) {
            q.enqueueDialog(
              [{ type: 'dialog_message', npcId, text, isStreaming: true }],
              text.length,
            )
          }
          break
        }
        case 'text': {
          const text = inner.content ?? ''
          this.logBubbleIngress(`subagent:text:${npcId}`, text)
          if (text) {
            this.activity.emitActivity(npcId, 'message-circle', text, true)
          }
          if (inWorkPhase) {
            q.enqueueDialog(
              [{ type: 'dialog_message', npcId, text, isStreaming: false }],
              text.length,
            )
          }
          break
        }
        case 'turn_end':
          this.activity.flushThinking(npcId)
          q.flush()
          this.emit([
              { type: 'npc_phase', npcId, phase: 'idle' },
              { type: 'npc_emoji', npcId, emoji: null },
            ])
            break
          case 'error': {
            this.activity.flushThinking(npcId)
            this.activity.emitActivity(npcId, 'alert-circle', '出错')
            q.flush()
            const errStation = this.tracker.getAllNpcStates().find(s => s.npcId === npcId)?.stationId
            this.emit([
              { type: 'npc_phase', npcId, phase: 'error' },
              { type: 'npc_emoji', npcId, emoji: '❌' },
              { type: 'npc_emote', npcId, emote: 'frustrated' },
              ...(errStation ? [{ type: 'workstation_screen', stationId: errStation, state: { mode: 'error' } } as GameEvent] : []),
            ])
            break
        }
      }
      return
    }

    if (subtype === 'done') {
      const info = this.agents.get(agentId)
      if (!info) return
      const npcId = info.npcId
      const isError = event.status === 'failed'

      info.status = isError ? 'failed' : 'completed'
      const station = this.tracker.getAllNpcStates().find(s => s.npcId === npcId)?.stationId
      const isTempWorker = this.tempWorkerNpcIds.has(npcId)

      this.emit([{
        type: 'npc_work_done' as const,
        npcId,
        status: (isError ? 'failed' : 'completed') as 'completed' | 'failed',
        stationId: station,
        isTempWorker,
      } as GameEvent])

      if (isTempWorker) {
        this.tempWorkerNpcIds.delete(npcId)
      }

      const doneCount = [...this.agents.values()].filter(a => a.status === 'completed' || a.status === 'failed').length
      const totalCount = this.agents.size
      this.emit([
        { type: 'progress', current: doneCount, total: totalCount, label: `${doneCount}/${totalCount} 完成` },
      ])

      if (this.allAgentsDone()) {
        console.log('[DirectorBridge] all agents done — waiting for steward to call project_complete')
      }
      return
    }
  }

  private emitArrival(info: AgentInfo, spawn?: { x: number; z: number }): void {
    let safeAvatarId: string
    if (typeof info.avatarId === 'string' && info.avatarId.trim()) {
      safeAvatarId = info.avatarId.trim()
    } else if (this.tempWorkerNpcIds.has(info.npcId)) {
      safeAvatarId = pickUnusedCharacterKey(this.npcCharacterAssignments)
    } else {
      const configured = this.townConfig?.citizens?.find((c: any) => c.id === info.npcId)
      safeAvatarId = configured?.avatarId ?? getCharacterKeyForNpc(info.npcId)
    }
    this.npcCharacterAssignments.set(info.npcId, safeAvatarId)

    const spawnVec = spawn ? { x: spawn.x, y: 0, z: spawn.z } : undefined
    this.emit([
      { type: 'npc_spawn', npcId: info.npcId, name: info.displayName, role: 'programming', category: 'citizen', task: info.task, avatarId: safeAvatarId, spawn: spawnVec, arrivalFanfare: true },
    ])
  }

  private emitWorkflowSummon(): void {
    if (this.workflowSummonEmitted) return
    this.workflowSummonEmitted = true
    const agents = this.agentOrder.map(id => this.agents.get(id)!).filter(Boolean)
    this.emit([{
      type: 'workflow_summon',
      agents: agents.map(a => ({ npcId: a.npcId, displayName: a.displayName, task: a.task })),
    } as GameEvent])
  }

  private assignLateArrival(info: AgentInfo): void {
    info.status = 'working'
    this.emit([
      { type: 'workstation_assign', npcId: info.npcId, stationId: '' },
    ])
  }

  private allAgentsDone(): boolean {
    if (this.agents.size === 0) return false
    for (const info of this.agents.values()) {
      if (info.status !== 'completed' && info.status !== 'failed') return false
    }
    return true
  }

  private handleProjectComplete(event: Extract<AgentEvent, { type: 'tool_result' }>): void {
    const output = String(event?.output ?? '')
    if (/^error:/i.test(output.trim())) {
      console.warn('[DirectorBridge] project_complete rejected by tool:', output)
      return
    }

    const input = this.lastToolInput ?? {}
    const deliverableType = String(input.type ?? 'operation')
    const summary = String(input.summary ?? '')
    const url = input.url ? String(input.url) : undefined
    const name = input.name ? String(input.name) : this.pendingProjectName || ''
    const files = Array.isArray(input.files)
      ? input.files.map((file: unknown) => String(file ?? '').trim()).filter(Boolean)
      : []
    let cardType = CARD_TYPES[deliverableType] ?? null
    if (!cardType && this.pendingProjectType) {
      cardType = CARD_TYPES[this.pendingProjectType] ?? null
    }
    const enriched = Array.isArray(input._enrichedFiles) ? input._enrichedFiles as Array<{ path: string; fileName: string; mediaType: string; mimeType: string; data?: string; thumbnailData?: string; httpUrl?: string }> : []
    const deliverableCards: GameEvent[] = []
    if (cardType && files.length > 0) {
      const entryFile = files[0]
      const match = enriched.find((e: any) => e.path === entryFile)
      const entryUrl = match?.httpUrl || url || entryFile
      deliverableCards.push({
        type: 'deliverable_card',
        cardType: cardType as 'game' | 'app' | 'website',
        name: name || undefined,
        url: entryUrl,
      } as GameEvent)
    } else if (cardType && url) {
      deliverableCards.push({
        type: 'deliverable_card',
        cardType: cardType as 'game' | 'app' | 'website',
        name: name || undefined,
        url,
      } as GameEvent)
    } else if (deliverableType === 'files' || deliverableType === 'media') {
      for (const filePath of files) {
        const match = enriched.find((e: any) => e.path === filePath)
        if (match && (match.data || match.httpUrl)) {
          deliverableCards.push({
            type: 'deliverable_card',
            cardType: match.mediaType as any,
            name: match.fileName,
            url: match.httpUrl,
            filePath,
            mimeType: match.mimeType,
            data: match.data,
            thumbnailData: match.thumbnailData,
            httpUrl: match.httpUrl,
          } as GameEvent)
        } else {
          deliverableCards.push({
            type: 'deliverable_card',
            cardType: inferDeliverableCardType(filePath),
            name: filePath.split('/').pop() ?? filePath,
            filePath,
          } as GameEvent)
        }
      }
    }

    console.log(
      '[DirectorBridge] project_complete:',
      deliverableType,
      'pendingType:',
      this.pendingProjectType,
      'name:',
      name,
      'cards:',
      deliverableCards.length,
      'phase:',
      this.phase,
    )
    if (this.phase === 'publishing' || this.phase === 'returning') {
      if (deliverableCards.length > 0) {
        this.emit(deliverableCards)
      }
      return
    }

    const wasInOffice = this.phase === 'working'
    this.phase = 'publishing'
    if (wasInOffice) {
      this.emit([{ type: 'mode_change', mode: 'work', workSubState: 'publishing' }])
    }
    const agents = this.agentOrder.map(id => this.agents.get(id)!).filter(Boolean)
    this.emit([{
      type: 'workflow_publish',
      summary: summary || '任务完成了！',
      deliverableCards: deliverableCards as unknown[],
      agents: agents.map(a => ({ npcId: a.npcId, displayName: a.displayName, status: a.status })),
    } as GameEvent])
  }

  private handleDeliverOutput(): void {
    const input = this.lastToolInput ?? {}
    const deliverableType = String(input.type ?? 'operation')
    const url = input.url ? String(input.url) : undefined
    const name = input.name ? String(input.name) : ''
    const files = Array.isArray(input.files)
      ? input.files.map((file: unknown) => String(file ?? '').trim()).filter(Boolean)
      : []
    let cardType = CARD_TYPES[deliverableType] ?? null
    if (!cardType && this.pendingProjectType) {
      cardType = CARD_TYPES[this.pendingProjectType] ?? null
    }

    const cards: GameEvent[] = []
    if (cardType && url) {
      cards.push({ type: 'deliverable_card', cardType: cardType as any, name: name || undefined, url } as GameEvent)
    } else if (deliverableType === 'files' || deliverableType === 'media') {
      for (const filePath of files) {
        cards.push({ type: 'deliverable_card', cardType: inferDeliverableCardType(filePath), name: filePath.split('/').pop() ?? filePath, filePath } as GameEvent)
      }
    }

    console.log('[DirectorBridge] deliver_output: cards:', cards.length)
    if (cards.length > 0) this.emit(cards)
  }

  private emit(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'npc_spawn') {
        const npcId = event.npcId
        if (npcId) {
          this.npcCharacterAssignments.set(
            npcId,
            getCharacterKeyForNpc(npcId, typeof event.avatarId === 'string' ? event.avatarId : undefined),
          )
        }
      } else if (event.type === 'steward_rename' && typeof event.characterKey === 'string') {
        this.npcCharacterAssignments.set('steward', event.characterKey)
      } else if (event.type === 'npc_despawn') {
        this.npcCharacterAssignments.delete(event.npcId)
      }
    }
    if (events.length > 0) {
      if (this.emitFn) {
        this.emitFn(events)
      } else {
        this.emitBuffer.push(events)
      }
    }
  }

  private scheduleDelayedEmit(delayMs: number, events: GameEvent[]): void {
    setTimeout(() => this.emit(events), delayMs)
  }

  private delayMs(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  getActivityReplayEvents(): any[] {
    return this.activity.getActivityReplayEvents()
  }
}