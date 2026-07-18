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
          syncTownSessionLabel(data.townSessionId)
          if (typeof data.model === 'string' && data.model) {
            const el = document.querySelector('.tas-model')
            if (el) el.textContent = data.model
          }
        } else if (data.type === 'implicit_chat_response' && typeof data.id === 'string') {
          const pending = implicitChatPending.get(data.id)
          if (pending) {
            implicitChatPending.delete(data.id)
            clearTimeout(pending.timer)
            pending.resolve({ text: data.text ?? '', usage: data.usage })
          }
        } else if (data.type === 'animal_state') {
          // Plugin returns persisted Animal Mode state (snapshots + clock)
          console.log(`[main] animal_state received: snapshots=${data.snapshots?.length ?? 0} clock=${data.clock ? 'yes' : 'no'}`)
          if (sceneRef) {
            ;(sceneRef as any).restoreAnimalState(data.snapshots ?? [], data.clock ?? null)
          }
        }
      } catch { /* ignore malformed */ }
    }

    socket.onclose = () => {
      wsReady = false
      ws = null
      townWs = null
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
        } else if (action.type === 'animal_memory_clear_all') {
          // Clear all memories on plugin side
          wsSend({ type: 'animal_memory_clear_all' })
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
  let groupChatState: GroupChatState | null = null

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

  let showEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = '' }
  let hideEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = 'none' }

  endTopicBtn?.addEventListener('click', () => {
    scene.getUIManager().showEndTopicConfirm()
  })

  // Issue 2: observe bottom panel resize (textarea grows) and reposition NPC card.
  const bottomPanelEl = document.getElementById('town-bottom-panel')
  if (bottomPanelEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      scene.getUIManager().adjustNPCCardForInputPanel()
    })
    ro.observe(bottomPanelEl)
  }

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

    // Position relative to anchor
    const rect = anchorEl.getBoundingClientRect()
    dropdown.style.position = 'fixed'
    dropdown.style.left = `${rect.left}px`
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`

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

    // Old work mode removed; always false in Animal Mode.
    const isWork = false
    const isTopic = !!topicState

    const topicItem = document.createElement('div')
    topicItem.className = 'town-action-item' + (isWork || isTopic ? ' disabled' : '')
    topicItem.textContent = t('menu.start_topic')
    topicItem.addEventListener('click', async () => {
      closeActionDropdown()
      if (isWork || isTopic) return

      const { showTopicSetupPanel } = await import('./ui/TopicSetupPanel')

      const citizens = scene.getAgentEnabledCitizens()
      if (citizens.length < 2) {
        scene.getUIManager().showToast('至少需要2位已开启 Agent 的居民')
        return
      }

      // Issue 2: pause autonomy BEFORE showing the panel so citizens don't
      // generate autonomous chat bubbles while the user is still selecting
      // participants / composing the topic text.
      scene.pauseTopicAutonomy()

      const result = await showTopicSetupPanel(citizens, (id) => !!scene.isNpcVisible(id))
      if (!result || result.citizens.length < 2) {
        // User cancelled or too few selected — resume autonomy
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
    })
    actionDropdown.appendChild(topicItem)

    // ── Citizen detail panel ──
    const detailItem = document.createElement('div')
    detailItem.className = 'town-action-item'
    detailItem.textContent = t('menu.citizen_detail')
    detailItem.addEventListener('click', () => {
      closeActionDropdown()
      showCitizenDetailPanel()
    })
    actionDropdown.appendChild(detailItem)

    // ── Broadcast (send to all residents) ──
    // Uses the group chat channel: a message with no @mention is dispatched to
    // all enabled citizens, so it acts as a broadcast to everyone.
    const broadcastItem = document.createElement('div')
    broadcastItem.className = 'town-action-item'
    const isBroadcast = !!groupChatState?.active
    broadcastItem.textContent = isBroadcast ? t('menu.broadcast_active') : t('menu.broadcast')
    broadcastItem.addEventListener('click', () => {
      closeActionDropdown()
      if (isBroadcast) {
        // Exit broadcast mode
        groupChatState = null
        inputBar.setGroupMode(false)
        const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
        if (textarea) textarea.placeholder = t('input.idle')
        scene.getUIManager().clearChatTarget()
        scene.getUIManager().showToast(t('menu.broadcast_active'))
      } else {
        // Enter broadcast mode — ensure group chat is initialized
        if (!groupChatState) {
          wsSend({ type: 'group_chat_init' })
        }
        // Activate group chat mode with all enabled citizens as mentionable
        const citizens = scene.getAgentEnabledCitizens().map(c => ({
          npcId: c.id, name: c.name, specialty: c.specialty,
        }))
        if (citizens.length === 0) {
          scene.getUIManager().showToast('至少需要1位已开启 Agent 的居民')
          return
        }
        if (!groupChatState) {
          // group_chat_info hasn't arrived yet; create a minimal state so .active works
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
    })
    actionDropdown.appendChild(broadcastItem)

    // ── Topic detail (only when topic is active) ──
    if (isTopic && topicState?.phase === 'active') {
      const topicDetailItem = document.createElement('div')
      topicDetailItem.className = 'town-action-item'
      topicDetailItem.textContent = t('menu.topic_detail')
      topicDetailItem.addEventListener('click', () => {
        closeActionDropdown()
        showTopicDetailPanel()
      })
      actionDropdown.appendChild(topicDetailItem)
    }

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

    const makeBtn = (label: string, disabled: boolean, onClick: () => void): HTMLElement => {
      const btn = document.createElement('button')
      btn.className = 'town-quick-btn' + (disabled ? ' disabled' : '')
      btn.textContent = label
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (disabled) return
        onClick()
      })
      return btn
    }

    // Start topic
    quickActionsEl.appendChild(makeBtn(t('menu.start_topic'), isWork || isTopic, async () => {
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

    // Citizen detail
    quickActionsEl.appendChild(makeBtn(t('menu.citizen_detail'), false, () => {
      scene.showCurrentTargetDetail()
    }))

    // Broadcast
    const isBroadcast = !!groupChatState?.active
    quickActionsEl.appendChild(makeBtn(
      isBroadcast ? t('menu.broadcast_active') : t('menu.broadcast'),
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

    // Topic detail (only when topic is active)
    if (isTopic && topicState?.phase === 'active') {
      quickActionsEl.appendChild(makeBtn(t('menu.topic_detail'), false, () => {
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
