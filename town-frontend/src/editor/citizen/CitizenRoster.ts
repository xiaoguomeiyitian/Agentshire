import type { CitizenWorkshopConfig, WorkshopCitizenConfig } from '../../data/CitizenWorkshopConfig'
import { getLocale, t } from '../../i18n'
import { generateCitizenId, INDUSTRY_SPECIALTY_MAP } from '../../data/CitizenWorkshopConfig'
import { getAllGroups } from '../../data/CharacterModelRegistry'
import { apiUrl } from '@/utils/api-base'

export type RosterSelection =
  | { type: 'user' }
  | { type: 'steward' }
  | { type: 'citizen'; id: string }

export type RosterListener = (selection: RosterSelection | null) => void

export class CitizenRoster {
  private el: HTMLElement
  private config: CitizenWorkshopConfig
  private selection: RosterSelection | null = null
  private listeners: RosterListener[] = []
  private activeMenu: HTMLElement | null = null
  private onDeleteCallback: ((id: string) => void) | null = null
  private avatarResolver: ((avatarUrl?: string, avatarId?: string) => string | null) | null = null

  constructor(el: HTMLElement, config: CitizenWorkshopConfig) {
    this.el = el
    this.config = config
    document.addEventListener('click', () => this.closeActiveMenu())
    this.render()
    this.selectFirst()
  }

  onChange(fn: RosterListener): void {
    this.listeners.push(fn)
  }

  onDelete(fn: (id: string) => void): void {
    this.onDeleteCallback = fn
  }

  setAvatarResolver(fn: (avatarUrl?: string, avatarId?: string) => string | null): void {
    this.avatarResolver = fn
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.selection)
  }

  getSelection(): RosterSelection | null {
    return this.selection
  }

  getConfig(): CitizenWorkshopConfig {
    return this.config
  }

  setConfig(config: CitizenWorkshopConfig): void {
    this.config = config
    this.render()
  }

  select(sel: RosterSelection | null): void {
    this.selection = sel
    this.updateSelectionUI()
    this.emit()
  }

  addCitizen(name: string): void {
    const id = generateCitizenId()
    const industries = Object.keys(INDUSTRY_SPECIALTY_MAP)
    const defaultIndustry = industries[0]
    const defaultSpecialty = INDUSTRY_SPECIALTY_MAP[defaultIndustry][0]

    const citizen: WorkshopCitizenConfig = {
      id,
      name: name.trim() || (getLocale() === 'en' ? 'New Citizen' : '新居民'),
      avatarId: 'char-male-f',
      modelSource: 'builtin',
      bio: '',
      industry: defaultIndustry,
      specialty: defaultSpecialty,
      persona: '',
      homeId: '',
    }
    this.config.citizens.push(citizen)
    this.render()
    this.select({ type: 'citizen', id })
  }

  deleteCitizen(id: string): void {
    this.config.citizens = this.config.citizens.filter(c => c.id !== id)
    if (this.selection?.type === 'citizen' && (this.selection as any).id === id) {
      this.selectFirst()
    }
    this.render()
  }

  private selectFirst(): void {
    this.selection = { type: 'user' }
    this.emit()
  }

  private closeActiveMenu(): void {
    if (this.activeMenu) {
      this.activeMenu.remove()
      this.activeMenu = null
    }
  }

  private showItemMenu(btn: HTMLElement, citizenId: string, _citizenName: string): void {
    this.closeActiveMenu()

    const menu = document.createElement('div')
    menu.className = 'cw-roster-menu'

    const delItem = document.createElement('button')
    delItem.className = 'cw-roster-menu-item danger'
    delItem.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>${getLocale() === 'en' ? 'Delete' : '删除居民'}`
    delItem.addEventListener('click', (e) => {
      e.stopPropagation()
      this.closeActiveMenu()
      if (this.onDeleteCallback) {
        this.onDeleteCallback(citizenId)
      } else {
        this.deleteCitizen(citizenId)
      }
    })
    menu.appendChild(delItem)

    const rect = btn.getBoundingClientRect()
    menu.style.position = 'fixed'
    menu.style.left = `${rect.right + 4}px`
    menu.style.top = `${rect.top - 4}px`

    if (rect.right + 140 > window.innerWidth) {
      menu.style.left = `${rect.left - 140}px`
    }

    document.body.appendChild(menu)
    this.activeMenu = menu
  }

  render(): void {
    const list = this.el
    list.innerHTML = ''
    const u = this.config.user
    const s = this.config.steward

    list.appendChild(this.renderGroup('', [
      this.renderItem({ type: 'user' }, u.name, '', u.avatarUrl, u.avatarId),
    ]))

    list.appendChild(this.renderGroup('', [
      this.renderItem({ type: 'steward' }, s.name, s.bio ? t('steward') : '', s.avatarUrl, s.avatarId),
    ]))

    if (this.config.citizens.length > 0) {
      const citizenItems = this.config.citizens.map(c =>
        this.renderItem({ type: 'citizen', id: c.id }, c.name, c.specialty || c.industry, c.avatarUrl, c.avatarId, true)
      )
      list.appendChild(this.renderGroup(getLocale() === 'en' ? `Citizens (${this.config.citizens.length})` : `居民 (${this.config.citizens.length})`, citizenItems))
    }

    this.updateSelectionUI()
  }

  private renderGroup(label: string, items: HTMLElement[]): HTMLElement {
    const group = document.createElement('div')
    group.className = 'cw-roster-group'
    if (label) {
      const lbl = document.createElement('div')
      lbl.className = 'cw-roster-group-label'
      lbl.textContent = label
      group.appendChild(lbl)
    }
    for (const item of items) group.appendChild(item)
    return group
  }

  private resolveAvatarUrl(avatarUrl?: string, avatarId?: string): string | null {
    if (this.avatarResolver) return this.avatarResolver(avatarUrl, avatarId)
    if (avatarUrl) return apiUrl(avatarUrl)
    if (avatarId) {
      const group = getAllGroups().find(g => g.id === avatarId)
      if (group?.thumbnailUrl) return group.thumbnailUrl
    }
    return null
  }

  private renderItem(
    sel: RosterSelection,
    name: string,
    meta: string,
    avatarUrl?: string,
    avatarId?: string,
    hasMenu = false,
  ): HTMLElement {
    const item = document.createElement('div')
    item.className = 'cw-roster-item'
    item.dataset.type = sel.type
    if (sel.type === 'citizen') item.dataset.id = sel.id

    const avatar = document.createElement('div')
    avatar.className = 'cw-roster-avatar'
    const imgUrl = this.resolveAvatarUrl(avatarUrl, avatarId)
    if (imgUrl) {
      const img = document.createElement('img')
      img.src = imgUrl
      img.alt = name
      img.onerror = () => { img.remove(); avatar.textContent = name.charAt(0) }
      avatar.appendChild(img)
    } else {
      avatar.textContent = name.charAt(0)
    }
    item.appendChild(avatar)

    const info = document.createElement('div')
    info.className = 'cw-roster-info'
    const nameEl = document.createElement('div')
    nameEl.className = 'cw-roster-name'
    nameEl.textContent = name
    info.appendChild(nameEl)
    if (meta) {
      const metaEl = document.createElement('div')
      metaEl.className = 'cw-roster-meta'
      metaEl.textContent = meta
      info.appendChild(metaEl)
    }
    item.appendChild(info)

    if (hasMenu && sel.type === 'citizen') {
      const moreBtn = document.createElement('button')
      moreBtn.className = 'cw-roster-more'
      moreBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>'
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const citizen = this.config.citizens.find(c => c.id === sel.id)
        this.showItemMenu(moreBtn, sel.id, citizen?.name || '')
      })
      item.appendChild(moreBtn)
    }

    item.addEventListener('click', () => this.select(sel))
    return item
  }

  private updateSelectionUI(): void {
    this.el.querySelectorAll('.cw-roster-item').forEach(el => {
      const item = el as HTMLElement
      const type = item.dataset.type
      const id = item.dataset.id
      let isSelected = false
      if (this.selection) {
        if (this.selection.type === type) {
          if (type === 'citizen') {
            isSelected = (this.selection as any).id === id
          } else {
            isSelected = true
          }
        }
      }
      item.classList.toggle('selected', isSelected)
    })
  }
}
