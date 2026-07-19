// @desc NPC card panel — card display, work logs, thinking stream, todo list

import type { NPCConfig, DialogMessage } from '../types'
import { buildAvatarEl, localizeState } from './ui-utils'
import { createLucideIcon } from './LucideIcon'
import { t } from '../i18n'
import { MOOD_LABELS_ZH } from '../game/animal-mode/MoodEngine'
import { NEED_LABELS_ZH } from '../game/animal-mode/NeedsEngine'
import { RELATIONSHIP_LABELS_ZH } from '../game/animal-mode/RelationshipEngine'
import { getLocale } from '../i18n'

/** Recent activity entry from ActivityJournal.getRecentActivities() */
export interface RecentActivity {
  time: string
  action: string
  location: string
  detail?: string
}

/** Mood snapshot from MoodEngine.compute() */
export interface MoodInfo {
  value: number       // -100..+100
  level: string       // great|good|neutral|bad|terrible
  dominantNeed: string | null
}

/** Needs snapshot from NeedsEngine.getSnapshot() */
export interface NeedsInfo {
  needs: Record<string, number>  // 0..100
  urgent: string[]
  lowest: string
  average: number
}

/** Relationship summary from RelationshipEngine.getRelationship() */
export interface RelationshipInfo {
  npcId: string
  name: string
  sentiment: number  // -100..+100
  level: string      // close|friend|acquaintance|dislike|enemy
  label: string
  interactionCount: number
}

/**
 * Manages the NPC information card overlay: header, persona bio,
 * work-log entries, thinking stream, and todo list.
 */
export class NpcCardPanel {
  private npcCard: HTMLElement
  private npcCardCurrentId: string | null = null
  private npcCardLogContainer: HTMLElement | null = null
  private npcCardThinkingEl: HTMLElement | null = null
  private npcCardThinkingText: HTMLElement | null = null
  // Issue 2 (user msg visibility): track chat list + fetcher for live refresh
  private chatListEl: HTMLElement | null = null
  private chatFetcher: (() => Array<DialogMessage>) | null = null
  // Issue 4: current NPC specialty for chat record alignment with ChatView
  private currentSpecialty: string | null = null
  // Issue 5: preserved tab name to restore after card rebuild
  private preservedTabName: string | null = null

  constructor(npcCard: HTMLElement) {
    this.npcCard = npcCard
    this.npcCard.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('card-close')) this.hide()
    })
  }

  show(opts: {
    npc: NPCConfig; state: string; specialty?: string; persona?: string;
    workLogs?: Array<{ type: string; icon: string; message: string; time?: string }>;
    agentOnline?: boolean;
    isWorking?: boolean;
    recentActivities?: RecentActivity[];
    mood?: MoodInfo | null;
    needs?: NeedsInfo | null;
    relationships?: RelationshipInfo[];
    chatMessages?: Array<{ from: string; text: string; timestamp: number }>;
    /** Issue 2/3: fetcher to re-query chat messages for live refresh. */
    chatFetcher?: () => Array<{ from: string; text: string; timestamp: number; targetNpcId?: string; usage?: DialogMessage['usage']; model?: string; contextInfo?: DialogMessage['contextInfo'] }>;
    agentId?: string;
    /** Home building display name (e.g. "住宅3") */
    homeBuilding?: string | null;
    /** Current location display name (e.g. "广场", "西区") */
    currentLocation?: string | null;
  }): void {
    if (!this.npcCard) return

    if (this.npcCardCurrentId === opts.npc.id && this.npcCard.style.display === 'block') {
      this.hide()
      return
    }

    // Preserve the currently active tab when re-showing the same NPC
    // (prevents auto-switching to the Activity tab while the user is chatting).
    this.preservedTabName = null
    if (this.npcCardCurrentId === opts.npc.id) {
      const activeTab = this.npcCard.querySelector('.card-tab.active')
      if (activeTab) this.preservedTabName = activeTab.textContent ?? null
    }

    this.npcCardCurrentId = opts.npc.id
    this.chatFetcher = opts.chatFetcher ?? null
    this.currentSpecialty = opts.specialty ?? null
    this.npcCardThinkingEl = null
    this.npcCardThinkingText = null
    this.npcCard.innerHTML = ''

    // Always enable has-logs layout (taller card) so the tab area is visible
    this.npcCard.classList.add('has-logs')

    const close = document.createElement('button')
    close.className = 'card-close'
    const closeIcon = createLucideIcon('x', 16, 'currentColor')
    if (closeIcon) close.appendChild(closeIcon)
    close.onclick = () => this.hide()
    this.npcCard.appendChild(close)

    const header = document.createElement('div')
    header.className = 'card-header'
    const av = buildAvatarEl('card-avatar', opts.npc, 48)
    const info = document.createElement('div')
    info.className = 'card-info'
    const nm = document.createElement('div')
    nm.className = 'card-name'
    nm.textContent = opts.npc.label || opts.npc.name
    if (opts.agentOnline !== undefined) {
      const dot = document.createElement('span')
      dot.className = opts.agentOnline ? 'card-status-dot online' : 'card-status-dot offline'
      nm.appendChild(dot)
    }
    const meta = document.createElement('div')
    meta.className = 'card-meta'
    const parts: string[] = []
    if (opts.specialty) parts.push(opts.specialty)
    parts.push(localizeState(opts.state))
    // Persona (bio) on the same line as specialty · state (no new line)
    if (opts.persona) parts.push(opts.persona)
    meta.textContent = parts.join(' · ')
    info.appendChild(nm)
    info.appendChild(meta)
    header.appendChild(av)
    header.appendChild(info)

    // Chat button removed (issue 5): switching is done via the input bar dropdown.
    this.npcCard.appendChild(header)

    // ── Tabbed area: status / activities / logs / chat / sessions ──
    // Mood/needs/relationships moved into a "状态" tab to save vertical space.
    const tabArea = this.buildTabbedArea(
      opts.workLogs ?? [],
      opts.chatMessages ?? [],
      opts.recentActivities ?? [],
      opts.agentId ?? '',
      opts.npc.id,
      opts.mood ?? null,
      opts.needs ?? null,
      opts.relationships ?? [],
      opts.homeBuilding ?? null,
      opts.currentLocation ?? null,
    )
    this.npcCard.appendChild(tabArea)
    requestAnimationFrame(() => {
      if (this.npcCardLogContainer) this.npcCardLogContainer.scrollTop = this.npcCardLogContainer.scrollHeight
    })

    this.npcCard.style.display = 'flex'
    // Issue 2: adjust card bottom to avoid overlapping with the (possibly tall) input panel.
    this.adjustBottomForInputPanel()
  }

  /**
   * Issue 4/5: Dynamically move the NPC card *up* (via transform) when the
   * bottom input panel grows taller, instead of shrinking the card height.
   * When the input panel shrinks back (after sending), the card returns to
   * its original position. The card height stays constant throughout.
   */
  adjustBottomForInputPanel(): void {
    if (!this.npcCard || this.npcCard.style.display === 'none') return
    const bottomPanel = document.getElementById('town-bottom-panel')
    if (!bottomPanel) return
    const panelRect = bottomPanel.getBoundingClientRect()
    // Default bottom offset (matches CSS: 124px, or 134px in embedded mode)
    const defaultBottom = document.body.classList.contains('embedded-mode') ? 134 : 124
    // How much the input panel top has risen above the default bottom line
    const panelTopFromBottom = window.innerHeight - panelRect.top
    const extra = Math.max(panelTopFromBottom - defaultBottom, 0)
    // Card now fills the screen; adjust `bottom` so it sits just above the input panel
    // (keeps the card height responsive instead of using a transform that would clip the top).
    this.npcCard.style.bottom = `${defaultBottom + extra}px`
    this.npcCard.style.transform = ''
  }

  appendActivity(npcId: string, log: { type: string; icon: string; message: string; time?: string; status?: boolean | null }): void {
    if (this.npcCardCurrentId !== npcId) return
    // If the logs tab isn't active (e.g. activities tab is default), skip DOM append.
    // The logs are still captured via show() when the card is opened.
    if (!this.npcCardLogContainer) return
    const isPlaceholder = log.message === t('card.thinking')
    const oldPlaceholder = this.npcCardLogContainer.querySelector('.thinking-placeholder')
    if (oldPlaceholder && !isPlaceholder) {
      oldPlaceholder.remove()
    }
    if (isPlaceholder && oldPlaceholder) return
    const el = this.createLogEl(log)
    if (isPlaceholder) el.classList.add('thinking-placeholder')
    if (log.type === 'thinking') {
      this.npcCardThinkingEl = el
      this.npcCardThinkingText = el.querySelector('.log-msg')
    }
    this.npcCardLogContainer.appendChild(el)
    this.npcCardLogContainer.scrollTop = this.npcCardLogContainer.scrollHeight
  }

  appendThinkingDelta(npcId: string, delta: string): void {
    if (this.npcCardCurrentId !== npcId || !this.npcCardThinkingText) return
    this.npcCardThinkingText.textContent += delta
    if (this.npcCardLogContainer) {
      this.npcCardLogContainer.scrollTop = this.npcCardLogContainer.scrollHeight
    }
  }

  endThinkingStream(npcId: string): void {
    if (this.npcCardCurrentId !== npcId || !this.npcCardThinkingEl) return
    this.npcCardThinkingEl.classList.remove('thinking-active')
    this.npcCardThinkingEl.classList.add('thinking-done')
    const iconWrap = this.npcCardThinkingEl.querySelector('.log-icon')
    if (iconWrap) {
      iconWrap.innerHTML = ''
      const doneIcon = createLucideIcon('check-circle', 14, 'rgba(0,200,120,0.8)')
      if (doneIcon) iconWrap.appendChild(doneIcon)
    }
    this.npcCardThinkingEl = null
    this.npcCardThinkingText = null
  }

  updateLastActivityStatus(npcId: string, success: boolean): void {
    if (this.npcCardCurrentId !== npcId || !this.npcCardLogContainer) return
    const entries = this.npcCardLogContainer.querySelectorAll('.card-log-entry:not(.thinking-active):not(.thinking-done):not(.thinking-placeholder)')
    let target: Element | null = null
    for (let i = 0; i < entries.length; i++) {
      const statusEl = entries[i].querySelector('.log-status-pending')
      if (statusEl) { target = entries[i]; break; }
    }
    if (!target) return
    const statusEl = target.querySelector('.log-status')
    if (!statusEl) return
    statusEl.innerHTML = ''
    statusEl.className = 'log-status'
    const icon = createLucideIcon(success ? 'check' : 'x', 14, success ? 'rgba(0,200,120,0.8)' : 'rgba(255,80,80,0.8)')
    if (icon) statusEl.appendChild(icon)
  }

  appendTodoList(npcId: string, todos: Array<{ id: number; content: string; status: string }>): void {
    if (this.npcCardCurrentId !== npcId) return
    if (!this.npcCardLogContainer) return
    const existing = this.npcCardLogContainer.querySelector('.log-todo-block')
    if (existing) {
      this.updateTodoBlock(existing as HTMLElement, todos)
    } else {
      const block = this.createTodoBlock(todos)
      this.npcCardLogContainer.appendChild(block)
    }
    this.npcCardLogContainer.scrollTop = this.npcCardLogContainer.scrollHeight
  }

  hide(): void {
    if (!this.npcCard) return
    this.npcCard.style.display = 'none'
    this.npcCard.classList.remove('has-logs')
    this.npcCardCurrentId = null
    this.npcCardLogContainer = null
    this.npcCardThinkingEl = null
    this.npcCardThinkingText = null
    this.chatListEl = null
    this.chatFetcher = null
  }

  /**
   * Issue 2 (user msg visibility): re-render the chat tab if the card is open.
   * Called when a new chat message is added to ChatPanel.
   */
  refreshChat(): void {
    if (!this.npcCard || this.npcCard.style.display === 'none') return
    if (!this.chatListEl || !this.chatFetcher) return
    const msgs = this.chatFetcher()
    this.chatListEl.innerHTML = ''
    if (msgs.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'card-chat-empty'
      empty.textContent = t('card.no_chat')
      this.chatListEl.appendChild(empty)
    } else {
      for (const msg of msgs) {
        this.chatListEl.appendChild(this.createChatEl(msg as DialogMessage))
      }
    }
    // Auto-scroll to bottom so the latest message is visible
    this.chatListEl.scrollTop = this.chatListEl.scrollHeight
  }

  // ── private helpers ──

  private createTodoBlock(todos: Array<{ id: number; content: string; status: string }>): HTMLElement {
    const block = document.createElement('div')
    block.className = 'card-log-entry log-todo-block'
    const header = document.createElement('div')
    header.className = 'log-todo-header'
    const icon = createLucideIcon('list-checks', 14, 'rgba(255,255,255,0.45)')
    if (icon) header.appendChild(icon)
    const label = document.createElement('span')
    label.textContent = t('card.task_list')
    header.appendChild(label)
    block.appendChild(header)
    const list = document.createElement('div')
    list.className = 'log-todo-list'
    for (const t of todos) {
      list.appendChild(this.createTodoItem(t))
    }
    block.appendChild(list)
    return block
  }

  private createTodoItem(t: { id: number; content: string; status: string }): HTMLElement {
    const row = document.createElement('div')
    row.className = 'log-todo-item'
    row.dataset.todoId = String(t.id)
    const text = document.createElement('span')
    text.className = 'log-todo-text'
    text.textContent = t.content
    row.appendChild(text)
    const st = document.createElement('span')
    st.className = 'log-todo-status'
    this.setTodoStatusIcon(st, t.status)
    row.appendChild(st)
    return row
  }

  private setTodoStatusIcon(el: HTMLElement, status: string): void {
    el.innerHTML = ''
    if (status === 'completed') {
      const ic = createLucideIcon('check', 12, 'rgba(0,200,120,0.8)')
      if (ic) el.appendChild(ic)
    } else if (status === 'in_progress') {
      const ic = createLucideIcon('loader', 12, 'rgba(255,255,255,0.3)')
      if (ic) { ic.classList.add('todo-spin'); el.appendChild(ic) }
    }
  }

  private updateTodoBlock(block: HTMLElement, todos: Array<{ id: number; content: string; status: string }>): void {
    const list = block.querySelector('.log-todo-list')
    if (!list) return
    for (const t of todos) {
      const existing = list.querySelector(`[data-todo-id="${t.id}"]`) as HTMLElement | null
      if (existing) {
        const textEl = existing.querySelector('.log-todo-text')
        if (textEl && t.content) textEl.textContent = t.content
        const stEl = existing.querySelector('.log-todo-status') as HTMLElement
        if (stEl) this.setTodoStatusIcon(stEl, t.status)
      } else {
        list.appendChild(this.createTodoItem(t))
      }
    }
  }

  private buildLocationArea(homeBuilding: string | null, currentLocation: string | null): HTMLElement {
    const area = document.createElement('div')
    area.className = 'card-mood-area'

    const title = document.createElement('div')
    title.className = 'card-section-title'
    title.textContent = getLocale() === 'en' ? 'Location' : '位置信息'
    area.appendChild(title)

    const en = getLocale() === 'en'
    if (homeBuilding) {
      const row = document.createElement('div')
      row.className = 'card-info-row'
      const label = document.createElement('span')
      label.className = 'card-info-label'
      label.textContent = en ? 'Home' : '房子'
      const val = document.createElement('span')
      val.className = 'card-info-value'
      val.textContent = homeBuilding
      row.appendChild(label)
      row.appendChild(val)
      area.appendChild(row)
    }
    if (currentLocation) {
      const row = document.createElement('div')
      row.className = 'card-info-row'
      const label = document.createElement('span')
      label.className = 'card-info-label'
      label.textContent = en ? 'Current' : '当前位置'
      const val = document.createElement('span')
      val.className = 'card-info-value'
      val.textContent = currentLocation
      row.appendChild(label)
      row.appendChild(val)
      area.appendChild(row)
    }
    return area
  }

  private buildMoodNeedsArea(mood: MoodInfo | null, needs: NeedsInfo | null): HTMLElement {
    const area = document.createElement('div')
    area.className = 'card-mood-area'

    const title = document.createElement('div')
    title.className = 'card-section-title'
    title.textContent = getLocale() === 'en' ? 'Mood & Needs' : '心情与需求'
    area.appendChild(title)

    // Mood row
    if (mood) {
      const moodRow = document.createElement('div')
      moodRow.className = 'card-mood-row'
      const moodLabel = document.createElement('span')
      moodLabel.className = 'card-mood-label'
      moodLabel.textContent = getLocale() === 'en' ? 'Mood' : '心情'
      const moodValue = document.createElement('span')
      moodValue.className = `card-mood-value mood-${mood.level}`
      const moodText = getLocale() === 'en' ? mood.level : (MOOD_LABELS_ZH[mood.level as keyof typeof MOOD_LABELS_ZH] ?? mood.level)
      // Issue 1: round mood value to integer for display
      const moodValRounded = Math.round(mood.value)
      moodValue.textContent = `${moodText} (${moodValRounded > 0 ? '+' : ''}${moodValRounded})`
      moodRow.appendChild(moodLabel)
      moodRow.appendChild(moodValue)
      area.appendChild(moodRow)
    }

    // Needs bars
    if (needs) {
      const needsGrid = document.createElement('div')
      needsGrid.className = 'card-needs-grid'
      const needKeys = Object.keys(needs.needs)
      for (const key of needKeys) {
        const val = needs.needs[key]
        const bar = document.createElement('div')
        bar.className = 'card-need-bar'
        const isUrgent = needs.urgent.includes(key)
        const label = document.createElement('span')
        label.className = 'card-need-label'
        if (isUrgent) label.classList.add('urgent')
        label.textContent = getLocale() === 'en' ? key : (NEED_LABELS_ZH[key as keyof typeof NEED_LABELS_ZH] ?? key)
        const track = document.createElement('div')
        track.className = 'card-need-track'
        const fill = document.createElement('div')
        fill.className = 'card-need-fill'
        if (isUrgent) fill.classList.add('urgent')
        fill.style.width = `${Math.round(val)}%`
        track.appendChild(fill)
        const valEl = document.createElement('span')
        valEl.className = 'card-need-val'
        if (isUrgent) valEl.classList.add('urgent')
        valEl.textContent = `${Math.round(val)}`
        bar.appendChild(label)
        bar.appendChild(track)
        bar.appendChild(valEl)
        needsGrid.appendChild(bar)
      }
      area.appendChild(needsGrid)
    }

    return area
  }

  /**
   * Build a full relationships area for the dedicated "关系" tab.
   * Shows ALL relationships (not just top 5), sorted by sentiment descending,
   * with interaction count and a sentiment bar for richer detail.
   */
  private buildAllRelationshipsArea(rels: RelationshipInfo[]): HTMLElement {
    const area = document.createElement('div')
    area.className = 'card-rel-area'
    const en = getLocale() === 'en'
    const title = document.createElement('div')
    title.className = 'card-section-title'
    title.textContent = en ? `Relationships (${rels.length})` : `人际关系（${rels.length}）`
    area.appendChild(title)

    const list = document.createElement('div')
    list.className = 'card-rel-list'
    const sorted = [...rels].sort((a, b) => b.sentiment - a.sentiment)
    for (const rel of sorted) {
      const row = document.createElement('div')
      row.className = 'card-rel-row card-rel-row-full'

      const nameWrap = document.createElement('div')
      nameWrap.className = 'card-rel-name-wrap'
      const name = document.createElement('span')
      name.className = 'card-rel-name'
      name.textContent = rel.name
      nameWrap.appendChild(name)
      const levelLabel = en ? rel.level : (RELATIONSHIP_LABELS_ZH[rel.level as keyof typeof RELATIONSHIP_LABELS_ZH] ?? rel.level)
      const level = document.createElement('span')
      level.className = `card-rel-level rel-${rel.level}`
      level.textContent = levelLabel
      nameWrap.appendChild(level)
      row.appendChild(nameWrap)

      // Sentiment bar (−100..+100 mapped to 0..100%)
      const barWrap = document.createElement('div')
      barWrap.className = 'card-rel-bar-wrap'
      const bar = document.createElement('div')
      bar.className = 'card-rel-bar'
      const fill = document.createElement('div')
      fill.className = `card-rel-bar-fill rel-${rel.level}`
      const pct = (rel.sentiment + 100) / 2 // -100→0%, 0→50%, +100→100%
      fill.style.width = `${Math.round(pct)}%`
      bar.appendChild(fill)
      barWrap.appendChild(bar)
      const sentiment = document.createElement('span')
      sentiment.className = 'card-rel-sentiment'
      sentiment.textContent = `${rel.sentiment > 0 ? '+' : ''}${rel.sentiment}`
      barWrap.appendChild(sentiment)
      row.appendChild(barWrap)

      // Interaction count
      const count = document.createElement('span')
      count.className = 'card-rel-count'
      count.textContent = en ? `${rel.interactionCount} interactions` : `互动 ${rel.interactionCount} 次`
      row.appendChild(count)

      list.appendChild(row)
    }
    area.appendChild(list)
    return area
  }

  private actionToLabel(action: string): string {
    const zhMap: Record<string, string> = {
      arrived: '到达', departed: '离开', staying: '停留', walking: '行走',
      chatted: '聊天', went_home: '回家', woke_up: '起床',
      summoned: '被叫到', assigned_task: '接下活儿', started_working: '开始做手艺',
      completed_task: '做完手艺', celebrating: '庆祝', returned_from_work: '从工坊回来',
      need_urgent: '需求紧急', need_satisfied: '需求满足', mood_changed: '心情变化',
      went_indoor: '进入室内', left_indoor: '离开室内',
      decided: '决策',
    }
    const enMap: Record<string, string> = {
      arrived: 'Arrived', departed: 'Departed', staying: 'Staying', walking: 'Walking',
      chatted: 'Chatted', went_home: 'Went home', woke_up: 'Woke up',
      summoned: 'Called', assigned_task: 'Took the job', started_working: 'Started crafting',
      completed_task: 'Finished craft', celebrating: 'Celebrating', returned_from_work: 'Back from workshop',
      need_urgent: 'Need urgent', need_satisfied: 'Need satisfied', mood_changed: 'Mood changed',
      went_indoor: 'Went indoor', left_indoor: 'Left indoor',
      decided: 'Decided',
    }
    const map = getLocale() === 'en' ? enMap : zhMap
    return map[action] ?? action
  }

  private buildTabbedArea(
    logs: Array<{ type: string; icon: string; message: string; time?: string; status?: boolean | null }>,
    chatMessages: Array<{ from: string; text: string; timestamp: number }>,
    recentActivities: RecentActivity[],
    agentId: string,
    npcId: string,
    mood: MoodInfo | null = null,
    needs: NeedsInfo | null = null,
    relationships: RelationshipInfo[] = [],
    homeBuilding: string | null = null,
    currentLocation: string | null = null,
  ): HTMLElement {
    const area = document.createElement('div')
    area.className = 'card-tab-area'

    // Tab bar
    const tabBar = document.createElement('div')
    tabBar.className = 'card-tab-bar'

    // Issue 2/3: tab names shortened to 2 chars to avoid wrapping on mobile.
    // Tab order: 状态 → 活动 → 日志 → 聊天 → 会话; 活动 is default active.
    // Issue 3: "关系" tab removed — relationships now shown in 状态 tab.
    const tabStatus = document.createElement('button')
    tabStatus.className = 'card-tab'
    tabStatus.textContent = getLocale() === 'en' ? 'Status' : '状态'

    const tabActivities = document.createElement('button')
    tabActivities.className = 'card-tab active'
    tabActivities.textContent = getLocale() === 'en' ? 'Activity' : '活动'

    const tabLogs = document.createElement('button')
    tabLogs.className = 'card-tab'
    tabLogs.textContent = getLocale() === 'en' ? 'Logs' : '日志'

    const tabChat = document.createElement('button')
    tabChat.className = 'card-tab'
    tabChat.textContent = getLocale() === 'en' ? 'Chat' : '聊天'

    const tabSessions = document.createElement('button')
    tabSessions.className = 'card-tab'
    tabSessions.textContent = getLocale() === 'en' ? 'Sessions' : '会话'

    tabBar.appendChild(tabStatus)
    tabBar.appendChild(tabActivities)
    tabBar.appendChild(tabLogs)
    tabBar.appendChild(tabChat)
    tabBar.appendChild(tabSessions)
    area.appendChild(tabBar)

    // Tab panels container
    const panels = document.createElement('div')
    panels.className = 'card-tab-panels'
    area.appendChild(panels)

    // Status panel (mood/needs/relationships — issue: moved from header area)
    const statusPanel = document.createElement('div')
    statusPanel.className = 'card-tab-panel'
    const statusScroll = document.createElement('div')
    statusScroll.className = 'card-status-scroll'
    if (homeBuilding || currentLocation) {
      statusScroll.appendChild(this.buildLocationArea(homeBuilding, currentLocation))
    }
    if (mood || needs) {
      statusScroll.appendChild(this.buildMoodNeedsArea(mood, needs))
    }
    // Issue 3: show full relationships (moved from the removed 关系 tab)
    if (relationships.length > 0) {
      statusScroll.appendChild(this.buildAllRelationshipsArea(relationships))
    }
    if (!mood && !needs && relationships.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'card-chat-empty'
      empty.textContent = getLocale() === 'en' ? 'No status data' : '暂无状态信息'
      statusScroll.appendChild(empty)
    }
    statusPanel.appendChild(statusScroll)
    panels.appendChild(statusPanel)

    // Activities panel (default active — issue 1)
    const activitiesPanel = document.createElement('div')
    activitiesPanel.className = 'card-tab-panel active'
    const activitiesList = document.createElement('div')
    activitiesList.className = 'card-activity-list'
    if (recentActivities.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'card-chat-empty'
      empty.textContent = getLocale() === 'en' ? 'No recent activities' : '暂无最近活动'
      activitiesList.appendChild(empty)
    } else {
      for (const act of recentActivities) {
        activitiesList.appendChild(this.createActivityEl(act))
      }
    }
    activitiesPanel.appendChild(activitiesList)
    panels.appendChild(activitiesPanel)

    // Logs panel
    const logsPanel = document.createElement('div')
    logsPanel.className = 'card-tab-panel'
    const logList = document.createElement('div')
    logList.className = 'card-log-list'
    for (const log of logs) {
      logList.appendChild(this.createLogEl(log))
    }
    logsPanel.appendChild(logList)
    panels.appendChild(logsPanel)

    // Chat panel
    const chatPanel = document.createElement('div')
    chatPanel.className = 'card-tab-panel'
    const chatList = document.createElement('div')
    chatList.className = 'card-chat-list'
    this.chatListEl = chatList
    if (chatMessages.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'card-chat-empty'
      empty.textContent = t('card.no_chat')
      chatList.appendChild(empty)
    } else {
      for (const msg of chatMessages) {
        chatList.appendChild(this.createChatEl(msg))
      }
    }
    chatPanel.appendChild(chatList)
    panels.appendChild(chatPanel)

    // Sessions panel
    const sessionsPanel = document.createElement('div')
    sessionsPanel.className = 'card-tab-panel'
    const sessionsList = document.createElement('div')
    sessionsList.className = 'card-sessions-list'
    sessionsPanel.appendChild(sessionsList)
    panels.appendChild(sessionsPanel)

    // Issue 3: "关系" tab removed — relationships now shown in 状态 tab.

    // Tab switching — order matches allTabs/allPanels: status, activities, logs, chat, sessions
    const allTabs = [tabStatus, tabActivities, tabLogs, tabChat, tabSessions]
    const allPanels = [statusPanel, activitiesPanel, logsPanel, chatPanel, sessionsPanel]
    const switchTab = (tab: HTMLElement, panel: HTMLElement, logContainer: HTMLElement | null) => {
      allTabs.forEach(t => t.classList.remove('active'))
      allPanels.forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      panel.classList.add('active')
      this.npcCardLogContainer = logContainer
    }

    tabStatus.addEventListener('click', () => switchTab(tabStatus, statusPanel, null))
    tabActivities.addEventListener('click', () => switchTab(tabActivities, activitiesPanel, null))
    tabLogs.addEventListener('click', () => switchTab(tabLogs, logsPanel, logList))
    tabChat.addEventListener('click', () => {
      switchTab(tabChat, chatPanel, chatList)
      requestAnimationFrame(() => { chatList.scrollTop = chatList.scrollHeight })
    })
    tabSessions.addEventListener('click', () => {
      switchTab(tabSessions, sessionsPanel, null)
      this.loadSessions(sessionsList, agentId, npcId)
    })

    // Issue 5: restore the previously active tab if we're re-showing the same NPC
    // (prevents auto-switching to Activity while the user is on Chat/Logs/etc.)
    if (this.preservedTabName) {
      const tabMap: Record<string, { tab: HTMLElement; panel: HTMLElement; logContainer: HTMLElement | null }> = {
        [tabStatus.textContent ?? '']: { tab: tabStatus, panel: statusPanel, logContainer: null },
        [tabActivities.textContent ?? '']: { tab: tabActivities, panel: activitiesPanel, logContainer: null },
        [tabLogs.textContent ?? '']: { tab: tabLogs, panel: logsPanel, logContainer: logList },
        [tabChat.textContent ?? '']: { tab: tabChat, panel: chatPanel, logContainer: chatList },
        [tabSessions.textContent ?? '']: { tab: tabSessions, panel: sessionsPanel, logContainer: null },
      }
      const target = tabMap[this.preservedTabName]
      if (target) {
        switchTab(target.tab, target.panel, target.logContainer)
        // If restoring the chat tab, scroll to bottom
        if (target.tab === tabChat) {
          requestAnimationFrame(() => { chatList.scrollTop = chatList.scrollHeight })
        }
      }
      this.preservedTabName = null
    }

    return area
  }

  /** Create a single recent-activity row element (used in the Activities tab). */
  private createActivityEl(act: RecentActivity): HTMLElement {
    const row = document.createElement('div')
    row.className = 'card-activity-row'
    const time = document.createElement('span')
    time.className = 'card-activity-time'
    time.textContent = act.time
    const desc = document.createElement('span')
    desc.className = 'card-activity-desc'
    const actionLabel = this.actionToLabel(act.action)
    desc.textContent = `${actionLabel} · ${act.location}${act.detail ? ' · ' + act.detail : ''}`
    row.appendChild(time)
    row.appendChild(desc)
    return row
  }

  /** Determine whether a chat message was sent by the user (mayor). */
  private isUserMessage(from: string): boolean {
    if (from === 'user' || from === '你' || from === 'Jin' || from === 'Mayor') return true
    // Localized mayor label (zh: 镇长, en: Mayor) — used by MainScene.showUserBubble
    const mayorLabel = t('mayor')
    if (from === mayorLabel) return true
    return false
  }

  private createChatEl(msg: DialogMessage): HTMLElement {
    const el = document.createElement('div')
    el.className = 'card-chat-entry'
    const isUser = this.isUserMessage(msg.from)
    if (isUser) el.classList.add('user')

    const nameEl = document.createElement('div')
    nameEl.className = 'card-chat-name'
    // Issue 4: show specialty next to name (like React ChatView: "name（specialty）")
    if (isUser) {
      nameEl.textContent = t('you')
    } else {
      const name = msg.from
      if (this.currentSpecialty) {
        nameEl.textContent = `${name}（${this.currentSpecialty}）`
      } else {
        nameEl.textContent = name
      }
    }
    el.appendChild(nameEl)

    const textEl = document.createElement('div')
    textEl.className = 'card-chat-text'
    textEl.textContent = msg.text
    el.appendChild(textEl)

    // Issue 4: align footer with React ChatView — show time, tokens, cache, reasoning, ctx, model
    if (!isUser) {
      const footer = document.createElement('div')
      footer.className = 'card-chat-meta'
      const parts: string[] = []
      // Time
      if (msg.timestamp) {
        const d = new Date(msg.timestamp)
        parts.push(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`)
      }
      // Usage (tokens)
      if (msg.usage) {
        const u = msg.usage
        const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n)
        if (u.input > 0 || u.output > 0) {
          parts.push(`↑${fmt(u.input)} ↓${fmt(u.output)}`)
        }
        // Cache read with percentage (full mode)
        if (typeof u.cacheRead === 'number' && u.cacheRead > 0) {
          const total = u.cacheRead + (u.input ?? 0)
          const pct = total > 0 ? Math.round((u.cacheRead / total) * 100) : 0
          parts.push(`cache ${pct}% (${fmt(u.cacheRead)})`)
        }
        // Reasoning tokens
        if (typeof u.reasoningTokens === 'number' && u.reasoningTokens > 0) {
          parts.push(`think ${fmt(u.reasoningTokens)}`)
        }
      }
      // Context info
      if (msg.contextInfo) parts.push(`ctx ${msg.contextInfo.percent}%`)
      // Model
      if (msg.model) {
        const shortModel = msg.model.split('/').slice(1).join('/') || msg.model
        parts.push(shortModel)
      }
      if (parts.length > 0) {
        footer.textContent = parts.join(' · ')
        el.appendChild(footer)
      }
    }

    if (msg.timestamp && isUser) {
      const timeEl = document.createElement('div')
      timeEl.className = 'card-chat-time'
      const d = new Date(msg.timestamp)
      timeEl.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
      el.appendChild(timeEl)
    }

    return el
  }

  /** Load sessions for the given agent from the backend API. */
  private async loadSessions(container: HTMLElement, agentId: string, npcId: string): Promise<void> {
    container.innerHTML = ''
    if (!agentId) {
      const empty = document.createElement('div')
      empty.className = 'card-sessions-empty'
      empty.textContent = t('card.sessions_no_agent')
      container.appendChild(empty)
      return
    }

    // Loading indicator
    const loading = document.createElement('div')
    loading.className = 'card-sessions-loading'
    loading.textContent = '...'
    container.appendChild(loading)

    try {
      const { apiUrl } = await import('../utils/api-base')
      const resp = await fetch(apiUrl('/claw/_api/sessions/list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await resp.json()
      container.innerHTML = ''

      if (!data.success) {
        const err = document.createElement('div')
        err.className = 'card-sessions-empty'
        err.textContent = data.error ?? 'Error'
        container.appendChild(err)
        return
      }

      const allSessions: Array<any> = data.sessions ?? []
      // Filter sessions for this agent only
      const sessions = allSessions.filter((s) => s.agentId === agentId)

      if (sessions.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'card-sessions-empty'
        empty.textContent = t('card.sessions_empty')
        container.appendChild(empty)
        return
      }

      // Toolbar: batch delete
      const toolbar = document.createElement('div')
      toolbar.className = 'card-sessions-toolbar'
      const selectAll = document.createElement('label')
      selectAll.className = 'card-sessions-select-all'
      const selectAllCb = document.createElement('input')
      selectAllCb.type = 'checkbox'
      selectAllCb.className = 'card-session-check-all'
      const selectAllLabel = document.createElement('span')
      selectAllLabel.textContent = t('card.select_all')
      selectAll.appendChild(selectAllCb)
      selectAll.appendChild(selectAllLabel)
      const batchDeleteBtn = document.createElement('button')
      batchDeleteBtn.className = 'card-sessions-batch-delete'
      batchDeleteBtn.textContent = t('card.batch_delete')
      batchDeleteBtn.disabled = true
      toolbar.appendChild(selectAll)
      toolbar.appendChild(batchDeleteBtn)
      container.appendChild(toolbar)

      // Session list
      const list = document.createElement('div')
      list.className = 'card-sessions-items'
      const checkboxes: HTMLInputElement[] = []
      for (const s of sessions) {
        const row = this.createSessionRow(s, agentId, () => this.loadSessions(container, agentId, npcId))
        list.appendChild(row)
        checkboxes.push(row.querySelector('.card-session-check') as HTMLInputElement)
      }
      container.appendChild(list)

      // Select all handler
      selectAllCb.addEventListener('change', () => {
        for (const cb of checkboxes) cb.checked = selectAllCb.checked
        updateBatchBtn()
      })

      // Batch delete handler
      const updateBatchBtn = () => {
        const checked = checkboxes.filter(cb => cb.checked)
        batchDeleteBtn.disabled = checked.length === 0
        batchDeleteBtn.textContent = checked.length > 0
          ? `${t('card.batch_delete')} (${checked.length})`
          : t('card.batch_delete')
      }
      for (const cb of checkboxes) cb.addEventListener('change', updateBatchBtn)

      batchDeleteBtn.addEventListener('click', async () => {
        const checked = checkboxes.filter(cb => cb.checked)
        if (checked.length === 0) return
        if (!confirm(t('card.confirm_batch_delete').replace('{n}', String(checked.length)))) return
        batchDeleteBtn.disabled = true
        batchDeleteBtn.textContent = '...'
        const { apiUrl } = await import('../utils/api-base')
        for (const cb of checked) {
          const sessionKey = cb.dataset.sessionKey ?? ''
          if (!sessionKey) continue
          try {
            await fetch(apiUrl('/claw/_api/sessions/delete'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId, sessionKey }),
            })
          } catch { /* ignore */ }
        }
        await this.loadSessions(container, agentId, npcId)
      })
    } catch (err: any) {
      container.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.className = 'card-sessions-empty'
      errEl.textContent = err?.message ?? 'Error'
      container.appendChild(errEl)
    }
  }

  /** Create a single session row with checkbox and delete button. */
  private createSessionRow(session: any, agentId: string, onDeleted: () => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'card-session-row'

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.className = 'card-session-check'
    check.dataset.sessionKey = session.sessionKey ?? ''
    row.appendChild(check)

    const info = document.createElement('div')
    info.className = 'card-session-info'
    const time = document.createElement('div')
    time.className = 'card-session-time'
    const updated = session.updatedAt ? new Date(session.updatedAt) : null
    time.textContent = updated
      ? `${updated.getFullYear()}-${String(updated.getMonth() + 1).padStart(2, '0')}-${String(updated.getDate()).padStart(2, '0')} ${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}`
      : '—'
    info.appendChild(time)

    const meta = document.createElement('div')
    meta.className = 'card-session-meta'
    const parts: string[] = []
    if (session.chatType) parts.push(session.chatType)
    if (session.totalTokens) parts.push(`${session.totalTokens} tokens`)
    if (session.model) parts.push(session.model)
    meta.textContent = parts.join(' · ')
    info.appendChild(meta)
    row.appendChild(info)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'card-session-delete'
    const delIcon = createLucideIcon('trash-2', 13, 'currentColor')
    if (delIcon) deleteBtn.appendChild(delIcon)
    deleteBtn.title = t('card.delete_session')
    deleteBtn.addEventListener('click', async () => {
      const sessionKey = session.sessionKey ?? ''
      if (!sessionKey) return
      if (!confirm(t('card.confirm_delete_session'))) return
      deleteBtn.disabled = true
      try {
        const { apiUrl } = await import('../utils/api-base')
        const resp = await fetch(apiUrl('/claw/_api/sessions/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, sessionKey }),
        })
        const data = await resp.json()
        if (data.success) {
          onDeleted()
        } else {
          alert(data.error ?? 'Delete failed')
          deleteBtn.disabled = false
        }
      } catch (err: any) {
        alert(err?.message ?? 'Network error')
        deleteBtn.disabled = false
      }
    })
    row.appendChild(deleteBtn)

    return row
  }

  private createLogEl(log: { type: string; icon: string; message: string; time?: string; status?: boolean | null }): HTMLElement {
    const el = document.createElement('div')
    el.className = 'card-log-entry'
    if (log.type === 'thinking') el.classList.add('thinking-active')

    if (log.time) {
      const timeEl = document.createElement('span')
      timeEl.className = 'log-time'
      timeEl.textContent = log.time
      el.appendChild(timeEl)
    }

    const iconWrap = document.createElement('span')
    iconWrap.className = 'log-icon'
    const color = log.type === 'thinking' ? 'rgba(0,212,255,0.7)' :
      log.icon === 'alert-circle' ? 'rgba(255,80,80,0.7)' : 'rgba(255,255,255,0.45)'
    const svg = createLucideIcon(log.icon, 14, color)
    if (svg) iconWrap.appendChild(svg)
    el.appendChild(iconWrap)

    const hasDetail = log.message.includes('\n')
    const mainText = hasDetail ? log.message.split('\n')[0] : log.message
    const detailText = hasDetail ? log.message.split('\n').slice(1).join('\n') : ''

    const msgWrap = document.createElement('div')
    msgWrap.className = 'log-msg-wrap'

    const msg = document.createElement('span')
    msg.className = 'log-msg'
    msg.textContent = mainText
    msgWrap.appendChild(msg)

    if (detailText) {
      const detail = document.createElement('div')
      detail.className = 'log-detail collapsed'
      detail.textContent = detailText
      msgWrap.appendChild(detail)

      requestAnimationFrame(() => {
        if (detail.scrollHeight > detail.clientHeight + 2) {
          const toggle = document.createElement('span')
          toggle.className = 'log-status log-detail-toggle'
          const chevDown = createLucideIcon('chevron-down', 12, 'rgba(255,255,255,0.35)')
          if (chevDown) toggle.appendChild(chevDown)
          toggle.onclick = (e) => {
            e.stopPropagation()
            const isCollapsed = detail.classList.contains('collapsed')
            detail.classList.toggle('collapsed')
            toggle.innerHTML = ''
            const icon = createLucideIcon(isCollapsed ? 'chevron-up' : 'chevron-down', 12, 'rgba(255,255,255,0.35)')
            if (icon) toggle.appendChild(icon)
          }
          el.appendChild(toggle)
        }
      })
    }

    el.appendChild(msgWrap)

    if (log.status === null) {
      // no status icon
    } else if (log.status === true) {
      const st = document.createElement('span')
      st.className = 'log-status'
      const ic = createLucideIcon('check', 12, 'rgba(0,200,120,0.8)')
      if (ic) st.appendChild(ic)
      el.appendChild(st)
    } else if (log.status === false) {
      const st = document.createElement('span')
      st.className = 'log-status'
      const ic = createLucideIcon('x', 12, 'rgba(255,80,80,0.8)')
      if (ic) st.appendChild(ic)
      el.appendChild(st)
    } else {
      const st = document.createElement('span')
      st.className = 'log-status log-status-pending'
      const loader = createLucideIcon('loader', 12, 'rgba(255,255,255,0.3)')
      if (loader) st.appendChild(loader)
      el.appendChild(st)
    }

    return el
  }
}
