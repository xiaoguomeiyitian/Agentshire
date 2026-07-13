/**
 * Skill marketplace panel for the Agentshire.
 * Two tabs: "已获取" (equipped) and "技能超市" (market).
 */
import {
  getAllSkills, getAllCategories, getSkillsByCategory,
  createSkillIcon, type SkillEntry,
} from './SkillIcons'
import { apiUrl } from '@/utils/api-base'

import catalogZh from '../data/skill-catalog.json'
import catalogEn from '../data/skill-catalog.en.json'
import { t, getLocale } from '../i18n'

function getCatalog() { return getLocale() === 'en' ? catalogEn : catalogZh }

const getInstallTpl = () => (getCatalog() as any).installCmdTemplate as string

export function getInstallCmd(slug: string): string {
  return getInstallTpl().replace(/\{slug\}/g, slug)
}

function formatNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + t('skill.wan')
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

type InstallCallback = (slug: string, installCmd: string) => void

export class SkillPanel {
  private overlay: HTMLElement
  private topbar!: HTMLElement
  private listWrap!: HTMLElement
  private equippedTab!: HTMLElement
  private marketTab!: HTMLElement

  private activeTab: 'equipped' | 'market' = 'market'
  private activeCategory: string | null = null
  private searchQuery = ''
  private installedNames = new Set<string>()
  private pendingSlugs = new Set<string>()
  private onInstall: InstallCallback

  constructor(container: HTMLElement, onInstall: InstallCallback) {
    this.overlay = container
    this.onInstall = onInstall
    this.build()
  }

  toggle(): void { this.overlay.classList.contains('open') ? this.close() : this.open() }

  open(): void {
    this.overlay.classList.add('open')
    this.fetchInstalled().then(() => this.renderList())
  }

  close(): void { this.overlay.classList.remove('open') }

  get isOpen(): boolean { return this.overlay.classList.contains('open') }

  markInstalled(slug: string): void {
    const skill = getAllSkills().find(s => s.slug === slug)
    if (skill) this.installedNames.add(skill.name)
    this.pendingSlugs.delete(slug)
    if (this.isOpen) this.renderList()
  }

  private async fetchInstalled(): Promise<void> {
    try {
      const res = await fetch(apiUrl('/installed-skills'))
      if (!res.ok) return
      const data = await res.json() as Record<string, { name: string }>
      this.installedNames = new Set(Object.values(data).map(s => s.name))
    } catch { /* offline fallback */ }
  }

  private build(): void {
    this.overlay.innerHTML = ''

    this.topbar = el('div', 'sp-topbar')
    const leftSlot = el('div', 'sp-topbar-left')
    const backBtn = el('button', 'sp-back-btn')
    backBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
    backBtn.addEventListener('click', () => this.close())
    leftSlot.appendChild(backBtn)

    const navSlot = el('nav', 'sp-topbar-nav')
    this.equippedTab = el('a', 'nav-link')
    this.equippedTab.textContent = t('skill.equipped')
    this.equippedTab.addEventListener('click', () => this.switchTab('equipped'))
    this.marketTab = el('a', 'nav-link nav-active')
    this.marketTab.textContent = t('skill.market')
    this.marketTab.addEventListener('click', () => this.switchTab('market'))
    navSlot.append(this.equippedTab, this.marketTab)

    const rightSlot = el('div', 'sp-topbar-right')
    this.topbar.append(leftSlot, navSlot, rightSlot)

    this.listWrap = el('div', 'sp-list')
    this.overlay.append(this.topbar, this.listWrap)
  }

  private switchTab(tab: 'equipped' | 'market'): void {
    this.activeTab = tab
    this.equippedTab.classList.toggle('nav-active', tab === 'equipped')
    this.marketTab.classList.toggle('nav-active', tab === 'market')
    this.renderList()
  }

  private isInstalled(skill: SkillEntry): boolean {
    return this.installedNames.has(skill.name)
  }

  private renderList(): void {
    this.listWrap.innerHTML = ''

    if (this.activeTab === 'market') {
      this.listWrap.appendChild(this.buildSearchRow())
      this.listWrap.appendChild(this.buildFilters())
    }

    let items: SkillEntry[]
    if (this.activeTab === 'equipped') {
      items = getAllSkills().filter(s => this.isInstalled(s))
      if (items.length === 0) {
        const empty = el('div', 'sp-empty')
        empty.textContent = t('skill.empty')
        this.listWrap.appendChild(empty)
        return
      }
    } else {
      items = this.activeCategory ? getSkillsByCategory(this.activeCategory) : getAllSkills()
      if (this.searchQuery) {
        const q = this.searchQuery
        items = items.filter(s =>
          s.name.toLowerCase().includes(q) ||
          s.desc.toLowerCase().includes(q) ||
          s.slug.includes(q)
        )
      }
    }

    for (const skill of items) {
      const installed = this.isInstalled(skill)
      const pending = this.pendingSlugs.has(skill.slug)
      const status = installed ? 'installed' : pending ? 'pending' : 'idle'
      this.listWrap.appendChild(this.buildRow(skill, status))
    }
  }

  private buildSearchRow(): HTMLElement {
    const wrap = el('div', 'sp-search-row')
    const input = document.createElement('input')
    input.className = 'sp-search'
    input.type = 'text'
    input.placeholder = t('skill.search')
    input.value = this.searchQuery
    let debounce: ReturnType<typeof setTimeout>
    input.addEventListener('input', () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => { this.searchQuery = input.value.trim().toLowerCase(); this.renderList() }, 200)
    })
    wrap.appendChild(input)
    return wrap
  }

  private buildFilters(): HTMLElement {
    const bar = el('div', 'sp-filters')
    const allPill = el('button', 'sp-pill' + (this.activeCategory === null ? ' active' : ''))
    allPill.textContent = t('skill.all')
    allPill.addEventListener('click', () => { this.activeCategory = null; this.renderList() })
    bar.appendChild(allPill)

    for (const [key, def] of Object.entries(getAllCategories())) {
      const pill = el('button', 'sp-pill' + (this.activeCategory === key ? ' active' : ''))
      pill.textContent = def.label
      pill.addEventListener('click', () => { this.activeCategory = key; this.renderList() })
      bar.appendChild(pill)
    }
    return bar
  }

  private buildRow(skill: SkillEntry, status: 'idle' | 'pending' | 'installed'): HTMLElement {
    const row = el('div', 'sp-row')

    const iconWrap = el('div', 'sp-icon')
    iconWrap.appendChild(createSkillIcon(skill.slug, 40))

    const info = el('div', 'sp-info')
    const name = el('div', 'sp-name')
    name.textContent = skill.name
    const desc = el('div', 'sp-desc')
    desc.textContent = skill.desc
    const stats = el('div', 'sp-stats')
    stats.innerHTML = `<span class="sp-stat">↓ ${formatNum(skill.downloads)}</span><span class="sp-stat">☆ ${formatNum(skill.stars)}</span>`
    info.append(name, desc, stats)

    const btn = el('button', 'sp-btn') as HTMLButtonElement
    if (status === 'installed') {
      btn.textContent = t('skill.got')
      btn.className = 'sp-btn installed'
      btn.disabled = true
    } else if (status === 'pending') {
      btn.textContent = t('skill.getting')
      btn.className = 'sp-btn pending'
      btn.disabled = true
    } else {
      btn.textContent = t('skill.get')
      btn.addEventListener('click', () => {
        this.pendingSlugs.add(skill.slug)
        btn.textContent = t('skill.getting')
        btn.className = 'sp-btn pending'
        btn.disabled = true
        this.onInstall(skill.slug, getInstallCmd(skill.slug))
      })
    }

    row.append(iconWrap, info, btn)
    return row
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  return e
}
