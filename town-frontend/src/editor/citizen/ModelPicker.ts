import {
  getBuiltinGroups, getLibraryGroups, resolveGroupMeshUrl,
  type CharacterGroup,
} from '../../data/CharacterModelRegistry'
import { getLocale } from '../../i18n'
import { CharacterModelUpload } from './CharacterModelUpload'
import { apiUrl } from '@/utils/api-base'

export type ModelPickerListener = (meshUrl: string, groupId: string) => void
export type PreviewListener = (meshUrl: string, group: CharacterGroup) => void
export type CardActionListener = (group: CharacterGroup) => void

export class ModelPicker {
  private static readonly SVG_PERSON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
  private static readonly SVG_UPLOAD = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`
  private static readonly SVG_PLUS = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
  private static readonly SVG_MORE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`
  private static readonly SVG_EDIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`
  private static readonly SVG_DELETE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`
  private static readonly SVG_ANIM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>`

  private tabsEl: HTMLElement
  private gridEl: HTMLElement

  private allGroups: CharacterGroup[] = []
  private customGroups: CharacterGroup[] = []
  private filter: 'all' | 'custom' = 'all'
  private listeners: ModelPickerListener[] = []
  private onUploadCallback: (() => void) | null = null
  private previewListener: PreviewListener | null = null
  private deselectedListener: (() => void) | null = null
  private editListener: CardActionListener | null = null
  private deleteListener: CardActionListener | null = null
  private animListener: CardActionListener | null = null
  private charUpload: CharacterModelUpload | null = null
  private activePopover: HTMLElement | null = null
  private customModelsReadyCallback: (() => void) | null = null

  currentGroupId = ''
  candidateGroup: CharacterGroup | null = null
  selectedVariant = 1
  selectedColor = 1

  constructor(tabsEl: HTMLElement, gridEl: HTMLElement, _scrollEl: HTMLElement) {
    this.tabsEl = tabsEl
    this.gridEl = gridEl
    this.allGroups = [...getBuiltinGroups()]
    this.probeLibraryAssets()
    this.loadCustomModels()
    this.initTabs()
    this.render()
  }

  private async probeLibraryAssets(): Promise<void> {
    try {
      const res = await fetch(apiUrl('/ext-assets/Characters_1/thumbnails/lib-1.webp'), { method: 'HEAD' })
      if (res.ok) {
        this.allGroups = [...getBuiltinGroups(), ...getLibraryGroups()]
        this.render()
      }
    } catch { /* library assets not available — keep builtin only */ }
  }

  onSelect(fn: ModelPickerListener): void { this.listeners.push(fn) }
  onUpload(fn: () => void): void { this.onUploadCallback = fn }
  onPreview(fn: PreviewListener): void { this.previewListener = fn }
  onDeselected(fn: () => void): void { this.deselectedListener = fn }
  onEdit(fn: CardActionListener): void { this.editListener = fn }
  onDelete(fn: CardActionListener): void { this.deleteListener = fn }
  onAnimMapping(fn: CardActionListener): void { this.animListener = fn }
  onCustomModelsReady(fn: () => void): void { this.customModelsReadyCallback = fn }

  setCurrentGroupId(id: string): void {
    this.currentGroupId = id
    this.render()
  }

  setCandidateGroup(group: CharacterGroup | null): void {
    this.candidateGroup = group
    this.render()
  }

  async refreshCustomModels(): Promise<void> { await this.loadCustomModels(); this.render() }

  getGroupById(id: string): CharacterGroup | undefined {
    return [...this.allGroups, ...this.customGroups].find(g => g.id === id)
  }

  getAllAndCustomGroups(): CharacterGroup[] {
    return [...this.allGroups, ...this.customGroups]
  }

  confirm(): void {
    if (!this.candidateGroup) return
    const url = resolveGroupMeshUrl(this.candidateGroup, this.selectedVariant, this.selectedColor)
    for (const fn of this.listeners) fn(url, this.candidateGroup.id)
  }

  private async loadCustomModels(): Promise<void> {
    try {
      const r = await fetch(apiUrl('/custom-assets/_api/list'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      const assets = d.assets ?? []
      this.customGroups = assets
        .filter((a: any) => a.kind === 'character')
        .map((a: any) => ({
          id: `custom-${a.id}`,
          displayName: a.name,
          source: 'custom' as const,
          thumbnailUrl: apiUrl(a.thumbnail || ''),
          variants: [],
          colors: [],
          meshUrlPattern: `/custom-assets/characters/${a.fileName}`,
          animMapping: a.animMapping,
          detectedClips: a.detectedClips,
          animFileUrls: a.animFileUrls,
          assetId: a.id,
        }))
    } catch { this.customGroups = [] }
    this.customModelsReadyCallback?.()
  }

  private initTabs(): void {
    this.tabsEl.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest('.cw-picker-tab') as HTMLElement | null
      if (!tab) return
      this.filter = (tab.dataset.filter ?? 'all') as typeof this.filter
      this.tabsEl.querySelectorAll('.cw-picker-tab').forEach(t =>
        t.classList.toggle('active', t === tab)
      )
      this.render()
    })
  }

  private getFilteredGroups(): CharacterGroup[] {
    if (this.filter === 'custom') return this.customGroups
    return this.allGroups
  }

  render(): void {
    this.gridEl.innerHTML = ''
    this.dismissPopover()
    const groups = this.getFilteredGroups()
    const isCustom = this.filter === 'custom'

    if (isCustom && groups.length === 0) {
      this.renderEmptyState()
      return
    }

    if (isCustom) {
      this.gridEl.appendChild(this.createAddCard())
    }

    for (const group of groups) {
      const card = document.createElement('div')
      const isCurrent = group.id === this.currentGroupId
      const isCandidate = this.candidateGroup?.id === group.id
      let cls = 'cw-model-card'
      if (isCurrent) cls += ' current'
      if (isCandidate && !isCurrent) cls += ' candidate'
      card.className = cls
      card.dataset.groupId = group.id

      const thumb = document.createElement('div')
      thumb.className = 'cw-model-card-thumb'
      if (group.thumbnailUrl) {
        const img = document.createElement('img')
        img.src = group.thumbnailUrl
        img.alt = group.displayName
        img.onerror = () => {
          img.remove()
          thumb.innerHTML = ModelPicker.SVG_PERSON
        }
        thumb.appendChild(img)
      } else {
        thumb.innerHTML = group.source === 'custom' ? ModelPicker.SVG_UPLOAD : ModelPicker.SVG_PERSON
      }
      card.appendChild(thumb)

      if (isCustom) {
        const nameRow = document.createElement('div')
        nameRow.className = 'cw-model-card-name-row'
        const nameEl = document.createElement('span')
        nameEl.className = 'cw-model-card-name'
        nameEl.textContent = group.displayName
        nameRow.appendChild(nameEl)

        const moreBtn = document.createElement('button')
        moreBtn.className = 'cw-card-more-btn'
        moreBtn.title = getLocale() === 'en' ? 'More' : '更多'
        moreBtn.innerHTML = ModelPicker.SVG_MORE
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          this.showCardPopover(moreBtn, group)
        })
        nameRow.appendChild(moreBtn)
        card.appendChild(nameRow)
      } else {
        const name = document.createElement('div')
        name.className = 'cw-model-card-name'
        name.textContent = group.displayName
        card.appendChild(name)
      }

      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.cw-card-more-btn')) return
        if (this.candidateGroup?.id === group.id) {
          this.candidateGroup = null
          this.render()
          this.deselectedListener?.()
          return
        }
        this.candidateGroup = group
        this.selectedVariant = group.variants[0] ?? 1
        this.selectedColor = group.colors[0] ?? 1
        this.render()
        const url = resolveGroupMeshUrl(group, this.selectedVariant, this.selectedColor)
        this.previewListener?.(url, group)
      })

      this.gridEl.appendChild(card)
    }
  }

  private createAddCard(): HTMLElement {
    const card = document.createElement('div')
    card.className = 'cw-model-card cw-model-card-upload'
    card.innerHTML = `
      <div class="cw-model-card-thumb">${ModelPicker.SVG_PLUS}</div>
      <div class="cw-model-card-name">${getLocale() === 'en' ? 'Add Model' : '添加模型'}</div>
    `
    card.addEventListener('click', () => this.handleUpload())
    return card
  }

  private renderEmptyState(): void {
    const empty = document.createElement('div')
    empty.className = 'cw-picker-empty'
    empty.innerHTML = `
      <div class="cw-picker-empty-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.29 7 12 12 20.71 7"/>
          <line x1="12" y1="22" x2="12" y2="12"/>
        </svg>
      </div>
      <div class="cw-picker-empty-text">${getLocale() === 'en' ? 'No custom models yet' : '还没有自定义角色模型'}</div>
      <div class="cw-picker-empty-hint">${getLocale() === 'en' ? 'Upload .glb / .gltf 3D models' : '上传 .glb / .gltf 格式的 3D 角色模型'}</div>
    `
    const btn = document.createElement('button')
    btn.className = 'cw-picker-empty-btn'
    btn.textContent = getLocale() === 'en' ? '+ Add Model' : '+ 添加角色模型'
    btn.addEventListener('click', () => this.handleUpload())
    empty.appendChild(btn)
    this.gridEl.appendChild(empty)
  }

  private showCardPopover(anchor: HTMLElement, group: CharacterGroup): void {
    this.dismissPopover()

    const pop = document.createElement('div')
    pop.className = 'custom-popover'
    pop.innerHTML = `
      <button class="popover-item" data-action="edit">${ModelPicker.SVG_EDIT} ${getLocale() === 'en' ? 'Edit' : '编辑'}</button>
      <button class="popover-item" data-action="anim">${ModelPicker.SVG_ANIM} ${getLocale() === 'en' ? 'Animations' : '动画映射'}</button>
      <button class="popover-item popover-danger" data-action="delete">${ModelPicker.SVG_DELETE} ${getLocale() === 'en' ? 'Delete' : '删除'}</button>
    `

    const rect = anchor.getBoundingClientRect()
    const gridRect = this.gridEl.getBoundingClientRect()
    pop.style.position = 'absolute'
    pop.style.top = `${rect.bottom - gridRect.top + 4}px`
    pop.style.right = `${gridRect.right - rect.right}px`
    pop.style.zIndex = '50'

    pop.querySelector('[data-action="edit"]')!.addEventListener('click', (e) => {
      e.stopPropagation()
      this.dismissPopover()
      this.editListener?.(group)
    })
    pop.querySelector('[data-action="anim"]')!.addEventListener('click', (e) => {
      e.stopPropagation()
      this.dismissPopover()
      this.animListener?.(group)
    })
    pop.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
      e.stopPropagation()
      this.dismissPopover()
      this.deleteListener?.(group)
    })

    this.gridEl.style.position = 'relative'
    this.gridEl.appendChild(pop)
    this.activePopover = pop

    const outsideHandler = (e: Event) => {
      if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        this.dismissPopover()
        document.removeEventListener('click', outsideHandler)
      }
    }
    setTimeout(() => document.addEventListener('click', outsideHandler))
  }

  private dismissPopover(): void {
    this.activePopover?.remove()
    this.activePopover = null
  }

  private handleUpload(): void {
    if (!this.charUpload) this.charUpload = new CharacterModelUpload()
    this.charUpload.open(async (_result) => {
      await this.loadCustomModels()
      this.filter = 'custom'
      this.tabsEl.querySelectorAll('.cw-picker-tab').forEach(t =>
        t.classList.toggle('active', (t as HTMLElement).dataset.filter === 'custom')
      )
      this.render()
      this.onUploadCallback?.()
    })
  }

  openEditForGroup(group: CharacterGroup): void {
    if (group.source !== 'custom') return
    const assetId = group.id.replace('custom-', '')
    if (!this.charUpload) this.charUpload = new CharacterModelUpload()
    this.charUpload.openEdit(assetId, async () => {
      await this.loadCustomModels()
      this.render()
      this.onUploadCallback?.()
    })
  }
}
