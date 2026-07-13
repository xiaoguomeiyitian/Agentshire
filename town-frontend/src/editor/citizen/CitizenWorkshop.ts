import { getLocale } from '../../i18n'
import { CitizenRoster, type RosterSelection } from './CitizenRoster'
import { CharacterStage } from './CharacterStage'
import { ModelPicker } from './ModelPicker'
import { AnimMappingDialog } from './AnimMappingDialog'
import {
  createDefaultWorkshopConfig,
  CHARACTERS1_DEFAULT_ANIM_MAPPING,
  ANIM_SLOTS,
  SLOT_LABELS,
  computeDefaultTransform,
  createDefaultModelTransform,
  type CitizenWorkshopConfig,
  type WorkshopCitizenConfig,
  type WorkshopStewardConfig,
  type AnimMapping,
  type ModelTransform,
  type ModelSource,
} from '../../data/CitizenWorkshopConfig'
import { getAllGroups, resolveGroupMeshUrl, type CharacterGroup } from '../../data/CharacterModelRegistry'
import { apiUrl } from '@/utils/api-base'

export class CitizenWorkshop {
  private container: HTMLElement
  private config: CitizenWorkshopConfig
  private roster!: CitizenRoster
  private stage!: CharacterStage
  private picker!: ModelPicker
  private selection: RosterSelection | null = null
  private started = false

  private undoHistory: string[] = []
  private redoHistory: string[] = []
  private static readonly MAX_UNDO = 50
  private configChangedListeners: (() => void)[] = []

  private soulCache = new Map<string, string>()
  private _activeVariant = 1
  private _activeColor = 1
  private buildingList: { id: string; name: string }[] = []
  private animDialog: AnimMappingDialog | null = null
  private lastRawHeight = 1
  private lastModelSource: ModelSource = 'builtin'

  constructor() {
    this.container = document.getElementById('citizen-workshop')!
    this.config = this.loadDraft() ?? createDefaultWorkshopConfig()
    this.initRoster()
    this.initStage()
    this.initPicker()
    this.restoreGroupTransformsFromConfig()
    this.roster.setAvatarResolver((avatarUrl, avatarId) => this.resolveAvatarUrl(avatarUrl, avatarId))
    this.picker.onCustomModelsReady(() => {
      this.restoreGroupTransformsFromConfig()
      this.roster.render()
    })
    this.initAddButton()
    this.initModelChangeBtn()
    this.loadRemoteData()
  }

  private async loadRemoteData(): Promise<void> {
    const [fileConfig, , buildings] = await Promise.all([
      this.loadFromFile(),
      this.fetchAgents(),
      this.fetchBuildings(),
    ])
    if (fileConfig && !this.loadDraft()) {
      this.config = fileConfig
      this.restoreGroupTransformsFromConfig()
      this.roster.setConfig(this.config)
      this.renderInspector()
      this.updateModelBar()
      this.loadSelectedCharacter()
    }
    this.buildingList = buildings
    if (this.selection) this.renderInspector()
  }

  private async fetchAgents(): Promise<{ id: string; name: string }[]> {
    try {
      const r = await fetch(apiUrl('/citizen-workshop/_api/agents'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      return d.agents ?? []
    } catch { return [] }
  }

  private async fetchBuildings(): Promise<{ id: string; name: string }[]> {
    try {
      const r = await fetch(apiUrl('/citizen-workshop/_api/buildings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      return d.buildings ?? []
    } catch { return [] }
  }

  private initStage(): void {
    const canvasEl = document.getElementById('cw-stage-canvas')!
    this.stage = new CharacterStage(canvasEl)
    this.stage.setOnRawHeight((h, source) => {
      this.lastRawHeight = h
      this.lastModelSource = source
      if (!this.pickerOpen) {
        this.ensureTransformForCurrentGroup(h, source)
        this.renderInspector()
      }
    })
  }

  private initPicker(): void {
    const tabsEl = document.getElementById('cw-picker-tabs')!
    const gridEl = document.getElementById('cw-picker-grid')!
    const scrollEl = document.getElementById('cw-picker-scroll')!
    this.picker = new ModelPicker(tabsEl, gridEl, scrollEl)
    this.picker.onSelect((meshUrl, groupId) => {
      this.applyModel(groupId, meshUrl)
    })
    this.picker.onPreview((meshUrl, group) => {
      this.stage.setCharacter(meshUrl, undefined, undefined)
      this.updatePickerFooter(group.displayName)
    })
    this.picker.onDeselected(() => {
      this.loadSelectedCharacter()
      this.updatePickerFooter(null)
    })
    this.picker.onEdit((group) => {
      this.picker.openEditForGroup(group)
    })
    this.picker.onAnimMapping((group) => {
      this.openAnimDialogForGroup(group)
    })
    this.picker.onDelete(async (group) => {
      const ok = await this.showConfirm(getLocale() === 'en' ? 'Delete Model' : '删除模型', getLocale() === 'en' ? `Delete "${group.displayName}"? This cannot be undone.` : `确定要删除「${group.displayName}」吗？此操作不可撤销。`)
      if (!ok) return
      const assetId = group.id.replace('custom-', '')
      try {
        const resp = await fetch(apiUrl('/custom-assets/_api/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: assetId }),
        })
        const result = await resp.json()
        if (result.success) {
          await this.picker.refreshCustomModels()
        }
      } catch { /* delete failed */ }
    })
  }

  private applyModel(groupId: string, meshUrl: string): void {
    if (!this.selection) return
    const isLibrary = groupId.startsWith('lib-')
    const isCustom = groupId.startsWith('custom-')
    const group = this.picker.getGroupById(groupId)
    const transform = group?.modelTransform ? { ...group.modelTransform } : undefined
    let mapping: AnimMapping | undefined
    if (isLibrary) {
      mapping = { ...CHARACTERS1_DEFAULT_ANIM_MAPPING }
    } else if (isCustom) {
      mapping = { idle: '', walk: '', typing: '', wave: '', cheer: '', reading: '', frustrated: '', dancing: '' }
    }

    if (this.selection.type === 'user') {
      this.config.user.avatarId = groupId
      this.config.user.animMapping = mapping
    } else if (this.selection.type === 'steward') {
      this.config.steward.avatarId = groupId
      this.config.steward.animMapping = mapping
    } else if (this.selection.type === 'citizen') {
      const c = this.config.citizens.find(c => c.id === (this.selection as any).id)
      if (c) {
        c.avatarId = groupId
        c.animMapping = mapping
      }
    }
    this.updateModelBar()
    this.stage.setCharacter(meshUrl, undefined, mapping, group?.animFileUrls, transform)
    this.roster.render()
    this.renderInspector()
    this.saveDraft()
  }

  private pickerOpen = false
  private prePickerAvatarId = ''

  private initModelChangeBtn(): void {
    const changeBtn = document.getElementById('cw-model-change')
    const closeBtn = document.getElementById('cw-picker-close')
    const cancelBtn = document.getElementById('cw-picker-cancel')
    const confirmBtn = document.getElementById('cw-picker-confirm')
    const center = document.getElementById('cw-center')

    const openPicker = () => {
      this.pickerOpen = true
      this.prePickerAvatarId = this.getCurrentAvatarId()
      center?.classList.add('picker-open')
      this.picker.setCurrentGroupId(this.prePickerAvatarId)
      this.picker.setCandidateGroup(null)
      this.updatePickerFooter(null)
      this.scheduleStageResize()
    }

    const closePicker = (confirmed: boolean) => {
      this.pickerOpen = false
      center?.classList.remove('picker-open')

      if (confirmed && this.picker.candidateGroup) {
        this.picker.confirm()
      } else {
        this.loadSelectedCharacter()
      }

      this.picker.setCandidateGroup(null)
      this.scheduleStageResize()
    }

    changeBtn?.addEventListener('click', () => openPicker())
    closeBtn?.addEventListener('click', () => closePicker(false))
    cancelBtn?.addEventListener('click', () => closePicker(false))
    confirmBtn?.addEventListener('click', () => closePicker(true))
  }

  private scheduleStageResize(): void {
    const doResize = () => this.stage.resize()
    doResize()
    setTimeout(doResize, 50)
    setTimeout(doResize, 150)
    setTimeout(doResize, 280)
  }

  private getCurrentAvatarId(): string {
    if (!this.selection) return ''
    if (this.selection.type === 'user') return this.config.user.avatarId
    if (this.selection.type === 'steward') return this.config.steward.avatarId
    if (this.selection.type === 'citizen') {
      const c = this.config.citizens.find(c => c.id === (this.selection as any).id)
      return c?.avatarId ?? ''
    }
    return ''
  }

  private updatePickerFooter(candidateName: string | null): void {
    const currentEl = document.getElementById('cw-footer-current')
    const candidateEl = document.getElementById('cw-footer-candidate')
    const confirmBtn = document.getElementById('cw-picker-confirm') as HTMLButtonElement | null
    const arrowEl = document.querySelector('.cw-picker-footer-arrow') as HTMLElement | null
    const actionsEl = document.querySelector('.cw-picker-footer-actions') as HTMLElement | null

    const currentGroup = this.picker.getGroupById(this.getCurrentAvatarId())
    const currentName = currentGroup?.displayName || '--'

    if (currentEl) currentEl.textContent = `${getLocale() === 'en' ? 'Current: ' : '已选角色：'}${currentName}`

    const hasCandidate = !!candidateName
    if (arrowEl) arrowEl.style.display = hasCandidate ? '' : 'none'
    if (candidateEl) {
      candidateEl.style.display = hasCandidate ? '' : 'none'
      candidateEl.textContent = candidateName ? `${getLocale() === 'en' ? 'Change to: ' : '更换为：'}${candidateName}` : ''
    }
    if (actionsEl) actionsEl.style.display = hasCandidate ? '' : 'none'

    if (confirmBtn) {
      const candidate = this.picker.candidateGroup
      const isSame = candidate?.id === this.getCurrentAvatarId()
      confirmBtn.disabled = !candidate || isSame
      confirmBtn.textContent = isSame ? (getLocale() === 'en' ? 'Already current' : '已是当前模型') : (getLocale() === 'en' ? 'Confirm' : '确认更换')
    }
  }

  private initRoster(): void {
    const listEl = document.getElementById('cw-roster-list')!
    this.roster = new CitizenRoster(listEl, this.config)
    this.roster.onChange(sel => {
      this.selection = sel
      this.onSelectionChanged()
    })
    this.roster.onDelete(id => {
      const citizen = this.config.citizens.find(c => c.id === id)
      const name = citizen?.name || (getLocale() === 'en' ? 'this citizen' : '该居民')
      this.showConfirm(getLocale() === 'en' ? 'Delete Citizen' : '删除居民', getLocale() === 'en' ? `Delete "${name}"?` : `确定要删除「${name}」吗？`).then(ok => {
        if (!ok) return
        this.roster.deleteCitizen(id)
        this.saveDraft()
      })
    })
  }

  private initAddButton(): void {
    document.getElementById('cw-add-citizen')?.addEventListener('click', () => {
      this.showAddCitizenDialog()
    })
  }

  private showAddCitizenDialog(): void {
    const overlay = document.getElementById('add-citizen-overlay')
    const input = document.getElementById('add-citizen-name') as HTMLInputElement
    const okBtn = document.getElementById('add-citizen-ok')!
    const cancelBtn = document.getElementById('add-citizen-cancel')!
    if (!overlay || !input) return

    input.value = ''
    overlay.classList.add('open')
    setTimeout(() => input.focus(), 50)

    const cleanup = () => {
      overlay.classList.remove('open')
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      overlay.removeEventListener('click', onBg)
      input.removeEventListener('keydown', onKey)
    }
    const doAdd = () => {
      const name = input.value.trim()
      if (!name) { input.focus(); return }
      cleanup()
      this.roster.addCitizen(name)
      this.saveDraft()
    }
    const onOk = () => doAdd()
    const onCancel = () => cleanup()
    const onBg = (e: Event) => { if (e.target === overlay) cleanup() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') doAdd(); if (e.key === 'Escape') cleanup() }

    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    overlay.addEventListener('click', onBg)
    input.addEventListener('keydown', onKey)
  }

  private showConfirm(title: string, message: string): Promise<boolean> {
    return new Promise(resolve => {
      const overlay = document.getElementById('confirm-overlay')!
      document.getElementById('confirm-title')!.textContent = title
      document.getElementById('confirm-message')!.textContent = message
      overlay.classList.add('open')

      const cleanup = (result: boolean) => {
        overlay.classList.remove('open')
        okBtn.removeEventListener('click', onOk)
        cancelBtn.removeEventListener('click', onCancel)
        overlay.removeEventListener('click', onBg)
        resolve(result)
      }
      const onOk = () => cleanup(true)
      const onCancel = () => cleanup(false)
      const onBg = (e: Event) => { if (e.target === overlay) cleanup(false) }

      const okBtn = document.getElementById('confirm-ok')!
      const cancelBtn = document.getElementById('confirm-cancel')!
      okBtn.addEventListener('click', onOk)
      cancelBtn.addEventListener('click', onCancel)
      overlay.addEventListener('click', onBg)
    })
  }

  private onSelectionChanged(): void {
    this.renderInspector()
    this.updateModelBar()
    this.loadSelectedCharacter()
  }

  private loadSelectedCharacter(): void {
    if (!this.selection) return
    let avatarId = ''
    let mapping: AnimMapping | undefined
    if (this.selection.type === 'user') {
      avatarId = this.config.user.avatarId
      mapping = this.config.user.animMapping
    } else if (this.selection.type === 'steward') {
      avatarId = this.config.steward.avatarId
      mapping = this.config.steward.animMapping
    } else if (this.selection.type === 'citizen') {
      const c = this.config.citizens.find(c => c.id === (this.selection as any).id)
      avatarId = c?.avatarId ?? ''
      mapping = c?.animMapping
    }
    if (!avatarId) return

    const isLibrary = avatarId.startsWith('lib-')
    if (isLibrary && !mapping) mapping = { ...CHARACTERS1_DEFAULT_ANIM_MAPPING }

    this.picker.setCurrentGroupId(avatarId)

    const group = this.picker.getGroupById(avatarId)
    const transform = group?.modelTransform
    if (group) {
      if (group.source === 'custom' && group.animMapping) {
        mapping = group.animMapping
      }
      const meshUrl = resolveGroupMeshUrl(group)
      this.stage.setCharacter(meshUrl, undefined, mapping, group.animFileUrls, transform)
    } else {
      const base = import.meta.env.BASE_URL ?? './'
      const meshUrl = apiUrl(`${base}assets/models/characters/character-${avatarId.replace('char-', '')}.glb`)
      this.stage.setCharacter(meshUrl, undefined, mapping, undefined, transform)
    }
  }

  private renderInspector(): void {
    const content = document.getElementById('cw-inspector-content')!
    if (!this.selection) {
      content.innerHTML = `<div class="cw-empty-state">${getLocale() === 'en' ? 'Select a character' : '选择一个角色'}</div>`
      return
    }

    if (this.selection.type === 'user') {
      this.renderUserInspector(content)
    } else if (this.selection.type === 'steward') {
      this.renderStewardInspector(content)
    } else if (this.selection.type === 'citizen') {
      const citizenId = (this.selection as { type: 'citizen'; id: string }).id
      const citizen = this.config.citizens.find(c => c.id === citizenId)
      if (citizen) this.renderCitizenInspector(content, citizen)
    }
  }

  private renderUserInspector(el: HTMLElement): void {
    const u = this.config.user
    el.innerHTML = `
      <div class="cw-identity-row">
        <div class="cw-avatar-clickable" id="cw-user-avatar-btn" title="${getLocale() === 'en' ? 'Change avatar' : '点击更换头像'}">
          ${this.resolveAvatarHtml(u.name, u.avatarUrl, u.avatarId)}
          <div class="cw-avatar-hover-overlay">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
        </div>
        <div class="cw-identity-fields">
          <input class="cw-input cw-input-name" id="cw-user-name" value="${this.esc(u.name)}" placeholder="${getLocale() === 'en' ? 'Name' : '角色名'}" />
        </div>
      </div>
      <div id="cw-user-transform" class="cw-field-conditional"></div>
    `
    el.querySelector('#cw-user-name')?.addEventListener('input', (e) => {
      this.config.user.name = (e.target as HTMLInputElement).value
      this.roster.setConfig(this.config)
      this.saveDraft()
    })
    this.bindAvatarClickable('#cw-user-avatar-btn', (url) => {
      this.config.user.avatarUrl = url
      this.renderInspector()
      this.roster.render()
      this.saveDraft()
    })
    this.renderTransformSection(el, '#cw-user-transform')
  }

  private renderStewardInspector(el: HTMLElement): void {
    const s = this.config.steward

    el.innerHTML = `
      <div class="cw-identity-row">
        <div class="cw-avatar-clickable" id="cw-stew-avatar-btn" title="${getLocale() === 'en' ? 'Change avatar' : '点击更换头像'}">
          ${this.resolveAvatarHtml(s.name, s.avatarUrl, s.avatarId)}
          <div class="cw-avatar-hover-overlay">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
        </div>
        <div class="cw-identity-fields">
          <input class="cw-input cw-input-name" id="cw-stew-name" value="${this.esc(s.name)}" placeholder="${getLocale() === 'en' ? 'Name' : '管家名'}" />
        </div>
      </div>
      <div class="cw-field">
        <div class="cw-field-label">${getLocale() === 'en' ? 'Persona Style' : '人设风格'}</div>
        <textarea class="cw-textarea" id="cw-stew-bio" placeholder="${getLocale() === 'en' ? 'Describe personality, style...' : '描述管家的性格特征、说话风格…'}">${this.esc(s.bio)}</textarea>
      </div>
      <div id="cw-stew-model-variant" class="cw-field cw-field-conditional"></div>
      <div id="cw-stew-model-color" class="cw-field cw-field-conditional"></div>
      <div class="cw-field">
        <div class="cw-field-label">${getLocale() === 'en' ? 'OpenClaw Binding' : 'OpenClaw 绑定'}</div>
        <div class="cw-agent-auto-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span>${getLocale() === 'en' ? 'Auto-bound to main Agent' : '自动绑定当前 OpenClaw 主 Agent'}</span>
        </div>
      </div>
      <div class="cw-section cw-section-conditional">
        <div class="cw-section-title">${getLocale() === 'en' ? 'Animation Mapping' : '动画映射'}</div>
        <div id="cw-stew-anim-container"></div>
      </div>
      <div id="cw-stew-transform" class="cw-field-conditional"></div>
    `
    this.bindInput('#cw-stew-name', v => { this.config.steward.name = v; this.roster.setConfig(this.config) })
    this.bindTextarea('#cw-stew-bio', v => { this.config.steward.bio = v })

    this.bindAvatarClickable('#cw-stew-avatar-btn', (url) => {
      this.config.steward.avatarUrl = url
      this.renderInspector()
      this.roster.render()
      this.saveDraft()
    })

    this.renderModelSettingsSection(el, '#cw-stew-model-variant', '#cw-stew-model-color', this.config.steward)
    this.renderAnimMappingSection(el, '#cw-stew-anim-container', this.config.steward)
    this.renderTransformSection(el, '#cw-stew-transform')
  }

  private renderCitizenInspector(el: HTMLElement, c: WorkshopCitizenConfig): void {
    const hasPresetSoul = !!c.persona && !c.useCustomPersona
    const isCustom = !!c.useCustomPersona || !c.persona
    const showCustomToggle = !!c.persona

    el.innerHTML = `
      <div class="cw-avatar-standalone">
        <div class="cw-avatar-clickable" id="cw-cit-avatar-btn" title="${getLocale() === 'en' ? 'Change avatar' : '点击更换头像'}">
          ${this.resolveAvatarHtml(c.name, c.avatarUrl, c.avatarId)}
          <div class="cw-avatar-hover-overlay">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
        </div>
      </div>
      <div class="cw-persona-block${isCustom ? ' cw-persona-custom' : ' cw-persona-default'}">
        ${showCustomToggle ? `
        <div class="cw-persona-header">
          <span class="cw-persona-header-label">${getLocale() === 'en' ? 'Custom Persona' : '自定义人设'}</span>
          <div class="pi-toggle${isCustom ? ' active' : ''}" id="cw-cit-custom-toggle"></div>
        </div>` : ''}
        <div class="cw-field">
          <div class="cw-field-label">${getLocale() === 'en' ? 'Name' : '名字'}</div>
          <input class="cw-input cw-input-name" id="cw-cit-name" value="${this.esc(c.name)}" placeholder="${getLocale() === 'en' ? 'Name' : '角色名'}" ${hasPresetSoul ? 'readonly' : ''} />
        </div>
        <div class="cw-field">
          <div class="cw-field-label">${getLocale() === 'en' ? 'Specialty' : '专业技能'}</div>
          <input class="cw-input" id="cw-cit-specialty" value="${this.esc(c.specialty)}" placeholder="${getLocale() === 'en' ? 'e.g. Frontend, PM...' : '如：前端开发、产品经理…'}" ${hasPresetSoul ? 'readonly' : ''} />
        </div>
        <div class="cw-field">
          <div class="cw-field-label">${getLocale() === 'en' ? 'Bio' : '一句话介绍'}</div>
          <input class="cw-input" id="cw-cit-bio" value="${this.esc(c.bio)}" placeholder="${getLocale() === 'en' ? 'Brief description' : '一句话描述角色特点'}" ${hasPresetSoul ? 'readonly' : ''} />
        </div>
        ${isCustom ? `<div class="cw-field">
          <div class="cw-field-label-row">
            <div class="cw-field-label">${getLocale() === 'en' ? 'Full Persona' : '完整人设'}</div>
            <button class="cw-ai-gen-btn" id="cw-cit-gen-soul"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.09 3.26L16.36 6l-3.27 1.09L12 10.36l-1.09-3.27L7.64 6l3.27-1.09L12 2z"/><path d="M5 15l.55 1.64L7.18 17.2 5.55 17.75 5 19.4l-.55-1.65L2.82 17.2l1.63-.56L5 15z"/><path d="M19 11l.55 1.64 1.63.56-1.63.55L19 15.4l-.55-1.65-1.63-.55 1.63-.56L19 11z"/></svg> ${getLocale() === 'en' ? 'AI Generate' : 'AI 生成'}</button>
          </div>
          <textarea class="cw-textarea" id="cw-cit-custom-soul" placeholder="${getLocale() === 'en' ? 'Describe personality, style, work...' : '详细描述角色的性格、说话风格、工作方式…'}">${this.esc(c.customSoul ?? '')}</textarea>
        </div>
        <div class="cw-persona-hint">${getLocale() === 'en' ? 'A new Soul file will be generated on publish' : '发布时将根据以上内容合成新 Soul 文件'}</div>` : ''}
      </div>
      <div id="cw-cit-model-variant" class="cw-field cw-field-conditional"></div>
      <div id="cw-cit-model-color" class="cw-field cw-field-conditional"></div>
      <div class="cw-field">
        <div class="cw-field-label">${getLocale() === 'en' ? 'Agent Mode' : 'Agent 模式'}</div>
        <div class="cw-agent-toggle-row" id="cw-cit-agent-toggle-row">
          <div class="pi-toggle${c.agentEnabled ? ' active' : ''}" id="cw-cit-agent-toggle"></div>
          <span class="cw-agent-toggle-label" id="cw-cit-agent-label">${c.agentEnabled ? (getLocale() === 'en' ? 'Enabled · Chat after publish' : '已开启 · 发布后可对话') : (getLocale() === 'en' ? 'Disabled' : '未开启')}</span>
        </div>
        <div class="cw-agent-hint">${c.agentEnabled ? (getLocale() === 'en' ? 'A sub-agent will be created for direct chat' : '发布后将创建常驻子 Agent，用户可与该居民直接聊天') : (getLocale() === 'en' ? 'Enable for independent AI personality' : '开启后该居民将拥有独立 AI 人格，可与用户对话')}</div>
      </div>
      <div class="cw-field">
        <div class="cw-field-label">${getLocale() === 'en' ? 'Assign Home' : '分配场景住宅'}</div>
        <div id="cw-cit-home-dd"></div>
      </div>
      <div class="cw-section cw-section-conditional">
        <div class="cw-section-title">${getLocale() === 'en' ? 'Animation Mapping' : '动画映射'}</div>
        <div id="cw-cit-anim-container"></div>
      </div>
      <div id="cw-cit-transform" class="cw-field-conditional"></div>
    `

    if (isCustom) {
      this.bindInput('#cw-cit-name', v => { c.name = v; this.roster.setConfig(this.config) })
      this.bindInput('#cw-cit-bio', v => { c.bio = v })
      el.querySelector('#cw-cit-specialty')?.addEventListener('input', (e) => {
        c.specialty = (e.target as HTMLInputElement).value
        this.saveDraft()
      })
      this.bindTextarea('#cw-cit-custom-soul', v => { c.customSoul = v })
      el.querySelector('#cw-cit-gen-soul')?.addEventListener('click', () => {
        this.generateSoulForCitizen(c, el)
      })
    }

    if (showCustomToggle) {
      const customToggle = el.querySelector('#cw-cit-custom-toggle') as HTMLElement
      customToggle?.addEventListener('click', () => {
        c.useCustomPersona = !c.useCustomPersona
        this.saveDraft()
        this.renderInspector()
      })
    }

    const agentToggle = el.querySelector('#cw-cit-agent-toggle') as HTMLElement
    const agentLabel = el.querySelector('#cw-cit-agent-label') as HTMLElement
    const agentHint = el.querySelector('.cw-agent-hint') as HTMLElement
    const onAgentToggle = () => {
      c.agentEnabled = !c.agentEnabled
      agentToggle.classList.toggle('active', !!c.agentEnabled)
      agentLabel.textContent = c.agentEnabled ? (getLocale() === 'en' ? 'Enabled · Chat after publish' : '已开启 · 发布后可对话') : (getLocale() === 'en' ? 'Disabled' : '未开启')
      agentHint.textContent = c.agentEnabled
        ? (getLocale() === 'en' ? 'A sub-agent will be created for direct chat' : '发布后将创建常驻子 Agent，用户可与该居民直接聊天')
        : (getLocale() === 'en' ? 'Enable for independent AI personality' : '开启后该居民将拥有独立 AI 人格，可与用户对话')
      this.saveDraft()
    }
    agentToggle.addEventListener('click', onAgentToggle)
    agentLabel.addEventListener('click', onAgentToggle)

    this.createDropdown(
      el, 'cw-cit-home-dd',
      this.buildingList.map(b => ({ value: b.id, label: b.name })),
      c.homeId || '', getLocale() === 'en' ? 'Unassigned' : '未分配',
      (val) => { c.homeId = val; this.saveDraft() }
    )

    this.bindAvatarClickable('#cw-cit-avatar-btn', (url) => {
      c.avatarUrl = url
      this.renderInspector()
      this.roster.render()
      this.saveDraft()
    })

    this.renderModelSettingsSection(el, '#cw-cit-model-variant', '#cw-cit-model-color', c)
    this.renderAnimMappingSection(el, '#cw-cit-anim-container', c)
    this.renderTransformSection(el, '#cw-cit-transform')
  }

  private updateModelBar(): void {
    const label = document.getElementById('cw-model-current')
    if (!label || !this.selection) return
    const avatarId = this.getCurrentAvatarId()
    const group = this.picker.getGroupById(avatarId)
    label.textContent = group?.displayName || avatarId.replace('char-', '').replace(/-/g, ' ') || '--'
  }

  private bindInput(selector: string, setter: (v: string) => void): void {
    const el = document.querySelector(selector) as HTMLInputElement | null
    el?.addEventListener('input', () => { setter(el.value); this.saveDraft() })
  }

  private bindTextarea(selector: string, setter: (v: string) => void): void {
    const el = document.querySelector(selector) as HTMLTextAreaElement | null
    el?.addEventListener('input', () => { setter(el.value); this.saveDraft() })
  }

  private async generateSoulForCitizen(c: WorkshopCitizenConfig, el: HTMLElement): Promise<void> {
    const btn = el.querySelector('#cw-cit-gen-soul') as HTMLButtonElement | null
    if (!btn || !c.name || !c.bio) return
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cw-spin"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ${getLocale() === 'en' ? 'Generating...' : '生成中...'}`
    btn.classList.add('disabled')
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 120_000)
      const r = await fetch(apiUrl('/citizen-workshop/_api/generate-soul'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: c.name, bio: c.bio, specialty: c.specialty, industry: c.industry }),
        signal: ac.signal,
      })
      clearTimeout(timer)
      const d = await r.json()
      if (d.content) {
        c.customSoul = d.content
        const ta = el.querySelector('#cw-cit-custom-soul') as HTMLTextAreaElement | null
        if (ta) ta.value = d.content
        this.saveDraft()
      }
    } catch (e) { console.error('[CitizenWorkshop] generate-soul failed:', e) }
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.09 3.26L16.36 6l-3.27 1.09L12 10.36l-1.09-3.27L7.64 6l3.27-1.09L12 2z"/><path d="M5 15l.55 1.64L7.18 17.2 5.55 17.75 5 19.4l-.55-1.65L2.82 17.2l1.63-.56L5 15z"/><path d="M19 11l.55 1.64 1.63.56-1.63.55L19 15.4l-.55-1.65-1.63-.55 1.63-.56L19 11z"/></svg> ${getLocale() === 'en' ? 'AI Generate' : 'AI 生成'}`
    btn.classList.remove('disabled')
  }

  private createDropdown(
    parentEl: HTMLElement,
    containerId: string,
    options: { value: string; label: string }[],
    selectedValue: string,
    placeholder: string,
    onChange: (value: string) => void,
  ): void {
    const wrapper = parentEl.querySelector(`#${containerId}`) as HTMLElement
    if (!wrapper) return
    wrapper.innerHTML = ''
    wrapper.classList.add('cw-dropdown')

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'cw-dropdown-trigger'
    const selectedOpt = options.find(o => o.value === selectedValue)
    trigger.innerHTML = `<span class="cw-dd-text${!selectedOpt ? ' cw-dd-placeholder' : ''}">${selectedOpt ? this.esc(selectedOpt.label) : placeholder}</span>`
    wrapper.appendChild(trigger)

    const menu = document.createElement('div')
    menu.className = 'cw-dropdown-menu'

    const emptyOpt = document.createElement('button')
    emptyOpt.type = 'button'
    emptyOpt.className = `cw-dropdown-option${!selectedValue ? ' selected' : ''}`
    emptyOpt.textContent = placeholder
    emptyOpt.addEventListener('click', () => { select(''); close() })
    menu.appendChild(emptyOpt)

    for (const opt of options) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `cw-dropdown-option${opt.value === selectedValue ? ' selected' : ''}`
      btn.textContent = opt.label
      btn.addEventListener('click', () => { select(opt.value); close() })
      menu.appendChild(btn)
    }
    wrapper.appendChild(menu)

    const select = (val: string) => {
      const chosen = options.find(o => o.value === val)
      trigger.innerHTML = `<span class="cw-dd-text${!chosen ? ' cw-dd-placeholder' : ''}">${chosen ? this.esc(chosen.label) : placeholder}</span>`
      onChange(val)
    }

    const close = () => {
      trigger.classList.remove('open')
      menu.classList.remove('open')
      document.removeEventListener('click', outsideHandler)
    }

    const outsideHandler = (e: Event) => {
      if (!wrapper.contains(e.target as Node)) close()
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = menu.classList.contains('open')
      if (isOpen) { close() } else {
        trigger.classList.add('open')
        menu.classList.add('open')
        document.addEventListener('click', outsideHandler)
      }
    })
  }

  private bindAvatarClickable(selector: string, onUploaded: (url: string) => void): void {
    this.bindAvatarUpload(selector, onUploaded)
  }

  private bindAvatarUpload(btnSelector: string, onUploaded: (url: string) => void): void {
    const btn = document.querySelector(btnSelector) as HTMLElement | null
    if (!btn) return
    btn.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/webp'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUrl = reader.result as string
          const safeName = `avatar_${Date.now()}`
          try {
            const r = await fetch(apiUrl('/citizen-workshop/_api/upload-avatar'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: safeName, imageData: dataUrl }),
            })
            const d = await r.json()
            if (d.success && d.url) onUploaded(d.url)
          } catch { /* upload failed */ }
        }
        reader.readAsDataURL(file)
      }
      input.click()
    })
  }

  private renderModelSettingsSection(
    el: HTMLElement,
    variantSelector: string,
    colorSelector: string,
    configRef: WorkshopCitizenConfig | WorkshopStewardConfig,
  ): void {
    const variantEl = el.querySelector(variantSelector) as HTMLElement
    const colorEl = el.querySelector(colorSelector) as HTMLElement

    const group = this.picker.getGroupById(configRef.avatarId)
    if (!group) {
      if (variantEl) variantEl.style.display = 'none'
      if (colorEl) colorEl.style.display = 'none'
      return
    }

    if (!this._activeVariant || !group.variants.includes(this._activeVariant)) {
      this._activeVariant = group.variants[0] ?? 1
    }
    if (!this._activeColor || !group.colors.includes(this._activeColor)) {
      this._activeColor = group.colors[0] ?? 1
    }

    if (variantEl) {
      if (group.variants.length > 1) {
        variantEl.style.display = ''
        variantEl.innerHTML = `<div class="cw-field-label">${getLocale() === 'en' ? '3D Variants' : '3D模型变体'}</div>`
        const btns = document.createElement('div')
        btns.className = 'cw-picker-variant-btns'
        for (const v of group.variants) {
          const btn = document.createElement('button')
          btn.className = `cw-picker-variant-btn${v === this._activeVariant ? ' active' : ''}`
          btn.textContent = String(v)
          btn.addEventListener('click', () => {
            this._activeVariant = v
            const meshUrl = resolveGroupMeshUrl(group, v, this._activeColor)
            this.stage.setCharacter(meshUrl, undefined, configRef.animMapping)
            this.saveDraft()
            this.renderModelSettingsSection(el, variantSelector, colorSelector, configRef)
          })
          btns.appendChild(btn)
        }
        variantEl.appendChild(btns)
      } else {
        variantEl.style.display = 'none'
      }
    }

    if (colorEl) {
      if (group.colors.length > 1) {
        colorEl.style.display = ''
        colorEl.innerHTML = `<div class="cw-field-label">${getLocale() === 'en' ? '3D Colors' : '3D模型配色'}</div>`
        const swatches = document.createElement('div')
        swatches.className = 'cw-picker-color-swatches'
        const palette = [
          '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
          '#9b59b6', '#e91e63', '#795548', '#607d8b', '#34495e', '#ecf0f1',
          '#ff6b81', '#ffa502', '#7bed9f', '#70a1ff',
        ]
        for (let i = 0; i < group.colors.length; i++) {
          const c = group.colors[i]
          const swatch = document.createElement('button')
          swatch.className = `cw-picker-color-swatch${c === this._activeColor ? ' active' : ''}`
          swatch.style.background = palette[i % palette.length]
          swatch.title = `${getLocale() === 'en' ? 'Color' : '配色'} ${c}`
          swatch.addEventListener('click', () => {
            this._activeColor = c
            const meshUrl = resolveGroupMeshUrl(group, this._activeVariant, c)
            this.stage.setCharacter(meshUrl, undefined, configRef.animMapping)
            this.saveDraft()
            this.renderModelSettingsSection(el, variantSelector, colorSelector, configRef)
          })
          swatches.appendChild(swatch)
        }
        colorEl.appendChild(swatches)
      } else {
        colorEl.style.display = 'none'
      }
    }
  }

  private renderAnimMappingSection(
    el: HTMLElement,
    containerSelector: string,
    configRef: WorkshopCitizenConfig | WorkshopStewardConfig,
  ): void {
    const container = el.querySelector(containerSelector) as HTMLElement
    if (!container) return

    if (!configRef.avatarId.startsWith('custom-')) {
      const section = container.closest('.cw-section')
      if (section) (section as HTMLElement).style.display = 'none'
      return
    }

    const group = this.picker.getGroupById(configRef.avatarId)
    const mapping = group?.animMapping ?? {}
    const mappedCount = Object.values(mapping).filter(Boolean).length
    const totalSlots = ANIM_SLOTS.length
    const hasMapped = mappedCount > 0

    const mappedNames = ANIM_SLOTS
      .filter(s => mapping[s])
      .map(s => SLOT_LABELS[s] ?? s)
      .join(' · ')

    container.innerHTML = `
      <div class="cw-anim-status ${hasMapped ? 'has-anim' : 'no-anim'}">
        <div class="cw-anim-status-icon">${hasMapped ? '✓' : '⚠'}</div>
        <div class="cw-anim-status-text">
          <div class="cw-anim-status-title">${hasMapped ? `${getLocale() === 'en' ? 'Mapped' : '已映射'} ${mappedCount}/${totalSlots}` : (getLocale() === 'en' ? 'No animations' : '未配置动画')}</div>
          <div class="cw-anim-status-detail">${hasMapped ? mappedNames : (getLocale() === 'en' ? 'No animation effects in town' : '角色在小镇中将没有动画效果')}</div>
        </div>
      </div>
      <button class="cw-anim-edit-btn" id="cw-anim-edit-btn">${hasMapped ? (getLocale() === 'en' ? 'Edit Mapping' : '编辑动画映射') : (getLocale() === 'en' ? 'Configure Mapping' : '配置动画映射')}</button>
    `

    container.querySelector('#cw-anim-edit-btn')?.addEventListener('click', () => {
      this.openAnimDialog(configRef)
    })
  }

  private async openAnimDialog(configRef: WorkshopCitizenConfig | WorkshopStewardConfig): Promise<void> {
    const group = this.picker.getGroupById(configRef.avatarId)
    if (!group || group.source !== 'custom') return
    await this.openAnimDialogForGroup(group)
    this.renderInspector()
    this.loadSelectedCharacter()
  }

  async openAnimDialogForGroup(group: CharacterGroup): Promise<void> {
    if (!group.assetId) return
    if (!this.animDialog) this.animDialog = new AnimMappingDialog()

    const meshUrl = resolveGroupMeshUrl(group)
    const result = await this.animDialog.open({
      meshUrl,
      animMapping: group.animMapping,
      detectedClips: group.detectedClips,
      animFileUrls: group.animFileUrls,
    })

    if (!result) return

    group.animMapping = result.animMapping
    group.detectedClips = result.detectedClips
    group.animFileUrls = result.animFileUrls

    try {
      await fetch(apiUrl('/custom-assets/_api/update'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: group.assetId,
          animMapping: result.animMapping,
          detectedClips: result.detectedClips,
          animFileUrls: result.animFileUrls,
        }),
      })
    } catch { /* save failed */ }
  }

  private getCurrentGroup(): CharacterGroup | null {
    const avatarId = this.getCurrentAvatarId()
    if (!avatarId) return null
    return this.picker.getGroupById(avatarId) ?? null
  }

  private ensureTransformForCurrentGroup(rawHeight: number, source: ModelSource): void {
    const group = this.getCurrentGroup()
    if (!group) return
    if (!group.modelTransform) {
      group.modelTransform = computeDefaultTransform(rawHeight, source)
    }
    const currentCitizen = this.selection?.type === 'citizen'
      ? this.config.citizens.find(c => c.id === (this.selection as any).id)
      : null
    if (this.selection?.type === 'user') {
      this.config.user.modelTransform = { ...group.modelTransform }
    } else if (this.selection?.type === 'steward') {
      this.config.steward.modelTransform = { ...group.modelTransform }
    } else if (currentCitizen) {
      currentCitizen.modelTransform = { ...group.modelTransform }
    }
  }

  private renderTransformSection(el: HTMLElement, containerSelector: string): void {
    const container = el.querySelector(containerSelector) as HTMLElement
    if (!container) return

    if (this.pickerOpen) {
      container.style.display = 'none'
      return
    }

    const group = this.getCurrentGroup()
    if (!group || !group.modelTransform) {
      container.style.display = 'none'
      return
    }

    container.style.display = ''
    const t = group.modelTransform ?? createDefaultModelTransform()

    container.innerHTML = `
      <div class="cw-section">
        <div class="cw-section-title">${getLocale() === 'en' ? 'Transform' : '模型调整'}</div>
        <div class="cw-transform-grid">
          <label class="cw-transform-label">${getLocale() === 'en' ? 'Scale' : '缩放'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-scale" min="0.1" max="5" step="0.01" value="${t.scale}" />
          <input type="number" class="cw-transform-num" id="cw-tf-scale-n" min="0.1" max="5" step="0.01" value="${t.scale}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Rotate X' : '旋转X'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-rx" min="-180" max="180" step="1" value="${t.rotationX}" />
          <input type="number" class="cw-transform-num" id="cw-tf-rx-n" min="-180" max="180" step="1" value="${t.rotationX}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Rotate Y' : '旋转Y'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-ry" min="-180" max="180" step="1" value="${t.rotationY}" />
          <input type="number" class="cw-transform-num" id="cw-tf-ry-n" min="-180" max="180" step="1" value="${t.rotationY}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Rotate Z' : '旋转Z'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-rz" min="-180" max="180" step="1" value="${t.rotationZ}" />
          <input type="number" class="cw-transform-num" id="cw-tf-rz-n" min="-180" max="180" step="1" value="${t.rotationZ}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Offset X' : '偏移X'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-ox" min="-2" max="2" step="0.01" value="${t.offsetX}" />
          <input type="number" class="cw-transform-num" id="cw-tf-ox-n" min="-2" max="2" step="0.01" value="${t.offsetX}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Offset Y' : '偏移Y'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-oy" min="-2" max="2" step="0.01" value="${t.offsetY}" />
          <input type="number" class="cw-transform-num" id="cw-tf-oy-n" min="-2" max="2" step="0.01" value="${t.offsetY}" />

          <label class="cw-transform-label">${getLocale() === 'en' ? 'Offset Z' : '偏移Z'}</label>
          <input type="range" class="cw-transform-slider" id="cw-tf-oz" min="-2" max="2" step="0.01" value="${t.offsetZ}" />
          <input type="number" class="cw-transform-num" id="cw-tf-oz-n" min="-2" max="2" step="0.01" value="${t.offsetZ}" />
        </div>
        <button class="cw-btn cw-btn-secondary cw-transform-reset" id="cw-tf-reset">${getLocale() === 'en' ? 'Reset' : '重置为推荐值'}</button>
      </div>
    `

    const pairs: [string, keyof ModelTransform][] = [
      ['scale', 'scale'], ['rx', 'rotationX'], ['ry', 'rotationY'], ['rz', 'rotationZ'],
      ['ox', 'offsetX'], ['oy', 'offsetY'], ['oz', 'offsetZ'],
    ]

    for (const [prefix, key] of pairs) {
      const slider = container.querySelector(`#cw-tf-${prefix}`) as HTMLInputElement
      const num = container.querySelector(`#cw-tf-${prefix}-n`) as HTMLInputElement
      if (!slider || !num) continue

      const update = (val: string) => {
        const v = parseFloat(val) || 0
        if (!group.modelTransform) group.modelTransform = { ...t }
        ;(group.modelTransform as any)[key] = v
        this.stage.applyTransform(group.modelTransform)
      }

      slider.addEventListener('input', () => { num.value = slider.value; update(slider.value) })
      num.addEventListener('input', () => { slider.value = num.value; update(num.value) })
      slider.addEventListener('change', () => this.saveDraft())
      num.addEventListener('change', () => this.saveDraft())
    }

    container.querySelector('#cw-tf-reset')?.addEventListener('click', () => {
      group.modelTransform = computeDefaultTransform(this.lastRawHeight, this.lastModelSource)
      this.stage.applyTransform(group.modelTransform)
      this.saveDraft()
      this.renderTransformSection(el, containerSelector)
    })
  }

  private esc(s: string): string {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }

  private resolveAvatarUrl(avatarUrl?: string, avatarId?: string): string | null {
    if (avatarUrl) return apiUrl(avatarUrl)
    if (avatarId) {
      const group = this.picker.getGroupById(avatarId) ?? getAllGroups().find(g => g.id === avatarId)
      if (group?.thumbnailUrl) return group.thumbnailUrl
    }
    return null
  }

  private resolveAvatarHtml(name: string, avatarUrl?: string, avatarId?: string): string {
    const url = this.resolveAvatarUrl(avatarUrl, avatarId)
    if (url) return `<img src="${url}" onerror="this.remove();this.parentElement.textContent='${this.esc(name.charAt(0))}'" />`
    return this.esc(name.charAt(0))
  }

  show(): void {
    this.container.classList.add('visible')
    this.stage.start()
    if (!this.started) {
      this.started = true
      this.roster.select({ type: 'user' })
    }
  }

  hide(): void {
    this.container.classList.remove('visible')
    this.stage.stop()
  }

  private static readonly DRAFT_VERSION = 3

  private pushUndoSnapshot(): void {
    this.undoHistory.push(JSON.stringify(this.config))
    if (this.undoHistory.length > CitizenWorkshop.MAX_UNDO) this.undoHistory.shift()
    this.redoHistory.length = 0
  }

  undo(): void {
    if (this.undoHistory.length === 0) return
    this.redoHistory.push(JSON.stringify(this.config))
    this.config = JSON.parse(this.undoHistory.pop()!)
    this.afterConfigReplaced()
  }

  redo(): void {
    if (this.redoHistory.length === 0) return
    this.undoHistory.push(JSON.stringify(this.config))
    this.config = JSON.parse(this.redoHistory.pop()!)
    this.afterConfigReplaced()
  }

  get canUndo(): boolean { return this.undoHistory.length > 0 }
  get canRedo(): boolean { return this.redoHistory.length > 0 }

  onConfigChanged(fn: () => void): void { this.configChangedListeners.push(fn) }
  private notifyConfigChanged(): void { for (const fn of this.configChangedListeners) fn() }

  private afterConfigReplaced(): void {
    this.roster.setConfig(this.config)
    if (this.selection?.type === 'citizen') {
      const id = (this.selection as { type: 'citizen'; id: string }).id
      if (!this.config.citizens.find(c => c.id === id)) this.selection = { type: 'user' }
    }
    this.renderInspector()
    this.updateModelBar()
    this.loadSelectedCharacter()
    this.persistDraft()
    this.notifyConfigChanged()
  }

  exportJSON(): void {
    const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'citizen-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  importJSON(): Promise<boolean> {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve(false); return }
        try {
          const text = await file.text()
          const imported = JSON.parse(text) as CitizenWorkshopConfig
          if (!imported.user || !imported.steward || !Array.isArray(imported.citizens)) {
            resolve(false)
            return
          }
          this.pushUndoSnapshot()
          this.config = imported
          this.afterConfigReplaced()
          resolve(true)
        } catch {
          resolve(false)
        }
      }
      input.click()
    })
  }

  resetToDefault(): void {
    this.pushUndoSnapshot()
    this.config = createDefaultWorkshopConfig()
    this.undoHistory.length = 0
    this.redoHistory.length = 0
    this.afterConfigReplaced()
  }

  private syncGroupTransformsToConfig(): void {
    const pick = (avatarId: string) => {
      const g = this.picker.getGroupById(avatarId)
      return g?.modelTransform ? { ...g.modelTransform } : undefined
    }
    const ut = pick(this.config.user.avatarId)
    if (ut) this.config.user.modelTransform = ut
    const st = pick(this.config.steward.avatarId)
    if (st) this.config.steward.modelTransform = st
    for (const c of this.config.citizens) {
      const ct = pick(c.avatarId)
      if (ct) c.modelTransform = ct
    }
  }

  private restoreGroupTransformsFromConfig(): void {
    const restore = (avatarId: string, t?: ModelTransform) => {
      if (!t) return
      const g = this.picker.getGroupById(avatarId)
      if (g && !g.modelTransform) g.modelTransform = t
    }
    restore(this.config.user.avatarId, this.config.user.modelTransform)
    restore(this.config.steward.avatarId, this.config.steward.modelTransform)
    for (const c of this.config.citizens) restore(c.avatarId, c.modelTransform)
    if (this.config.modelTransforms) {
      for (const [id, t] of Object.entries(this.config.modelTransforms)) {
        const g = this.picker.getGroupById(id)
        if (g && !g.modelTransform) g.modelTransform = t
      }
      delete this.config.modelTransforms
    }
  }

  private saveDraft(): void {
    this.pushUndoSnapshot()
    this.persistDraft()
    this.notifyConfigChanged()
  }

  private persistDraft(): void {
    this.syncGroupTransformsToConfig()
    try {
      localStorage.setItem('cw-draft', JSON.stringify({ _v: CitizenWorkshop.DRAFT_VERSION, ...this.config }))
    } catch { /* quota */ }
  }

  private loadDraft(): CitizenWorkshopConfig | null {
    try {
      const raw = localStorage.getItem('cw-draft')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (parsed._v !== CitizenWorkshop.DRAFT_VERSION) {
        localStorage.removeItem('cw-draft')
        return null
      }
      delete parsed._v
      return parsed
    } catch { /* corrupt */ }
    return null
  }

  async saveToFile(): Promise<boolean> {
    this.syncGroupTransformsToConfig()
    try {
      const souls: Record<string, string> = {}
      for (const [key, content] of this.soulCache) {
        if (content) souls[key] = content
      }
      const resp = await fetch(apiUrl('/citizen-workshop/_api/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: this.config, souls }),
      })
      const data = await resp.json()
      return data.success === true
    } catch {
      return false
    }
  }

  async publish(): Promise<{ success: boolean; error?: string; changeset?: any }> {
    const saveOk = await this.saveToFile()
    if (!saveOk) return { success: false, error: getLocale() === 'en' ? 'Draft save failed' : '保存草稿失败' }

    try {
      const souls: Record<string, string> = {}
      for (const [key, content] of this.soulCache) {
        if (content) souls[key] = content
      }
      const resp = await fetch(apiUrl('/citizen-workshop/_api/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ souls }),
      })
      const data = await resp.json()
      if (data.success) return { success: true, changeset: data.changeset }
      return { success: false, error: data.error ?? (getLocale() === 'en' ? 'Publish failed' : '发布失败') }
    } catch {
      return { success: false, error: getLocale() === 'en' ? 'Network error' : '网络请求失败' }
    }
  }

  async loadFromFile(): Promise<CitizenWorkshopConfig | null> {
    try {
      const resp = await fetch(apiUrl('/citizen-workshop/_api/load'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await resp.json()
      return data.config ?? null
    } catch {
      return null
    }
  }
}
