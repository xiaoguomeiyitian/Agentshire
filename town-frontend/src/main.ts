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

  if (!useMock) {
    // @ts-ignore -- resolved by Vite alias at runtime
    bridgeModule = await import('agentshire_bridge')
    const wsParam = params.get('ws')
    const wsUrl = resolveWsUrl(wsParam)

    const { DirectorBridge } = bridgeModule
    const director = new DirectorBridge()

    const ws = new WebSocket(wsUrl)
    townWs = ws
    let wsReady = false
    let wsEverConnected = false

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
      if (ws.readyState !== WebSocket.OPEN) return
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

      for (const msg of assistantMessages) {
        const text = summarizeHistoryMessage(msg)
        if (!text) continue
        const key = `${payload.npcId}:${msg.timestamp ?? 0}:${msg.type ?? 'text'}:${text}`
        if (seenCitizenMessageKeys.has(key)) continue
        seenCitizenMessageKeys.add(key)
        scene.handleGameEvent({ type: 'npc_look_at', npcId: payload.npcId, targetNpcId: 'user' })
        scene.handleGameEvent({ type: 'dialog_message', npcId: payload.npcId, text, isStreaming: false })
      }
    }

    ws.onopen = () => {
      wsReady = true
      wsEverConnected = true
      hideWsError()
      console.log('[main] DirectorBridge WS connected')
      bindTownSession(configStore.getSessionId() || initialTownSessionId)
      // Initialize default group chat (deferred to avoid TDZ)
      setTimeout(() => wsSend({ type: 'group_chat_init' }), 100)
    }

    ws.onmessage = (msg: MessageEvent) => {
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
        }
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      wsReady = false
      console.log('[main] DirectorBridge WS closed')
      if (!wsEverConnected) showWsError()
    }

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
      disconnect() { ws.close() },
      get connected() { return wsReady },
      onGameEvent(_handler: (e: any) => void) {},
      sendAction(action: any) {
        if (action.type === 'user_message') {
          director.onUserMessage(action.text)
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

  const getMentionableCitizens = () => {
    if (!groupChatState) return []
    return groupChatState.participants.map(p => ({
      npcId: p.npcId,
      name: p.name,
      specialty: p.specialty,
      color: p.color,
      avatarUrl: p.avatarUrl,
    }))
  }

  const switchToGroupChat = () => {
    if (!groupChatState) return
    scene.getUIManager().getChatPanel().switchView('group')
    inputBar.setGroupMode(true, getMentionableCitizens())
    // Register participants for avatar rendering
    for (const p of groupChatState.participants) {
      scene.getUIManager().getChatPanel().registerGroupParticipant(p)
    }
    const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
    if (textarea) textarea.placeholder = t('input.group')
  }

  const switchToSingleChat = () => {
    scene.getUIManager().getChatPanel().switchView('single')
    inputBar.setGroupMode(false)
    const textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
    if (textarea) textarea.placeholder = t('input.idle')
  }

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

  const showEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = '' }
  const hideEndTopicBtn = () => { if (endTopicBtn) endTopicBtn.style.display = 'none' }

  endTopicBtn?.addEventListener('click', () => {
    scene.getUIManager().showEndTopicConfirm()
  })

  // ── "More" dropdown ──
  const moreBtn = document.getElementById('town-more-btn')
  const actionDropdown = document.getElementById('town-action-dropdown')
  let dropdownOpen = false

  const closeActionDropdown = () => {
    if (actionDropdown) actionDropdown.style.display = 'none'
    dropdownOpen = false
  }

  const openActionDropdown = () => {
    if (!actionDropdown) return
    actionDropdown.innerHTML = ''

    const isWork = scene.getModeManager()?.getMode() === 'work'
    const isTopic = !!topicState

    const newTaskItem = document.createElement('div')
    newTaskItem.className = 'town-action-item' + (isTopic ? ' disabled' : '')
    newTaskItem.textContent = t('menu.new_task')
    newTaskItem.addEventListener('click', () => {
      closeActionDropdown()
      if (!isTopic) startNewTownSession()
    })
    actionDropdown.appendChild(newTaskItem)

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

      const result = await showTopicSetupPanel(citizens, (id) => !!scene.isNpcVisible(id))
      if (!result || result.citizens.length < 2) return

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

    // ── Group chat (小镇广场) ──
    const isGroupActive = groupChatState?.active ?? false
    const groupItem = document.createElement('div')
    groupItem.className = 'town-action-item' + (isTopic ? ' disabled' : '')
    groupItem.textContent = isGroupActive ? t('menu.exit_group') : t('menu.enter_group')
    groupItem.addEventListener('click', () => {
      closeActionDropdown()
      if (isTopic) return
      if (isGroupActive) {
        // Exit group chat → back to single chat
        if (groupChatState) groupChatState.active = false
        switchToSingleChat()
      } else {
        // Enter group chat (default town-square)
        if (groupChatState) {
          groupChatState.active = true
          switchToGroupChat()
        } else {
          // Request group init first
          wsSend({ type: 'group_chat_init' })
          // Will switch after info arrives
          setTimeout(() => {
            if (groupChatState) {
              groupChatState.active = true
              switchToGroupChat()
            }
          }, 1000)
        }
      }
    })
    actionDropdown.appendChild(groupItem)

    actionDropdown.style.display = 'block'
    dropdownOpen = true
  }

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
  if (!savedSettings.autoWalk) scene.setAutoWalkEnabled(false)

  document.addEventListener('agentshire:music', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setMusicEnabled(enabled)
  })
  document.addEventListener('agentshire:soulmode', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setSoulModeEnabled(enabled)
  })
  document.addEventListener('agentshire:autowalk', (e: Event) => {
    const { enabled } = (e as CustomEvent).detail
    scene.setAutoWalkEnabled(enabled)
  })

  // Listen for cross-iframe messages from parent React App (settings changes)
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data
    if (!data || typeof data.type !== 'string') return
    if (data.type === 'agentshire:music') {
      scene.setMusicEnabled(!!data.enabled)
    } else if (data.type === 'agentshire:soulmode') {
      scene.setSoulModeEnabled(!!data.enabled)
    } else if (data.type === 'agentshire:autowalk') {
      scene.setAutoWalkEnabled(!!data.enabled)
    }
  })

  ;(window as any).engine = engine
}

main().catch(console.error)
