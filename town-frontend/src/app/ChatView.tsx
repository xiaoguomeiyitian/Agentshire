import { useCallback, useRef, useEffect, useState, useMemo } from 'react'
import { Trash2, AlertTriangle, Cpu, ChevronDown, Archive, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgents, type AgentInfo } from '@/hooks/useAgents'
import { useWebSocket, type ChatItem, type GroupChatMessageItem, type GroupChatInfo } from '@/hooks/useWebSocket'
import { AgentList } from './AgentList'
import { ChatMessages } from './ChatMessages'
import { ChatInputBar } from './ChatInputBar'
import { GroupChatView } from './GroupChatView'
import { getHelpText, type ParsedCommand } from '@/utils/command-parser'
import { t } from '../i18n'

/** Format a token count compactly (e.g. 26483 → "26K", 445 → "445"). */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return String(n)
}

/**
 * Deduplicate identical user text messages from retry/edit cycles.
 * Retry/edit re-sends the same text to the backend, which stores both copies
 * in the transcript. On page refresh, all copies are loaded from history.
 *
 * This function identifies groups of identical user text messages and keeps
 * only the last occurrence (along with its assistant reply). Earlier copies
 * and their replies are removed, since the user already saw the latest reply.
 *
 * Example: [user:"hi", asst:"r1", user:"hi", asst:"r2", user:"hi", asst:"r3"]
 * Result:  [user:"hi", asst:"r3"]
 */
function dedupRetryMessages(items: ChatItem[]): ChatItem[] {
  // Find the last occurrence index of each user text message
  const lastUserIdx = new Map<string, number>()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.role === 'user' && item.kind === 'text' && item.text) {
      lastUserIdx.set(item.text, i)
    }
  }

  // Identify which user messages are "stale" (not the last occurrence)
  // A stale user message and its reply (the assistant messages until the next
  // user message) should be removed.
  const staleRanges: Array<[number, number]> = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.role === 'user' && item.kind === 'text' && item.text) {
      const lastIdx = lastUserIdx.get(item.text!)
      if (lastIdx !== undefined && lastIdx !== i) {
        // This is a stale user message — find the end of its reply block
        // (everything until the next user message or end of array)
        let end = i + 1
        while (end < items.length && items[end].role !== 'user') {
          end++
        }
        staleRanges.push([i, end])
      }
    }
  }

  if (staleRanges.length === 0) return items

  // Build the result by excluding stale ranges
  const skip = new Set<number>()
  for (const [start, end] of staleRanges) {
    for (let j = start; j < end; j++) skip.add(j)
  }
  return items.filter((_, i) => !skip.has(i))
}

interface ChatViewProps {
  visible: boolean
  selectedAgent: AgentInfo | null
  onAgentChange?: (agent: AgentInfo | null) => void
  onConnectedChange?: (connected: boolean) => void
}

let globalMsgId = 0
const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'
const CHAT_VIEW_MODE_STORAGE_KEY = 'agentshire_chat_view_mode' // 'agent' | 'group'
const CLEARED_AGENTS_STORAGE_KEY = 'agentshire_cleared_agents' // Map<routingKey, clearTimestamp>
const GROUP_CLEARED_STORAGE_KEY = 'agentshire_group_cleared_at' // number | null
const AGENT_LIST_COLLAPSED_KEY = 'agentshire_agent_list_collapsed' // 'true' | 'false'

/** Load persisted clear timestamps from localStorage (survives page refresh / server restart). */
function loadClearedAgents(): Map<string, number> {
  try {
    const raw = localStorage.getItem(CLEARED_AGENTS_STORAGE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, number>
    return new Map(Object.entries(obj))
  } catch { return new Map() }
}

/** Persist clear timestamps to localStorage. */
function saveClearedAgents(map: Map<string, number>): void {
  try {
    const obj: Record<string, number> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(CLEARED_AGENTS_STORAGE_KEY, JSON.stringify(obj))
  } catch { /* ignore */ }
}

/** Load group chat clear timestamp from localStorage. */
function loadGroupClearedAt(): number | null {
  try {
    const raw = localStorage.getItem(GROUP_CLEARED_STORAGE_KEY)
    if (!raw || raw === 'null') return null
    return Number(raw)
  } catch { return null }
}

/** Persist group chat clear timestamp to localStorage. */
function saveGroupClearedAt(ts: number | null): void {
  try {
    if (ts === null) localStorage.removeItem(GROUP_CLEARED_STORAGE_KEY)
    else localStorage.setItem(GROUP_CLEARED_STORAGE_KEY, String(ts))
  } catch { /* ignore */ }
}

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
  const [thinkingMap, setThinkingMap] = useState<Map<string, boolean>>(new Map())
  // Live reasoning/thinking text per agent (accumulated from thinking_delta events)
  const [thinkingTextMap, setThinkingTextMap] = useState<Map<string, string>>(new Map())
  // Ref mirror for access in callbacks with [] deps
  const thinkingTextMapRef = useRef<Map<string, string>>(new Map())
  thinkingTextMapRef.current = thinkingTextMap
  // Context window usage per agent: { used, limit, percent }
  const [contextMap, setContextMap] = useState<Map<string, { used: number; limit: number; percent: number }>>(new Map())
  // Compaction count per agent (from turn_end event)
  const [compactionMap, setCompactionMap] = useState<Map<string, number>>(new Map())
  // Model options for the agent model selector (contextWindow from openclaw.json)
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; contextWindow?: number }>>([])
  // Map from modelRef ("providerId/modelId") → contextWindow limit, for restoring ctx on refresh
  const contextWindowMapRef = useRef<Map<string, number>>(new Map())
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelUpdating, setModelUpdating] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  // Per-agent model override: persists model changes across agent switching
  // without needing to reload from backend. Keyed by agentId (or 'steward').
  const [modelRefOverride, setModelRefOverride] = useState<Map<string, string | undefined>>(new Map())
  // Agent list collapsed state (avatar-only mode)
  const [agentListCollapsed, setAgentListCollapsed] = useState(() => {
    try { return localStorage.getItem(AGENT_LIST_COLLAPSED_KEY) === 'true' } catch { return false }
  })
  const selectedAgentRef = useRef(selectedAgent)
  selectedAgentRef.current = selectedAgent
  // Keep agents list in a ref so callbacks with [] deps can access the latest list
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  // Safety net: per-agent thinking timeout timers. If turn_end is missed
  // (e.g. disconnect during agent_end), the thinking indicator is cleared
  // after THINKING_TIMEOUT_MS so it doesn't stay forever.
  const thinkingTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const THINKING_TIMEOUT_MS = 120_000 // 2 minutes — multi-turn responses can be long

  /** Set thinking state for a specific agent (by routing key). */
  const setThinkingFor = useCallback((routingKey: string, value: boolean) => {
    setThinkingMap(prev => {
      if (prev.get(routingKey) === value) return prev
      const next = new Map(prev)
      if (value) next.set(routingKey, true)
      else next.delete(routingKey)
      return next
    })
    if (value) {
      // Clear live thinking text when starting a new turn
      setThinkingTextMap(prev => { const m = new Map(prev); m.delete(routingKey); return m })
    }
    // Manage safety-net timeout timer
    const timers = thinkingTimerRef.current
    if (value) {
      // Clear any existing timer for this agent
      const existing = timers.get(routingKey)
      if (existing) clearTimeout(existing)
      // Set a new timeout — if turn_end never arrives, clear thinking
      const timer = setTimeout(() => {
        setThinkingMap(prev => {
          if (!prev.get(routingKey)) return prev
          const next = new Map(prev)
          next.delete(routingKey)
          return next
        })
        timers.delete(routingKey)
      }, THINKING_TIMEOUT_MS)
      timers.set(routingKey, timer)
    } else {
      const existing = timers.get(routingKey)
      if (existing) {
        clearTimeout(existing)
        timers.delete(routingKey)
      }
    }
  }, [])
  const historyLoadedRef = useRef<Set<string>>(new Set())
  const loadingMoreRef = useRef(false)
  const lastAgentSyncRef = useRef('')
  // Map<routingKey, clearTimestamp> — messages with timestamp <= clearTime are ignored
  // Persisted to localStorage so that page refresh / server restart doesn't reload stale messages
  const clearedAgentsRef = useRef<Map<string, number>>(loadClearedAgents())
  // Group chat clear timestamp — messages with timestamp <= clearTime are ignored
  // Persisted to localStorage for the same reason
  const groupClearedAtRef = useRef<number | null>(loadGroupClearedAt())
  // Per-agent abort counter — incremented on each abort. turn_end events
  // decrement this counter and are ignored while it's > 0, which reliably
  // discards late turn_end/error events from aborted turns regardless of
  // arrival order or timing. error events are also ignored while > 0
  // (but don't decrement, since error always precedes turn_end from the
  // same agent_end hook — turn_end will consume the counter).
  const abortCountRef = useRef<Map<string, number>>(new Map())
  // Records the timestamp of the last abort per agent. chat_delta/chat_new_messages
  // that arrive after an abort but belong to the aborted turn are filtered using
  // this timestamp — assistant messages with timestamp <= abortTime + grace are
  // dropped. This complements abortCountRef which only covers turn_end/error events.
  const abortTimestampRef = useRef<Map<string, number>>(new Map())

  // ── Group chat state ──
  const [groupChatActive, setGroupChatActive] = useState(() => {
    try { return localStorage.getItem(CHAT_VIEW_MODE_STORAGE_KEY) === 'group' } catch { return false }
  })
  const [groupInfo, setGroupInfo] = useState<GroupChatInfo | null>(null)
  const [groupMessages, setGroupMessages] = useState<GroupChatMessageItem[]>([])
  const [groupThinking, setGroupThinking] = useState(false)
  // Citizens currently composing a reply in group chat (npcId → speakerName)
  const [groupTypingCitizens, setGroupTypingCitizens] = useState<Map<string, string>>(new Map())
  const groupInitSentRef = useRef(false)
  const groupThinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [compacting, setCompacting] = useState(false)

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

  const handleHistoryItems = useCallback((agentId: string, newItems: ChatItem[], more: boolean, cursor: string, agentActive?: boolean) => {
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
      // Clear any stale abort counter from before the page refresh —
      // a fresh history load means no turn is pending abort.
      abortCountRef.current.delete(agentId)
      // Deduplicate consecutive identical user text messages — retry/edit
      // re-sends the same text to the backend, which stores both copies.
      // Keep only the last copy so the user doesn't see duplicates on refresh.
      const deduped = dedupRetryMessages(newItems)
      setItems((prev) => new Map(prev).set(agentId, deduped))
      // Restore the thinking indicator if the agent is still composing a reply.
      // The backend reports `agentActive=true` when the agent has an active turn
      // (between before_agent_start and agent_end). This covers multi-turn
      // responses where the first reply has already arrived but the agent is
      // still working (e.g. using tools before a second reply).
      if (agentActive) {
        setThinkingFor(agentId, true)
      } else {
        // Fallback: if the last visible message is from the user, the agent
        // is still composing a reply (covers cases where agentActive is not
        // available, e.g. older backend).
        const visibleItems = newItems.filter(it => it.kind === 'text' || it.kind === 'media')
        const lastItem = visibleItems[visibleItems.length - 1]
        if (lastItem && lastItem.role === 'user') {
          setThinkingFor(agentId, true)
        }
      }
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
    // Restore context window usage from the last assistant message's usage info.
    // `used` = last assistant message's input tokens; `limit` = model's contextWindow
    // (looked up from openclaw.json via the model options API).
    if (isInitial) {
      const lastAssistant = [...newItems].reverse().find(it => it.role === 'assistant' && it.usage)
      if (lastAssistant?.usage) {
        const used = lastAssistant.usage.input ?? 0
        // Determine the model ref for this agent to look up contextWindow limit
        const agent = agentsRef.current.find(a => getAgentRoutingKey(a) === agentId)
        const modelRef = agent ? (modelRefOverride.get(agentId) ?? agent.modelRef) : undefined
        const limit = modelRef
          ? (contextWindowMapRef.current.get(modelRef) ?? 0)
          : (contextWindowMapRef.current.values().next().value ?? 0) // fallback: first model's window
        if (limit > 0) {
          const percent = Math.round((used / limit) * 100)
          setContextMap(prev => new Map(prev).set(agentId, { used, limit, percent }))
        }
      }
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
    // Ignore assistant deltas from aborted turns — the abort counter is > 0
    // until the aborted turn's turn_end arrives and consumes it.
    const abortCount = abortCountRef.current.get(agentId) ?? 0
    // Also check abort timestamp — even after abortCount is consumed by turn_end,
    // late chat_delta/chat_new_messages from the aborted turn may still arrive.
    // Filter assistant messages with timestamp <= abortTime + 10s grace period.
    const abortTime = abortTimestampRef.current.get(agentId)
    const abortCutoff = abortTime ? abortTime + 10_000 : 0
    const effectiveItems = deltaItems.filter(item => {
      if (clearTime !== undefined && item.timestamp <= clearTime) return false
      if (abortCount > 0 && item.role === 'assistant') return false
      if (abortCutoff > 0 && item.role === 'assistant' && item.timestamp <= abortCutoff) return false
      return true
    })
    if (effectiveItems.length === 0) return

    // NOTE: Do NOT clear thinking on assistant message arrival.
    // In multi-turn responses (agent uses tools then calls LLM again), clearing
    // here would hide the typing indicator between turns. Instead, thinking is
    // cleared only on turn_end (agent_end hook) in handleAgentEvent.

    setItems((prev) => {
      const existing = [...(prev.get(agentId) || [])]
      const existingIds = new Set(existing.map(i => i.id))
      let changed = false
      for (const item of effectiveItems) {
        if (existingIds.has(item.id)) {
          // For assistant messages, update usage/model if they changed
          // (e.g. retry scenario where the same entry id gets new usage)
          if (item.role === 'assistant' && item.kind === 'text') {
            const idx = existing.findIndex(e => e.id === item.id)
            if (idx >= 0) {
              const old = existing[idx]
              const oldUsage = old.usage
              const newUsage = item.usage
              const oldModel = old.model
              const newModel = item.model
              const usageChanged = !!newUsage && (
                !oldUsage ||
                oldUsage.input !== newUsage.input ||
                oldUsage.output !== newUsage.output
              )
              const modelChanged = !!newModel && oldModel !== newModel
              if (usageChanged || modelChanged) {
                existing[idx] = { ...old, ...item }
                changed = true
              }
            }
          }
          continue
        }
        if (item.role === 'user') {
          let localIdx = -1
          if (item.kind === 'text') {
            // Match by text content — find the LAST local- user message
            // with the same text that has NO assistant reply after it.
            // This handles retry scenarios where the original local message
            // timestamp was updated but the backend echo arrives with a
            // different timestamp (server time).
            for (let i = existing.length - 1; i >= 0; i--) {
              const entry = existing[i]
              if (
                entry.id.startsWith('local-') &&
                entry.kind === 'text' &&
                entry.role === 'user' &&
                entry.text === item.text
              ) {
                // Check no assistant reply exists after this message
                const hasReplyAfter = existing.slice(i + 1).some(e => e.role === 'assistant')
                if (!hasReplyAfter) {
                  localIdx = i
                  break
                }
              }
            }
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
    // ── Error event: API returned an error status ──
    // Display the error message in chat with a retry button (copy button preserved).
    if (event.type === 'error') {
      const routingKey = (event.agentId as string | undefined)
        ?? (event.npcId as string | undefined)
        ?? 'steward'
      // Ignore error events from an aborted turn. The aborted turn's agent_end
      // fires late with error + turn_end. We ignore the error here and let
      // turn_end consume the abort counter.
      // BUT: dispatch errors (recoverable=true, sent from channel.ts catch block)
      // are from the NEW retry message, not the aborted turn — they must NOT
      // be ignored, otherwise thinking stays forever.
      const abortCount = abortCountRef.current.get(routingKey) ?? 0
      const isDispatchError = event.recoverable === true
      if (abortCount > 0 && !isDispatchError) return
      // Clear thinking indicator — the turn has ended (with error)
      setThinkingFor(routingKey, false)
      // Add error message as an assistant text item with isError flag
      setItems(prev => {
        const existing = [...(prev.get(routingKey) || [])]
        existing.push({
          id: `err-${++globalMsgId}`,
          agentId: routingKey,
          timestamp: Date.now(),
          kind: 'text',
          role: 'assistant',
          text: String(event.message ?? '未知错误'),
          source: 'error',
          isError: true,
        })
        return new Map(prev).set(routingKey, existing)
      })
      // Clear accumulated thinking text (if any)
      setThinkingTextMap(prev => { const m = new Map(prev); m.delete(routingKey); return m })
      return
    }
    if (event.type === 'turn_end' || event.type === 'end') {
      // Use agentId (e.g. "citizen-citizen_6") as routing key — it matches
      // the key used by setThinkingFor in handleSend. Fall back to npcId
      // (e.g. "citizen_6") for backwards compatibility, then 'steward'.
      const routingKey = (event.agentId as string | undefined)
        ?? (event.npcId as string | undefined)
        ?? 'steward'
      // Ignore turn_end events from an aborted turn. Each abort increments
      // the counter; each late turn_end decrements it. When the counter
      // reaches 0, the next turn_end belongs to the current active turn.
      const abortCount = abortCountRef.current.get(routingKey) ?? 0
      if (abortCount > 0) {
        abortCountRef.current.set(routingKey, abortCount - 1)
        if (abortCount === 1) abortCountRef.current.delete(routingKey)
        return
      }
      setThinkingFor(routingKey, false)
      // Track compaction count (from agent_end hook payload)
      if (typeof event.compactionCount === 'number') {
        setCompactionMap(prev => new Map(prev).set(routingKey, event.compactionCount))
      }
      // Attach accumulated thinking text to the last assistant message (if any)
      const thinkingText = thinkingTextMapRef.current.get(routingKey)
      if (thinkingText) {
        setItems(prev => {
          const existing = [...(prev.get(routingKey) || [])]
          // Find the last assistant text message without reasoning
          for (let i = existing.length - 1; i >= 0; i--) {
            const it = existing[i]
            if (it.role === 'assistant' && it.kind === 'text' && !it.reasoning) {
              existing[i] = { ...it, reasoning: thinkingText }
              break
            }
          }
          return new Map(prev).set(routingKey, existing)
        })
        setThinkingTextMap(prev => { const m = new Map(prev); m.delete(routingKey); return m })
      }
    }
    // Accumulate thinking/reasoning deltas for live display
    if (event.type === 'thinking_delta' && event.delta) {
      const routingKey = (event.agentId as string | undefined)
        ?? (event.npcId as string | undefined)
        ?? 'steward'
      setThinkingTextMap(prev => {
        const existing = prev.get(routingKey) ?? ''
        return new Map(prev).set(routingKey, existing + event.delta)
      })
    }
    // Update context window usage info
    if (event.type === 'context_update' && event.tokens) {
      const agent = selectedAgentRef.current
      const routingKey = agent ? getAgentRoutingKey(agent) : 'steward'
      setContextMap(prev => new Map(prev).set(routingKey, {
        used: event.tokens.used ?? 0,
        limit: event.tokens.limit ?? 0,
        percent: event.tokens.percent ?? 0,
      }))
      // Attach cache stats to the last assistant message (if present in usage)
      const cacheRead = event.usage?.cacheRead
      const cacheWrite = event.usage?.cacheWrite
      if ((typeof cacheRead === 'number' && cacheRead > 0) || (typeof cacheWrite === 'number' && cacheWrite > 0)) {
        setItems(prev => {
          const existing = [...(prev.get(routingKey) || [])]
          for (let i = existing.length - 1; i >= 0; i--) {
            const it = existing[i]
            if (it.role === 'assistant' && it.kind === 'text') {
              existing[i] = {
                ...it,
                usage: {
                  ...(it.usage ?? { input: 0, output: 0 }),
                  ...(typeof cacheRead === 'number' ? { cacheRead } : {}),
                  ...(typeof cacheWrite === 'number' ? { cacheWrite } : {}),
                },
              }
              break
            }
          }
          return new Map(prev).set(routingKey, existing)
        })
      }
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
    // Clear this citizen's typing indicator (double safety alongside group_chat_typing_done)
    if (msg.speakerNpcId !== 'user' && msg.speakerNpcId !== 'system') {
      setGroupTypingCitizens(prev => {
        if (!prev.has(msg.speakerNpcId)) return prev
        const next = new Map(prev)
        next.delete(msg.speakerNpcId)
        return next
      })
    }
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

  // A citizen started composing a reply in group chat
  const handleGroupChatTyping = useCallback((citizen: { npcId: string; speakerName: string }) => {
    setGroupTypingCitizens(prev => {
      if (prev.has(citizen.npcId)) return prev
      const next = new Map(prev)
      next.set(citizen.npcId, citizen.speakerName)
      return next
    })
  }, [])

  // A citizen finished composing a reply in group chat
  const handleGroupChatTypingDone = useCallback((npcId: string) => {
    setGroupTypingCitizens(prev => {
      if (!prev.has(npcId)) return prev
      const next = new Map(prev)
      next.delete(npcId)
      return next
    })
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
    onGroupChatTyping: handleGroupChatTyping,
    onGroupChatTypingDone: handleGroupChatTypingDone,
  })
  const connectedRef = useRef(connected)
  connectedRef.current = connected

  // Request group chat init on connect (also re-init on reconnect)
  useEffect(() => {
    if (connected && visible && isLive) {
      // Reset on each connect so reconnect re-fetches group chat state/history
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
    if (!connectedRef.current) {
      setGroupMessages(prev => [...prev, {
        sequenceId: Date.now(),
        timestamp: Date.now(),
        speakerNpcId: 'system',
        speakerName: '系统',
        text: '⚠️ 网络已断开，请刷新页面重新连接。',
        mentions: [],
        groupId: groupInfo.groupId,
        groupName: groupInfo.groupName,
      }])
      return
    }
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
    // Reset sync ref on reconnect so we re-bind chat agent and re-request history
    if (connected) {
      lastAgentSyncRef.current = ''
    }
  }, [connected, onConnectedChange])

  // Fetch model options once for the agent model selector
  useEffect(() => {
    let cancelled = false
    async function loadModels() {
      try {
        const resp = await fetch('/citizen-workshop/_api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const data = await resp.json()
        if (cancelled || !data.options) return
        setModelOptions(data.options)
        // Build contextWindow map: modelRef → contextWindow limit
        const cwMap = new Map<string, number>()
        for (const opt of data.options) {
          if (typeof opt.contextWindow === 'number' && opt.contextWindow > 0) {
            cwMap.set(opt.value, opt.contextWindow)
          }
        }
        contextWindowMapRef.current = cwMap
      } catch {
        // ignore — model selector just won't show options
      }
    }
    loadModels()
    return () => { cancelled = true }
  }, [])

  // Close model menu on outside click
  useEffect(() => {
    if (!modelMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [modelMenuOpen])

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
    // Always request history; handleHistoryItems will filter out messages
    // older than the clear timestamp (clearedAgentsRef)
    requestHistory(agentKey)
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

  // Update the selected agent's LLM model via the backend API
  const handleUpdateAgentModel = useCallback(async (modelRef: string | undefined) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const agentId = agent.type === 'steward' ? 'town-steward' : (agent.agentId ?? agent.id)
    const routingKey = getAgentRoutingKey(agent)
    setModelUpdating(true)
    setModelMenuOpen(false)
    // Optimistically update the override map so the UI reflects immediately
    setModelRefOverride(prev => {
      const next = new Map(prev)
      if (modelRef === undefined) next.delete(routingKey)
      else next.set(routingKey, modelRef)
      return next
    })
    try {
      const resp = await fetch('/citizen-workshop/_api/update-agent-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, modelRef: modelRef ?? null }),
      })
      const data = await resp.json()
      if (data.success) {
        // Update the agent in the local agents list so the UI reflects the change
        onAgentChange?.({ ...agent, modelRef: modelRef ?? undefined })
      } else {
        // Revert on failure
        setModelRefOverride(prev => {
          const next = new Map(prev)
          next.delete(routingKey)
          return next
        })
      }
    } catch {
      // Revert on failure
      setModelRefOverride(prev => {
        const next = new Map(prev)
        next.delete(routingKey)
        return next
      })
    } finally {
      setModelUpdating(false)
    }
  }, [onAgentChange])

  const handleSend = useCallback((text: string) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    if (!connectedRef.current) {
      addSystemMessage(routingKey, '⚠️ 网络已断开，请刷新页面重新连接。')
      return
    }
    // Note: we do NOT delete the cleared timestamp — it stays so that stale
    // transcript messages (from before the clear) are always filtered out.
    // New messages naturally have timestamps > clearTime so they pass through.
    setThinkingFor(routingKey, true)
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
  }, [sendChat, sendCitizenChat, addSystemMessage])

  const handleSendMultimodal = useCallback((parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string; fileName?: string }>) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    if (!connectedRef.current) {
      addSystemMessage(routingKey, '⚠️ 网络已断开，请刷新页面重新连接。')
      return
    }
    // Note: we do NOT delete the cleared timestamp — see handleSend for rationale.
    setThinkingFor(routingKey, true)

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
  }, [sendMultimodal, addSystemMessage])

  // Clear current chat session: local messages + backend /clear command
  const performClearChat = useCallback(() => {
    // ── Group chat clear ──
    if (groupChatActive) {
      const groupId = groupInfo?.groupId ?? 'town-square'
      // Mark cleared timestamp — prevents stale history reload from backend
      groupClearedAtRef.current = Date.now()
      saveGroupClearedAt(groupClearedAtRef.current)
      // Clear local messages
      setGroupMessages([])
      setGroupThinking(false)
      setGroupTypingCitizens(new Map())
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
    saveClearedAgents(clearedAgentsRef.current)
    // Clear any pending abort counter — the session is being cleared
    abortCountRef.current.delete(routingKey)

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
    setThinkingFor(routingKey, false)

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

  // Compact current chat session: sends /compact to Gateway to compress conversation history
  const handleCompactChat = useCallback(() => {
    if (compacting) return
    // Group chat compact
    if (groupChatActive) {
      setCompacting(true)
      // /compact is a gateway command; for group chat we send it via the group message channel
      // by routing it as a regular command through the steward session
      sendCommand('compact', '')
      setTimeout(() => setCompacting(false), 3000)
      return
    }
    // Single agent compact
    const agent = selectedAgentRef.current
    const routingKey = agent ? getAgentRoutingKey(agent) : 'steward'
    setCompacting(true)
    sendCommand('compact', '')
    addSystemMessage(routingKey, t('chat.compact') + '...')
    setTimeout(() => setCompacting(false), 3000)
  }, [compacting, groupChatActive, sendCommand, addSystemMessage])

  // Retry: delete the agent's previous reply after the user message,
  // then re-send the user message to get a fresh response (no new user message added)
  const handleRetry = useCallback((text: string) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    if (!connectedRef.current) {
      addSystemMessage(routingKey, '⚠️ 网络已断开，请刷新页面重新连接。')
      return
    }
    // If the agent is currently thinking (active turn), abort it first so
    // that the late turn_end from the aborted turn is properly ignored.
    // For citizen agents, pass the agentId/npcId so the backend can abort
    // the citizen's session (not just the steward's).
    if (thinkingMap.get(routingKey)) {
      abortCountRef.current.set(routingKey, (abortCountRef.current.get(routingKey) ?? 0) + 1)
      abortTimestampRef.current.set(routingKey, Date.now())
      sendAbort(agent.type === 'steward' ? undefined : { agentId: routingKey, npcId: agent.id })
    }
    // Remove all messages after the last matching user message (i.e. the agent's reply)
    // and mark the user message with a fresh local- id so the backend echo can match it
    setItems((prev) => {
      const existing = [...(prev.get(routingKey) || [])]
      // Find the last user text message matching the retry text
      let lastUserIdx = -1
      for (let i = existing.length - 1; i >= 0; i--) {
        const it = existing[i]
        if (it.role === 'user' && it.kind === 'text' && it.text === text) {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx >= 0) {
        // Keep everything up to and including the user message; drop the rest
        existing.splice(lastUserIdx + 1)
        // Reset the user message to a fresh local- entry so the backend echo
        // can match it via the dedup logic in handleDeltaItems (which looks
        // for local- prefix). The original message may have been replaced by
        // a backend echo (msg: prefix) from a previous send/retry cycle.
        existing[lastUserIdx] = {
          ...existing[lastUserIdx],
          id: `local-${++globalMsgId}`,
          timestamp: Date.now(),
        }
      }
      return new Map(prev).set(routingKey, existing)
    })
    setThinkingFor(routingKey, true)
    // Re-send the message to the backend (no new local user message — the original stays)
    if (agent.type === 'steward') sendChat(text)
    else sendCitizenChat(agent.id, text)
  }, [sendChat, sendCitizenChat, sendAbort, addSystemMessage, setThinkingFor, thinkingMap])

  const handleEdit = useCallback((msgId: string, _oldText: string, newText: string) => {
    const agent = selectedAgentRef.current
    if (!agent) return
    const routingKey = getAgentRoutingKey(agent)
    if (!connectedRef.current) {
      addSystemMessage(routingKey, '⚠️ 网络已断开，请刷新页面重新连接。')
      return
    }
    // If the agent is currently thinking (active turn), abort it first so
    // that the late turn_end from the aborted turn is properly ignored.
    // For citizen agents, pass the agentId/npcId so the backend can abort
    // the citizen's session (not just the steward's).
    if (thinkingMap.get(routingKey)) {
      abortCountRef.current.set(routingKey, (abortCountRef.current.get(routingKey) ?? 0) + 1)
      abortTimestampRef.current.set(routingKey, Date.now())
      sendAbort(agent.type === 'steward' ? undefined : { agentId: routingKey, npcId: agent.id })
    }
    // Replace the user message with the new text and remove all subsequent messages
    setItems((prev) => {
      const existing = [...(prev.get(routingKey) || [])]
      // Find the user message by its id (exact match, not by text)
      const editIdx = existing.findIndex(it => it.id === msgId)
      if (editIdx >= 0) {
        // Keep everything up to and including the user message; drop the rest
        existing.splice(editIdx + 1)
        // Replace the user message text and reset to a fresh local- entry
        existing[editIdx] = {
          ...existing[editIdx],
          id: `local-${++globalMsgId}`,
          text: newText,
          timestamp: Date.now(),
        }
      }
      return new Map(prev).set(routingKey, existing)
    })
    setThinkingFor(routingKey, true)
    // Send the edited message to the backend
    if (agent.type === 'steward') sendChat(newText)
    else sendCitizenChat(agent.id, newText)
  }, [sendChat, sendCitizenChat, sendAbort, addSystemMessage, setThinkingFor, thinkingMap])

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
        abortCountRef.current.set(routingKey, (abortCountRef.current.get(routingKey) ?? 0) + 1)
        abortTimestampRef.current.set(routingKey, Date.now())
        sendAbort(!agent || agent.type === 'steward' ? undefined : { agentId: routingKey, npcId: agent.id })
        setThinkingFor(routingKey, false)
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
    // Do NOT clear thinking — it's per-agent now, switching agents should not
    // interrupt another agent's typing indicator.
    setGroupChatActive(false)
    try { localStorage.setItem(CHAT_VIEW_MODE_STORAGE_KEY, 'agent') } catch {}
    onAgentChange?.(agent)
  }, [onAgentChange])

  const currentRoutingKey = getAgentRoutingKey(selectedAgent)
  const currentHasMore = hasMoreMap.get(currentRoutingKey) ?? false
  const currentCursor = cursorMap.get(currentRoutingKey) ?? ''
  const currentThinking = thinkingMap.get(currentRoutingKey) ?? false
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

  const handleToggleAgentListCollapse = useCallback(() => {
    setAgentListCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(AGENT_LIST_COLLAPSED_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  // Effective model ref: override map takes priority, then agent's modelRef
  const effectiveModelRef = selectedAgent
    ? (modelRefOverride.get(currentRoutingKey) ?? selectedAgent.modelRef)
    : undefined
  // Context window usage for the current agent (shown next to model id in header)
  const currentContextInfo = contextMap.get(currentRoutingKey)
  // Compaction count for the current agent (shown next to ctx in header)
  const currentCompactionCount = compactionMap.get(currentRoutingKey)

  return (
    <div className="flex h-full" style={{ display: visible ? undefined : 'none' }}>
      <div className={cn(
        'border-r border-border-subtle bg-bg-surface md:bg-bg-canvas shrink-0 overflow-hidden min-h-0 relative',
        agentListCollapsed ? 'w-full md:w-16' : 'w-full md:w-60 lg:w-64',
        (selectedAgent || groupChatActive) ? 'hidden md:flex md:flex-col' : 'flex flex-col',
      )}>
        {/* Collapse toggle button (desktop only) */}
        <button
          onClick={handleToggleAgentListCollapse}
          className="hidden md:flex absolute top-2 right-2 z-10 items-center justify-center w-6 h-6 rounded-lg text-text-quaternary hover:text-text-secondary hover:bg-bg-elevated/60 cursor-pointer transition-colors duration-150"
          title={agentListCollapsed ? t('chat.expand_list') : t('chat.collapse_list')}
        >
          {agentListCollapsed ? <PanelLeftOpen size={14} strokeWidth={1.8} /> : <PanelLeftClose size={14} strokeWidth={1.8} />}
        </button>
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
            collapsed={agentListCollapsed}
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
            onCompact={handleCompactChat}
            compacting={compacting}
            thinking={groupThinking}
            typingCitizens={groupTypingCitizens}
            onRetry={handleSendGroupMessage}
          />
        ) : selectedAgent ? (
          <>
            <div className="hidden md:flex items-center gap-2 px-4 py-1 select-none shrink-0">
              <span className="text-[13px] font-semibold text-brand-secondary">{selectedAgent.name}</span>
              {selectedAgent.specialty && (
                <span className="text-[11px] text-text-quaternary/70">（{selectedAgent.specialty}）</span>
              )}
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                agentOnline ? 'bg-status-success' : 'bg-text-quaternary',
              )} />
              {/* Agent model selector */}
              {modelOptions.length > 0 && (
                <div ref={modelMenuRef} className="relative">
                  <button
                    onClick={() => setModelMenuOpen(o => !o)}
                    disabled={modelUpdating}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px]',
                      'transition-colors duration-150 cursor-pointer',
                      modelMenuOpen
                        ? 'bg-bg-elevated text-text-primary'
                        : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/40',
                      modelUpdating && 'opacity-50 cursor-default',
                    )}
                    title={t('chat.change_model')}
                  >
                    <Cpu size={11} strokeWidth={1.8} />
                    <span className="max-w-[160px] truncate" title={effectiveModelRef ?? ''}>
                      {modelUpdating ? t('chat.updating_model') : (effectiveModelRef ? effectiveModelRef.split('/').slice(1).join('/') || effectiveModelRef : t('chat.default_model'))}
                    </span>
                    <ChevronDown size={10} strokeWidth={1.8} className="shrink-0" />
                    {currentContextInfo && currentContextInfo.limit > 0 && (
                      <span
                        className="text-text-quaternary/50 tabular-nums ml-0.5"
                        title={`上下文 ${formatTokens(currentContextInfo.used)}/${formatTokens(currentContextInfo.limit)}`}
                      >
                        ctx {currentContextInfo.percent}%
                      </span>
                    )}
                    {typeof currentCompactionCount === 'number' && currentCompactionCount > 0 && (
                      <span
                        className="text-text-quaternary/50 tabular-nums ml-0.5"
                        title={`上下文压缩次数 ${currentCompactionCount}`}
                      >
                        · 压缩 {currentCompactionCount}
                      </span>
                    )}
                  </button>
                  {modelMenuOpen && (
                    <div className="absolute left-0 top-full mt-1.5 min-w-[200px] max-h-[240px] overflow-y-auto styled-scrollbar py-2 rounded-2xl bg-bg-surface border border-border-subtle shadow-2xl shadow-black/60 z-50">
                      <button
                        onClick={() => handleUpdateAgentModel(undefined)}
                        className={cn(
                          'flex items-center w-full px-4 py-2 text-[12px] cursor-pointer transition-colors duration-150',
                          !effectiveModelRef
                            ? 'text-brand-primary font-medium bg-bg-elevated/40'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                        )}
                      >
                        {t('chat.default_model')}
                      </button>
                      {modelOptions.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => handleUpdateAgentModel(opt.value)}
                          className={cn(
                            'flex items-center w-full px-4 py-2 text-[12px] cursor-pointer transition-colors duration-150',
                            effectiveModelRef === opt.value
                              ? 'text-brand-primary font-medium bg-bg-elevated/40'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex-1" />
              <button
                onClick={handleCompactChat}
                disabled={compacting || currentThinking || !canSend}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-lg cursor-pointer',
                  'transition-colors duration-150',
                  'text-text-tertiary hover:text-brand-secondary hover:bg-[rgba(212,165,116,0.08)]',
                  (compacting || currentThinking || !canSend) && 'opacity-40 cursor-default',
                )}
                aria-label={t('chat.compact')}
                title={t('chat.compact')}
              >
                <Archive size={14} strokeWidth={1.5} className={compacting ? 'animate-pulse' : ''} />
              </button>
              <button
                onClick={handleClearChat}
                disabled={currentThinking || !canSend}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-lg cursor-pointer',
                  'transition-colors duration-150',
                  'text-text-tertiary hover:text-status-error hover:bg-[rgba(248,113,113,0.08)]',
                  (currentThinking || !canSend) && 'opacity-40 cursor-default',
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
              agentThinking={thinkingMap.get(currentRoutingKey) ?? false}
              liveThinkingText={thinkingTextMap.get(currentRoutingKey)}
              connected={connected}
              visible={visible}
              historyLoading={!isCurrentHistoryLoaded && (isStewardSelected || agentOnline)}
              loadingMore={historyLoading}
              hasMore={currentHasMore}
              onLoadMore={handleLoadMore}
              contextInfo={contextMap.get(currentRoutingKey)}
              onRetry={handleRetry}
              onEdit={handleEdit}
              retryDisabled={currentThinking || !canSend}
            />
            <ChatInputBar
              onSend={handleSend}
              onSendMultimodal={handleSendMultimodal}
              onCommand={handleCommand}
              disabled={(!canSend && isLive) || currentThinking}
              thinking={currentThinking}
              onAbort={() => {
                // Increment abort counter — late turn_end/error events from
                // the aborted turn will be ignored until the counter is consumed.
                abortCountRef.current.set(currentRoutingKey, (abortCountRef.current.get(currentRoutingKey) ?? 0) + 1)
                // Record abort timestamp — late chat_delta/chat_new_messages from
                // the aborted turn will be filtered by timestamp in handleDeltaItems.
                abortTimestampRef.current.set(currentRoutingKey, Date.now())
                sendAbort(selectedAgent?.type === 'steward' ? undefined : { agentId: currentRoutingKey, npcId: selectedAgent?.id })
                setThinkingFor(currentRoutingKey, false)
              }}
              placeholder={
                !agentOnline
                  ? `${selectedAgent.name} 当前离线`
                  : currentThinking
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
