// @desc Chat panel — message list rendering and scroll management

import type { DialogMessage } from '../types'
import { stripTags } from './ui-utils'
import { t } from '../i18n'

export interface GroupChatMessage {
  sequenceId: number
  timestamp: number
  speakerNpcId: string
  speakerName: string
  text: string
  mentions: string[]
  groupId: string
  groupName: string
}

interface GroupParticipant {
  npcId: string
  name: string
  specialty?: string
  color?: number
  avatarUrl?: string
}

/**
 * Manages the chat message list displayed in the "chat" tab.
 * Receives the chat panel DOM element from UIManager during construction.
 * Supports both single-chat and group-chat views.
 */
export class ChatPanel {
  private chatMessages: DialogMessage[] = []
  private groupChatMessages: GroupChatMessage[] = []
  private groupParticipants: Map<string, GroupParticipant> = new Map()
  private chatPanelEl: HTMLElement
  private activeView: 'single' | 'group' = 'single'

  constructor(chatPanelEl: HTMLElement) {
    this.chatPanelEl = chatPanelEl
  }

  /** Switch between single-chat and group-chat views. */
  switchView(view: 'single' | 'group'): void {
    this.activeView = view
    this.rerender()
  }

  /** Register a group participant for avatar/name lookup. */
  registerGroupParticipant(p: GroupParticipant): void {
    this.groupParticipants.set(p.npcId, p)
  }

  /** Get current active view. */
  getActiveView(): 'single' | 'group' {
    return this.activeView
  }

  /** Clear all group chat messages. */
  clearGroupMessages(): void {
    this.groupChatMessages = []
    if (this.activeView === 'group') this.rerender()
  }

  /** Append a group chat message. */
  addGroupMessage(msg: GroupChatMessage): void {
    this.groupChatMessages.push(msg)
    if (this.activeView === 'group') {
      this.appendGroupMessageEl(msg)
    }
  }

  /** Re-render the entire message list based on active view. */
  private rerender(): void {
    if (!this.chatPanelEl) return
    this.chatPanelEl.innerHTML = ''
    if (this.activeView === 'group') {
      for (const msg of this.groupChatMessages) {
        this.appendGroupMessageEl(msg)
      }
    } else {
      for (const msg of this.chatMessages) {
        this.appendSingleMessageEl(msg)
      }
    }
  }

  /** Append a single-chat message bubble. */
  private appendSingleMessageEl(msg: DialogMessage): void {
    const isUser = msg.from === 'user' || msg.from === '你' || msg.from === 'Jin' || msg.from === 'Mayor'
    const div = document.createElement('div')
    div.className = 'chat-msg ' + (isUser ? 'user' : 'npc')
    const bgColor = isUser ? '#DDA444' : '#4488CC'
    const avatarDiv = document.createElement('div')
    avatarDiv.className = 'avatar'
    avatarDiv.style.background = bgColor
    avatarDiv.textContent = isUser ? t('you')[0] : msg.from[0]
    const bubbleDiv = document.createElement('div')
    bubbleDiv.className = 'bubble'
    bubbleDiv.textContent = stripTags(msg.text)
    div.appendChild(avatarDiv)
    div.appendChild(bubbleDiv)
    this.chatPanelEl.appendChild(div)
  }

  /** Append a group-chat message bubble with @mention highlighting. */
  private appendGroupMessageEl(msg: GroupChatMessage): void {
    const isUser = msg.speakerNpcId === 'user'
    const div = document.createElement('div')
    div.className = 'chat-msg group-msg ' + (isUser ? 'user' : 'npc')

    // Avatar
    const avatarDiv = document.createElement('div')
    avatarDiv.className = 'avatar'
    if (isUser) {
      avatarDiv.style.background = '#DDA444'
      avatarDiv.textContent = t('you')[0]
    } else {
      const participant = this.groupParticipants.get(msg.speakerNpcId)
      const colorHex = participant?.color ? '#' + participant.color.toString(16).padStart(6, '0') : '#4488CC'
      avatarDiv.style.background = colorHex
      avatarDiv.textContent = msg.speakerName[0]
    }
    div.appendChild(avatarDiv)

    // Content wrapper
    const contentDiv = document.createElement('div')
    contentDiv.className = 'group-msg-content'

    // Speaker name
    const nameDiv = document.createElement('div')
    nameDiv.className = 'group-msg-name'
    nameDiv.textContent = isUser ? t('you') : msg.speakerName
    contentDiv.appendChild(nameDiv)

    // Bubble with @mention highlighting
    const bubbleDiv = document.createElement('div')
    bubbleDiv.className = 'bubble'
    bubbleDiv.innerHTML = this.formatGroupMessageText(msg.text, msg.mentions)
    contentDiv.appendChild(bubbleDiv)

    div.appendChild(contentDiv)
    this.chatPanelEl.appendChild(div)
    this.chatPanelEl.scrollTop = this.chatPanelEl.scrollHeight
  }

  /** Format message text with @mention highlighting. */
  private formatGroupMessageText(text: string, mentions: string[]): string {
    const escaped = stripTags(text)
    if (!mentions || mentions.length === 0) return escaped

    let result = escaped
    // Highlight @所有人
    if (mentions.includes('all')) {
      result = result.replace(/@(所有人|all|全体)/gi, '<span class="mention-all">$&</span>')
    }
    // Highlight @participant names
    for (const npcId of mentions) {
      if (npcId === 'all') continue
      const participant = this.groupParticipants.get(npcId)
      if (participant) {
        const pattern = new RegExp(`@${this.escapeRegExp(participant.name)}(?=\\s|$|[,，。.!！?？])`, 'g')
        result = result.replace(pattern, `<span class="mention">$&</span>`)
      }
    }
    return result
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /** Append a message bubble and auto-scroll to bottom. (single-chat) */
  addChatMessage(msg: DialogMessage): void {
    if (!this.chatPanelEl) return
    this.chatMessages.push(msg)
    if (this.activeView === 'single') {
      this.appendSingleMessageEl(msg)
    }
  }
}
