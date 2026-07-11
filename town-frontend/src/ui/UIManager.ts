// @desc UIManager facade — initialises sub-panels and delegates public API

import type { DialogMessage, NPCConfig } from '../types'
import type { CoverStyleId } from './CoverTemplates'
import { buildAvatarEl } from './ui-utils'
import { ChatPanel } from './ChatPanel'
import { NpcCardPanel } from './NpcCardPanel'
import { GamePublishPanel } from './GamePublishPanel'
import { MediaPreview, type DeliverableItem } from './MediaPreview'
import { createLucideIcon } from './LucideIcon'
import { t } from '../i18n'

export type TabType = 'world' | 'chat'
export type UIEvent =
  | { type: 'tab_change'; tab: TabType }
  | { type: 'send_message'; text: string }
  | { type: 'back_town' }
  | { type: 'play_now'; gameUrl: string }
  | { type: 'chat_with_citizen'; npcId: string; label: string }

type UIEventCallback = (event: UIEvent) => void

/**
 * Thin facade that wires DOM elements, owns the event bus, and delegates
 * domain-specific rendering to {@link ChatPanel}, {@link NpcCardPanel},
 * {@link GamePublishPanel} and {@link MediaPreview}.
 */
export class UIManager {
  private listeners: UIEventCallback[] = []
  private activeTab: TabType = 'world'

  private tabBtns!: NodeListOf<Element>
  private chatPanelEl!: HTMLElement
  private gameContainer!: HTMLElement
  private textInput!: HTMLInputElement
  private sendBtn!: HTMLElement
  private inputTarget!: HTMLElement
  private backBtn!: HTMLElement
  private progressBar!: HTMLElement
  private progressFill!: HTMLElement
  private progressLabel!: HTMLElement
  private sceneFade!: HTMLElement
  private loadingScreen!: HTMLElement

  private chatPanel!: ChatPanel
  private npcCardPanel!: NpcCardPanel
  private gamePublishPanel!: GamePublishPanel
  private mediaPreview!: MediaPreview

  private whiteboardOverlay: HTMLElement | null = null
  private whiteboardMirrorCtx: CanvasRenderingContext2D | null = null

  init(): void {
    this.tabBtns = document.querySelectorAll('.tab-item')
    this.gameContainer = document.getElementById('game-container')!
    this.chatPanelEl = document.getElementById('chat-panel') as HTMLElement
    this.textInput = document.getElementById('text-input') as HTMLInputElement
    this.sendBtn = document.getElementById('send-btn') as HTMLElement
    this.inputTarget = document.getElementById('input-target') as HTMLElement
    this.backBtn = document.getElementById('back-btn') as HTMLElement
    this.progressBar = document.getElementById('progress-bar') as HTMLElement
    this.progressFill = this.progressBar?.querySelector('.fill') as HTMLElement
    this.progressLabel = document.getElementById('progress-label') as HTMLElement
    this.sceneFade = document.getElementById('scene-fade') as HTMLElement
    this.loadingScreen = document.getElementById('loading-screen') as HTMLElement

    // Sub-panels
    this.chatPanel = new ChatPanel(this.chatPanelEl)

    const npcCardEl = document.getElementById('npc-card') as HTMLElement
    this.npcCardPanel = new NpcCardPanel(npcCardEl)
    this.npcCardPanel.setOnChatWith((npcId, label) =>
      this.emit({ type: 'chat_with_citizen', npcId, label }),
    )

    this.gamePublishPanel = new GamePublishPanel((url) =>
      this.emit({ type: 'play_now', gameUrl: url }),
    )

    this.mediaPreview = new MediaPreview(
      (msg) => this.showToast(msg),
      (item, onClose) =>
        this.gamePublishPanel.show({
          gameName: item.name || t('new_project'),
          iframeSrc: item.url || '',
          onClose,
        }),
    )

    // Tab buttons
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as TabType
        this.setActiveTab(tab)
      })
    })
    this.sendBtn?.addEventListener('click', () => this.handleSend())
    this.textInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.handleSend() }
    })
    this.backBtn?.addEventListener('click', () => this.emit({ type: 'back_town' }))

    const settingsBtn = document.getElementById('tab-settings')
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        if (confirm(t('reset.confirm'))) {
          localStorage.removeItem('agentshire_config')
          location.reload()
        }
      })
    }
  }

  on(cb: UIEventCallback): void { this.listeners.push(cb) }
  private emit(e: UIEvent): void { this.listeners.forEach(cb => cb(e)) }

  private handleSend(): void {
    if (!this.textInput) return
    const text = this.textInput.value.trim()
    if (!text) return
    this.textInput.value = ''
    this.textInput.blur()
    this.emit({ type: 'send_message', text })
  }

  // ── Tab management ──

  setActiveTab(tab: TabType): void {
    this.activeTab = tab
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab)
    })
    this.chatPanelEl?.classList.toggle('visible', tab === 'chat')
    this.emit({ type: 'tab_change', tab })
  }

  /** Get the ChatPanel instance (for group chat view switching). */
  getChatPanel(): ChatPanel {
    return this.chatPanel
  }

  // ── Loading / progress / scene transitions ──

  hideLoading(): void { this.loadingScreen?.classList.add('hidden') }

  setProgress(current: number, total: number, label?: string): void {
    if (!this.progressBar || !this.progressLabel) return
    if (total <= 0) { this.progressBar.style.display = 'none'; this.progressLabel.style.display = 'none'; return }
    this.progressBar.style.display = 'block'
    this.progressLabel.style.display = 'block'
    if (this.progressFill) this.progressFill.style.width = Math.round((current / total) * 100) + '%'
    this.progressLabel.textContent = label || ('\u2588'.repeat(current) + '\u2591'.repeat(total - current) + ' ' + current + '/' + total)
  }

  hideProgress(): void { if (this.progressBar) this.progressBar.style.display = 'none'; if (this.progressLabel) this.progressLabel.style.display = 'none' }

  showWhiteboard(): void {
    if (!this.whiteboardOverlay) {
      const overlay = document.createElement('div')
      Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: '200', display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: '0', transition: 'opacity 0.2s ease', cursor: 'pointer'
      })
      const container = document.createElement('div')
      Object.assign(container.style, {
        position: 'relative', width: '60%', maxWidth: '720px', aspectRatio: '1024/640',
        backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden',
        boxShadow: '0 24px 48px rgba(0,0,0,0.5)', cursor: 'default'
      })
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 640
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
      this.whiteboardMirrorCtx = canvas.getContext('2d')
      
      const closeBtn = document.createElement('button')
      const closeIcon = createLucideIcon('x', 16, '#333')
      if (closeIcon) closeBtn.appendChild(closeIcon)
      Object.assign(closeBtn.style, {
        position: 'absolute', top: '16px', right: '16px',
        width: '32px', height: '32px', borderRadius: '16px',
        border: 'none', backgroundColor: 'rgba(0,0,0,0.1)',
        padding: '0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
      })
      closeBtn.onclick = () => this.hideWhiteboard()
      overlay.onclick = (e) => { if (e.target === overlay) this.hideWhiteboard() }
      
      container.appendChild(canvas)
      container.appendChild(closeBtn)
      overlay.appendChild(container)
      document.body.appendChild(overlay)
      this.whiteboardOverlay = overlay
      
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.whiteboardOverlay?.style.display === 'flex') {
          this.hideWhiteboard()
        }
      })
    }
    
    this.whiteboardOverlay.style.display = 'flex'
    requestAnimationFrame(() => {
      if (this.whiteboardOverlay) this.whiteboardOverlay.style.opacity = '1'
    })
  }

  hideWhiteboard(): void {
    if (this.whiteboardOverlay) {
      this.whiteboardOverlay.style.opacity = '0'
      setTimeout(() => {
        if (this.whiteboardOverlay) this.whiteboardOverlay.style.display = 'none'
      }, 200)
    }
  }

  updateWhiteboardMirror(sourceCanvas: HTMLCanvasElement | OffscreenCanvas): void {
    if (this.whiteboardOverlay?.style.display === 'flex' && this.whiteboardMirrorCtx) {
      this.whiteboardMirrorCtx.clearRect(0, 0, 1024, 640)
      this.whiteboardMirrorCtx.drawImage(sourceCanvas, 0, 0, 1024, 640)
    }
  }

  async fadeToBlack(ms = 300): Promise<void> {
    if (!this.sceneFade) return
    this.sceneFade.style.transition = 'opacity ' + ms + 'ms'
    this.sceneFade.classList.add('active')
    await new Promise(r => setTimeout(r, ms))
  }

  async fadeFromBlack(ms = 300): Promise<void> {
    if (!this.sceneFade) return
    this.sceneFade.style.transition = 'opacity ' + ms + 'ms'
    this.sceneFade.classList.remove('active')
    await new Promise(r => setTimeout(r, ms))
  }

  showBackButton(show: boolean): void { if (this.backBtn) this.backBtn.style.display = show ? 'block' : 'none' }

  showToast(msg: string): void {
    let toast = document.getElementById('media-toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'media-toast'
      Object.assign(toast.style, {
        position: 'fixed', top: '60px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(20,20,40,0.95)', color: '#fff', padding: '10px 24px',
        borderRadius: '20px', fontSize: '13px', zIndex: '800', pointerEvents: 'none',
        border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
        transition: 'opacity 0.3s', opacity: '0',
      })
      document.body.appendChild(toast)
    }
    toast.textContent = msg
    toast.style.opacity = '1'
    setTimeout(() => { toast!.style.opacity = '0' }, 2500)
  }

  // ── Dialog target (input bar) ──

  setDialogTarget(npc: NPCConfig): void {
    if (!this.inputTarget) return
    const oldAvatar = this.inputTarget.querySelector('.avatar-sm') as HTMLElement
    const name = this.inputTarget.querySelector('.name') as HTMLElement
    if (oldAvatar) {
      const newAvatar = buildAvatarEl('avatar-sm', npc, 24)
      oldAvatar.replaceWith(newAvatar)
    }
    if (name) name.textContent = npc.label || npc.name
  }

  updateStewardName(name: string): void {
    this.stewardName = name
    if (this.stewardConfig) {
      this.stewardConfig = { ...this.stewardConfig, name, label: name }
    }
    if (this.tasNameEl && !this.activeCitizenTarget) {
      this.tasNameEl.textContent = name
      this.rebuildAvatar(this.stewardConfig)
    }
  }

  // ── Chat target switcher (reuses #town-agent-status .tas-line) ──

  private tasClickWrap: HTMLElement | null = null
  private tasAvatarWrap: HTMLElement | null = null
  private tasNameEl: HTMLElement | null = null
  private tasArrowEl: HTMLElement | null = null
  private tasDropdown: HTMLElement | null = null
  private activeCitizenTarget: NPCConfig | null = null
  private stewardName = t('steward')
  private stewardConfig: NPCConfig | null = null
  private onSwitchToSteward: (() => void) | null = null
  private onSwitchToCitizen: (() => void) | null = null

  initChatTargetIndicator(opts: {
    onSwitchToSteward: () => void
    onSwitchToCitizen: () => void
    stewardName?: string
    stewardConfig?: NPCConfig
  }): void {
    this.onSwitchToSteward = opts.onSwitchToSteward
    this.onSwitchToCitizen = opts.onSwitchToCitizen
    if (opts.stewardName) this.stewardName = opts.stewardName
    if (opts.stewardConfig) this.stewardConfig = opts.stewardConfig

    const tasLineEl = document.querySelector('#town-agent-status .tas-line') as HTMLElement
    this.tasNameEl = document.querySelector('#town-agent-status .tas-name') as HTMLElement
    if (!tasLineEl || !this.tasNameEl) return

    const wrap = document.createElement('span')
    wrap.className = 'tas-click-wrap'
    this.tasClickWrap = wrap

    const avatarWrap = document.createElement('span')
    avatarWrap.className = 'tas-avatar-wrap'
    this.tasAvatarWrap = avatarWrap
    this.rebuildAvatar(this.stewardConfig)
    wrap.appendChild(avatarWrap)

    this.tasNameEl.textContent = this.stewardName

    tasLineEl.insertBefore(wrap, this.tasNameEl)
    wrap.appendChild(this.tasNameEl)

    const arrow = document.createElement('span')
    arrow.className = 'tas-switch-arrow'
    arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
    wrap.appendChild(arrow)
    this.tasArrowEl = arrow

    const statusEl = document.getElementById('town-agent-status')
    if (statusEl) {
      statusEl.style.position = 'relative'
      statusEl.style.overflow = 'visible'
      this.tasDropdown = document.createElement('div')
      this.tasDropdown.id = 'tas-target-dropdown'
      this.tasDropdown.style.display = 'none'
      statusEl.appendChild(this.tasDropdown)
    }

    wrap.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.topicTargets || this.activeCitizenTarget) this.toggleDropdown()
    })

    document.addEventListener('click', () => this.hideDropdown())
  }

  private rebuildAvatar(npc: NPCConfig | null): void {
    if (!this.tasAvatarWrap) return
    this.tasAvatarWrap.innerHTML = ''
    if (npc) {
      const el = buildAvatarEl('tas-avatar', npc, 20)
      this.tasAvatarWrap.appendChild(el)
    } else {
      const fallback = document.createElement('span')
      fallback.className = 'tas-avatar tas-avatar-text'
      fallback.textContent = this.stewardName.charAt(0)
      this.tasAvatarWrap.appendChild(fallback)
    }
  }

  updateChatTargetIndicator(citizenNpc: NPCConfig | null, showingCitizen: boolean): void {
    if (citizenNpc) this.activeCitizenTarget = citizenNpc
    if (!this.tasNameEl || !this.tasArrowEl) return

    if (showingCitizen && this.activeCitizenTarget) {
      const name = this.activeCitizenTarget.label || this.activeCitizenTarget.name
      this.tasNameEl.textContent = name
      this.rebuildAvatar(this.activeCitizenTarget)
    } else {
      this.tasNameEl.textContent = this.stewardName
      this.rebuildAvatar(this.stewardConfig)
    }

    this.tasArrowEl.style.display = this.activeCitizenTarget ? 'inline' : 'none'
  }

  clearChatTarget(): void {
    this.activeCitizenTarget = null
    this.topicTargets = null
    this.updateChatTargetIndicator(null, false)
  }

  // ── Topic mode (multi-citizen group discussion) ──

  private topicTargets: NPCConfig[] | null = null
  private onEndTopic: (() => void) | null = null

  initTopicCallbacks(opts: { onEndTopic: () => void }): void {
    this.onEndTopic = opts.onEndTopic
  }

  updateTopicIndicator(citizens: NPCConfig[]): void {
    this.topicTargets = citizens
    if (!this.tasAvatarWrap || !this.tasNameEl || !this.tasArrowEl) return

    this.tasAvatarWrap.innerHTML = ''
    this.tasAvatarWrap.className = 'tas-group-avatars'

    const maxShow = 2
    const shown = citizens.slice(0, maxShow)
    for (const c of shown) {
      const el = buildAvatarEl('tas-avatar', c, 20)
      this.tasAvatarWrap.appendChild(el)
    }
    if (citizens.length > maxShow) {
      const overflow = document.createElement('span')
      overflow.className = 'tas-group-overflow'
      overflow.textContent = `+${citizens.length - maxShow}`
      this.tasAvatarWrap.appendChild(overflow)
    }

    this.tasNameEl.textContent = ''
    this.tasArrowEl.style.display = 'inline'
  }

  clearTopicIndicator(): void {
    this.topicTargets = null
    if (this.tasAvatarWrap) {
      this.tasAvatarWrap.className = 'tas-avatar-wrap'
    }
    this.updateChatTargetIndicator(null, false)
  }

  private toggleDropdown(): void {
    if (!this.tasDropdown) return
    const visible = this.tasDropdown.style.display !== 'none'
    if (visible) this.hideDropdown()
    else this.showDropdown()
  }

  private showDropdown(): void {
    if (!this.tasDropdown) return

    // Topic mode: only show steward option (ends topic with confirm)
    if (this.topicTargets) {
      this.tasDropdown.innerHTML = ''
      const stewardItem = document.createElement('div')
      stewardItem.className = 'tas-dropdown-item'
      if (this.stewardConfig) {
        const avatar = buildAvatarEl('tas-dropdown-avatar', this.stewardConfig, 18)
        stewardItem.appendChild(avatar)
      }
      const nameSpan = document.createElement('span')
      nameSpan.textContent = this.stewardName
      stewardItem.appendChild(nameSpan)
      stewardItem.addEventListener('click', (e) => {
        e.stopPropagation()
        this.hideDropdown()
        this.showEndTopicConfirm()
      })
      this.tasDropdown.appendChild(stewardItem)
      this.tasDropdown.style.display = 'block'
      return
    }

    if (!this.activeCitizenTarget) return
    this.tasDropdown.innerHTML = ''

    const currentName = this.tasNameEl?.textContent ?? ''
    const citizenName = this.activeCitizenTarget.label || this.activeCitizenTarget.name

    const items: Array<{ label: string; npc: NPCConfig | null; action: () => void }> = [
      { label: this.stewardName, npc: this.stewardConfig, action: () => this.onSwitchToSteward?.() },
      { label: citizenName, npc: this.activeCitizenTarget, action: () => this.onSwitchToCitizen?.() },
    ]

    for (const item of items) {
      const el = document.createElement('div')
      el.className = 'tas-dropdown-item'
      if (item.label === currentName) el.classList.add('tas-dropdown-active')

      if (item.npc) {
        const avatar = buildAvatarEl('tas-dropdown-avatar', item.npc, 18)
        el.appendChild(avatar)
      }
      const nameSpan = document.createElement('span')
      nameSpan.textContent = item.label
      el.appendChild(nameSpan)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        item.action()
        this.hideDropdown()
      })
      this.tasDropdown.appendChild(el)
    }

    this.tasDropdown.style.display = 'block'
  }

  private hideDropdown(): void {
    if (this.tasDropdown) this.tasDropdown.style.display = 'none'
  }

  showEndTopicConfirm(): void {
    const backdrop = document.createElement('div')
    backdrop.className = 'town-confirm-backdrop'

    const card = document.createElement('div')
    card.className = 'town-confirm-card'

    const title = document.createElement('div')
    title.className = 'town-confirm-title'
    title.textContent = t('topic.end_title')
    card.appendChild(title)

    const body = document.createElement('div')
    body.className = 'town-confirm-body'
    body.textContent = t('topic.end_desc')
    card.appendChild(body)

    const actions = document.createElement('div')
    actions.className = 'town-confirm-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'town-confirm-btn cancel'
    cancelBtn.textContent = t('cancel')
    cancelBtn.addEventListener('click', () => backdrop.remove())

    const confirmBtn = document.createElement('button')
    confirmBtn.className = 'town-confirm-btn confirm'
    confirmBtn.textContent = t('confirm')
    confirmBtn.addEventListener('click', () => {
      backdrop.remove()
      this.onEndTopic?.()
    })

    actions.appendChild(cancelBtn)
    actions.appendChild(confirmBtn)
    card.appendChild(actions)
    backdrop.appendChild(card)

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove()
    })

    document.body.appendChild(backdrop)
  }

  // ── Delegates to ChatPanel ──

  addChatMessage(msg: DialogMessage): void {
    this.chatPanel.addChatMessage(msg)
  }

  // ── Delegates to NpcCardPanel ──

  showNPCCard(opts: {
    npc: NPCConfig; state: string; specialty?: string; persona?: string;
    workLogs?: Array<{ type: string; icon: string; message: string; time?: string }>;
    agentOnline?: boolean;
    isWorking?: boolean;
  }): void {
    this.npcCardPanel.show(opts)
  }

  hideNPCCard(): void { this.npcCardPanel.hide() }

  appendActivity(npcId: string, log: { type: string; icon: string; message: string; time?: string; status?: boolean | null }): void {
    this.npcCardPanel.appendActivity(npcId, log)
  }

  appendThinkingDelta(npcId: string, delta: string): void {
    this.npcCardPanel.appendThinkingDelta(npcId, delta)
  }

  endThinkingStream(npcId: string): void {
    this.npcCardPanel.endThinkingStream(npcId)
  }

  updateLastActivityStatus(npcId: string, success: boolean): void {
    this.npcCardPanel.updateLastActivityStatus(npcId, success)
  }

  appendTodoList(npcId: string, todos: Array<{ id: number; content: string; status: string }>): void {
    this.npcCardPanel.appendTodoList(npcId, todos)
  }

  // ── Delegates to GamePublishPanel ──

  showGamePublish(opts: {
    gameName: string; styleId?: CoverStyleId; iframeSrc: string; onClose?: () => void
  }): void {
    this.gamePublishPanel.show(opts)
  }

  hideGamePublish(): void { this.gamePublishPanel.hide() }

  // ── Delegates to MediaPreview ──

  handleDeliverableCard(event: {
    cardType: string; name?: string; url?: string;
    filePath?: string; mimeType?: string; thumbnailData?: string; data?: string;
  }, onClose?: () => void): void {
    this.mediaPreview.handleDeliverableCard(event, onClose)
  }

  closeDeliverableCard(): void { this.mediaPreview.closeDeliverableCard() }
  isDeliverableCardOpen(): boolean { return this.mediaPreview.isDeliverableCardOpen() }
  getDeliverableItems(): ReadonlyArray<DeliverableItem> { return this.mediaPreview.getDeliverableItems() }

  // ── Misc ──

  focusInput(): void { this.textInput?.focus() }
  getGameContainer(): HTMLElement { return this.gameContainer }
}
