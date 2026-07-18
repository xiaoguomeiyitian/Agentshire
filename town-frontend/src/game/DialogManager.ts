// @desc Dialog streaming, flush, and NPC activity log management
import { getAudioSystem } from '../audio/AudioSystem'
import { type ChatBubbleSystem, getBubbleDurationMs } from '../ui/ChatBubble'
import type { UIManager } from '../ui/UIManager'
import type { NPCManager } from '../npc/NPCManager'
import { t } from '../i18n'

export interface DialogManagerDeps {
  bubbles: ChatBubbleSystem
  ui: UIManager
  npcManager: NPCManager
  logBubble?: (stage: string, text: string) => void
}

export class DialogManager {
  private streamBuffers = new Map<string, string>()
  private streamBubbleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Issue 1: track recently flushed streams to prevent duplicate final messages.
  // When the 5s timeout fires before the final `text` event, the buffer is flushed
  // (adding a chat message). The later `text` event would then add a duplicate.
  // We record the flushed text + timestamp so the final event can deduplicate.
  private recentlyFlushed = new Map<string, { text: string; ts: number }>()
  private workLogs = new Map<string, Array<{ type: 'activity' | 'thinking'; icon: string; message: string; time?: string; status?: boolean | null }>>()

  private bubbles: ChatBubbleSystem
  private ui: UIManager
  private npcManager: NPCManager
  private logBubble: (stage: string, text: string) => void

  constructor(deps: DialogManagerDeps) {
    this.bubbles = deps.bubbles
    this.ui = deps.ui
    this.npcManager = deps.npcManager
    this.logBubble = deps.logBubble ?? (() => {})
  }

  getWorkLogs(): Map<string, Array<{ type: 'activity' | 'thinking'; icon: string; message: string; time?: string; status?: boolean | null }>> {
    return this.workLogs
  }

  onDialogMessage(npcId: string, text: string, isStreaming: boolean): void {
    const npc = this.npcManager.get(npcId)
    getAudioSystem().play('chat_pop')
    this.logBubble(isStreaming ? `dialog_stream:${npcId}` : `dialog_once:${npcId}`, text)

    if (isStreaming) {
      const prev = this.streamBuffers.get(npcId) ?? ''
      const accumulated = prev + text
      this.streamBuffers.set(npcId, accumulated)

      if (npc) this.bubbles.streamUpdate(npc.mesh, accumulated)

      const existing = this.streamBubbleTimers.get(npcId)
      if (existing) clearTimeout(existing)
      this.streamBubbleTimers.set(npcId, setTimeout(() => this.flushStream(npcId), 5000))
    } else {
      // Deduplicate against the 5s stream-timeout flush: if the final `text`
      // event arrives after the timer already flushed the same content, skip it.
      const recent = this.recentlyFlushed.get(npcId)
      const isDup = recent && recent.text === text && (Date.now() - recent.ts) < 15_000
      if (isDup) return

      const hadStream = this.streamBuffers.has(npcId)
      if (hadStream) {
        // Stream already displayed the bubble incrementally; just finalize
        // (end stream + add chat message). No need to show a second bubble.
        this.flushStream(npcId)
      } else {
        // Pure non-streaming message (no preceding text_delta): show bubble.
        if (npc) this.bubbles.show(npc.mesh, text, getBubbleDurationMs(text, 'npc'))
        const displayName = npc?.label ?? npcId
        this.ui.addChatMessage({ from: displayName, text, timestamp: Date.now() })
      }
    }
  }

  onDialogEnd(npcId: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      this.bubbles.endStream(npc.mesh)
      this.flushStream(npcId)
    }
  }

  flushStream(npcId: string): void {
    const text = this.streamBuffers.get(npcId)
    if (text) {
      const npc = this.npcManager.get(npcId)
      if (npc) this.bubbles.endStream(npc.mesh)
      const displayName = npc?.label ?? npcId
      this.ui.addChatMessage({ from: displayName, text, timestamp: Date.now() })
      // Issue 1: record the flushed text so the final `text` event can deduplicate
      this.recentlyFlushed.set(npcId, { text, ts: Date.now() })
      this.streamBuffers.delete(npcId)
    }
    this.streamBubbleTimers.delete(npcId)
  }

  onNpcActivity(event: { npcId: string; icon: string; message: string; time?: string; status?: boolean | null }): void {
    const thinkingText = t('card.thinking')
    const isPlaceholder = event.message === thinkingText
    const logs = this.workLogs.get(event.npcId) ?? []
    if (!isPlaceholder) {
      const lastIdx = logs.length - 1
      if (lastIdx >= 0 && logs[lastIdx].message === thinkingText) {
        logs.pop()
      }
    }
    const entryType = event.icon === 'brain' ? 'thinking' as const : 'activity' as const
    const noStatus = entryType === 'thinking' || event.icon === 'message-circle' || event.icon === 'alert-circle' || event.icon === 'sparkles'
    const status: boolean | null | undefined = noStatus ? null : (event as any).status

    if (!isPlaceholder) {
      logs.push({ type: entryType, icon: event.icon, message: event.message, time: event.time, status })
      if (logs.length > 200) logs.shift()
    }
    this.workLogs.set(event.npcId, logs)
    this.ui.appendActivity(event.npcId, { type: entryType, icon: event.icon, message: event.message, time: event.time, status })
  }

  onNpcActivityStatus(npcId: string, success: boolean): void {
    const sLogs = this.workLogs.get(npcId)
    if (sLogs) {
      for (let i = sLogs.length - 1; i >= 0; i--) {
        if (sLogs[i].status === undefined) { sLogs[i].status = success; break }
      }
    }
    this.ui.updateLastActivityStatus(npcId, success)
  }

  onNpcActivityStream(npcId: string, delta: string): void {
    this.ui.appendThinkingDelta(npcId, delta)
    const sLogs = this.workLogs.get(npcId)
    if (sLogs && sLogs.length > 0) {
      const last = sLogs[sLogs.length - 1]
      if (last.type === 'thinking') last.message += delta
    }
  }

  onNpcActivityStreamEnd(npcId: string): void {
    this.ui.endThinkingStream(npcId)
  }

  onNpcActivityTodo(npcId: string, todos: Array<{ id: number; content: string; status: string }>): void {
    this.ui.appendTodoList(npcId, todos)
  }

  onNpcActivityRestore(npcId: string, rawEntries: unknown[]): void {
    const entries: Array<{ type: 'activity' | 'thinking'; icon: string; message: string; time?: string; status?: boolean | null }> = []
    for (const e of (rawEntries as any[])) {
      if (e.kind === 'thinking') {
        entries.push({ type: 'thinking' as const, icon: 'brain', message: e.message ?? '', status: null })
      } else if (e.kind === 'todo') {
        entries.push({ type: 'activity' as const, icon: 'list-checks', message: '', status: null })
      } else {
        const st = e.status === 'success' ? true : e.status === 'error' ? false : e.status === 'none' ? null : undefined
        entries.push({ type: 'activity' as const, icon: e.icon ?? 'wrench', message: e.message ?? '', status: st })
      }
    }
    this.workLogs.set(npcId, entries)
  }
}
