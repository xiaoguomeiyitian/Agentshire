import { getLocale } from '../i18n'
import catalogZh from '../data/asset-catalog.json'
import catalogEn from '../data/asset-catalog.en.json'
import type { TownEditor } from './TownEditor'

function getCatalog() { return getLocale() === 'en' ? catalogEn : catalogZh }
import type { AssetPreview } from './AssetPreview'
import type { CustomAssetStore, CustomAsset } from './CustomAssetStore'
import type { CustomAssetUpload } from './CustomAssetUpload'

export interface AssetGroup {
  type: string
  style: string
  name: string
  colors: string[]
  cells: [number, number]
  defaultScale: number
  urlPattern: string
  filePattern: string
  fixRotationX?: number
}

export interface AssetCatalogEntry {
  key: string
  name: string
  url: string
  cells: [number, number]
  defaultScale?: number
  fixRotationX?: number
  fixRotationY?: number
  fixRotationZ?: number
  icon?: string
  category: string
  /** Actual asset type derived from group.type (e.g. 'building', 'road') */
  assetType: string
}

type Category = keyof typeof catalogZh | 'custom' | 'characters' | 'pets'

const CATEGORY_LABELS_ZH: Record<string, string> = {
  custom: '我的',
  characters: '角色',
  pets: '宠物', kaykit: '小镇', buildings: '建筑', vehicles: '汽车',
  roads: '道路', nature: '自然', streetProps: '街道', tiles: '瓦片',
  signs: '标牌', factory: '工厂', foodProps: '餐饮', roofProps: '屋顶',
  basketball: '球场', other: '其他', construction: '工地',
}
const CATEGORY_LABELS_EN: Record<string, string> = {
  custom: 'Custom',
  characters: 'Characters',
  pets: 'Pets', kaykit: 'Town', buildings: 'Buildings', vehicles: 'Vehicles',
  roads: 'Roads', nature: 'Nature', streetProps: 'Street', tiles: 'Tiles',
  signs: 'Signs', factory: 'Factory', foodProps: 'Food', roofProps: 'Roof',
  basketball: 'Sports', other: 'Other', construction: 'Build',
}

const CATEGORY_KEYS: Category[] = [
  'custom',
  'characters',
  'pets', 'kaykit', 'buildings', 'vehicles', 'roads', 'nature', 'streetProps',
  'tiles', 'signs', 'factory', 'foodProps', 'roofProps', 'basketball', 'other', 'construction',
]

function getCategories(): { key: Category; label: string }[] {
  const labels = getLocale() === 'en' ? CATEGORY_LABELS_EN : CATEGORY_LABELS_ZH
  return CATEGORY_KEYS.map(key => ({ key, label: labels[key] ?? key }))
}

const PAGE_SIZE = 12

export class AssetPalette {
  private container: HTMLElement
  private editor: TownEditor
  private listEl: HTMLElement
  private preview: AssetPreview | null = null
  private activeCategory: Category = 'custom'
  private page = 0
  private selectedGroup: AssetGroup | null = null
  private selectedColor: string = 'A'
  private customStore: CustomAssetStore | null = null
  private customUpload: CustomAssetUpload | null = null
  private selectedCustomAsset: CustomAsset | null = null
  private activePopover: HTMLElement | null = null

  constructor(container: HTMLElement, editor: TownEditor) {
    this.container = container
    this.editor = editor
    this.listEl = container.querySelector('.palette-list') ?? container
    this.initTabs()
    this.renderList()

    document.addEventListener('click', (e) => {
      if (this.activePopover && !this.activePopover.contains(e.target as Node)) {
        this.activePopover.remove()
        this.activePopover = null
      }
    })
  }

  setPreview(preview: AssetPreview): void {
    this.preview = preview
  }

  setCustomStore(store: CustomAssetStore): void {
    this.customStore = store
    store.onChange(() => {
      if (this.activeCategory === 'custom' || this.activeCategory === 'characters' || this.activeCategory === 'pets') this.renderList()
    })
    if (this.activeCategory === 'custom' || this.activeCategory === 'characters' || this.activeCategory === 'pets') this.renderList()
  }

  setCustomUpload(upload: CustomAssetUpload): void {
    this.customUpload = upload
  }

  private initTabs(): void {
    const tabContainer = this.container.querySelector('.palette-tabs') as HTMLElement
    tabContainer.innerHTML = ''
    for (const cat of getCategories()) {
      const btn = document.createElement('button')
      btn.className = `palette-tab${cat.key === this.activeCategory ? ' active' : ''}`
      btn.dataset.category = cat.key
      btn.textContent = cat.label
      btn.addEventListener('click', () => {
        this.activeCategory = cat.key
        this.page = 0
        this.selectedGroup = null
        this.selectedCustomAsset = null
        this.container.querySelectorAll('.palette-tab').forEach(t => t.classList.remove('active'))
        btn.classList.add('active')
        // Scroll the active tab into view
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
        this.renderList()
      })
      tabContainer.appendChild(btn)
    }

    // Enable horizontal scroll via mouse wheel (translate vertical wheel to horizontal)
    tabContainer.addEventListener('wheel', (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        tabContainer.scrollLeft += e.deltaY
      }
    }, { passive: false })

    // Add scroll indicator arrows
    this.setupTabScrollIndicators(tabContainer as HTMLElement)
  }

  private setupTabScrollIndicators(tabContainer: HTMLElement): void {
    // Find or create the wrapper that contains .palette-tabs
    const parent = tabContainer.parentElement
    if (!parent) return

    // Create left/right arrow indicators if not already present
    let leftArrow = parent.querySelector('.tab-scroll-arrow.left') as HTMLElement | null
    let rightArrow = parent.querySelector('.tab-scroll-arrow.right') as HTMLElement | null

    if (!leftArrow) {
      leftArrow = document.createElement('button')
      leftArrow.className = 'tab-scroll-arrow left'
      leftArrow.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
      leftArrow.setAttribute('aria-label', 'Scroll left')
      leftArrow.addEventListener('click', () => {
        tabContainer.scrollBy({ left: -120, behavior: 'smooth' })
      })
      tabContainer.insertAdjacentElement('beforebegin', leftArrow)
    }
    if (!rightArrow) {
      rightArrow = document.createElement('button')
      rightArrow.className = 'tab-scroll-arrow right'
      rightArrow.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
      rightArrow.setAttribute('aria-label', 'Scroll right')
      rightArrow.addEventListener('click', () => {
        tabContainer.scrollBy({ left: 120, behavior: 'smooth' })
      })
      tabContainer.insertAdjacentElement('afterend', rightArrow)
    }

    const updateArrows = () => {
      const maxScroll = tabContainer.scrollWidth - tabContainer.clientWidth
      const canScrollLeft = tabContainer.scrollLeft > 2
      const canScrollRight = tabContainer.scrollLeft < maxScroll - 2
      leftArrow!.classList.toggle('visible', canScrollLeft)
      rightArrow!.classList.toggle('visible', canScrollRight)
    }

    tabContainer.addEventListener('scroll', updateArrows, { passive: true })
    // Initial state + update after layout settles
    requestAnimationFrame(updateArrows)
    setTimeout(updateArrows, 100)
  }

  private getGroups(): AssetGroup[] {
    if (this.activeCategory === 'custom' || this.activeCategory === 'characters' || this.activeCategory === 'pets') return []
    return (getCatalog() as unknown as Record<string, AssetGroup[]>)[this.activeCategory] ?? []
  }

  private renderList(): void {
    if (this.activeCategory === 'custom' || this.activeCategory === 'characters' || this.activeCategory === 'pets') {
      this.renderCustomList()
      return
    }

    const groups = this.getGroups()
    const totalPages = Math.ceil(groups.length / PAGE_SIZE)
    const pageGroups = groups.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)

    this.listEl.innerHTML = ''

    if (groups.length === 0) {
      this.listEl.innerHTML = '<div class="palette-empty">' + (getLocale() === 'en' ? 'No assets' : '暂无资产') + '</div>'
      return
    }

    for (const group of pageGroups) {
      const isSelected = this.selectedGroup === group
      const card = document.createElement('div')
      card.className = `asset-card${isSelected ? ' selected' : ''}`

      const icon = this.guessIcon(group)
      const shortName = this.truncName(group.name)
      const colorCount = group.colors.length

      card.innerHTML = `
        <div class="asset-icon">${icon}</div>
        <div class="asset-card-info">
          <div class="asset-name" title="${group.name}">${shortName}</div>
          <div class="asset-meta">${group.cells[0]}×${group.cells[1]}${colorCount > 1 ? ` · ${colorCount}色` : ''}</div>
        </div>
      `

      card.addEventListener('click', () => {
        if (this.selectedGroup === group) {
          this.selectedGroup = null
          this.editor.stopPlacing()
          this.renderList()
        } else {
          this.selectedGroup = group
          this.selectedColor = group.colors[0]
          this.startPlacingCurrent()
          this.renderList()
        }
      })

      this.listEl.appendChild(card)

      if (isSelected && colorCount > 1) {
        const colorBar = document.createElement('div')
        colorBar.className = 'color-bar'
        for (const color of group.colors) {
          const swatch = document.createElement('button')
          swatch.className = `color-swatch${color === this.selectedColor ? ' active' : ''}`
          swatch.textContent = color
          swatch.title = getLocale() === 'en' ? `Color ${color}` : `颜色 ${color}`
          swatch.addEventListener('click', (e) => {
            e.stopPropagation()
            this.selectedColor = color
            this.startPlacingCurrent()
            this.renderList()
          })
          colorBar.appendChild(swatch)
        }
        this.listEl.appendChild(colorBar)
      }
    }

    // Pager — render as sibling after list, not inside it
    let pagerEl = this.container.querySelector('.palette-pager') as HTMLElement
    if (pagerEl) pagerEl.remove()

    if (totalPages > 1) {
      pagerEl = document.createElement('div')
      pagerEl.className = 'palette-pager'
      pagerEl.innerHTML = `
        <button class="pager-btn" id="pager-prev" ${this.page === 0 ? 'disabled' : ''}>‹</button>
        <span class="pager-info">${this.page + 1} / ${totalPages}</span>
        <button class="pager-btn" id="pager-next" ${this.page >= totalPages - 1 ? 'disabled' : ''}>›</button>
      `
      this.container.appendChild(pagerEl)
      pagerEl.querySelector('#pager-prev')?.addEventListener('click', () => {
        if (this.page > 0) { this.page--; this.renderList() }
      })
      pagerEl.querySelector('#pager-next')?.addEventListener('click', () => {
        if (this.page < totalPages - 1) { this.page++; this.renderList() }
      })
    }
  }

  private renderCustomList(): void {
    // Filter assets by current category:
    // - 'custom': assets with no category or category === 'custom'
    // - 'characters' / 'pets': assets with matching category
    let assets: CustomAsset[]
    if (this.activeCategory === 'characters' || this.activeCategory === 'pets') {
      assets = this.customStore?.getAssets('model', this.activeCategory) ?? []
    } else {
      // 'custom' tab: show assets without a category (or category === 'custom')
      assets = (this.customStore?.getAssets('model') ?? []).filter(
        a => !a.category || a.category === 'custom',
      )
    }
    this.listEl.innerHTML = ''

    // Remove existing pager and add-footer to keep DOM order stable
    let pagerEl = this.container.querySelector('.palette-pager') as HTMLElement
    if (pagerEl) pagerEl.remove()
    let addBtn = this.container.querySelector('.custom-add-footer') as HTMLElement
    if (addBtn) addBtn.remove()

    if (assets.length === 0) {
      const isEmpty = getLocale() === 'en' ? 'No assets' : '暂无资产'
      const addLabel = getLocale() === 'en' ? '+ Add Asset' : '+ 添加资产'
      // Only show add button on 'custom' tab; characters/pets are preset libraries
      const showAdd = this.activeCategory === 'custom'
      this.listEl.innerHTML = `
        <div class="palette-empty custom-empty">
          <div class="custom-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div>${isEmpty}</div>
          ${showAdd ? `<button class="custom-add-btn-empty">${addLabel}</button>` : ''}
        </div>
      `
      this.listEl.querySelector('.custom-add-btn-empty')?.addEventListener('click', () => {
        this.customUpload?.open(() => this.renderList())
      })
      return
    }

    const totalPages = Math.ceil(assets.length / PAGE_SIZE)
    const pageAssets = assets.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)

    for (const asset of pageAssets) {
      const isSelected = this.selectedCustomAsset?.id === asset.id
      const card = document.createElement('div')
      card.className = `asset-card custom-card${isSelected ? ' selected' : ''}`

      const thumbHtml = asset.thumbnail
        ? `<img class="custom-thumb" src="${asset.thumbnail}" alt="">`
        : `<div class="asset-icon">${this.guessIconByType(asset.assetType ?? 'prop')}</div>`

      card.innerHTML = `
        <div class="custom-thumb-wrap">${thumbHtml}</div>
        <div class="asset-card-info">
          <div class="asset-name" title="${this.escHtml(asset.name)}">${this.escHtml(asset.name)}</div>
          <div class="asset-meta">${asset.cells?.[0] ?? 1}×${asset.cells?.[1] ?? 1}</div>
        </div>
        <button class="custom-more-btn" title="${getLocale() === 'en' ? 'More' : '更多'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
      `

      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.custom-more-btn')) return
        if (this.selectedCustomAsset?.id === asset.id) {
          this.selectedCustomAsset = null
          this.editor.stopPlacing()
          this.renderList()
        } else {
          this.selectedCustomAsset = asset
          this.selectedGroup = null
          this.startPlacingCustom(asset)
          this.renderList()
        }
      })

      // Only show "more" (edit/delete) menu on 'custom' tab — preset libraries are read-only
      if (this.activeCategory === 'custom') {
        card.querySelector('.custom-more-btn')!.addEventListener('click', (e) => {
          e.stopPropagation()
          this.showPopover(card.querySelector('.custom-more-btn') as HTMLElement, asset)
        })
      } else {
        card.querySelector('.custom-more-btn')!.remove()
      }

      this.listEl.appendChild(card)
    }

    // Pager — always append before add-footer to keep stable order
    if (totalPages > 1) {
      pagerEl = document.createElement('div')
      pagerEl.className = 'palette-pager'
      pagerEl.innerHTML = `
        <button class="pager-btn" id="pager-prev" ${this.page === 0 ? 'disabled' : ''}>‹</button>
        <span class="pager-info">${this.page + 1} / ${totalPages}</span>
        <button class="pager-btn" id="pager-next" ${this.page >= totalPages - 1 ? 'disabled' : ''}>›</button>
      `
      this.container.appendChild(pagerEl)
      pagerEl.querySelector('#pager-prev')?.addEventListener('click', () => {
        if (this.page > 0) { this.page--; this.renderList() }
      })
      pagerEl.querySelector('#pager-next')?.addEventListener('click', () => {
        if (this.page < totalPages - 1) { this.page++; this.renderList() }
      })
    }

    // Fixed add button at bottom — only on 'custom' tab, always after pager
    if (this.activeCategory === 'custom') {
      addBtn = document.createElement('button')
      addBtn.className = 'custom-add-footer'
      addBtn.innerHTML = getLocale() === 'en' ? '+ Add Asset' : '+ 添加资产'
      addBtn.addEventListener('click', () => {
        this.customUpload?.open(() => this.renderList())
      })
      this.container.appendChild(addBtn)
    }
  }

  private startPlacingCustom(asset: CustomAsset): void {
    const runtimeUrl = this.customStore?.getModelUrl(asset)
    if (!runtimeUrl) return

    const persistUrl = this.customStore?.getPersistentUrl(asset) ?? runtimeUrl

    const entry: AssetCatalogEntry = {
      key: `custom_${asset.id}`,
      name: asset.name,
      url: persistUrl,
      cells: asset.cells ?? [1, 1],
      defaultScale: asset.scale,
      fixRotationX: asset.fixRotationX,
      fixRotationY: asset.fixRotationY,
      fixRotationZ: asset.fixRotationZ,
      category: 'custom',
      assetType: asset.assetType ?? 'prop',
    }

    this.editor.startPlacing(entry)
    this.preview?.show(runtimeUrl, entry.name, entry.fixRotationX)
  }

  private showPopover(anchor: HTMLElement, asset: CustomAsset): void {
    if (this.activePopover) {
      this.activePopover.remove()
      this.activePopover = null
    }

    const pop = document.createElement('div')
    pop.className = 'custom-popover'
    pop.innerHTML = `
      <button class="popover-item" data-action="edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        ${getLocale() === 'en' ? 'Edit' : '编辑'}
      </button>
      <button class="popover-item popover-danger" data-action="delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        ${getLocale() === 'en' ? 'Delete' : '删除'}
      </button>
    `

    const rect = anchor.getBoundingClientRect()
    const paletteRect = this.container.getBoundingClientRect()
    pop.style.position = 'absolute'
    pop.style.top = `${rect.bottom - paletteRect.top + 4}px`
    pop.style.right = `8px`

    pop.querySelector('[data-action="edit"]')!.addEventListener('click', (e) => {
      e.stopPropagation()
      pop.remove()
      this.activePopover = null
      this.customUpload?.openEdit(asset, () => this.renderList())
    })

    pop.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
      e.stopPropagation()
      pop.remove()
      this.activePopover = null
      this.confirmDelete(asset)
    })

    this.container.appendChild(pop)
    this.activePopover = pop
  }

  private async confirmDelete(asset: CustomAsset): Promise<void> {
    const overlay = document.getElementById('confirm-overlay')!
    document.getElementById('confirm-title')!.textContent = getLocale() === 'en' ? 'Delete Asset' : '删除资产'
    document.getElementById('confirm-message')!.textContent =
      getLocale() === 'en' ? `Delete "${asset.name}"? Items using this asset will not display.` : `确定要删除「${asset.name}」吗？删除后地图中使用该资产的物件将无法显示。`
    overlay.classList.add('open')

    const result = await new Promise<boolean>((resolve) => {
      const okBtn = document.getElementById('confirm-ok')!
      const cancelBtn = document.getElementById('confirm-cancel')!
      const cleanup = (r: boolean) => {
        overlay.classList.remove('open')
        okBtn.removeEventListener('click', onOk)
        cancelBtn.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onBg)
        resolve(r)
      }
      const onOk = () => cleanup(true)
      const onCancel = () => cleanup(false)
      const onBg = (ev: Event) => { if (ev.target === overlay) cleanup(false) }
      okBtn.addEventListener('click', onOk)
      cancelBtn.addEventListener('click', onCancel)
      overlay.addEventListener('click', onBg)
    })

    if (result) {
      if (this.selectedCustomAsset?.id === asset.id) {
        this.selectedCustomAsset = null
        this.editor.stopPlacing()
      }
      await this.customStore?.delete(asset.id)
    }
  }

  private guessIconByType(assetType: string): string {
    const svg = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
    if (assetType === 'building')
      return svg('<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 7h1"/><path d="M14 7h1"/><path d="M9 11h1"/><path d="M14 11h1"/>')
    if (assetType === 'road')
      return svg('<path d="M4 19L20 19"/><path d="M4 15h16"/><path d="M12 3v16"/>')
    return svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>')
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private startPlacingCurrent(): void {
    if (!this.selectedGroup) return
    const entry = this.resolveEntry(this.selectedGroup, this.selectedColor)
    if (entry) {
      this.editor.startPlacing(entry)
      this.preview?.show(entry.url, entry.name, entry.fixRotationX)
    }
  }

  private resolveEntry(group: AssetGroup, color: string): AssetCatalogEntry | null {
    const file = group.filePattern.replace('{color}', color)
    const url = group.urlPattern + file
    const key = `${group.type}_${group.style}_${color}`.toLowerCase().replace(/\s+/g, '_')
    return {
      key,
      name: `${group.name} (${color})`,
      url,
      cells: group.cells as [number, number],
      defaultScale: group.defaultScale,
      fixRotationX: group.fixRotationX,
      category: this.activeCategory,
      assetType: group.type.toLowerCase(),
    }
  }

  private truncName(name: string): string {
    let n = name
      .replace(/^Building\s*/i, 'Bld ')
      .replace(/^Parking\s*Road/i, 'P-Road')
      .replace(/^Road\s*Mid/i, 'RdMid')
    if (n.length > 20) n = n.slice(0, 19) + '…'
    return n
  }

  private guessIcon(group: AssetGroup): string {
    const t = group.type.toLowerCase()
    const svg = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

    if (t.includes('tree') || t.includes('bush') || t.includes('flower') || t.includes('mushroom'))
      return svg('<path d="M12 22v-7"/><path d="M9 9a5 5 0 0 1 6 0"/><circle cx="12" cy="8" r="5"/>')
    if (t.includes('road') || t.includes('parking') || t.includes('tile') || t.includes('grass'))
      return svg('<path d="M4 19L20 19"/><path d="M4 15h16"/><path d="M12 3v16"/><path d="M12 7h0"/><path d="M12 11h0"/>')
    if (t.includes('building') || t.includes('fabric'))
      return svg('<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><path d="M9 7h1"/><path d="M14 7h1"/><path d="M9 11h1"/><path d="M14 11h1"/>')
    if (t.includes('car') || t.includes('taxi') || t.includes('truck') || t.includes('rv') || t.includes('police') || t.includes('bus'))
      return svg('<path d="M5 17h14"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 11V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>')
    if (t.includes('lamp') || t.includes('light') || t.includes('streetlamp'))
      return svg('<line x1="12" y1="2" x2="12" y2="14"/><path d="M9 14h6"/><path d="M8 22h8"/><path d="M10 22v-4h4v4"/>')
    if (t.includes('fence') || t.includes('wall') || t.includes('brick'))
      return svg('<rect x="1" y="4" width="22" height="16" rx="1"/><line x1="1" y1="10" x2="23" y2="10"/><line x1="1" y1="16" x2="23" y2="16"/><line x1="12" y1="4" x2="12" y2="10"/><line x1="7" y1="10" x2="7" y2="16"/><line x1="17" y1="10" x2="17" y2="16"/>')
    if (t.includes('sign') || t.includes('bilboard') || t.includes('placard'))
      return svg('<rect x="4" y="3" width="16" height="12" rx="1"/><line x1="12" y1="15" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>')
    if (t.includes('bench') || t.includes('chair') || t.includes('table') || t.includes('parasol'))
      return svg('<path d="M4 18h16"/><path d="M4 18l1-6h14l1 6"/><path d="M6 12V8"/><path d="M18 12V8"/>')
    if (t.includes('cone') || t.includes('barier'))
      return svg('<path d="M12 2L8 22h8L12 2z"/><line x1="6" y1="22" x2="18" y2="22"/>')
    if (t.includes('food') || t.includes('burger') || t.includes('pizza') || t.includes('coffee'))
      return svg('<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>')
    if (t.includes('basket'))
      return svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20"/><path d="M2 12h20"/>')
    if (t.includes('factory') || t.includes('gas') || t.includes('chimney'))
      return svg('<path d="M2 20h20"/><path d="M5 20V8l5 4V8l5 4V4h3v16"/>')
    if (t.includes('rock') || t.includes('peble'))
      return svg('<path d="M6 18l-2-5 4-7 5-2 6 3 3 6-2 5H6z"/>')
    if (t.includes('trash') || t.includes('dumpster'))
      return svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6"/>')
    if (t.includes('hydrant') || t.includes('post'))
      return svg('<rect x="9" y="3" width="6" height="18" rx="2"/><path d="M5 10h14"/>')
    if (t.includes('plane') || t.includes('heli') || t.includes('cloud') || t.includes('antenna'))
      return svg('<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>')
    if (t.includes('duck'))
      return svg('<circle cx="10" cy="8" r="5"/><path d="M15 8c2 0 4 1 5 3"/><path d="M5 13c-2 2-3 5-1 7h16c2-2 1-5-1-7"/>')

    return svg('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>')
  }

  deselect(): void {
    this.selectedGroup = null
    this.selectedCustomAsset = null
    this.renderList()
  }

  switchToCustom(): void {
    this.activeCategory = 'custom'
    this.page = 0
    this.selectedGroup = null
    this.container.querySelectorAll('.palette-tab').forEach(t => t.classList.remove('active'))
    this.container.querySelector('.palette-tab[data-category="custom"]')?.classList.add('active')
    this.renderList()
  }
}
