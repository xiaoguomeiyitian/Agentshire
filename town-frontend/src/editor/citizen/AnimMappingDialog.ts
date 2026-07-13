import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  ANIM_SLOTS, SLOT_LABELS, autoMatchAnimSlots,
  type AnimMapping, type AnimSlot,
} from '../../data/CitizenWorkshopConfig'
import { getLocale } from '../../i18n'
import { apiUrl } from '@/utils/api-base'

export interface AnimDialogInput {
  meshUrl: string
  animMapping?: AnimMapping
  detectedClips?: string[]
  animFileUrls?: string[]
}

export interface AnimDialogOutput {
  animMapping: AnimMapping
  detectedClips: string[]
  animFileUrls: string[]
}

interface AnimSource {
  label: string
  url: string
  clips: string[]
  removable: boolean
}

export class AnimMappingDialog {
  private overlay: HTMLElement
  private loader = new GLTFLoader()

  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private model: THREE.Group | null = null
  private mixer: THREE.AnimationMixer | null = null
  private currentAction: THREE.AnimationAction | null = null
  private clock = new THREE.Clock()
  private animId = 0
  private allClips: THREE.AnimationClip[] = []

  private sources: AnimSource[] = []
  private mapping: AnimMapping = {}
  private activeSlot: AnimSlot | null = null

  private resolve: ((result: AnimDialogOutput | null) => void) | null = null

  constructor() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'anim-dialog-overlay'
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel()
    })
    document.getElementById('editor-root')!.appendChild(this.overlay)
  }

  open(input: AnimDialogInput): Promise<AnimDialogOutput | null> {
    return new Promise(resolve => {
      this.resolve = resolve
      this.mapping = input.animMapping ? { ...input.animMapping } : {}
      this.sources = []
      this.allClips = []
      this.activeSlot = null

      this.overlay.classList.add('open')
      this.buildUI()
      this.initPreview()
      this.beginLoading(input)
    })
  }

  private cancel(): void { this.finish(null) }
  private confirm(): void {
    this.finish({
      animMapping: { ...this.mapping },
      detectedClips: this.getAllClipNames(),
      animFileUrls: this.sources.filter(s => s.removable).map(s => s.url),
    })
  }
  private finish(result: AnimDialogOutput | null): void {
    this.overlay.classList.remove('open')
    this.stopPreview()
    this.resolve?.(result)
    this.resolve = null
  }

  private getAllClipNames(): string[] {
    return [...new Set(this.sources.flatMap(s => s.clips))]
  }

  // ── Loading pipeline ──

  private async beginLoading(input: AnimDialogInput): Promise<void> {
    this.setStatus(getLocale() === 'en' ? 'Loading model...' : '正在加载模型...')

    const modelClips = await this.loadModel(input.meshUrl)

    if (modelClips.length > 0) {
      this.sources.push({ label: getLocale() === 'en' ? 'Embedded' : '模型内嵌', url: input.meshUrl, clips: modelClips.map(c => c.name), removable: false })
      this.allClips.push(...modelClips)
    }

    if (input.animFileUrls && input.animFileUrls.length > 0) {
      for (const url of input.animFileUrls) {
        this.setStatus(getLocale() === 'en' ? 'Loading animations...' : '正在加载动画文件...')
        await this.loadAnimFileIntoSources(url, true)
      }
    }

    if (Object.keys(this.mapping).length === 0 && this.getAllClipNames().length > 0) {
      this.mapping = autoMatchAnimSlots(this.getAllClipNames())
    }

    this.setStatus(null)
    this.refreshAll()
    if (this.mapping.idle) this.playSlot('idle')
  }

  private setStatus(msg: string | null): void {
    const el = this.overlay.querySelector('#amd-loading') as HTMLElement
    if (!el) return
    if (msg) { el.style.display = 'flex'; el.textContent = msg }
    else { el.style.display = 'none' }
  }

  private async loadAnimFileIntoSources(url: string, removable: boolean): Promise<boolean> {
    try {
      const gltf = await this.loader.loadAsync(url)
      const clips = gltf.animations.filter(c => c.name && c.name !== 'default')
      if (clips.length === 0) return false
      const fileName = decodeURIComponent(url.split('/').pop() || url)
      const label = fileName.length > 24 ? fileName.slice(0, 21) + '...' : fileName
      this.sources.push({ label, url, clips: clips.map(c => c.name), removable })
      for (const clip of clips) {
        const idx = this.allClips.findIndex(c => c.name === clip.name)
        if (idx >= 0) this.allClips[idx] = clip
        else this.allClips.push(clip)
      }
      return true
    } catch { return false }
  }

  // ── UI ──

  private buildUI(): void {
    this.overlay.innerHTML = `
      <div class="anim-dialog">
        <div class="anim-dialog-header">
          <span class="anim-dialog-title">${getLocale() === 'en' ? 'Animation Mapping' : '动画映射配置'}</span>
          <button class="anim-dialog-close" aria-label="${getLocale() === 'en' ? 'Close' : '关闭'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="anim-dialog-body">
          <div class="anim-dialog-left">
            <div class="amd-section-label">${getLocale() === 'en' ? 'Sources' : '动画源'}</div>
            <div class="amd-sources" id="amd-sources"></div>
            <button class="amd-add-btn" id="amd-add-anim">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              ${getLocale() === 'en' ? 'Add Animation' : '追加动画文件'}
            </button>
            <div class="amd-divider"></div>
            <div class="amd-section-label">${getLocale() === 'en' ? 'Slot Mapping' : '槽位映射'}</div>
            <div class="amd-map-list" id="amd-mapping"></div>
          </div>
          <div class="anim-dialog-right">
            <div class="amd-preview-wrap" id="amd-preview">
              <canvas class="amd-preview-canvas" id="amd-canvas"></canvas>
              <div class="amd-preview-loading" id="amd-loading">${getLocale() === 'en' ? 'Loading...' : '加载中...'}</div>
              <div class="amd-slot-tabs" id="amd-slot-tabs"></div>
            </div>
          </div>
        </div>
        <div class="anim-dialog-footer">
          <button class="amd-btn amd-btn-cancel" id="amd-cancel">${getLocale() === 'en' ? 'Cancel' : '取消'}</button>
          <button class="amd-btn amd-btn-confirm" id="amd-confirm">${getLocale() === 'en' ? 'Save' : '确认保存'}</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.anim-dialog-close')!.addEventListener('click', () => this.cancel())
    this.overlay.querySelector('#amd-cancel')!.addEventListener('click', () => this.cancel())
    this.overlay.querySelector('#amd-confirm')!.addEventListener('click', () => this.confirm())
    this.overlay.querySelector('#amd-add-anim')!.addEventListener('click', () => this.handleAddAnimFile())
  }

  private refreshAll(): void {
    this.renderSources()
    this.renderMapping()
    this.renderSlotTabs()
  }

  private renderSources(): void {
    const el = this.overlay.querySelector('#amd-sources') as HTMLElement
    if (!el) return
    el.innerHTML = ''
    if (this.sources.length === 0) {
      el.innerHTML = `<div class="amd-source-empty">${getLocale() === 'en' ? 'No animation sources' : '未检测到动画源'}</div>`
      return
    }
    for (const src of this.sources) {
      const row = document.createElement('div')
      row.className = 'amd-source-row'

      const info = document.createElement('div')
      info.className = 'amd-source-info'
      info.innerHTML = `<span class="amd-source-name" title="${this.esc(src.label)}">${this.esc(src.label)}</span><span class="amd-source-badge">${src.clips.length}</span>`
      row.appendChild(info)

      if (src.removable) {
        const actions = document.createElement('div')
        actions.className = 'amd-source-actions'

        const replaceBtn = document.createElement('button')
        replaceBtn.className = 'amd-source-act'
        replaceBtn.title = getLocale() === 'en' ? 'Replace' : '替换'
        replaceBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/></svg>'
        replaceBtn.addEventListener('click', () => this.replaceSource(src))
        actions.appendChild(replaceBtn)

        const delBtn = document.createElement('button')
        delBtn.className = 'amd-source-act amd-source-del'
        delBtn.title = getLocale() === 'en' ? 'Delete' : '删除'
        delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'
        delBtn.addEventListener('click', () => this.removeSource(src))
        actions.appendChild(delBtn)

        row.appendChild(actions)
      } else {
        const badge = document.createElement('span')
        badge.className = 'amd-source-tag'
        badge.textContent = getLocale() === 'en' ? 'Built-in' : '内嵌'
        row.appendChild(badge)
      }
      el.appendChild(row)
    }
  }

  private renderMapping(): void {
    const el = this.overlay.querySelector('#amd-mapping') as HTMLElement
    if (!el) return
    const clipNames = this.getAllClipNames()
    el.innerHTML = ''

    for (const slot of ANIM_SLOTS) {
      const label = SLOT_LABELS[slot] ?? slot
      const val = this.mapping[slot] ?? ''
      const row = document.createElement('div')
      row.className = 'amd-map-row'

      const labelEl = document.createElement('span')
      labelEl.className = 'amd-map-label'
      labelEl.textContent = label
      row.appendChild(labelEl)

      const dd = document.createElement('div')
      dd.className = 'amd-map-dd'
      this.buildCustomSelect(dd, clipNames, val, (v) => {
        if (v) this.mapping[slot] = v
        else delete this.mapping[slot]
        this.renderSlotTabs()
        if (v) this.playSlot(slot)
      })
      row.appendChild(dd)
      el.appendChild(row)
    }
  }

  private buildCustomSelect(
    container: HTMLElement,
    options: string[],
    selected: string,
    onChange: (val: string) => void,
  ): void {
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'amd-dd-trigger'
    trigger.innerHTML = `<span class="amd-dd-text${!selected ? ' placeholder' : ''}">${selected || (getLocale() === 'en' ? '-- Unmapped --' : '-- 未映射 --')}</span>`

    const menu = document.createElement('div')
    menu.className = 'amd-dd-menu'

    const buildMenu = () => {
      menu.innerHTML = ''
      const emptyOpt = document.createElement('button')
      emptyOpt.type = 'button'
      emptyOpt.className = `amd-dd-opt${!selected ? ' selected' : ''}`
      emptyOpt.textContent = (getLocale() === 'en' ? '-- Unmapped --' : '-- 未映射 --')
      emptyOpt.addEventListener('click', () => { select('') })
      menu.appendChild(emptyOpt)

      for (const opt of options) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `amd-dd-opt${opt === selected ? ' selected' : ''}`
        btn.textContent = opt
        btn.addEventListener('click', () => { select(opt) })
        menu.appendChild(btn)
      }
    }

    const select = (val: string) => {
      selected = val
      trigger.innerHTML = `<span class="amd-dd-text${!val ? ' placeholder' : ''}">${val || (getLocale() === 'en' ? '-- Unmapped --' : '-- 未映射 --')}</span>`
      close()
      onChange(val)
    }

    const close = () => {
      trigger.classList.remove('open')
      menu.classList.remove('open')
      document.removeEventListener('click', outsideHandler)
    }
    const outsideHandler = (e: Event) => {
      if (!container.contains(e.target as Node)) close()
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = menu.classList.contains('open')
      if (isOpen) { close() } else {
        buildMenu()
        trigger.classList.add('open')
        menu.classList.add('open')
        document.addEventListener('click', outsideHandler)
      }
    })

    container.appendChild(trigger)
    container.appendChild(menu)
  }

  private renderSlotTabs(): void {
    const container = this.overlay.querySelector('#amd-slot-tabs') as HTMLElement
    if (!container) return
    container.innerHTML = ''
    for (const slot of ANIM_SLOTS) {
      const mapped = !!this.mapping[slot]
      const btn = document.createElement('button')
      btn.className = `amd-slot-tab${mapped ? '' : ' disabled'}${this.activeSlot === slot ? ' active' : ''}`
      btn.textContent = SLOT_LABELS[slot] ?? slot
      if (mapped) btn.addEventListener('click', () => this.playSlot(slot))
      container.appendChild(btn)
    }
  }

  // ── File operations ──

  private async handleAddAnimFile(): Promise<void> {
    const file = await this.pickFile('.glb,.gltf')
    if (!file) return
    const addBtn = this.overlay.querySelector('#amd-add-anim') as HTMLButtonElement
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = getLocale() === 'en' ? 'Uploading...' : '上传中...' }

    try {
      const url = await this.uploadAnimFile(file)
      if (url) {
        await this.loadAnimFileIntoSources(url, true)
        this.mapping = autoMatchAnimSlots(this.getAllClipNames(), this.mapping)
        this.refreshAll()
      }
    } catch { /* failed */ }

    if (addBtn) {
      addBtn.disabled = false
      addBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ${getLocale() === 'en' ? 'Add Animation' : '追加动画文件'}`
    }
  }

  private async replaceSource(oldSrc: AnimSource): Promise<void> {
    const file = await this.pickFile('.glb,.gltf')
    if (!file) return
    try {
      const url = await this.uploadAnimFile(file)
      if (!url) return
      await this.removeSource(oldSrc)
      await this.loadAnimFileIntoSources(url, true)
      this.mapping = autoMatchAnimSlots(this.getAllClipNames(), this.mapping)
      this.refreshAll()
    } catch { /* failed */ }
  }

  private async removeSource(src: AnimSource): Promise<void> {
    try {
      await fetch(apiUrl('/citizen-workshop/_api/delete-anim'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: src.url }),
      })
    } catch { /* ignore */ }

    const removed = new Set(src.clips)
    this.sources = this.sources.filter(s => s !== src)
    this.allClips = this.allClips.filter(c => !removed.has(c.name))
    for (const slot of ANIM_SLOTS) {
      if (this.mapping[slot] && removed.has(this.mapping[slot]!)) delete this.mapping[slot]
    }
    this.refreshAll()
  }

  private pickFile(accept: string): Promise<File | null> {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })
  }

  private async uploadAnimFile(file: File): Promise<string | null> {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const r = await fetch(apiUrl('/citizen-workshop/_api/upload-anim'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: btoa(binary), fileName: file.name }),
    })
    const d = await r.json()
    return d.success ? d.url : null
  }

  // ── 3D Preview ──

  private initPreview(): void {
    const canvas = this.overlay.querySelector('#amd-canvas') as HTMLCanvasElement
    if (!canvas) return

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a1e)

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
    this.camera.position.set(0, 1.5, 5)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.target.set(0, 1, 0)
    this.controls.enablePan = false

    this.scene.add(new THREE.AmbientLight(0xfff5e0, 1.2))
    const dir = new THREE.DirectionalLight(0xffffff, 1.8)
    dir.position.set(5, 8, 5)
    this.scene.add(dir)
    const fill = new THREE.DirectionalLight(0xffeedd, 0.6)
    fill.position.set(-4, 4, -3)
    this.scene.add(fill)

    const grid = new THREE.GridHelper(10, 20, 0x2a2a32, 0x202028)
    grid.position.y = 0
    this.scene.add(grid)

    this.resizePreview()
    this.startLoop()
  }

  private async loadModel(meshUrl: string): Promise<THREE.AnimationClip[]> {
    try {
      const gltf = await this.loader.loadAsync(meshUrl)
      const m = gltf.scene
      m.scale.setScalar(1)
      m.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(m)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)

      if (maxDim > 0) {
        const s = 2.5 / maxDim
        m.scale.setScalar(s)
        box.setFromObject(m)
        box.getCenter(center)
        m.position.sub(center)
        box.setFromObject(m)
        m.position.y -= box.min.y
      }

      if (this.model && this.scene) this.scene.remove(this.model)
      this.model = m

      m.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mats = Array.isArray((child as THREE.Mesh).material)
            ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
            : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
          for (const mat of mats) {
            if (mat.transparent) {
              mat.transparent = false
              mat.alphaTest = 0.5
              mat.opacity = 1
            }
            if (mat.alphaMap) {
              mat.alphaTest = Math.max(mat.alphaTest, 0.5)
            }
            mat.depthWrite = true
            mat.side = THREE.FrontSide
          }
        }
      })

      this.scene!.add(m)
      this.mixer = new THREE.AnimationMixer(m)

      const finalBox = new THREE.Box3().setFromObject(m)
      const finalCenter = finalBox.getCenter(new THREE.Vector3())
      const finalSize = finalBox.getSize(new THREE.Vector3())
      const dist = Math.max(finalSize.x, finalSize.y, finalSize.z) * 2

      this.controls!.target.copy(finalCenter)
      this.camera!.position.set(
        finalCenter.x,
        finalCenter.y + dist * 0.25,
        finalCenter.z + dist,
      )

      return gltf.animations.filter(c => c.name && c.name !== 'default')
    } catch {
      return []
    }
  }

  playSlot(slot: AnimSlot): void {
    const clipName = this.mapping[slot]
    if (!clipName || !this.mixer) return
    const clip = this.allClips.find(c => c.name === clipName)
    if (!clip) return

    this.activeSlot = slot
    const action = this.mixer.clipAction(clip)
    if (this.currentAction && this.currentAction !== action) {
      action.reset().play()
      this.currentAction.crossFadeTo(action, 0.25, false)
    } else {
      action.reset().play()
    }
    this.currentAction = action
    this.renderSlotTabs()
  }

  private resizePreview(): void {
    const canvas = this.overlay.querySelector('#amd-canvas') as HTMLCanvasElement
    if (!canvas || !this.renderer || !this.camera) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (w > 0 && h > 0) {
      this.renderer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  private startLoop(): void {
    const tick = () => {
      if (!this.renderer) return
      this.animId = requestAnimationFrame(tick)
      this.resizePreview()
      this.mixer?.update(this.clock.getDelta())
      this.controls?.update()
      this.renderer.render(this.scene!, this.camera!)
    }
    this.clock.start()
    this.animId = requestAnimationFrame(tick)
  }

  private stopPreview(): void {
    cancelAnimationFrame(this.animId)
    if (this.model && this.scene) this.scene.remove(this.model)
    this.mixer?.stopAllAction()
    this.renderer?.dispose()
    this.controls?.dispose()
    this.renderer = null; this.scene = null; this.camera = null
    this.controls = null; this.model = null; this.mixer = null
    this.currentAction = null; this.allClips = []
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }
}
