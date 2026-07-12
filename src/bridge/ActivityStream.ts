// @desc NPC activity log and thinking stream — buffers thinking deltas and emits activity/status events
import type { GameEvent } from '../../town-frontend/src/data/GameProtocol.js'

const MAX_ACTIVITY_LOG = 500

/** Manages the activity log panel: emits activity entries, streams thinking text in batches, and tracks tool result success/failure */
export class ActivityStream {
  private thinkingBuffers = new Map<string, string>()
  private thinkingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private activityLog: any[] = []
  private emitFn: (events: GameEvent[]) => void

  constructor(emitFn: (events: GameEvent[]) => void) {
    this.emitFn = emitFn
  }

  private nowHHMM(): string {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  private cacheActivity(event: any): void {
    this.activityLog.push(event)
    if (this.activityLog.length > MAX_ACTIVITY_LOG) this.activityLog.shift()
  }

  getActivityReplayEvents(): any[] {
    return this.activityLog.slice()
  }

  /** Emit an activity log entry with icon, message, and timestamp */
  emitActivity(npcId: string, icon: string, message: string, noStatus?: boolean): void {
    const ev: GameEvent = { type: 'npc_activity', npcId, icon, message, time: this.nowHHMM() }
    if (noStatus) (ev as any).status = null
    this.cacheActivity(ev)
    this.emitFn([ev])
  }

  /** Mark the most recent activity entry for an NPC as success or failure */
  emitActivityStatus(npcId: string, success: boolean): void {
    for (let i = 0; i < this.activityLog.length; i++) {
      const cached = this.activityLog[i]
      if (cached.npcId === npcId && cached.type === 'npc_activity' && cached.status === undefined) {
        cached.status = success
        break
      }
    }
    const ev: GameEvent = { type: 'npc_activity_status', npcId, success }
    this.cacheActivity(ev)
    this.emitFn([ev])
  }

  private startThinkingStream(npcId: string): void {
    if (this.thinkingFlushTimers.has(npcId)) return
    const ev: GameEvent = { type: 'npc_activity', npcId, icon: 'brain', message: '', time: this.nowHHMM() }
    this.cacheActivity(ev)
    this.emitFn([ev])
    const timer = setInterval(() => {
      const buf = this.thinkingBuffers.get(npcId)
      if (buf && buf.length > 0) {
        const streamEv: GameEvent = { type: 'npc_activity_stream', npcId, delta: buf }
        this.cacheActivity(streamEv)
        this.emitFn([streamEv])
        this.thinkingBuffers.set(npcId, '')
      }
    }, 500)
    this.thinkingFlushTimers.set(npcId, timer)
  }

  /** Buffer a thinking text delta; starts a periodic flush stream if not already running */
  appendThinkingDelta(npcId: string, delta: string): void {
    if (!delta && !this.thinkingFlushTimers.has(npcId)) return
    const buf = this.thinkingBuffers.get(npcId) ?? ''
    this.thinkingBuffers.set(npcId, buf + delta)
    if (!this.thinkingFlushTimers.has(npcId)) {
      this.startThinkingStream(npcId)
    }
  }

  /** Flush any buffered thinking text and emit stream-end marker */
  flushThinking(npcId: string): void {
    const timer = this.thinkingFlushTimers.get(npcId)
    if (!timer) return
    clearInterval(timer)
    this.thinkingFlushTimers.delete(npcId)
    const buf = this.thinkingBuffers.get(npcId)
    if (buf && buf.length > 0) {
      const streamEv: GameEvent = { type: 'npc_activity_stream', npcId, delta: buf }
      this.cacheActivity(streamEv)
      this.emitFn([streamEv])
    }
    this.thinkingBuffers.set(npcId, '')
    const endEv: GameEvent = { type: 'npc_activity_stream_end', npcId }
    this.cacheActivity(endEv)
    this.emitFn([endEv])
  }

  /** Return the Lucide icon name for a given tool */
  toolActivityIcon(toolName: string): string {
    if (toolName === '__thinking__') return 'sparkles'
    if (toolName === '__thinking_placeholder__') return 'sparkles'
    if (toolName === 'bash' || toolName === 'exec') return 'terminal'
    if (['read', 'read_file', 'grep', 'glob'].includes(toolName)) return 'file-search'
    if (['write', 'edit', 'write_file', 'edit_file'].includes(toolName)) return 'file-edit'
    if (toolName === 'web_search' || toolName === 'web_fetch') return 'globe'
    if (toolName === 'browser') return 'globe'
    if (toolName === 'process') return 'terminal'
    if (toolName === 'skill') return 'zap'
    if (toolName === 'spawn_agent' || toolName === 'sessions_spawn') return 'users'
    if (toolName === 'todo_write') return 'list-checks'
    return 'wrench'
  }

  /** Generate a human-readable Chinese description of what a tool is doing */
  toolActivityMsg(toolName: string, input?: Record<string, unknown>): string {
    const inp = input ?? {}
    if (toolName === '__thinking__') {
      const content = String(inp.content ?? '')
      const firstLine = content.split('\n')[0].trim()
      const preview = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine
      return `思考完成\n${preview}`
    }
    if (toolName === '__thinking_placeholder__') return '正在思考'
    if (toolName === 'bash' || toolName === 'exec') {
      const cmd = String(inp.command ?? '').trim()
      if (/\b(pnpm|npm|yarn)\s+(install|i|ci)\b/.test(cmd)) return '安装依赖'
      if (/\b(git\s+clone|cp\s+-r|rsync)\b/.test(cmd)) return '克隆项目'
      if (/\bmkdir\b/.test(cmd)) return '创建目录'
      if (/\b(rm|rmdir)\b/.test(cmd)) return '删除文件'
      if (/\b(pnpm|npm|yarn|npx)\s+(run|exec|start|dev|build|test)\b/.test(cmd)) return '运行脚本'
      if (/\b(node|ts-node|tsx)\b/.test(cmd)) return '运行脚本'
      if (/\b(cat|head|tail|less|more)\b/.test(cmd)) return '查看文件'
      if (/\bls\b/.test(cmd)) return '查看目录'
      if (/\b(sed|awk|grep|find)\b/.test(cmd)) return '处理文件'
      if (/\bscreencapture\b/.test(cmd)) return '截取屏幕'
      if (/\bcurl|wget\b/.test(cmd)) return '网络请求'
      if (/\bdocker\b/.test(cmd)) return '运行容器'
      if (/\bcd\b/.test(cmd)) return '切换目录'
      return '执行命令'
    }
    if (['read', 'read_file', 'grep', 'glob'].includes(toolName)) {
      const readPath = String(inp.path ?? inp.pattern ?? '').split('/').pop() ?? ''
      return `阅读 ${readPath || '文件'}`
    }
    if (['write', 'edit', 'write_file', 'edit_file'].includes(toolName)) {
      const writePath = String(inp.path ?? inp.file ?? '').split('/').pop() ?? ''
      return `编辑 ${writePath || '文件'}`
    }
    if (toolName === 'web_search') return '搜索网络'
    if (toolName === 'web_fetch') return '访问网页'
    if (toolName === 'browser') return '浏览器操作'
    if (toolName === 'process') {
      const action = String(inp.action ?? '')
      if (action === 'poll') return '等待进程完成'
      if (action === 'log') return '查看进程日志'
      if (action === 'kill') return '终止进程'
      return '进程操作'
    }
    if (toolName === 'skill') {
      const sn = String(inp.skill_name ?? inp.name ?? '').slice(0, 20)
      return `使用技能：${sn || '技能'}`
    }
    if (toolName === 'spawn_agent' || toolName === 'sessions_spawn') {
      const name = String(inp.name ?? inp.displayName ?? inp.label ?? '').slice(0, 15)
      return `召唤 ${name || '居民'}`
    }
    if (toolName === 'todo_write') return ''
    return `使用工具：${toolName}`
  }

  isTodoWrite(toolName: string): boolean {
    return toolName === 'todo_write'
  }

  /** Emit a todo list activity entry */
  emitTodoActivity(npcId: string, input: Record<string, unknown>): void {
    const todos = input.todos as Array<{ id: number; content: string; status: string }> | undefined
    if (!todos || !Array.isArray(todos)) return
    const ev: GameEvent = { type: 'npc_activity_todo', npcId, todos: todos.map(t => ({ id: t.id, content: t.content, status: t.status })) }
    this.cacheActivity(ev)
    this.emitFn([ev])
  }
}
