import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgents, type AgentInfo } from '@/hooks/useAgents'
import { useWebSocket, type ChatItem, type GroupChatMessageItem, type GroupChatInfo } from '@/hooks/useWebSocket'
import { AgentList } from './AgentList'
import { ChatMessages } from './ChatMessages'
import { ChatInputBar } from './ChatInputBar'
import { GroupChatView } from './GroupChatView'
import { getHelpText, type ParsedCommand } from '@/utils/command-parser'

interface ChatViewProps {
  visible: boolean
  selectedAgent: AgentInfo | null
  onAgentChange?: (agent: AgentInfo | null) => void
  onConnectedChange?: (connected: boolean) => void
}

let globalMsgId = 0
const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'
const CHAT_VIEW_MODE_STORAGE_KEY = 'agentshire_chat_view_mode' // 'agent' | 'group'

function getAgentRoutingKey(agent: AgentInfo | null): string {
  if (!agent) return ''
  if (agent.type === 'steward') return 'steward'
  return agent.agentId ?? agent.id
}

export function ChatView({ visible, selectedAgent, onAgentChange, onConnectedChange }: ChatViewProps) {
  const { agents, loading } = useAgents()
  const [items, setItems] = useState<Map<string, ChatItem[]>>(new Map())
  const [historyLoadedSet, setHistoryLoadedSet] = useState<Set<string>>(new Set())
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreMap, setHasMoreMap] = useState<Map<string, boolean>>(new Map())
  const [cursorMap, setCursorMap] = useState<Map<string, string>>(new Map())
  const [thinking, setThinking] = useState(false)
  const selectedAgentRef = useRef(selectedAgent)
  selectedAgentRef.current = selectedAgent
  const historyLoadedRef = useRef<Set<string>>(new Set())
  const loadingMoreRef = useRef(false)
  const lastAgentSyncRef = useRef('')
  // Map<routingKey, clearTimestamp> — messages with timestamp <= clearTime are ignored
  const clearedAgentsRef = useRef<Map<string, number>>(new Map())
  // Group chat clear timestamp — messages with timestamp <= clearTime are ignored
  const groupClearedAtRef = useRef<number | null>(null)

  // ── Group chat state ──
  const [groupChatActive, setGroupChatActive] = useState(() => {
    try { return localStorage.getItem(CHAT_VIEW_MODE_STORAGE_KEY) === 'group' } catch { return false }
  })
  const [groupInfo, setGroupInfo] = useState<GroupChatInfo | null>(null)
  const [groupMessages, setGroupMessages] = useState<GroupChatMessageItem[]>([])
  const [groupThinking, setGroupThinking] = useState(false)
  const groupInitSentRef = useRef(false)
  const groupThinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const wsUrl = useMemo(() => {
    const param = new URLSearchParams(window.location.search).get('ws')
    return param || `ws://${window.location.hostname || 'localhost'}:${(window.location.port ? Number(window.location.port) - 1 : 20008)}`
  }, [])

  const isLive = useMemo(() => {
    return new URLSearchParams(window.location.search).get('mock') !== 'true'
  }, [])

  const townSessionId = useMemo(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('townSessionId')
    if (fromUrl) return fromUrl
    try {
      return localStorage.getItem('agentshire_active_session') || 'default'
    } catch {
      return 'default'
    }
  }, [])

  const handleHistoryItems = useCallback((agentId: string, newItems: ChatItem[], more: boolean, cursor: string) => {
    // Ignore stale history from backend if this agent was cleared locally
    const clearTime = clearedAgentsRef.current.get(agentId)
    if (clearTime !== undefined) {
      // Filter out messages that existed before the clear operation
      const filtered = newItems.filter(item => item.timestamp > clearTime)
      if (filtered.length === 0) {
        // All items are stale — just mark as loaded (empty), don't set items
        historyLoadedRef.current = new Set(historyLoadedRef.current).add(agentId)
        setHistoryLoadedSet((prev) => new Set(prev).add(agentId))
        setHistoryLoading(false)
        loadingMoreRef.current = false
        setHasMoreMap((prev) => new Map(prev).set(agentId, false))
        return
      }
      newItems = filtered
    }

    const isInitial = !historyLoadedRef.current.has(agentId)
    historyLoadedRef.current = new Set(historyLoadedRef.current).add(agentId)

    if (isInitial) {
      setItems((prev) => new Map(prev).set(agentId, newItems))
    } else {
      setItems((prev) => {
        const existing = prev.get(agentId) || []
        const existingIds = new Set(existing.map(e => e.id))
        const fresh = newItems.filter(item => !existingIds.has(item.id))
        if (fresh.length === 0) return prev
        const merged = [...fresh, ...existing]
        merged.sort((a, b) => a.timestamp - b.timestamp)
        return new Map(prev).set(agentId, merged)
      })
    }
    setHistoryLoadedSet((prev) => new Set(prev).add(agentId))
    setHistoryLoading(false)
    loadingMoreRef.current = false
    setHasMoreMap((prev) => new Map(prev).set(agentId, more))
    if (cursor) setCursorMap((prev) => new Map(prev).set(agentId, cursor))
  }, [])

  const handleDeltaItems = useCallback((agentId: string, deltaItems: ChatItem[]) => {
    // Filter out stale items that existed before a local clear operation
    const clearTime = clearedAgentsRef.current.get(agentId)
    const effectiveItems = clearTime !== undefined
      ? deltaItems.filter(item => item.timestamp > clearTime)
      : deltaItems
    if (effectiveItems.length === 0) return

    const hasAssistant = effectiveItems.some(it => it.role === 'assistant')
    if (hasAssistant) setThinking(false)

    setItems((prev) => {
      const existing = [...(prev.get(agentId) || [])]
      const existingIds = new Set(existing.map(i => i.id))
      let changed = false
      for (const item of effectiveItems) {
        if (existingIds.has(item.id)) continue
        if (item.role === 'user') {
          let localIdx = -1
          if (item.kind === 'text') {
            localIdx = existing.findIndex((entry) =>
              entry.id.startsWith('local-') &&
              entry.kind === 'text' &&
              entry.role === 'user' &&
              entry.text === item.text &&
              Math.abs(entry.timestamp - item.timestamp) <= 15000,
            )
          } else if (item.kind === 'media') {
            localIdx = existing.findIndex((entry) =>
              entry.id.startsWith('local-') &&
              entry.kind === 'media' &&
              entry.role === 'user' &&
              entry.mediaType === item.mediaType &&
              Math.abs(entry.timestamp - item.timestamp) <= 15000,
            )
          }
          if (localIdx >= 0) {
            existing[localIdx] = item
            existingIds.add(item.id)
            changed = true
            continue
          }
        }
        existing.push(item)
        existingIds.add(item.id)
        changed = true
      }
      if (!changed) return prev
      existing.sort((a, b) => a.timestamp - b.timestamp)
      return new Map(prev).set(agentId, existing)
    })
  }, [])

  const handleAgentEvent = useCallback((event: any) => {
    if (event.type === 'turn_end' || event.type === 'end') {
      setThinking(false)
    }
  }, [])

  // ── Group chat WS callbacks ──
  const handleGroupChatMessage = useCallback((msg: GroupChatMessageItem) => {
    // Filter out stale messages from before a local clear
    const clearTime = groupClearedAtRef.current
    if (clearTime !== null && msg.timestamp <= clearTime) return

    setGroupMessages(prev => {
      // Deduplicate: skip if a message with the same sequenceId already exists
      // (user messages are added locally first, then echoed back by the server)
      if (prev.some(m => m.sequenceId === msg.sequenceId)) return prev
      // Also skip user messages from server echo — local message already added
      if (msg.speakerNpcId === 'user' && prev.some(m =>
        m.speakerNpcId === 'user' &&
        m.text === msg.text &&
        Math.abs(m.timestamp - msg.timestamp) <= 5000,
      )) return prev
      return [...prev, msg]
    })
    setGroupThinking(false)
    if (groupThinkingTimerRef.current) {
      clearTimeout(groupThinkingTimerRef.current)
      groupThinkingTimerRef.current = null
    }
  }, [])

  const handleGroupChatInfo = useCallback((info: GroupChatInfo) => {
    setGroupInfo(info)
    // Auto-activate group chat if not already active and no agent selected
    if (!groupChatActive && !selectedAgentRef.current) {
      setGroupChatActive(true)
    }
  }, [groupChatActive])

  // Receive persisted group chat history (on init / reconnect) — replace local messages
  const handleGroupChatHistory = useCallback((messages: GroupChatMessageItem[]) => {
    // Filter out messages that existed before a local clear operation
    const clearTime = groupClearedAtRef.current
    const filtered = clearTime !== null
      ? messages.filter(m => m.timestamp > clearTime)
      : messages
    setGroupMessages(filtered)
  }, [])

  const { connected, sendChat, sendCitizenChat, sendMultimodal, sendAbort, sendCommand, requestHistory, bindChatAgent, sendGroupChatInit, sendGroupChatMessage, sendGroupChatClear } = useWebSocket({
    url: wsUrl,
    townSessionId,
    enabled: isLive,
    onHistoryItems: handleHistoryItems,
    onDeltaItems: handleDeltaItems,
    onAgentEvent: handleAgentEvent,
    onGroupChatMessage: handleGroupChatMessage,
    onGroupChatInfo: handleGroupChatInfo,
    onGroupChatHistory: handleGroupChatHistory,
  })

  // Request group chat init on connect
  useEffect(() => {
    if (connected && visible && isLive && !groupInitSentRef.current) {
      groupInitSentRef.current = true
      sendGroupChatInit()
    }
  }, [connected, visible, isLive, sendGroupChatInit])

  // Enter group chat
  const handleEnterGroupChat = useCallback(() => {
    setGroupChatActive(true)
    try { localStorage.setItem(CHAT_VIEW_MODE_STORAGE_KEY, 'group') } catch {}
    onAgentChange?.(null)
    if (!groupInfo) {
      sendGroupChatInit()
    }
  }, [groupInfo, onAgentChange, sendGroupChatInit])

  // Send group chat message
  const handleSendGroupMessage = useCallback((text: string, mentions: string[]) => {
    if (!groupInfo) return
    // Add local user message
    const localMsg: GroupChatMessageItem = {
      sequenceId: Date.now(),
      timestamp: Date.now(),
      speakerNpcId: 'user',
      speakerName: '镇长',
      text,
      mentions,
      groupId: groupInfo.groupId,
      groupName: groupInfo.groupName,
    }
    setGroupMessages(prev => [...prev, localMsg])
    setGroupThinking(true)
    // Set a timeout to clear thinking state after 30s
    if (groupThinkingTimerRef.current) clearTimeout(groupThinkingTimerRef.current)
    groupThinkingTimerRef.current = setTimeout(() => setGroupThinking(false), 30000)
    sendGroupChatMessage(groupInfo.groupId, text, mentions)
  }, [groupInfo, sendGroupChatMessage])

  useEffect(() => {
    onConnectedChange?.(connected)
  }, [connected, onConnectedChange])

  useEffect(() => {
    if (!connected || !visible || !selectedAgent) {
      lastAgentSyncRef.current = ''
      return
    }
    const agentKey = getAgentRoutingKey(selectedAgent)
    if (!agentKey) return
    const syncKey = `${townSessionId}:${agentKey}`
    if (lastAgentSyncRef.current === syncKey) return
    lastAgentSyncRef.current = syncKey
    bindChatAgent(agentKey)
    // Skip backend history fetch if this agent was cleared locally
    if (clearedAgentsRef.current.get(agentKey) === undefined) {
      requestHistory(agentKey)
    }
  }, [selectedAgent, connected, visible, townSessionId, bindChatAgent, requestHistory])

  useEffect(() => {
    if (loading || agents.length === 0 || selectedAgent || groupChatActive) return
    let restored: AgentInfo | undefined
    try {
      const storedAgentId = localStorage.getItem(CHAT_AGENT_STORAGE_KEY)
      if (storedAgentId) {
        restored = agents.find((agent) => agent.id === storedAgentId)
      }
    } catch {
      restored = undefined
    }
    if (restored) {
      onAgentChange?.(restored)
      return
    }
    if (window.innerWidth >= 768) {
      onAgentChange?.(agents[0])
    }
  }, [loading, agents, selectedAgent, onAgentChange, groupChatActive])

  useEffect(() => {
    if (!selectedAgent) return
    try {
      localStorage.setItem(CHAT_AGENT_STORAGE_KEY, selectedAgent.id)
    } catch {
      // ignore storage failures
    }
  }, [selectedAgent])

  useEffect(() => {
    if (historyLoadedSet.has('steward')) return
    const timer = setTimeout(() => {
      setHistoryLoadedSet((prev) => new Set(prev).add('steward'))
      setHistoryLoading(false)
    }, 5000)
    return () => clearTimeout(timer)
  }, [historyLoadedSet])

  const handleSend = useCallback((text: string) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    // Note: we do NOT delete the cleared timestamp — it stays so that stale
    // transcript messages (from before the clear) are always filtered out.
    // New messages naturally have timestamps > clearTime so they pass through.
    setThinking(true)
    setItems((prev) => {
      const agentItems = [...(prev.get(routingKey) || [])]
      agentItems.push({
        id: `local-${++globalMsgId}`,
        agentId: routingKey,
        timestamp: Date.now(),
        kind: 'text',
        role: 'user',
        text,
        source: 'user_input',
      })
      return new Map(prev).set(routingKey, agentItems)
    })
    if (agent.type === 'steward') sendChat(text)
    else sendCitizenChat(agent.id, text)
  }, [sendChat, sendCitizenChat])

  const handleSendMultimodal = useCallback((parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string; fileName?: string }>) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    // Note: we do NOT delete the cleared timestamp — see handleSend for rationale.
    setThinking(true)

    const textPart = parts.find((p) => p.kind === 'text')
    const mediaParts = parts.filter((p) => p.kind !== 'text')

    setItems((prev) => {
      const agentItems = [...(prev.get(routingKey) || [])]
      if (textPart?.text) {
        agentItems.push({
          id: `local-${++globalMsgId}`,
          agentId: routingKey,
          timestamp: Date.now(),
          kind: 'text',
          role: 'user',
          text: textPart.text,
          source: 'user_input',
        })
      }
      for (const p of mediaParts) {
        if (p.kind === 'image' && p.data) {
          agentItems.push({
            id: `local-${++globalMsgId}`,
            agentId: routingKey,
            timestamp: Date.now(),
            kind: 'media',
            role: 'user',
            mediaType: 'image',
            fileUrl: '',
            imageData: p.data,
            mimeType: p.mimeType,
          })
        } else if (p.fileName) {
          agentItems.push({
            id: `local-${++globalMsgId}`,
            agentId: routingKey,
            timestamp: Date.now(),
            kind: 'media',
            role: 'user',
            mediaType: 'file',
            fileUrl: '',
            fileName: p.fileName,
          })
        }
      }
      return new Map(prev).set(routingKey, agentItems)
    })

    if (agent.type === 'steward') {
      sendMultimodal(parts, { agentId: 'steward' })
    } else {
      sendMultimodal(parts, {
        agentId: routingKey,
        npcId: agent.id,
      })
    }
  }, [sendMultimodal])

  const addSystemMessage = useCallback((routingKey: string, text: string) => {
    setItems((prev) => {
      const existing = [...(prev.get(routingKey) || [])]
      existing.push({
        id: `sys-${++globalMsgId}`,
        agentId: routingKey,
        timestamp: Date.now(),
        kind: 'text',
        role: 'assistant',
        text,
        source: 'system',
      })
      return new Map(prev).set(routingKey, existing)
    })
  }, [])

  // Clear current chat session: local messages + backend /clear command
  const performClearChat = useCallback(() => {
    // ── Group chat clear ──
    if (groupChatActive) {
      const groupId = groupInfo?.groupId ?? 'town-square'
      // Mark cleared timestamp — prevents stale history reload from backend
      groupClearedAtRef.current = Date.now()
      // Clear local messages
      setGroupMessages([])
      setGroupThinking(false)
      if (groupThinkingTimerRef.current) {
        clearTimeout(groupThinkingTimerRef.current)
        groupThinkingTimerRef.current = null
      }
      // Send clear to backend
      sendGroupChatClear(groupId)
      // Add local system message
      setGroupMessages(prev => [...prev, {
        sequenceId: Date.now(),
        timestamp: Date.now(),
        speakerNpcId: 'system',
        speakerName: '系统',
        text: '群聊会话已清空。',
        mentions: [],
        groupId,
        groupName: groupInfo?.groupName ?? '小镇广场',
      }])
      return
    }

    // ── Single agent clear ──
    const agent = selectedAgentRef.current
    const routingKey = agent ? getAgentRoutingKey(agent) : 'steward'

    // 0) Mark this agent as cleared with timestamp — prevents stale history/delta reload from backend
    clearedAgentsRef.current.set(routingKey, Date.now())

    // 1) Clear local message items for this agent
    setItems((prev) => {
      const next = new Map(prev)
      next.delete(routingKey)
      return next
    })
    // 2) Mark history as loaded (empty) so UI doesn't show "loading" spinner
    historyLoadedRef.current.add(routingKey)
    setHistoryLoadedSet((prev) => new Set(prev).add(routingKey))
    setHasMoreMap((prev) => {
      const next = new Map(prev)
      next.delete(routingKey)
      return next
    })
    setCursorMap((prev) => {
      const next = new Map(prev)
      next.delete(routingKey)
      return next
    })
    setThinking(false)

    // 3) Send /clear to Gateway to clear backend session history
    sendCommand('clear', '')
    addSystemMessage(routingKey, '会话已清空。')
  }, [groupChatActive, groupInfo, sendGroupChatClear, sendCommand, addSystemMessage])

  const handleClearChat = useCallback(() => {
    setShowClearConfirm(true)
  }, [])

  const confirmClearChat = useCallback(() => {
    setShowClearConfirm(false)
    performClearChat()
  }, [performClearChat])

  const handleCommand = useCallback((cmd: ParsedCommand) => {
    const agent = selectedAgentRef.current
    const routingKey = agent ? getAgentRoutingKey(agent) : 'steward'

    switch (cmd.command) {
      case 'new': {
        const nextId = `town-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`
        try { localStorage.setItem('agentshire_active_session', nextId) } catch {}
        const url = new URL(window.location.href)
        url.searchParams.set('townSessionId', nextId)
        window.location.href = url.toString()
        return
      }
      case 'clear': {
        performClearChat()
        return
      }
      case 'help': {
        addSystemMessage(routingKey, getHelpText())
        return
      }
      case 'stop': {
        sendAbort()
        setThinking(false)
        addSystemMessage(routingKey, '已发送中止请求。')
        return
      }
      default: {
        sendCommand(cmd.command, cmd.args)
        addSystemMessage(routingKey, `正在执行 /${cmd.command}${cmd.args ? ' ' + cmd.args : ''}...`)
        return
      }
    }
  }, [sendAbort, sendCommand, addSystemMessage, performClearChat])

  const handleSelectAgent = useCallback((agent: AgentInfo) => {
    setThinking(false)
    setGroupChatActive(false)
    try { localStorage.setItem(CHAT_VIEW_MODE_STORAGE_KEY, 'agent') } catch {}
    onAgentChange?.(agent)
  }, [onAgentChange])

  const currentRoutingKey = getAgentRoutingKey(selectedAgent)
  const currentHasMore = hasMoreMap.get(currentRoutingKey) ?? false
  const currentCursor = cursorMap.get(currentRoutingKey) ?? ''
  const isCurrentHistoryLoaded = historyLoadedSet.has(currentRoutingKey)
  const isStewardSelected = selectedAgent?.type === 'steward'

  const handleLoadMore = useCallback(() => {
    if (historyLoading || loadingMoreRef.current || !currentHasMore) return
    loadingMoreRef.current = true
    setHistoryLoading(true)
    requestHistory(currentRoutingKey, currentCursor)
  }, [historyLoading, currentHasMore, currentRoutingKey, currentCursor, requestHistory])

  const currentItems = selectedAgent ? (items.get(currentRoutingKey) || []) : []
  const agentOnline = selectedAgent?.online ?? false
  const canSend = connected && agentOnline

  return (
    <div className="flex h-full" style={{ display: visible ? undefined : 'none' }}>
      <div className={cn(
        'w-full md:w-60 lg:w-64 border-r border-border-subtle bg-bg-surface md:bg-bg-canvas shrink-0 overflow-hidden min-h-0',
        (selectedAgent || groupChatActive) ? 'hidden md:flex md:flex-col' : 'flex flex-col',
      )}>
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-xs text-text-quaternary">加载中...</div>
          </div>
        ) : (
          <AgentList
            agents={agents}
            selectedId={selectedAgent?.id ?? null}
            onSelect={handleSelectAgent}
            className="flex-1"
            groupChatActive={groupChatActive}
            onGroupChatClick={handleEnterGroupChat}
          />
        )}
      </div>

      <div className={cn(
        'flex-1 flex flex-col min-w-0 bg-bg-surface',
        (!selectedAgent && !groupChatActive) ? 'hidden md:flex' : 'flex',
      )}>
        {groupChatActive ? (
          <GroupChatView
            visible={visible && groupChatActive}
            agents={agents}
            groupInfo={groupInfo}
            messages={groupMessages}
            onSend={handleSendGroupMessage}
            onClear={handleClearChat}
            thinking={groupThinking}
          />
        ) : selectedAgent ? (
          <>
            <div className="hidden md:flex items-center gap-2 px-4 py-1 select-none shrink-0">
              <span className="text-[13px] font-semibold text-brand-secondary">{selectedAgent.name}</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                agentOnline ? 'bg-status-success' : 'bg-text-quaternary',
              )} />
              <div className="flex-1" />
              <button
                onClick={handleClearChat}
                disabled={thinking || !canSend}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-lg cursor-pointer',
                  'transition-colors duration-150',
                  'text-text-tertiary hover:text-status-error hover:bg-[rgba(248,113,113,0.08)]',
                  (thinking || !canSend) && 'opacity-40 cursor-default',
                )}
                aria-label="清空会话"
                title="清空当前会话"
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </div>
            <ChatMessages
              key={currentRoutingKey}
              items={currentItems}
              agentName={selectedAgent.name}
              agentSpecialty={selectedAgent.specialty}
              agentAvatarUrl={selectedAgent.avatarUrl}
              agentThinking={thinking}
              connected={connected}
              visible={visible}
              historyLoading={!isCurrentHistoryLoaded && (isStewardSelected || agentOnline)}
              loadingMore={historyLoading}
              hasMore={currentHasMore}
              onLoadMore={handleLoadMore}
            />
            <ChatInputBar
              onSend={handleSend}
              onSendMultimodal={handleSendMultimodal}
              onCommand={handleCommand}
              disabled={(!canSend && isLive) || thinking}
              placeholder={
                !agentOnline
                  ? `${selectedAgent.name} 当前离线`
                  : thinking
                    ? `${selectedAgent.name} 思考中...`
                    : `跟 ${selectedAgent.name} 说点什么...`
              }
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-quaternary text-sm select-none">
            选择一个 Agent 开始对话
          </div>
        )}
      </div>

      {/* ── Clear session confirmation dialog ── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[320px] rounded-2xl bg-bg-surface border border-border-default shadow-2xl shadow-black/60 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(248,113,113,0.10)] shrink-0">
                <AlertTriangle size={18} className="text-status-error" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold text-text-primary">清空当前会话</div>
                <div className="text-[12px] text-text-tertiary mt-0.5">将清除所有聊天记录，此操作不可撤销</div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 h-9 rounded-lg bg-bg-elevated text-[13px] text-text-secondary hover:bg-bg-hover cursor-pointer transition-colors duration-150"
              >
                取消
              </button>
              <button
                onClick={confirmClearChat}
                className="flex-1 h-9 rounded-lg bg-status-error/90 text-[13px] text-white hover:bg-status-error cursor-pointer transition-colors duration-150 font-medium"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
