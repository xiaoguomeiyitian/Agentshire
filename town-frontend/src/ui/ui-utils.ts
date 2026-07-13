// @desc Shared UI utility functions used across sub-panels

import type { NPCConfig } from '../types'
import { getLocale } from '../i18n'
import { apiUrl } from '@/utils/api-base'

const AVATAR_KEYS = new Set([
  'char-female-b', 'char-female-c', 'char-female-e', 'char-female-f',
  'char-male-b', 'char-male-c', 'char-male-e',
])

export function buildAvatarEl(
  className: string,
  npc: NPCConfig,
  size: number,
): HTMLElement {
  if (npc.avatarUrl) {
    const img = document.createElement('img')
    img.className = className
    img.src = apiUrl(npc.avatarUrl)
    img.alt = npc.name[0]
    img.style.width = size + 'px'
    img.style.height = size + 'px'
    img.style.borderRadius = '50%'
    img.style.objectFit = 'cover'
    img.onerror = () => {
      const fallback = buildFallbackAvatar(className, npc, size)
      img.replaceWith(fallback)
    }
    return img
  }
  const key = npc.characterKey
  if (key && AVATAR_KEYS.has(key)) {
    const img = document.createElement('img')
    img.className = className
    img.src = `assets/avatars/${key}.webp`
    img.alt = npc.name[0]
    img.style.width = size + 'px'
    img.style.height = size + 'px'
    img.style.borderRadius = '50%'
    img.style.objectFit = 'cover'
    img.onerror = () => {
      const fallback = buildFallbackAvatar(className, npc, size)
      img.replaceWith(fallback)
    }
    return img
  }
  return buildFallbackAvatar(className, npc, size)
}

function buildFallbackAvatar(
  className: string,
  npc: NPCConfig,
  size: number,
): HTMLElement {
  const div = document.createElement('div')
  div.className = className
  div.style.width = size + 'px'
  div.style.height = size + 'px'
  div.style.borderRadius = '50%'
  div.style.display = 'flex'
  div.style.alignItems = 'center'
  div.style.justifyContent = 'center'
  div.style.color = '#fff'
  div.style.fontWeight = 'bold'
  div.style.fontSize = Math.round(size * 0.4) + 'px'
  div.style.background = '#' + npc.color.toString(16).padStart(6, '0')
  div.textContent = npc.name[0]
  return div
}

const STATE_LABELS_ZH: Record<string, string> = {
  idle: '空闲', walking: '行走中', running: '奔跑中', sitting: '休息中',
  typing: '编码中', thinking: '思考中', celebrate: '庆祝', frustrated: '受挫',
  sleeping: '休息中', wave: '打招呼', working: '工作中', talking: '对话中',
  waiting: '等待中', done: '已完成', error: '出错',
}

const STATE_LABELS_EN: Record<string, string> = {
  idle: 'Idle', walking: 'Walking', running: 'Running', sitting: 'Resting',
  typing: 'Coding', thinking: 'Thinking', celebrate: 'Celebrating', frustrated: 'Frustrated',
  sleeping: 'Sleeping', wave: 'Waving', working: 'Working', talking: 'Talking',
  waiting: 'Waiting', done: 'Done', error: 'Error',
}

export function localizeState(state: string): string {
  const labels = getLocale() === 'en' ? STATE_LABELS_EN : STATE_LABELS_ZH
  return labels[state] ?? state
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function stripTags(text: string): string {
  return text.replace(/<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?\s*>/g, '').trim()
}

export function truncateFileName(raw: string, maxLen = 28): string {
  const name = raw.split('/').pop() || raw
  if (name.length <= maxLen) return name
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx <= 0) return name.slice(0, maxLen - 3) + '...'
  const ext = name.slice(dotIdx)
  const base = name.slice(0, dotIdx)
  const keep = maxLen - ext.length - 3
  if (keep <= 0) return name.slice(0, maxLen - 3) + '...'
  return base.slice(0, keep) + '...' + ext
}
