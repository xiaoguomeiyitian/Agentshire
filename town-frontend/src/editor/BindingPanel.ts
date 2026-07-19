import { getLocale } from '../i18n'
import type { TownEditor } from './TownEditor'
import { type BindingSlot, getBuildingBindingSlot } from './TownMapConfig'

interface SlotDef {
  slot: BindingSlot
  icon: string
  label: string
  required: boolean
  auto: boolean
}

const SLOT_ICONS: Record<BindingSlot, string> = {
  office: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16"/><path d="M9 7h1"/><path d="M14 7h1"/><path d="M9 11h1"/><path d="M14 11h1"/><path d="M9 15h1"/><path d="M14 15h1"/></svg>',
  museum: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M12 3l9 7H3l9-7z"/><path d="M6 10v8"/><path d="M10 10v8"/><path d="M14 10v8"/><path d="M18 10v8"/></svg>',
  houses: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l4-3.5L11 9v9H3V9z"/><path d="M13 6l4-3.5L21 6v12h-8V6z"/><path d="M6 18v-3h2v3"/><path d="M16 18v-4h2v4"/></svg>',
}

const SLOTS: SlotDef[] = [
  { slot: 'office',   icon: SLOT_ICONS.office,   label: getLocale() === 'en' ? 'Workshop' : '工坊',    required: true,  auto: false },
  { slot: 'museum',   icon: SLOT_ICONS.museum,   label: getLocale() === 'en' ? 'Museum' : '博物馆',    required: false, auto: false },
  { slot: 'houses',   icon: SLOT_ICONS.houses,    label: getLocale() === 'en' ? 'NPC Houses' : 'NPC 住宅', required: false, auto: true  },
]

export class BindingPanel {
  private el: HTMLElement
  private editor: TownEditor
  private openDropdown: HTMLElement | null = null

  constructor(el: HTMLElement, editor: TownEditor) {
    this.el = el
    this.editor = editor

    document.addEventListener('click', (e) => {
      if (this.openDropdown && !this.openDropdown.contains(e.target as Node)) {
        this.closeDropdown()
      }
    })
  }

  refresh(): void {
    const config = this.editor.config
    const bindings = config.bindings

    this.el.innerHTML = ''
    this.openDropdown = null

    const closeBtn = document.createElement('button')
    closeBtn.className = 'binding-close'
    closeBtn.innerHTML = '&times;'
    closeBtn.addEventListener('click', () => {
      document.getElementById('binding-overlay')?.classList.remove('open')
    })
    this.el.appendChild(closeBtn)

    const title = document.createElement('div')
    title.className = 'binding-title'
    title.textContent = getLocale() === 'en' ? 'Bindings' : '功能绑定'
    this.el.appendChild(title)

    for (const def of SLOTS) {
      this.el.appendChild(this.renderSlotRow(def, bindings))
    }

    const tip = document.createElement('div')
    tip.className = 'binding-tip'
    tip.textContent = getLocale() === 'en' ? 'Select a building to bind' : '从下拉列表中选择建筑进行绑定'
    this.el.appendChild(tip)
  }

  private closeDropdown(): void {
    if (this.openDropdown) {
      this.openDropdown.remove()
      this.openDropdown = null
    }
  }

  private renderSlotRow(def: SlotDef, bindings: typeof this.editor.config.bindings): HTMLElement {
    const row = document.createElement('div')
    row.className = 'binding-row'

    const icon = document.createElement('span')
    icon.className = 'binding-icon'
    icon.innerHTML = def.icon

    const info = document.createElement('div')
    info.className = 'binding-info'

    const label = document.createElement('div')
    label.className = 'binding-label'
    label.textContent = def.label

    const isBound = def.slot === 'houses'
      ? bindings.houses.length > 0
      : !!bindings[def.slot]

    let tag: string
    let tagClass: string
    if (isBound) {
      tag = getLocale() === 'en' ? 'Bound' : '已绑定'
      tagClass = 'tag-optional'
    } else if (def.required) {
      tag = getLocale() === 'en' ? 'Required' : '必填'
      tagClass = 'tag-required'
    } else if (def.auto) {
      tag = getLocale() === 'en' ? 'Auto' : '自动'
      tagClass = 'tag-auto'
    } else {
      tag = getLocale() === 'en' ? 'Optional' : '推荐'
      tagClass = 'tag-optional'
    }
    const tagEl = document.createElement('span')
    tagEl.className = `binding-tag ${tagClass}`
    tagEl.textContent = tag
    label.appendChild(tagEl)

    const desc = document.createElement('div')
    desc.className = 'binding-desc'

    info.appendChild(label)
    info.appendChild(desc)

    const actions = document.createElement('div')
    actions.className = 'binding-actions'

    if (def.slot === 'houses') {
      const count = bindings.houses.length
      desc.textContent = count > 0 ? (getLocale() === 'en' ? `${count} bound` : `${count} 栋已绑定`) : (getLocale() === 'en' ? 'Select building' : '从列表中选择建筑绑定')

      const badge = document.createElement('span')
      badge.className = `binding-badge ${count > 0 ? 'set' : 'unset'}`
      badge.textContent = String(count)
      actions.appendChild(badge)

      const addBtn = this.makeActionBtn(getLocale() === 'en' ? 'Add' : '添加', 'bind', (e) => {
        e.stopPropagation()
        this.showBuildingDropdown(def.slot, addBtn)
      })
      actions.appendChild(addBtn)
    } else {
      const boundId = bindings[def.slot]
      if (boundId) {
        const building = this.editor.config.buildings.find(b => b.id === boundId)
        desc.textContent = building?.displayName ?? building?.modelKey ?? boundId

        const changeBtn = this.makeActionBtn(getLocale() === 'en' ? 'Change' : '更换', 'change', (e) => {
          e.stopPropagation()
          this.showBuildingDropdown(def.slot, changeBtn)
        })
        actions.appendChild(changeBtn)

        const unbindBtn = this.makeActionBtn(getLocale() === 'en' ? 'Unbind' : '解绑', 'unbind', (e) => {
          e.stopPropagation()
          this.editor.unbind(def.slot)
          this.refresh()
        })
        actions.appendChild(unbindBtn)
      } else {
        desc.textContent = getLocale() === 'en' ? 'Unbound' : '未绑定'

        const bindBtn = this.makeActionBtn(getLocale() === 'en' ? 'Bind' : '绑定', 'bind', (e) => {
          e.stopPropagation()
          this.showBuildingDropdown(def.slot, bindBtn)
        })
        actions.appendChild(bindBtn)
      }
    }

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(actions)
    return row
  }

  private showBuildingDropdown(slot: BindingSlot, anchor: HTMLElement): void {
    this.closeDropdown()

    const dropdown = document.createElement('div')
    dropdown.className = 'binding-dropdown'

    const buildings = this.editor.config.buildings
    if (buildings.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'bd-empty'
      empty.textContent = getLocale() === 'en' ? 'No buildings' : '地图中没有建筑'
      dropdown.appendChild(empty)
    } else {
      for (const b of buildings) {
        const existing = getBuildingBindingSlot(this.editor.config, b.id)
        const isSelf = existing?.slot === slot
        const isOccupied = existing && !isSelf

        const item = document.createElement('div')
        item.className = `bd-item${isOccupied ? ' bd-disabled' : ''}${isSelf ? ' bd-current' : ''}`

        const nameSpan = document.createElement('span')
        nameSpan.className = 'bd-name'
        nameSpan.textContent = b.displayName ?? b.modelKey

        const metaSpan = document.createElement('span')
        metaSpan.className = 'bd-meta'
        metaSpan.textContent = `${b.widthCells}×${b.depthCells}`

        item.appendChild(nameSpan)
        item.appendChild(metaSpan)

        if (isOccupied) {
          const lockSpan = document.createElement('span')
          lockSpan.className = 'bd-lock'
          lockSpan.textContent = existing.label
          item.appendChild(lockSpan)
        }

        if (isSelf) {
          const curSpan = document.createElement('span')
          curSpan.className = 'bd-current-tag'
          curSpan.textContent = getLocale() === 'en' ? 'Current' : '当前'
          item.appendChild(curSpan)
        }

        if (!isOccupied && !isSelf) {
          item.addEventListener('click', (e) => {
            e.stopPropagation()
            this.closeDropdown()
            this.editor.completeBinding(slot, b.id)
            this.refresh()
          })
        }

        dropdown.appendChild(item)
      }
    }

    const rect = anchor.getBoundingClientRect()
    const panelRect = this.el.getBoundingClientRect()
    dropdown.style.top = `${rect.bottom - panelRect.top + 4}px`
    dropdown.style.right = `${panelRect.right - rect.right}px`

    this.el.appendChild(dropdown)
    this.openDropdown = dropdown
  }

  private makeActionBtn(text: string, type: 'bind' | 'change' | 'unbind', onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = `binding-action-btn btn-${type}`
    btn.textContent = text
    btn.addEventListener('click', onClick as EventListener)
    return btn
  }
}
