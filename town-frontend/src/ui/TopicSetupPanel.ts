/**
 * Overlay panel for selecting citizens to join a group topic discussion.
 * Shows only citizens with agentEnabled === true. Multi-select + "召集" button.
 * Polls for NPC spawn status and live-updates row availability.
 */

import { buildAvatarEl } from './ui-utils'
import { t } from '../i18n'

export interface TopicCitizen {
  id: string
  name: string
  specialty?: string
  color: number
  characterKey?: string
  avatarUrl?: string
  spawned?: boolean
}

export interface TopicSetupResult {
  citizens: TopicCitizen[]
}

export function showTopicSetupPanel(
  citizens: TopicCitizen[],
  checkSpawned?: (id: string) => boolean,
): Promise<TopicSetupResult | null> {
  return new Promise((resolve) => {
    if (citizens.length === 0) {
      resolve(null)
      return
    }

    const selected = new Set<string>()
    const rowMap = new Map<string, HTMLElement>()

    const overlay = document.createElement('div')
    overlay.id = 'town-topic-overlay'

    const card = document.createElement('div')
    card.className = 'topic-card'

    const title = document.createElement('div')
    title.className = 'topic-card-title'
    title.textContent = t('topic.title')
    card.appendChild(title)

    const sub = document.createElement('div')
    sub.className = 'topic-card-sub'
    sub.textContent = t('topic.subtitle')
    card.appendChild(sub)

    const list = document.createElement('div')
    list.className = 'topic-citizen-list'

    const gatherBtn = document.createElement('button')
    gatherBtn.className = 'topic-gather-btn'
    gatherBtn.textContent = t('topic.gather')
    gatherBtn.disabled = true

    const updateBtn = () => {
      gatherBtn.disabled = selected.size < 2
      gatherBtn.textContent = selected.size > 0
        ? t('topic.gather_n', { n: String(selected.size) })
        : t('topic.gather')
      // Update select-all checkbox state
      const availableCount = citizens.filter(c => c.spawned !== false).length
      if (selectAllCheck) {
        if (selected.size === 0) {
          selectAllCheck.classList.remove('checked', 'partial')
        } else if (selected.size === availableCount) {
          selectAllCheck.classList.add('checked')
          selectAllCheck.classList.remove('partial')
        } else {
          selectAllCheck.classList.add('partial')
          selectAllCheck.classList.remove('checked')
        }
      }
    }

    const onRowClick = (c: TopicCitizen, row: HTMLElement) => {
      if (row.classList.contains('unavailable')) return
      if (selected.has(c.id)) {
        selected.delete(c.id)
        row.classList.remove('selected')
      } else {
        selected.add(c.id)
        row.classList.add('selected')
      }
      updateBtn()
    }

    // ── Select-all row ──
    const selectAllRow = document.createElement('div')
    selectAllRow.className = 'topic-citizen-row topic-select-all-row'
    const selectAllCheck = document.createElement('span')
    selectAllCheck.className = 'topic-citizen-check'
    selectAllCheck.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#050508" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    selectAllRow.appendChild(selectAllCheck)
    const selectAllLabel = document.createElement('span')
    selectAllLabel.className = 'topic-citizen-name'
    selectAllLabel.textContent = t('topic.select_all')
    selectAllRow.appendChild(selectAllLabel)
    selectAllRow.addEventListener('click', () => {
      const available = citizens.filter(c => c.spawned !== false)
      const allSelected = available.every(c => selected.has(c.id))
      if (allSelected) {
        // Deselect all
        for (const c of available) {
          selected.delete(c.id)
          rowMap.get(c.id)?.classList.remove('selected')
        }
      } else {
        // Select all available
        for (const c of available) {
          selected.add(c.id)
          rowMap.get(c.id)?.classList.add('selected')
        }
      }
      updateBtn()
    })
    list.appendChild(selectAllRow)

    for (const c of citizens) {
      const isAvailable = c.spawned !== false
      const row = document.createElement('div')
      row.className = 'topic-citizen-row' + (isAvailable ? '' : ' unavailable')
      if (!isAvailable) row.setAttribute('data-tooltip', t('topic.not_in_town'))
      rowMap.set(c.id, row)

      const check = document.createElement('span')
      check.className = 'topic-citizen-check'
      check.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#050508" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      row.appendChild(check)

      const avatar = buildAvatarEl('tas-avatar', {
        id: c.id, name: c.name, color: c.color, spawn: { x: 0, y: 0, z: 0 },
        role: 'worker', characterKey: c.characterKey, avatarUrl: c.avatarUrl,
      }, 28)
      row.appendChild(avatar)

      const nameEl = document.createElement('span')
      nameEl.className = 'topic-citizen-name'
      nameEl.textContent = c.name
      row.appendChild(nameEl)

      if (c.specialty) {
        const spec = document.createElement('span')
        spec.className = 'topic-citizen-spec'
        spec.textContent = c.specialty
        row.appendChild(spec)
      }

      row.addEventListener('click', () => onRowClick(c, row))
      list.appendChild(row)
    }

    card.appendChild(list)
    card.appendChild(gatherBtn)
    overlay.appendChild(card)
    document.body.appendChild(overlay)

    let pollTimer: ReturnType<typeof setInterval> | null = null

    if (checkSpawned) {
      pollTimer = setInterval(() => {
        for (const c of citizens) {
          const row = rowMap.get(c.id)
          if (!row) continue
          const nowSpawned = checkSpawned(c.id)
          const wasUnavailable = row.classList.contains('unavailable')
          if (wasUnavailable && nowSpawned) {
            row.classList.remove('unavailable')
            row.removeAttribute('data-tooltip')
          }
        }
      }, 2000)
    }

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer)
      overlay.remove()
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { cleanup(); resolve(null) }
    })

    gatherBtn.addEventListener('click', () => {
      const chosen = citizens.filter(c => selected.has(c.id))
      cleanup()
      resolve({ citizens: chosen })
    })
  })
}
