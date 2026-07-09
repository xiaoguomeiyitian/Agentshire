import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useAgents, type AgentInfo } from '@/hooks/useAgents'
import { useWebSocket, type ChatItem } from '@/hooks/useWebSocket'
import { AgentList } from './AgentList'
import { ChatMessages } from './ChatMessages'
import { ChatInputBar } from './ChatInputBar'
import { getHelpText, type ParsedCommand } from '@/utils/command-parser'

interface ChatViewProps {
  visible: boolean
  selectedAgent: AgentInfo | null
  onAgentChange?: (agent: AgentInfo | null) => void
  onConnectedChange?: (connected: boolean) => void
}

let globalMsgId = 0
const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'

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
    const hasAssistant = deltaItems.some(it => it.role === 'assistant')
    if (hasAssistant) setThinking(false)

    setItems((prev) => {
      const existing = [...(prev.get(agentId) || [])]
      const existingIds = new Set(existing.map(i => i.id))
      let changed = false
      for (const item of deltaItems) {
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

  const { connected, sendChat, sendCitizenChat, sendMultimodal, sendAbort, sendCommand, requestHistory, bindChatAgent } = useWebSocket({
    url: wsUrl,
    townSessionId,
    enabled: isLive,
    onHistoryItems: handleHistoryItems,
    onDeltaItems: handleDeltaItems,
    onAgentEvent: handleAgentEvent,
  })

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
    requestHistory(agentKey)
  }, [selectedAgent, connected, visible, townSessionId, bindChatAgent, requestHistory])

  useEffect(() => {
    if (loading || agents.length === 0 || selectedAgent) return
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
  }, [loading, agents, selectedAgent, onAgentChange])

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
  }, [sendAbort, sendCommand, addSystemMessage])

  const handleSelectAgent = useCallback((agent: AgentInfo) => {
    setThinking(false)
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
        'w-full md:w-60 lg:w-64 border-r border-border-subtle bg-bg-surface md:bg-bg-canvas shrink-0',
        selectedAgent ? 'hidden md:flex md:flex-col' : 'flex flex-col',
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
          />
        )}
      </div>

      <div className={cn(
        'flex-1 flex flex-col min-w-0 bg-bg-surface',
        !selectedAgent ? 'hidden md:flex' : 'flex',
      )}>
        {selectedAgent ? (
          <>
            <div className="hidden md:flex items-center gap-2 px-4 py-1 select-none shrink-0">
              <span className="text-[13px] font-semibold text-brand-secondary">{selectedAgent.name}</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                agentOnline ? 'bg-status-success' : 'bg-text-quaternary',
              )} />
            </div>
            <ChatMessages
              key={currentRoutingKey}
              items={currentItems}
              agentName={selectedAgent.name}
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
    </div>
  )
}
