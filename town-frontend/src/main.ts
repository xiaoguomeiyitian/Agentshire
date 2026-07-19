import './styles.css'
import { initLocale } from './i18n'
initLocale()

import { ensureAuthed } from './app/AuthGate'
import { t } from './i18n'
import { Engine } from './engine'
import { MainScene } from './game/MainScene'
import { PlatformBridge } from './platform/Bridge'
import { MockDataSource } from './data/MockDataSource'
import { TownConfigStore } from './data/TownConfigStore'
import type { IWorldDataSource } from './data/IWorldDataSource'
import { InputBar, type TownMessage } from './ui/InputBar'
import { loadSettings } from './ui/SettingsPanel'
import { resolveWsUrl } from './utils/ws-url'
import { apiUrl } from './utils/api-base'

interface WsHistoryMessage {
  role?: 'user' | 'assistant'
  text?: string
  timestamp?: number
  type?: 'text' | 'image' | 'video' | 'audio' | 'file'
  fileName?: string
}

function summarizeHistoryMessage(msg: WsHistoryMessage): string {
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text.trim()
  switch (msg.type) {
    case 'image':
      return t('media.image')
    case 'video':
      return msg.fileName?.trim() || t('media.video')
    case 'audio':
      return msg.fileName?.trim() || t('media.audio')
    case 'file':
      return msg.fileName?.trim() || t('media.file')
    default:
      return ''
  }
}

function createTownSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `town-${crypto.randomUUID()}`
  }
  return `town-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function formatTownSessionLabel(townSessionId: string): string {
  if (townSessionId.length <= 24) return townSessionId
  return `${townSessionId.slice(0, 12)}...${townSessionId.slice(-8)}`
}

function applyHtmlLocale(): void {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!
    const translated = t(key)
    if (translated !== key) el.textContent = translated
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!
    const translated = t(key)
    if (translated !== key) el.setAttribute('title', translated)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')!
    const translated = t(key)
    if (translated !== key) (el as HTMLTextAreaElement).placeholder = translated
  })
  const backBtn = document.getElementById('back-btn')
  if (backBtn) backBtn.textContent = t('back_to_town')
  const moreBtn = document.getElementById('town-more-btn')
  if (moreBtn) moreBtn.innerHTML = `${t('more_btn')} <span style="font-size:10px;">▾</span>`
}

async function main() {
  // ── 门卫：启动前先验票 ──
  // 未登录会跳转 /login 并返回 false；此时中止后续初始化，
  // 不 new Engine / MainScene / WebSocket，避免 WS 握手被拒、场景空转报错。
  const authed = await ensureAuthed()
  if (!authed) return

  const params = new URLSearchParams(location.search)

  const container = document.getElementById('game-container')
  if (!container) throw new Error('game-container not found')

  const engine = new Engine(container)
  await engine.init()

  applyHtmlLocale()

  const configStore = new TownConfigStore()
  const initialTownSessionId =
    params.get('townSessionId') || configStore.getSessionId() || createTownSessionId()
  configStore.setSessionId(initialTownSessionId)

const useMock = params.get('mock') === 'true'
const syncTownSessionUrl = (townSessionId: string) => {
  const url = new URL(window.location.href)
  url.searchParams.set('townSessionId', townSessionId)
  if (useMock) url.searchParams.set('mock', 'true')
    history.replaceState({}, '', url.toString())
  }

  const syncTownSessionLabel = (townSessionId: string) => {
    const el = document.getElementById('town-session-label')
    if (!el) return
    el.textContent = `${t('session_label')}: ${formatTownSessionLabel(townSessionId)}`
    el.setAttribute('title', townSessionId)
  }

  syncTownSessionUrl(initialTownSessionId)
  syncTownSessionLabel(initialTownSessionId)

  let dataSource: IWorldDataSource

  let bridgeModule: any = null
  let townWs: WebSocket | null = null
  const wsSend = (data: any) => {
    if (townWs && townWs.readyState === WebSocket.OPEN) {
      townWs.send(JSON.stringify(data))
    }
  }
  // ── Chat history restore state (issue: refresh loses chat history) ──
  let townSessionBound = false
  /** Guards against duplicate animal_state_load requests (sent once per WS session). */
  let animalStateRequested = false
  /** Cached animal_state response when sceneRef is null on arrival. Applied after loadScene. */
  let pendingAnimalState: { snapshots: any[]; clock: any; runtime: any; economy: any } | null = null
  /** Flag: animal_state restore completed but topicState not yet restored
   * (topicState is declared after the deferred restore point, so we defer
   * the topic UI restoration to after refreshQuickActions is wired up). */
  let pendingTopicRestore = false
  /** Module-level ref to applyRestoredTopic (defined after quick actions are
   * wired up). Lets the WS animal_state handler trigger topic restore even
   * when animal_state arrives after loadScene completes. */
  let applyRestoredTopicRef: (() => void) | null = null as (() => void) | null
  /** Group chat state (declared early to avoid TDZ if group_chat_info arrives before line 693). */
  let groupChatState: GroupChatState | null = null
  const pendingHistoryNpcIds = new Map<string, string>() // agentId → npcId
  let requestAllCitizenHistoryRetries = 0

  // Request chat history for every agent-enabled citizen (called after WS binds
  // and after the scene is ready — whichever happens last).
  const requestAllCitizenHistory = (scene: MainScene | null) => {
    if (!scene || !townSessionBound) return
    // Scene init() may not have completed yet (gameClock and bootstrap are set during init).
    // Defer the request until the scene is fully ready.
    if (!(scene as any).gameClock || !(scene as any).bootstrap) {
      if (requestAllCitizenHistoryRetries < 10) {
        requestAllCitizenHistoryRetries++
        setTimeout(() => requestAllCitizenHistory(scene), 1000)
      }
      return
    }
    const citizens = scene.getAgentEnabledCitizens()
    if (citizens.length === 0) {
      // Scene bootstrap (loadFinalConfig) may still be in progress — retry shortly.
      // The agentConfigMap is populated asynchronously after fetch returns.
      if (requestAllCitizenHistoryRetries < 10) {
        requestAllCitizenHistoryRetries++
        setTimeout(() => requestAllCitizenHistory(scene), 1000)
      }
      return
    }
    requestAllCitizenHistoryRetries = 0
    for (const c of citizens) {
      const agentId = scene.getAgentIdForNpc(c.id)
      if (!agentId || agentId === 'steward') continue
      pendingHistoryNpcIds.set(agentId, c.id)
      wsSend({ type: 'chat_history_request', agentId, format: 'messages', limit: 50 })
    }
  }

  // Restore citizen chat history (user + assistant) into ChatPanel with correct
  // targetNpcId so the NPC card detail "聊天记录" tab shows the full conversation.
  const restoreCitizenHistoryFromServer = (
    scene: MainScene | null,
    agentId: string,
    messages: WsHistoryMessage[],
  ) => {
    if (!scene) return
    const npcId = pendingHistoryNpcIds.get(agentId)
    if (!npcId) return
    pendingHistoryNpcIds.delete(agentId)
    if (!Array.isArray(messages) || messages.length === 0) return

    const npc = scene.getNpcManager().get(npcId)
    const npcLabel = npc?.label ?? npc?.name ?? npcId
    const mayorLabel = t('mayor')
    const chatPanel = scene.getUIManager().getChatPanel()
    const existingMsgs = chatPanel.getChatMessages()
    // Deduplicate: skip if a message with the same text+role already exists
    // for this citizen (avoid double-adding when live stream already captured it).
    const existingKeys = new Set(existingMsgs.map(m => `${m.from}:${m.text}`))

    // Sort by timestamp ascending so the conversation order is preserved
    const sorted = [...messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    let added = 0
    for (const msg of sorted) {
      const text = summarizeHistoryMessage(msg)
      if (!text) continue
      if (msg.role === 'user') {
        const key = `${mayorLabel}:${text}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)
        chatPanel.addChatMessage({
          from: mayorLabel, text, timestamp: msg.timestamp ?? Date.now(),
          targetNpcId: npcId,
        })
        added++
      } else if (msg.role === 'assistant') {
        const key = `${npcLabel}:${text}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)
        chatPanel.addChatMessage({
          from: npcLabel, text, timestamp: msg.timestamp ?? Date.now(),
        })
        added++
      }
    }
    if (added > 0) {
      console.log(`[main] Restored ${added} chat history messages for citizen ${npcId} (agentId=${agentId})`)
    }
  }

  const implicitChatPending = new Map<string, { resolve: (v: { text: string; usage?: { input: number; output: number } }) => void; timer: ReturnType<typeof setTimeout> }>()
  const seenCitizenMessageKeys = new Set<string>()

  // implicitChat: sends implicit_chat_request via WS, awaits implicit_chat_response
  // Used by AgentBrain / AutonomyEngine / TownJournal for LLM-driven NPC behavior.
  const implicitChat = (req: {
    scene: string; system: string; user: string; maxTokens?: number; extraStop?: string[]; npcId?: string; agentId?: string
  }): Promise<{ text: string; fallback: boolean }> => {
    const id = `${req.scene}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        implicitChatPending.delete(id)
        console.warn(`[main] implicitChat timeout scene=${req.scene} npcId=${req.npcId ?? '-'}`)
        resolve({ text: '', fallback: true })
      }, 120000)
      implicitChatPending.set(id, {
        resolve: (v) => resolve({ text: v.text ?? '', fallback: !v.text }),
        timer,
      })
      wsSend({
        type: 'implicit_chat_request',
        id,
        scene: req.scene,
        system: req.system,
        user: req.user,
        maxTokens: req.maxTokens ?? 200,
        stop: req.extraStop ?? [],
        ...(req.agentId ? { agentId: req.agentId } : {}),
      })
    })
  }

  if (!useMock) {
    // @ts-ignore -- resolved by Vite alias at runtime
    bridgeModule = await import('agentshire_bridge')
    const wsParam = params.get('ws')
    const wsUrl = resolveWsUrl(wsParam)

    const { DirectorBridge } = bridgeModule
    const director = new DirectorBridge()

    let ws: WebSocket | null = null
    townWs = null
    let wsReady = false
    let wsEverConnected = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectCount = 0
    const RECONNECT_DELAY = 3000
    const RECONNECT_MAX_DELAY = 30000
    const RECONNECT_MAX_ATTEMPTS = 20

    const showWsError = () => {
      if (document.getElementById('ws-error-banner')) return
      const banner = document.createElement('div')
      banner.id = 'ws-error-banner'
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '9999',
        padding: '12px 16px', background: 'rgba(200,50,50,0.92)', color: '#fff',
        fontSize: '13px', lineHeight: '1.6', textAlign: 'center', fontFamily: 'system-ui, sans-serif',
      })
      banner.textContent = t('ws.error', { url: wsUrl })
      document.body.appendChild(banner)
    }
    const hideWsError = () => {
      document.getElementById('ws-error-banner')?.remove()
    }

    const bindTownSession = (townSessionId: string) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'town_session_init', townSessionId, sceneCapable: true }))
    }

    const forwardCitizenMessagesToScene = (
      scene: MainScene | null,
      payload: { npcId?: string; messages?: WsHistoryMessage[] },
    ) => {
      if (!scene || typeof payload.npcId !== 'string' || !payload.npcId) return
      const assistantMessages = Array.isArray(payload.messages)
        ? payload.messages.filter((msg) => msg?.role === 'assistant')
        : []
      // Issue 1: get existing chat messages to deduplicate against the live stream path
      const existingMsgs = scene.getUIManager().getChatPanel().getChatMessages()
      const existingTexts = new Set(existingMsgs.map(m => m.text))

      for (const msg of assistantMessages) {
        const text = summarizeHistoryMessage(msg)
        if (!text) continue
        const key = `${payload.npcId}:${msg.timestamp ?? 0}:${msg.type ?? 'text'}:${text}`
        if (seenCitizenMessageKeys.has(key)) continue
        seenCitizenMessageKeys.add(key)
        // Issue 1: skip if the live stream path already added this exact text
        if (existingTexts.has(text)) continue
        scene.handleGameEvent({ type: 'npc_look_at', npcId: payload.npcId, targetNpcId: 'user' })
        scene.handleGameEvent({ type: 'dialog_message', npcId: payload.npcId, text, isStreaming: false })
      }
    }

    // ── Chat history restore (issue: refresh loses chat history) ──
    // On page refresh, the in-memory ChatPanel is cleared. The backend stores
    // full JSONL history per citizen agent. We proactively request history for
    // every agent-enabled citizen after WS binds + scene is ready, then restore
    // both user and assistant messages into ChatPanel (with correct targetNpcId).
    // (requestAllCitizenHistory / restoreCitizenHistoryFromServer are defined
    //  at top-level so they can be called both from WS handlers inside this
    //  block and after loadScene.)

    function attachWsHandlers(socket: WebSocket) {
    socket.onopen = () => {
      wsReady = true
      wsEverConnected = true
      reconnectCount = 0
      hideWsError()
      console.log('[main] DirectorBridge WS connected')
      bindTownSession(configStore.getSessionId() || initialTownSessionId)
      // Notify scene that gateway is online
      if (sceneRef) sceneRef.onConnectionChange(true)
      // Initialize default group chat (deferred to avoid TDZ)
      setTimeout(() => wsSend({ type: 'group_chat_init' }), 100)
    }

    socket.onmessage = (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data)
        if (data.type === 'agent_event' && data.event) {
          const evt = data.event
          if (evt.type === 'deliverable_card' || evt.type === 'media_preview') {
            if (sceneRef) sceneRef.handleGameEvent(evt)
          } else if (evt.type === 'world_control' && ((evt as any).target === 'scene' || (evt as any).target === 'query_npc' || (evt as any).target === 'move_npc')) {
            // Scene editing + NPC spatial query/move events → DirectorBridge → EventTranslator → MainScene
            director.processAgentEvent(evt)
          } else if (evt.type === 'fx') {
            // Visual effect events → DirectorBridge → EventTranslator → MainScene.onFx
            director.processAgentEvent(evt)
          } else if (evt.npcId && evt.npcId !== 'steward') {
            director.processCitizenEvent(evt.npcId, evt)
          } else {
            director.processAgentEvent(evt)
          }
          // Issue 3: capture usage/model/contextInfo from turn_end / context_update / llm_call
          // and attach to the last assistant message for the current dialog target.
          if (sceneRef) {
            const targetName = sceneRef.getDialogTargetDisplayName()
            if (targetName) {
              if (evt.type === 'turn_end' && evt.usage) {
                const u = evt.usage
                sceneRef.getUIManager().updateLastAssistantMeta(targetName, {
                  usage: {
                    input: u.inputTokens,
                    output: u.outputTokens,
                    totalTokens: u.inputTokens + u.outputTokens,
                    reasoningTokens: u.thinkingTokens,
                    cacheRead: u.cacheRead,
                    cacheWrite: u.cacheWrite,
                  },
                })
              } else if (evt.type === 'context_update' && evt.tokens) {
                sceneRef.getUIManager().updateLastAssistantMeta(targetName, {
                  contextInfo: { used: evt.tokens.used, limit: evt.tokens.limit, percent: evt.tokens.percent },
                  ...(evt.usage ? {
                    usage: {
                      input: evt.usage.inputTokens,
                      output: evt.usage.outputTokens,
                      totalTokens: evt.usage.inputTokens + evt.usage.outputTokens,
                      reasoningTokens: evt.usage.thinkingTokens,
                      cacheRead: evt.usage.cacheRead,
                      cacheWrite: evt.usage.cacheWrite,
                    },
                  } : {}),
                })
              } else if (evt.type === 'llm_call' && evt.subtype === 'start' && evt.model) {
                sceneRef.getUIManager().updateLastAssistantMeta(targetName, { model: evt.model })
              }
            }
          }
        } else if (data.type === 'chat_new_messages' && data.npcId) {
          forwardCitizenMessagesToScene(sceneRef, data)
        } else if (data.type === 'group_chat_message' && data.groupId) {
          // Group chat message from backend
          const chatPanel = sceneRef?.getUIManager().getChatPanel()
          if (chatPanel) {
            chatPanel.addGroupMessage({
              sequenceId: data.sequenceId,
              timestamp: data.timestamp,
              speakerNpcId: data.speakerNpcId,
              speakerName: data.speakerName,
              text: data.text,
              mentions: data.mentions ?? [],
              groupId: data.groupId,
              groupName: data.groupName,
            })
          }
        } else if (data.type === 'group_chat_info' && data.groupId) {
          // Group chat info (participants, etc.)
          if (!groupChatState) {
            groupChatState = {
              active: false,
              groupId: data.groupId,
              groupName: data.groupName,
              participants: (data.participants ?? []).map((p: any) => ({
                npcId: p.npcId,
                name: p.name,
                specialty: p.specialty,
              })),
            }
          } else {
            groupChatState.participants = (data.participants ?? []).map((p: any) => ({
              npcId: p.npcId,
              name: p.name,
              specialty: p.specialty,
            }))
          }
          console.log(`[main] Group chat info: ${data.groupName} (${data.participants?.length ?? 0} participants)`)
        } else if (data.type === 'work_snapshot' && data.snapshot?.agents) {
          director.restoreWorkState(data.snapshot)
        } else if (data.type === 'town_session_bound' && data.townSessionId) {
          console.log(`[main] Bound to town session ${data.townSessionId}`)
          townSessionBound = true
          syncTownSessionLabel(data.townSessionId)
          if (typeof data.model === 'string' && data.model) {
            const el = document.querySelector('.tas-model')
            if (el) el.textContent = data.model
          }
          // Request persisted runtime state (NPC positions, clock, snapshots)
          // immediately after session bind, so state is restored even when
          // Animal Mode is disabled. Previously this was only sent from
          // AnimalModeManager.enable(), meaning a disabled Animal Mode
          // (e.g. user toggled it off) would skip the entire restore flow.
          // NOTE: send this BEFORE requestAllCitizenHistory() — if that
          // function throws inside the try/catch, the animal_state_load
          // would never be sent.
          if (!animalStateRequested) {
            animalStateRequested = true
            console.log('[main] town_session_bound → sending animal_state_load')
            wsSend({ type: 'animal_state_load' })
          }
          // Issue: restore chat history after refresh — request history for all
          // agent-enabled citizens once the scene is ready.
          requestAllCitizenHistory(sceneRef)
        } else if (data.type === 'chat_history' && Array.isArray(data.messages) && typeof data.agentId === 'string') {
          // Restore citizen chat history (format: 'messages') into ChatPanel
          restoreCitizenHistoryFromServer(sceneRef, data.agentId, data.messages as WsHistoryMessage[])
        } else if (data.type === 'implicit_chat_response' && typeof data.id === 'string') {
          const pending = implicitChatPending.get(data.id)
          if (pending) {
            implicitChatPending.delete(data.id)
            clearTimeout(pending.timer)
            pending.resolve({ text: data.text ?? '', usage: data.usage })
          }
        } else if (data.type === 'animal_state') {
          // Plugin returns persisted Animal Mode state (snapshots + clock + runtime)
          console.log(`[main] animal_state received: snapshots=${data.snapshots?.length ?? 0} clock=${data.clock ? 'yes' : 'no'} runtime=${data.runtime ? 'yes' : 'no'} economy=${data.economy ? 'yes' : 'no'}`)
          if (sceneRef) {
            // Check if scene is fully initialized (gameClock + bootstrap are set in init()).
            // If not, cache for deferred restore after loadScene completes.
            if ((sceneRef as any).gameClock && (sceneRef as any).bootstrap) {
              ;(sceneRef as any).restoreAnimalState(data.snapshots ?? [], data.clock ?? null, data.runtime ?? null)
              ;(sceneRef as any).restoreEconomyState?.(data.economy ?? null)
              if (applyRestoredTopicRef) applyRestoredTopicRef()
              else pendingTopicRestore = true
            } else {
              pendingAnimalState = { snapshots: data.snapshots ?? [], clock: data.clock ?? null, runtime: data.runtime ?? null, economy: data.economy ?? null }
              console.log('[main] animal_state: scene not yet initialized (gameClock missing), cached for deferred restore')
            }
          } else {
            // Scene not yet ready — cache for deferred restore after loadScene
            pendingAnimalState = { snapshots: data.snapshots ?? [], clock: data.clock ?? null, runtime: data.runtime ?? null, economy: data.economy ?? null }
            console.log('[main] animal_state: sceneRef is null, cached for deferred restore')
          }
        }
      } catch (err) { console.error('[main] WS message error:', err) }
    }

    socket.onclose = () => {
      wsReady = false
      ws = null
      townWs = null
      // Reset animal_state_load guard so reconnect re-requests state
      animalStateRequested = false
      console.log('[main] DirectorBridge WS closed')
      // Notify scene that gateway is offline
      if (sceneRef) sceneRef.onConnectionChange(false)
      if (!wsEverConnected) {
        showWsError()
      } else {
        // Auto-reconnect with exponential backoff (capped)
        scheduleReconnect()
      }
    }

    // Don't setConnected(false) on error: let onclose handle it (avoids flicker)
    socket.onerror = () => {}
    } // end attachWsHandlers

    function scheduleReconnect() {
      if (reconnectTimer) return
      if (reconnectCount >= RECONNECT_MAX_ATTEMPTS) {
        console.log('[main] Max reconnect attempts reached, showing error banner')
        showWsError()
        return
      }
      const delay = Math.min(RECONNECT_DELAY * Math.pow(1.5, reconnectCount), RECONNECT_MAX_DELAY)
      reconnectCount++
      console.log(`[main] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectCount})`)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connectWs()
      }, delay)
    }

    function connectWs() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
      try {
        ws = new WebSocket(wsUrl)
        townWs = ws
        attachWsHandlers(ws)
      } catch {
        wsReady = false
        scheduleReconnect()
      }
    }

    // Initial connection
    connectWs()

    let sceneRef: MainScene | null = null

    const directorDataSource: IWorldDataSource = {
      async connect(config: any) {
        let hasWorkRestore = false
        if (sceneRef) {
          director.onEmit((events: any[]) => {
            for (const e of events) sceneRef!.handleGameEvent(e)
          })
          hasWorkRestore = director.setTownConfig(config)
        }
        return { hasWorkRestore }
      },
      disconnect() { if (ws) ws.close() },
      get connected() { return wsReady },
      onGameEvent(_handler: (e: any) => void) {},
      sendAction(action: any) {
        if (action.type === 'user_message') {
          // Note: user bubble + chat message are added by InputBar.onUserMessage → scene.showUserBubble.
          // Do NOT call director.onUserMessage here — it emits a duplicate `dialog_message` (npcId='user')
          // which DialogManager would render as a second chat entry (issue: duplicate "你好").
          const targetId = action.targetNpcId ?? 'steward'
          if (targetId !== 'steward') {
            wsSend({ type: 'citizen_chat', npcId: targetId, message: action.text })
          } else {
            const wsMsg = director.processWorldAction(action)
            if (wsMsg) wsSend(wsMsg)
            else wsSend({ type: 'chat', body: [{ kind: 'text', text: action.text }] })
          }
        } else if (action.type === 'abort_requested') {
          wsSend({ type: 'abort' })
        } else if (action.type === 'npc_query_result') {
          // NPC spatial query result → backend (bypasses DirectorBridge)
          wsSend({ type: 'npc_query_result', requestId: action.requestId, data: action.data })
        } else if (action.type === 'animal_memory_event') {
          // Animal Mode memory event → plugin persistence
          wsSend({ type: 'animal_memory_event', npcId: action.npcId, entry: action.entry })
        } else if (action.type === 'animal_snapshot_save') {
          // Animal Mode ActivityJournal snapshot → plugin persistence
          wsSend({ type: 'animal_snapshot_save', npcId: action.npcId, snapshot: action.snapshot })
        } else if (action.type === 'animal_clock_save') {
          // Animal Mode GameClock state → plugin persistence
          wsSend({ type: 'animal_clock_save', state: action.state })
        } else if (action.type === 'animal_state_load') {
          // Request persisted state from plugin (on reconnect)
          wsSend({ type: 'animal_state_load' })
        } else if (action.type === 'town_runtime_save') {
          // Town runtime state (NPC positions, scene, topic, indoor) → plugin persistence
          wsSend({ type: 'town_runtime_save', state: action.state })
        } else if (action.type === 'economy_state_save') {
          // Citizen economy state (coins, reputation, savings) → plugin persistence
          wsSend({ type: 'economy_state_save', state: action.state })
        } else if (action.type === 'animal_memory_clear_all') {
          // Clear all memories on plugin side
          wsSend({ type: 'animal_memory_clear_all' })
        } else if (action.type === 'compact_citizen') {
          // Actively trigger /compact for a citizen's chat session
          wsSend({ type: 'compact_citizen', npcId: action.npcId })
        } else {
          const wsMsg = director.processWorldAction(action)
          if (wsMsg) wsSend(wsMsg)
        }
      },
      getSnapshot() { return null },
    }
    dataSource = directorDataSource

    ;(dataSource as any)._setScene = (s: MainScene) => { sceneRef = s }
    ;(dataSource as any)._executeRestore = () => { director.executePendingRestore() }
  } else {
    dataSource = new MockDataSource()
  }

  // ── Platform Bridge (created early so MainScene can forward bubble / town status) ──
  const bridge = new PlatformBridge()

  const scene = new MainScene(engine, dataSource, configStore)

  // Inject PlatformBridge so bubble content and town status are forwarded to the parent React App
  scene.setPlatformBridge(bridge)

  // Set scene reference for DirectorBridge (must be before loadScene which triggers init → startFlow → connect)
  if ((dataSource as any)._setScene) {
    (dataSource as any)._setScene(scene)
  }

  await engine.loadScene(scene)

  // If animal_state arrived before sceneRef was set, apply it now.
  if (pendingAnimalState) {
    console.log('[main] Applying deferred animal_state after loadScene')
    const ps = pendingAnimalState as { snapshots: any[]; clock: any; runtime: any; economy: any }
    ;(scene as any).restoreAnimalState(ps.snapshots, ps.clock, ps.runtime)
    ;(scene as any).restoreEconomyState?.(ps.economy)
    if (applyRestoredTopicRef) applyRestoredTopicRef()
    else pendingTopicRestore = true
    pendingAnimalState = null
  }

  // Issue: restore chat history after refresh — if WS already bound before scene
  // was ready, requestAllCitizenHistory was deferred. Now that the scene is ready
  // (agentConfigMap populated), retry the request.
  if (bridgeModule) {
    requestAllCitizenHistory(scene)
  }

  // Inject implicitChat function so AgentBrain / AutonomyEngine / TownJournal can call LLM via WS.
  // Must be after loadScene because dailyScheduler is initialized in scene.init().
  scene.setImplicitChatFn(implicitChat)

  // ── Send function for InputBar — routes messages via dataSource ──

  const startNewTownSession = () => {
    const currentConfig = configStore.load()
    const nextTownSessionId = createTownSessionId()
    configStore.setSessionId(nextTownSessionId)
    if (currentConfig) {
      configStore.save(currentConfig)
    }
    syncTownSessionUrl(nextTownSessionId)
    syncTownSessionLabel(nextTownSessionId)

    if (window.parent !== window) {
      const parentUrl = new URL(window.parent.location.href)
      parentUrl.searchParams.set('townSessionId', nextTownSessionId)
      window.parent.location.href = parentUrl.toString()
    } else {
      window.location.reload()
    }
  }

  const sendToBackend = (msg: TownMessage): void => {
    const targetNpcId = scene.getDialogTarget()
    if (msg.type === 'chat') {
      dataSource.sendAction({ type: 'user_message', targetNpcId, text: msg.message })
    } else if (msg.type === 'multimodal') {
      const textPart = msg.parts.find(p => p.kind === 'text')
      const text = textPart && 'text' in textPart ? textPart.text : '[image]'
      dataSource.sendAction({ type: 'user_message', targetNpcId, text })
    }
  }

  // ── InputBar ──

  document.body.classList.add('has-town-panel')

  // ── Topic mode state ──
  interface TopicState {
    npcIds: string[]
    phase: 'gathering' | 'active'
  }
  let topicState: TopicState | null = null

  // ── Group chat state ──
  interface GroupChatState {
    active: boolean
    groupId: string
    groupName: string
    participants: Array<{ npcId: string; name: string; specialty?: string; color?: number; avatarUrl?: string }>
  }
  // groupChatState is declared early (line ~130) to avoid TDZ if group_chat_info
  // arrives before this point in the code.

  const inputBar = new InputBar({
    send: (msg) => {
      if (groupChatState?.active && msg.type === 'chat') {
        // Group chat message
        wsSend({
          type: 'group_chat_message',
          groupId: groupChatState.groupId,
          message: msg.message,
          mentions: msg.mentions ?? [],
        })
      } else if (topicState?.phase === 'active' && msg.type === 'chat') {
        wsSend({ type: 'topic_message', npcIds: topicState.npcIds, message: msg.message })
      } else {
        sendToBackend(msg)
      }
    },
    onUserMessage: (text) => {
      scene.showUserBubble(text)
    },
    onNewSession: startNewTownSession,
  })

  const endTopicAndSwitch = () => {
    if (!topicState) return
    wsSend({ type: 'topic_end' })
    scene.dismissTopic()
    topicState = null
    scene.getUIManager().clearTopicIndicator()
    hideEndTopicBtn()
    inputBar.setBusy(false)
    const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
    if (textarea) textarea.placeholder = t('input.idle')
  }

  scene.getUIManager().initTopicCallbacks({ onEndTopic: endTopicAndSwitch })

  // ── "End topic" button ──
  const endTopicBtn = document.getElementById('town-end-topic-btn')

  let showEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = 'none' /* Issue 1: moved into quick action bar */ }
  let hideEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = 'none' }

  endTopicBtn?.addEventListener('click', () => {
    scene.getUIManager().showEndTopicConfirm()
  })

  // Issue 2: observe bottom panel resize (textarea grows) and reposition
  // NPC card, topic-detail-panel and model dropdown so they never overlap
  // the (possibly taller on mobile) input bar.
  const computeInputPanelBottom = (): number => {
    const bp = document.getElementById('town-bottom-panel')
    if (!bp) return document.body.classList.contains('embedded-mode') ? 134 : 124
    const rect = bp.getBoundingClientRect()
    const defaultBottom = document.body.classList.contains('embedded-mode') ? 134 : 124
    const panelTopFromBottom = window.innerHeight - rect.top
    const extra = Math.max(panelTopFromBottom - defaultBottom, 0)
    return defaultBottom + extra
  }
  const repositionFloatingPanels = (): void => {
    const bottom = computeInputPanelBottom()
    // NPC card (delegates to UIManager which guards display:none)
    scene.getUIManager().adjustNPCCardForInputPanel()
    // Topic detail panel
    const tdp = document.getElementById('topic-detail-panel')
    if (tdp) tdp.style.bottom = `${bottom}px`
    // Model dropdown
    const md = document.getElementById('town-model-dropdown')
    if (md) md.style.bottom = `${bottom}px`
  }
  const bottomPanelEl = document.getElementById('town-bottom-panel')
  if (bottomPanelEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      repositionFloatingPanels()
    })
    ro.observe(bottomPanelEl)
  }
  window.addEventListener('resize', repositionFloatingPanels)

  // ── Model switching (click tas-model to change current target's model) ──
  let modelOptionsCache: Array<{ value: string; label: string }> | null = null
  const tasModelEl = document.querySelector('.tas-model') as HTMLElement | null

  const fetchModelOptions = async (): Promise<Array<{ value: string; label: string }>> => {
    if (modelOptionsCache) return modelOptionsCache
    try {
      const resp = await fetch(apiUrl('/citizen-workshop/_api/models'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await resp.json()
      if (data.options) {
        modelOptionsCache = data.options
        return data.options
      }
    } catch { /* ignore */ }
    return []
  }

  const updateAgentModel = async (agentId: string, model: string): Promise<boolean> => {
    try {
      const resp = await fetch(apiUrl('/citizen-workshop/_api/update-agent-config'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, patch: { model } }),
      })
      const data = await resp.json()
      return !!data.success
    } catch { return false }
  }

  const showModelDropdown = async (anchorEl: HTMLElement) => {
    const existing = document.getElementById('town-model-dropdown')
    if (existing) { existing.remove(); return }

    const dropdown = document.createElement('div')
    dropdown.id = 'town-model-dropdown'
    dropdown.className = 'town-model-dropdown'

    const loading = document.createElement('div')
    loading.className = 'town-model-loading'
    loading.textContent = '...'
    dropdown.appendChild(loading)

    // Position relative to anchor.
    // Use a dynamic bottom offset computed from the actual input panel
    // height so the dropdown never overlaps the input bar (especially on
    // mobile where the bar is taller).
    const rect = anchorEl.getBoundingClientRect()
    dropdown.style.position = 'fixed'
    dropdown.style.left = `${rect.left}px`
    dropdown.style.bottom = `${computeInputPanelBottom()}px`

    document.body.appendChild(dropdown)

    const options = await fetchModelOptions()
    dropdown.innerHTML = ''

    if (options.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'town-model-empty'
      empty.textContent = 'No models'
      dropdown.appendChild(empty)
    } else {
      for (const opt of options) {
        const item = document.createElement('div')
        item.className = 'town-model-item'
        item.textContent = opt.label || opt.value
        item.addEventListener('click', async (e) => {
          e.stopPropagation()
          dropdown.remove()
          const targetNpcId = scene.getDialogTarget()
          const agentId = scene.getAgentIdForNpc(targetNpcId) || (targetNpcId === 'steward' ? 'steward' : `citizen-${targetNpcId}`)
          if (!agentId) return
          if (tasModelEl) tasModelEl.textContent = t('chat.updating_model')
          const ok = await updateAgentModel(agentId, opt.value)
          if (ok) {
            if (tasModelEl) tasModelEl.textContent = opt.value
            scene.getUIManager().showToast(t('claw.am_model_updated'))
          } else {
            scene.getUIManager().showToast(t('claw.am_model_update_failed'))
          }
        })
        dropdown.appendChild(item)
      }
    }

    // Close on outside click
    setTimeout(() => {
      const handler = (ev: MouseEvent) => {
        if (!dropdown.contains(ev.target as Node)) {
          dropdown.remove()
          document.removeEventListener('click', handler)
        }
      }
      document.addEventListener('click', handler)
    }, 0)
  }

  tasModelEl?.addEventListener('click', (e) => {
    e.stopPropagation()
    showModelDropdown(tasModelEl)
  })

  // ── "More" dropdown ──
  const moreBtn = document.getElementById('town-more-btn')
  const actionDropdown = document.getElementById('town-action-dropdown')
  let dropdownOpen = false

  const closeActionDropdown = () => {
    if (actionDropdown) actionDropdown.style.display = 'none'
    dropdownOpen = false
  }

  const showCitizenDetailPanel = () => {
    scene.showCurrentTargetDetail()
  }

  const showTopicDetailPanel = () => {
    if (!topicState || topicState.phase !== 'active') {
      scene.getUIManager().showToast(t('topic_detail.no_topic'))
      return
    }

    // Remove existing panel
    const existing = document.getElementById('topic-detail-panel')
    if (existing) existing.remove()

    const panel = document.createElement('div')
    panel.id = 'topic-detail-panel'

    const inner = document.createElement('div')
    inner.className = 'tdp-inner'

    const header = document.createElement('div')
    header.className = 'tdp-header'
    const title = document.createElement('div')
    title.className = 'tdp-title'
    title.textContent = t('topic_detail.title')
    header.appendChild(title)
    const closeBtn = document.createElement('button')
    closeBtn.className = 'tdp-close'
    closeBtn.textContent = '✕'
    header.appendChild(closeBtn)
    inner.appendChild(header)

    const body = document.createElement('div')
    body.className = 'tdp-body'
    inner.appendChild(body)

    // Issue 5: render messages grouped by speaker. Returns the count so the
    // caller can detect new messages and re-render + scroll to bottom.
    const renderMessages = (): number => {
      const chatPanel = scene.getUIManager().getChatPanel()
      const groupMessages = chatPanel.getGroupChatMessages()
      body.innerHTML = ''

      if (groupMessages.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'tdp-empty'
        empty.textContent = t('topic_detail.empty')
        body.appendChild(empty)
        return 0
      }

      // Group messages by speaker
      const bySpeaker = new Map<string, Array<{ text: string; timestamp: number }>>()
      const speakerOrder: string[] = []
      for (const msg of groupMessages) {
        const key = msg.speakerName || msg.speakerNpcId
        if (!bySpeaker.has(key)) {
          bySpeaker.set(key, [])
          speakerOrder.push(key)
        }
        bySpeaker.get(key)!.push({ text: msg.text, timestamp: msg.timestamp })
      }

      for (const speaker of speakerOrder) {
        const msgs = bySpeaker.get(speaker)!
        const group = document.createElement('div')
        group.className = 'tdp-speaker-group'

        const speakerEl = document.createElement('div')
        speakerEl.className = 'tdp-speaker-name'
        speakerEl.textContent = `${speaker} (${msgs.length})`
        group.appendChild(speakerEl)

        for (const m of msgs) {
          const msgEl = document.createElement('div')
          msgEl.className = 'tdp-message'
          const textEl = document.createElement('div')
          textEl.className = 'tdp-message-text'
          textEl.textContent = m.text
          msgEl.appendChild(textEl)
          if (m.timestamp) {
            const timeEl = document.createElement('div')
            timeEl.className = 'tdp-message-time'
            const d = new Date(m.timestamp)
            timeEl.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
            msgEl.appendChild(timeEl)
          }
          group.appendChild(msgEl)
        }

        body.appendChild(group)
      }
      return groupMessages.length
    }

    let lastCount = renderMessages()
    // Scroll to bottom on initial open
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight })

    panel.appendChild(inner)
    document.body.appendChild(panel)
    // Position above the (possibly taller on mobile) input bar — same logic
    // as the NPC card so the topic detail panel never overlaps the input.
    panel.style.bottom = `${computeInputPanelBottom()}px`

    // Issue 5: poll for new messages every 1s; re-render + scroll to bottom
    // when new messages arrive so the topic list stays fresh.
    const pollTimer = setInterval(() => {
      if (!document.body.contains(panel)) {
        clearInterval(pollTimer)
        return
      }
      const chatPanel = scene.getUIManager().getChatPanel()
      const currentCount = chatPanel.getGroupChatMessages().length
      if (currentCount !== lastCount) {
        lastCount = renderMessages()
        // Auto-scroll to bottom to show the latest messages
        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight })
      }
    }, 1000)

    const cleanup = () => {
      clearInterval(pollTimer)
      panel.remove()
    }
    closeBtn.onclick = cleanup

    // Issue 4: panel is now absolute-positioned (not full-screen overlay),
    // so no outside-click-to-close. Close via the ✕ button only.
  }

  const openActionDropdown = () => {
    if (!actionDropdown) return
    actionDropdown.innerHTML = ''

    // ── Town editor (小镇改造) ──
    const townEditorItem = document.createElement('div')
    townEditorItem.className = 'town-action-item'
    townEditorItem.textContent = t('topnav.town_editor')
    townEditorItem.addEventListener('click', () => {
      closeActionDropdown()
      window.open('editor.html', '_blank')
    })
    actionDropdown.appendChild(townEditorItem)

    // ── Citizens editor (居民管理) ──
    const citizenEditorItem = document.createElement('div')
    citizenEditorItem.className = 'town-action-item'
    citizenEditorItem.textContent = t('topnav.citizens')
    citizenEditorItem.addEventListener('click', () => {
      closeActionDropdown()
      window.open('citizen-editor.html', '_blank')
    })
    actionDropdown.appendChild(citizenEditorItem)

    // ── Citizen chat (居民聊天) ──
    const chatItem = document.createElement('div')
    chatItem.className = 'town-action-item'
    chatItem.textContent = t('topnav.chat')
    chatItem.addEventListener('click', () => {
      closeActionDropdown()
      window.open('chat.html', '_blank')
    })
    actionDropdown.appendChild(chatItem)

    // ── Skill store (技能商店) ──
    const skillStoreItem = document.createElement('div')
    skillStoreItem.className = 'town-action-item'
    skillStoreItem.textContent = t('topnav.skill_store')
    skillStoreItem.addEventListener('click', () => {
      closeActionDropdown()
      window.open('https://clawhub.ai/', '_blank', 'noopener,noreferrer')
    })
    actionDropdown.appendChild(skillStoreItem)

    // ── Town settings (小镇设置) ──
    const settingsItem = document.createElement('div')
    settingsItem.className = 'town-action-item'
    settingsItem.textContent = t('topnav.settings')
    settingsItem.addEventListener('click', () => {
      closeActionDropdown()
      import('./ui/SettingsPanel').then(({ showSettingsPanel }) => {
        showSettingsPanel({
          onMusicChange: (enabled) => {
            document.dispatchEvent(new CustomEvent('agentshire:music', { detail: { enabled } }))
            const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Agentshire Town"]')
            iframe?.contentWindow?.postMessage({ type: 'agentshire:music', enabled }, '*')
          },
          onSoulModeChange: (enabled) => {
            document.dispatchEvent(new CustomEvent('agentshire:soulmode', { detail: { enabled } }))
            const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Agentshire Town"]')
            iframe?.contentWindow?.postMessage({ type: 'agentshire:soulmode', enabled }, '*')
          },
          onAnimalModeChange: (enabled) => {
            document.dispatchEvent(new CustomEvent('agentshire:animalmode', { detail: { enabled } }))
            const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Agentshire Town"]')
            iframe?.contentWindow?.postMessage({ type: 'agentshire:animalmode', enabled }, '*')
          },
          onReset: async () => {
            try {
              const resp = await fetch('/claw/_api/town/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              })
              const data = await resp.json().catch(() => ({}))
              if (!data.success) {
                console.error('[town-more] town/init failed:', data.error ?? 'unknown')
                return
              }
              try {
                await fetch('/claw/_api/town/restart', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({}),
                })
              } catch {
                // Restart closes the gateway connection; ignore.
              }
              location.reload()
            } catch (err) {
              console.error('[town-more] town/init network error:', err)
            }
          },
        })
      })
    })
    actionDropdown.appendChild(settingsItem)

    // ── Claw settings (Claw 设置) ──
    const clawItem = document.createElement('div')
    clawItem.className = 'town-action-item'
    clawItem.textContent = t('topnav.claw')
    clawItem.addEventListener('click', () => {
      closeActionDropdown()
      window.open('claw.html', '_blank')
    })
    actionDropdown.appendChild(clawItem)

    actionDropdown.style.display = 'block'
    dropdownOpen = true
  }

  // Issue 6: quick action bar — always-visible buttons above the input bar.
  // Renders the same actions as the "More" dropdown but as inline buttons
  // so the user can click them directly without opening the dropdown.
  const quickActionsEl = document.getElementById('town-quick-actions')
  const refreshQuickActions = () => {
    if (!quickActionsEl) return
    quickActionsEl.innerHTML = ''
    const isWork = false
    const isTopic = !!topicState

    const makeBtn = (label: string, disabled: boolean, onClick: () => void, extraClass = ''): HTMLElement => {
      const btn = document.createElement('button')
      btn.className = 'town-quick-btn' + (disabled ? ' disabled' : '') + (extraClass ? ' ' + extraClass : '')
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (disabled) return
        onClick()
      })
      return btn
    }

    // Issue 1: button order = 详情 → 群发 → 话题 → 结束 (靠右排列)
    // Short labels (详情/群发/话题) for the inline quick bar; the "More"
    // dropdown still uses the full labels.

    // 1) Citizen detail (short: 详情)
    quickActionsEl.appendChild(makeBtn(t('menu.citizen_detail_short'), false, () => {
      scene.showCurrentTargetDetail()
    }))

    // 2) Broadcast (short: 群发)
    const isBroadcast = !!groupChatState?.active
    quickActionsEl.appendChild(makeBtn(
      isBroadcast ? t('menu.broadcast_active') : t('menu.broadcast_short'),
      false,
      () => {
        if (isBroadcast) {
          groupChatState = null
          inputBar.setGroupMode(false)
          const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
          if (textarea) textarea.placeholder = t('input.idle')
          scene.getUIManager().clearChatTarget()
          scene.getUIManager().showToast(t('menu.broadcast_active'))
        } else {
          if (!groupChatState) wsSend({ type: 'group_chat_init' })
          const citizens = scene.getAgentEnabledCitizens().map(c => ({
            npcId: c.id, name: c.name, specialty: c.specialty,
          }))
          if (citizens.length === 0) {
            scene.getUIManager().showToast('至少需要1位已开启 Agent 的居民')
            return
          }
          if (!groupChatState) {
            groupChatState = {
              active: true,
              groupId: 'town-square',
              groupName: t('menu.broadcast'),
              participants: citizens,
            }
          } else {
            groupChatState.active = true
            groupChatState.participants = citizens
          }
          inputBar.setGroupMode(true, citizens)
          const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
          if (textarea) textarea.placeholder = t('input.broadcast')
          scene.getUIManager().showToast(t('menu.broadcast'))
        }
        refreshQuickActions()
      },
    ))

    // 3) Start topic / End topic — same slot, swaps label & action based on
    //    topic state. Issue 1: when a topic is active, this button becomes
    //    "结束" (end topic) instead of showing a disabled "话题" plus a separate
    //    "结束" button, saving one slot in the action bar.
    if (isTopic) {
      // Topic active → show "结束" (end topic) in this slot
      quickActionsEl.appendChild(makeBtn(t('menu.end_topic_short'), false, () => {
        scene.getUIManager().showEndTopicConfirm()
      }, 'town-quick-btn-end'))
    } else {
      // No topic → show "话题" (start topic)
      quickActionsEl.appendChild(makeBtn(t('menu.start_topic_short'), isWork, async () => {
        const { showTopicSetupPanel } = await import('./ui/TopicSetupPanel')
        const citizens = scene.getAgentEnabledCitizens()
        if (citizens.length < 2) {
          scene.getUIManager().showToast('至少需要2位已开启 Agent 的居民')
          return
        }
        scene.pauseTopicAutonomy()
        const result = await showTopicSetupPanel(citizens, (id) => !!scene.isNpcVisible(id))
        if (!result || result.citizens.length < 2) {
          scene.resumeTopicAutonomy()
          return
        }
        const npcIds = result.citizens.map(c => c.id)
        topicState = { npcIds, phase: 'gathering' }
        const npcConfigs = result.citizens.map(c => ({
          id: c.id, name: c.name, color: c.color,
          spawn: { x: 0, y: 0, z: 0 }, role: 'worker' as const,
          characterKey: c.characterKey, avatarUrl: c.avatarUrl,
        }))
        scene.getUIManager().updateTopicIndicator(npcConfigs)
        inputBar.setBusy(true)
        const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
        if (textarea) textarea.placeholder = t('input.gathering')
        wsSend({ type: 'topic_start', npcIds })
        await scene.gatherForTopic(npcIds)
        if (!topicState) return
        topicState.phase = 'active'
        inputBar.setBusy(false)
        if (textarea) textarea.placeholder = t('input.topic')
        showEndTopicBtn()
        refreshQuickActions()
      }))
    }

    // 4) Topic detail (only when topic is active) — short: 话题详情
    if (isTopic && topicState?.phase === 'active') {
      quickActionsEl.appendChild(makeBtn(t('menu.topic_detail_short'), false, () => {
        showTopicDetailPanel()
      }))
    }
  }
  refreshQuickActions()
  // Re-render quick actions when topic state changes
  const _origShowEndTopicBtn = showEndTopicBtn
  showEndTopicBtn = () => { _origShowEndTopicBtn(); refreshQuickActions() }
  const _origHideEndTopicBtn = hideEndTopicBtn
  hideEndTopicBtn = () => { _origHideEndTopicBtn(); refreshQuickActions() }

  // Restore topic state from runtime (page refresh). Called after the quick
  // action bar + showEndTopicBtn are wired up so the restored topic controls
  // (结束 / 话题详情 buttons) render correctly.
  function applyRestoredTopic(): void {
    const restoredIds = (scene as any).consumeRestoredTopicNpcIds?.() as string[] | undefined
    if (!restoredIds || restoredIds.length === 0) return
    const citizens = scene.getAgentEnabledCitizens()
    const npcConfigs = restoredIds
      .map((id: string) => citizens.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map(c => ({
        id: c.id, name: c.name, color: c.color,
        spawn: { x: 0, y: 0, z: 0 }, role: 'worker' as const,
        characterKey: c.characterKey, avatarUrl: c.avatarUrl,
      }))
    scene.getUIManager().updateTopicIndicator(npcConfigs)
    topicState = { npcIds: restoredIds, phase: 'active' }
    showEndTopicBtn()
    refreshQuickActions()
    console.log(`[main] Restored topic state from runtime: ${restoredIds.length} NPCs`)
  }
  applyRestoredTopicRef = applyRestoredTopic
  if (pendingTopicRestore) {
    pendingTopicRestore = false
    applyRestoredTopic()
  }
  // Register a callback so the lazy runtime-restore path (NPCs spawned after
  // animal_state arrives) can still restore the topic UI once applyRuntimeState
  // sets topicNpcIds. Without this, a refresh where NPCs spawn late would lose
  // the 结束/话题详情 buttons.
  ;(scene as any).setTopicRestoredCallback?.(() => {
    if (topicState) return // already restored, avoid double-applying
    applyRestoredTopic()
  })

  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (dropdownOpen) closeActionDropdown()
    else openActionDropdown()
  })

  document.addEventListener('click', () => closeActionDropdown())

  // ── Platform Bridge message handlers (bridge instance created earlier, before MainScene) ──

  bridge.onMessage((msg) => {
    switch (msg.type) {
      case 'play':
        engine.play()
        bridge.sendStateChange({ status: 'running' })
        break
      case 'pause':
        engine.pause()
        bridge.sendStateChange({ status: 'paused' })
        break
      case 'reset':
        engine.reset()
        bridge.sendStateChange({ status: 'running', tick: 0 })
        break
    }
  })

  bridge.sendReady()
  bridge.sendStateChange({ status: 'running', tick: 0, fps: 60, objectCount: 0 })

  engine.start()

  // Apply saved music setting on startup
  const savedSettings = loadSettings()
  if (!savedSettings.music) scene.setMusicEnabled(false)
  // Issue 1: enable Animal Mode on startup so citizens become visible & active
  scene.setAnimalModeEnabled(savedSettings.animalMode !== false)

  document.addEventListener('agentshire:music', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setMusicEnabled(enabled)
  })
  document.addEventListener('agentshire:soulmode', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setSoulModeEnabled(enabled)
  })
  document.addEventListener('agentshire:animalmode', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setAnimalModeEnabled(enabled)
  })

  // Listen for cross-iframe messages from parent React App (settings changes)
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data
    if (!data || typeof data.type !== 'string') return
    if (data.type === 'agentshire:music') {
      scene.setMusicEnabled(!!data.enabled)
    } else if (data.type === 'agentshire:soulmode') {
      scene.setSoulModeEnabled(!!data.enabled)
    } else if (data.type === 'agentshire:animalmode') {
      scene.setAnimalModeEnabled(!!data.enabled)
    }
  })

  ;(window as any).engine = engine
  ;(window as any).__scene = scene
}

main().catch(console.error)
