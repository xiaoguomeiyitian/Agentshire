/**
 * @mention picker for group chat input.
 * Shows a dropdown of available citizens when user types @ or clicks the @ button.
 */

export interface MentionableCitizen {
  npcId: string
  name: string
  specialty?: string
  color?: number
  avatarUrl?: string
}

export interface MentionPickerOptions {
  citizens: MentionableCitizen[]
  onSelect: (citizen: MentionableCitizen | { npcId: 'all'; name: string }) => void
}

/**
 * Show a mention picker dropdown near the input bar.
 * Returns a cleanup function to remove the picker.
 */
export function showMentionPicker(
  options: MentionPickerOptions,
  anchorEl?: HTMLElement,
): () => void {
  const { citizens, onSelect } = options

  // Remove any existing picker
  const existing = document.getElementById('town-mention-picker')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'town-mention-picker'
  overlay.className = 'mention-picker'

  const list = document.createElement('div')
  list.className = 'mention-picker-list'

  // "所有人" option
  const allItem = document.createElement('div')
  allItem.className = 'mention-picker-item mention-all-item'
  const allIcon = document.createElement('span')
  allIcon.className = 'mention-picker-icon'
  allIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  allItem.appendChild(allIcon)
  const allText = document.createElement('span')
  allText.textContent = '所有人'
  allItem.appendChild(allText)
  allItem.addEventListener('click', (e) => {
    e.stopPropagation()
    cleanup()
    onSelect({ npcId: 'all', name: '所有人' })
  })
  list.appendChild(allItem)

  // Separator
  const sep = document.createElement('div')
  sep.className = 'mention-picker-sep'
  list.appendChild(sep)

  // Citizens
  for (const c of citizens) {
    const item = document.createElement('div')
    item.className = 'mention-picker-item'
    const icon = document.createElement('span')
    icon.className = 'mention-picker-icon'
    if (c.color) {
      const colorHex = '#' + c.color.toString(16).padStart(6, '0')
      icon.style.background = colorHex
      icon.style.borderRadius = '50%'
      icon.style.width = '20px'
      icon.style.height = '20px'
      icon.style.display = 'inline-flex'
      icon.style.alignItems = 'center'
      icon.style.justifyContent = 'center'
      icon.style.color = '#fff'
      icon.style.fontSize = '11px'
      icon.textContent = c.name[0]
    } else {
      icon.textContent = c.name[0]
    }
    item.appendChild(icon)
    const nameSpan = document.createElement('span')
    nameSpan.className = 'mention-picker-name'
    nameSpan.textContent = c.name
    item.appendChild(nameSpan)
    if (c.specialty) {
      const spec = document.createElement('span')
      spec.className = 'mention-picker-spec'
      spec.textContent = c.specialty
      item.appendChild(spec)
    }
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      cleanup()
      onSelect(c)
    })
    list.appendChild(item)
  }

  overlay.appendChild(list)
  document.body.appendChild(overlay)

  // Position near anchor
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect()
    overlay.style.position = 'fixed'
    overlay.style.bottom = `${window.innerHeight - rect.top + 4}px`
    overlay.style.left = `${rect.left}px`
  }

  const cleanup = () => {
    overlay.remove()
    document.removeEventListener('click', onDocClick)
  }

  const onDocClick = (e: MouseEvent) => {
    if (!overlay.contains(e.target as Node)) {
      cleanup()
    }
  }
  // Delay to avoid immediate close from the same click that opened it
  setTimeout(() => document.addEventListener('click', onDocClick), 0)

  return cleanup
}

/**
 * Parse @mentions from input text.
 * Returns array of npcIds (or 'all' for @所有人).
 */
export function parseMentionsFromInput(
  text: string,
  citizens: MentionableCitizen[],
): string[] {
  const mentions: string[] = []

  // @所有人 / @all
  if (/@(所有人|all|全体)/i.test(text)) {
    mentions.push('all')
  }

  // @citizenName
  for (const c of citizens) {
    const pattern = new RegExp(`@${escapeRegExp(c.name)}(?=\\s|$|[,，。.!！?？])`, 'g')
    if (pattern.test(text)) {
      mentions.push(c.npcId)
    }
  }

  return [...new Set(mentions)]
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
