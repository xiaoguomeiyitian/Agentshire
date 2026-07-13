import * as THREE from 'three'
import { getLocale } from '../i18n'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CustomAssetStore, CustomAsset } from './CustomAssetStore'
import { apiUrl } from '@/utils/api-base'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.glb']

export class CustomAssetUpload {
  private overlay: HTMLElement
  private store: CustomAssetStore
  private loader = new GLTFLoader()
  private previewRenderer: THREE.WebGLRenderer | null = null
  private previewScene: THREE.Scene | null = null
  private previewCamera: THREE.PerspectiveCamera | null = null
  private previewControls: OrbitControls | null = null
  private previewModel: THREE.Group | null = null
  private previewPivot: THREE.Group | null = null
  private previewCanvas: HTMLCanvasElement | null = null
  private animId = 0
  private currentFile: File | null = null
  private editingAsset: CustomAsset | null = null
  private onComplete: (() => void) | null = null
  private rawModelSize = new THREE.Vector3()
  private basePreviewScale = 1

  constructor(store: CustomAssetStore) {
    this.store = store
    this.overlay = document.getElementById('upload-overlay')!
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close()
    })
  }

  open(onComplete?: () => void): void {
    this.editingAsset = null
    this.currentFile = null
    this.onComplete = onComplete ?? null
    this.overlay.classList.add('open')
    this.showStep1()
  }

  openEdit(asset: CustomAsset, onComplete?: () => void): void {
    this.editingAsset = asset
    this.currentFile = null
    this.onComplete = onComplete ?? null
    this.overlay.classList.add('open')
    this.showStep2Edit(asset)
  }

  close(): void {
    this.overlay.classList.remove('open')
    this.stopPreview()
    this.currentFile = null
    this.editingAsset = null
  }

  private showStep1(): void {
    const panel = this.overlay.querySelector('.upload-panel') as HTMLElement
    panel.classList.remove('upload-panel--step2')
    panel.innerHTML = `
      <div class="upload-header">
        <span class="upload-title">${getLocale() === 'en' ? 'Add Asset' : '添加资产'}</span>
        <button class="upload-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="upload-dropzone" id="upload-dropzone">
        <div class="dropzone-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="dropzone-text">${getLocale() === 'en' ? 'Drop .glb file here' : '拖拽 .glb 文件到此处'}</div>
        <div class="dropzone-hint">${getLocale() === 'en' ? 'or click to browse (≤ 10MB)' : '或点击选择文件（≤ 10MB）'}</div>
        <input type="file" accept=".glb" hidden id="upload-file-input">
      </div>
      <div class="upload-error" id="upload-error"></div>
      <div class="upload-divider"><span class="upload-divider-line"></span><span class="upload-divider-text">${getLocale() === 'en' ? 'or' : '或'}</span><span class="upload-divider-line"></span></div>
      <button class="ai-gen-toggle" id="ai-gen-toggle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.09 3.26L16.36 6l-3.27 1.09L12 10.36l-1.09-3.27L7.64 6l3.27-1.09L12 2z"/><path d="M5 15l.55 1.64L7.18 17.2 5.55 17.75 5 19.4l-.55-1.65L2.82 17.2l1.63-.56L5 15z"/><path d="M19 11l.55 1.64 1.63.56-1.63.55L19 15.4l-.55-1.65-1.63-.55 1.63-.56L19 11z"/></svg>
        <span class="ai-gen-label">${getLocale() === 'en' ? 'AI Generate 3D' : 'AI 生成 3D 资产'}</span>
        <svg class="ai-gen-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="ai-gen-tools" id="ai-gen-tools">
        <a class="ai-tool-card" data-url="https://3d-models.hunyuan.tencent.com/">
          <span class="ai-tool-logo" style="background:linear-gradient(135deg,#6366f1,#3b82f6)">H</span>
          <span class="ai-tool-name">混元3D</span>
        </a>
        <a class="ai-tool-card" data-url="https://www.meshy.ai">
          <span class="ai-tool-logo" style="background:linear-gradient(135deg,#f97316,#fb923c)">M</span>
          <span class="ai-tool-name">Meshy</span>
        </a>
        <a class="ai-tool-card" data-url="https://hyper3d.ai">
          <span class="ai-tool-logo" style="background:linear-gradient(135deg,#10b981,#34d399)">R</span>
          <span class="ai-tool-name">Rodin</span>
        </a>
        <a class="ai-tool-card" data-url="https://www.tripo3d.ai">
          <span class="ai-tool-logo" style="background:linear-gradient(135deg,#06b6d4,#22d3ee)">T</span>
          <span class="ai-tool-name">Tripo</span>
        </a>
      </div>
    `

    panel.querySelector('.upload-close-btn')!.addEventListener('click', () => this.close())

    const dropzone = panel.querySelector('#upload-dropzone') as HTMLElement
    const fileInput = panel.querySelector('#upload-file-input') as HTMLInputElement

    dropzone.addEventListener('click', () => fileInput.click())

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault()
      dropzone.classList.add('dragover')
    })
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover')
    })
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault()
      dropzone.classList.remove('dragover')
      const file = e.dataTransfer?.files[0]
      if (file) this.validateAndProceed(file)
    })

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (file) this.validateAndProceed(file)
    })

    const aiToggle = panel.querySelector('#ai-gen-toggle') as HTMLElement
    const aiTools = panel.querySelector('#ai-gen-tools') as HTMLElement
    aiToggle.addEventListener('click', () => {
      const expanded = aiTools.classList.toggle('expanded')
      aiToggle.classList.toggle('expanded', expanded)
    })
    aiTools.querySelectorAll('.ai-tool-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault()
        const url = (card as HTMLElement).dataset.url
        if (url) window.open(url, '_blank', 'noopener')
      })
    })
  }

  private validateAndProceed(file: File): void {
    const errorEl = this.overlay.querySelector('#upload-error') as HTMLElement

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errorEl.textContent = getLocale() === 'en' ? 'Only .glb supported' : '仅支持 .glb 格式'
      errorEl.classList.add('visible')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      errorEl.textContent = getLocale() === 'en' ? 'File exceeds 10MB' : '文件超过 10MB 限制'
      errorEl.classList.add('visible')
      return
    }

    this.currentFile = file
    this.showStep2()
  }

  private showStep2(): void {
    const defaultName = this.currentFile!.name.replace(/\.glb$/i, '').slice(0, 20)
    this.renderStep2Form(defaultName, 1.0, 'prop', 0, 0, 0)
    this.loadPreviewFromFile(this.currentFile!)
  }

  private showStep2Edit(asset: CustomAsset): void {
    this.renderStep2Form(
      asset.name,
      asset.scale ?? 1.0,
      asset.assetType ?? 'prop',
      asset.fixRotationX ?? 0,
      asset.fixRotationY ?? 0,
      asset.fixRotationZ ?? 0,
    )

    const url = this.store.getModelUrl(asset)
    const resolvedUrl = /^(blob:|https?:\/\/)/.test(url) ? url : apiUrl((import.meta.env.BASE_URL ?? '/') + url)
    this.initPreview()
    this.loader.loadAsync(resolvedUrl)
      .then(gltf => {
        this.setPreviewModel(gltf.scene)
        this.applyPreviewRotation()
        this.applyPreviewScale()
      })
      .catch(() => {
        const info = this.overlay.querySelector('.upload-preview-info') as HTMLElement
        if (info) info.textContent = getLocale() === 'en' ? 'Model load failed' : '模型加载失败'
      })
  }

  private renderStep2Form(
    name: string, scale: number,
    assetType: string, fixRotationX: number, fixRotationY: number, fixRotationZ: number,
  ): void {
    const panel = this.overlay.querySelector('.upload-panel') as HTMLElement
    const isEdit = !!this.editingAsset

    panel.classList.add('upload-panel--step2')
    panel.innerHTML = `
      <div class="upload-header">
        <span class="upload-title">${isEdit ? (getLocale() === 'en' ? 'Edit Asset' : '编辑资产') : (getLocale() === 'en' ? 'Add Asset' : '添加资产')}</span>
        <button class="upload-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="upload-body">
        <div class="upload-form">
          <label class="upload-label">
            ${getLocale() === 'en' ? 'Name' : '名称'}
            <input type="text" class="upload-input" id="upload-name" value="${this.escHtml(name)}" maxlength="20" placeholder="${getLocale() === 'en' ? 'Asset name' : '资产名称'}">
          </label>
          <label class="upload-label">${getLocale() === 'en' ? 'Type' : '放置类型'}</label>
          <div class="upload-custom-select" id="upload-type-select">
            <div class="upload-select-trigger" id="upload-type-trigger">
              <span class="upload-select-value">${this.getAssetTypeLabel(assetType)}</span>
              <svg class="upload-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="upload-select-dropdown" id="upload-type-dropdown">
              ${this.renderAssetTypeOptions(assetType)}
            </div>
            <input type="hidden" id="upload-type" value="${assetType}" />
          </div>
          <label class="upload-label">${getLocale() === 'en' ? 'Scale' : '缩放'}</label>
          <div class="upload-scale-row">
            <button class="pi-scale-btn" data-action="scale-minus">−</button>
            <input type="range" class="pi-scale-range" id="upload-scale" min="0.05" max="5" step="0.05" value="${scale}" />
            <button class="pi-scale-btn" data-action="scale-plus">+</button>
            <input type="number" class="pi-scale-num" id="upload-scale-num" min="0.05" max="5" step="0.05" value="${scale}" />
          </div>
          <label class="upload-label">${getLocale() === 'en' ? 'Rotation X' : '旋转 X'}</label>
          <div class="upload-scale-row">
            <button class="pi-scale-btn" data-action="rotx-minus">−</button>
            <input type="range" class="pi-scale-range" id="upload-rotx" min="-180" max="180" step="1" value="${fixRotationX}" />
            <button class="pi-scale-btn" data-action="rotx-plus">+</button>
            <span class="upload-rot-wrap"><input type="number" class="pi-scale-num" id="upload-rotx-num" min="-180" max="180" step="1" value="${fixRotationX}" /></span>
          </div>
          <label class="upload-label">${getLocale() === 'en' ? 'Rotation Y' : '旋转 Y'}</label>
          <div class="upload-scale-row">
            <button class="pi-scale-btn" data-action="roty-minus">−</button>
            <input type="range" class="pi-scale-range" id="upload-roty" min="-180" max="180" step="1" value="${fixRotationY}" />
            <button class="pi-scale-btn" data-action="roty-plus">+</button>
            <span class="upload-rot-wrap"><input type="number" class="pi-scale-num" id="upload-roty-num" min="-180" max="180" step="1" value="${fixRotationY}" /></span>
          </div>
          <label class="upload-label">${getLocale() === 'en' ? 'Rotation Z' : '旋转 Z'}</label>
          <div class="upload-scale-row">
            <button class="pi-scale-btn" data-action="rotz-minus">−</button>
            <input type="range" class="pi-scale-range" id="upload-rotz" min="-180" max="180" step="1" value="${fixRotationZ}" />
            <button class="pi-scale-btn" data-action="rotz-plus">+</button>
            <span class="upload-rot-wrap"><input type="number" class="pi-scale-num" id="upload-rotz-num" min="-180" max="180" step="1" value="${fixRotationZ}" /></span>
          </div>
          <div class="upload-error" id="upload-error"></div>
          <div class="upload-footer">
            <button class="upload-btn upload-btn-cancel" id="upload-cancel">${getLocale() === 'en' ? 'Cancel' : '取消'}</button>
            <button class="upload-btn upload-btn-save" id="upload-save">${isEdit ? (getLocale() === 'en' ? 'Save' : '保存修改') : (getLocale() === 'en' ? 'Save' : '保存')}</button>
          </div>
        </div>
        <div class="upload-preview-area">
          <canvas class="upload-preview-canvas"></canvas>
          <div class="upload-preview-info">${getLocale() === 'en' ? 'Loading...' : '加载中...'}</div>
        </div>
      </div>
    `

    panel.querySelector('.upload-close-btn')!.addEventListener('click', () => this.close())
    panel.querySelector('#upload-cancel')!.addEventListener('click', () => this.close())
    panel.querySelector('#upload-save')!.addEventListener('click', () => this.handleSave())

    this.bindScaleControls()
    this.bindRotationControls()
    this.bindCustomSelect()

    if (!isEdit) this.initPreview()
  }

  private bindScaleControls(): void {
    const range = this.overlay.querySelector('#upload-scale') as HTMLInputElement
    const num = this.overlay.querySelector('#upload-scale-num') as HTMLInputElement
    const minus = this.overlay.querySelector('[data-action="scale-minus"]') as HTMLButtonElement
    const plus = this.overlay.querySelector('[data-action="scale-plus"]') as HTMLButtonElement

    const sync = (val: number) => {
      val = Math.max(0.05, Math.min(5, Math.round(val * 100) / 100))
      range.value = String(val)
      num.value = String(val)
      this.applyPreviewScale()
    }

    range.addEventListener('input', () => sync(parseFloat(range.value)))
    num.addEventListener('input', () => {
      const v = parseFloat(num.value)
      if (!isNaN(v)) { range.value = String(v); this.applyPreviewScale() }
    })
    num.addEventListener('blur', () => sync(parseFloat(num.value) || 1))
    minus.addEventListener('click', () => sync((parseFloat(range.value) || 1) - 0.1))
    plus.addEventListener('click', () => sync((parseFloat(range.value) || 1) + 0.1))
  }

  private bindRotationControls(): void {
    const axes = ['rotx', 'roty', 'rotz'] as const
    for (const axis of axes) {
      const range = this.overlay.querySelector(`#upload-${axis}`) as HTMLInputElement
      const num = this.overlay.querySelector(`#upload-${axis}-num`) as HTMLInputElement
      const minus = this.overlay.querySelector(`[data-action="${axis}-minus"]`) as HTMLButtonElement
      const plus = this.overlay.querySelector(`[data-action="${axis}-plus"]`) as HTMLButtonElement

      const sync = (val: number) => {
        val = Math.max(-180, Math.min(180, Math.round(val)))
        range.value = String(val)
        num.value = String(val)
        this.applyPreviewRotation()
      }

      range.addEventListener('input', () => sync(parseInt(range.value)))
      num.addEventListener('input', () => {
        const v = parseInt(num.value)
        if (!isNaN(v)) { range.value = String(v); this.applyPreviewRotation() }
      })
      num.addEventListener('blur', () => sync(parseInt(num.value) || 0))
      minus.addEventListener('click', () => sync((parseInt(range.value) || 0) - 5))
      plus.addEventListener('click', () => sync((parseInt(range.value) || 0) + 5))
    }
  }

  private applyPreviewRotation(): void {
    if (!this.previewPivot) return
    const rotXEl = this.overlay.querySelector('#upload-rotx') as HTMLInputElement | null
    const rotYEl = this.overlay.querySelector('#upload-roty') as HTMLInputElement | null
    const rotZEl = this.overlay.querySelector('#upload-rotz') as HTMLInputElement | null
    const rx = parseFloat(rotXEl?.value ?? '0') || 0
    const ry = parseFloat(rotYEl?.value ?? '0') || 0
    const rz = parseFloat(rotZEl?.value ?? '0') || 0
    this.previewPivot.rotation.x = (rx * Math.PI) / 180
    this.previewPivot.rotation.y = (ry * Math.PI) / 180
    this.previewPivot.rotation.z = (rz * Math.PI) / 180
  }

  private applyPreviewScale(): void {
    if (!this.previewPivot) return
    const scaleEl = this.overlay.querySelector('#upload-scale') as HTMLInputElement | null
    const userScale = parseFloat(scaleEl?.value ?? '1') || 1
    this.previewPivot.scale.setScalar(this.basePreviewScale * userScale)
  }

  private async handleSave(): Promise<void> {
    const name = (this.overlay.querySelector('#upload-name') as HTMLInputElement).value.trim()
    const scale = parseFloat((this.overlay.querySelector('#upload-scale') as HTMLInputElement).value) || 1.0
    const assetType = (this.overlay.querySelector('#upload-type') as HTMLInputElement).value
    const fixRotationX = parseInt((this.overlay.querySelector('#upload-rotx') as HTMLInputElement).value) || 0
    const fixRotationY = parseInt((this.overlay.querySelector('#upload-roty') as HTMLInputElement).value) || 0
    const fixRotationZ = parseInt((this.overlay.querySelector('#upload-rotz') as HTMLInputElement).value) || 0
    const errorEl = this.overlay.querySelector('#upload-error') as HTMLElement

    const autoCells = this.computeCells(scale)

    if (!name) {
      errorEl.textContent = getLocale() === 'en' ? 'Enter a name' : '请输入资产名称'
      errorEl.classList.add('visible')
      return
    }

    const thumbnail = this.captureThumbnail()

    const saveBtn = this.overlay.querySelector('#upload-save') as HTMLButtonElement
    saveBtn.disabled = true
    saveBtn.textContent = getLocale() === 'en' ? 'Saving...' : '保存中...'

    try {
      if (this.editingAsset) {
        const result = await this.store.update(this.editingAsset.id, {
          name,
          cells: autoCells,
          scale,
          assetType,
          fixRotationX: fixRotationX || undefined,
          fixRotationY: fixRotationY || undefined,
          fixRotationZ: fixRotationZ || undefined,
        })
        if ('error' in result) {
          errorEl.textContent = result.error
          errorEl.classList.add('visible')
          saveBtn.disabled = false
          saveBtn.textContent = getLocale() === 'en' ? 'Save' : '保存修改'
          return
        }
      } else {
        if (!this.currentFile) return
        const result = await this.store.upload({
          kind: 'model',
          name,
          file: this.currentFile,
          cells: autoCells,
          scale,
          assetType,
          fixRotationX: fixRotationX || undefined,
          fixRotationY: fixRotationY || undefined,
          fixRotationZ: fixRotationZ || undefined,
          thumbnail,
        })
        if ('error' in result) {
          errorEl.textContent = result.error
          errorEl.classList.add('visible')
          saveBtn.disabled = false
          saveBtn.textContent = getLocale() === 'en' ? 'Save' : '保存'
          return
        }
      }

      this.close()
      this.onComplete?.()
    } catch {
      errorEl.textContent = getLocale() === 'en' ? 'Save failed' : '保存失败，请重试'
      errorEl.classList.add('visible')
      saveBtn.disabled = false
      saveBtn.textContent = this.editingAsset ? (getLocale() === 'en' ? 'Save' : '保存修改') : (getLocale() === 'en' ? 'Save' : '保存')
    }
  }

  private computeCells(userScale: number): [number, number] {
    if (this.rawModelSize.x === 0 && this.rawModelSize.z === 0) return [1, 1]
    const w = Math.max(1, Math.round(this.rawModelSize.x * userScale))
    const d = Math.max(1, Math.round(this.rawModelSize.z * userScale))
    return [w, d]
  }

  // 3D Preview

  private initPreview(): void {
    this.stopPreview()
    const canvas = this.overlay.querySelector('.upload-preview-canvas') as HTMLCanvasElement
    if (!canvas) return
    this.previewCanvas = canvas

    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace

    this.previewScene = new THREE.Scene()
    this.previewScene.background = new THREE.Color(0x101018)

    this.previewCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
    this.previewCamera.position.set(3, 2, 3)

    this.previewControls = new OrbitControls(this.previewCamera, canvas)
    this.previewControls.enableDamping = true
    this.previewControls.autoRotate = false

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    this.previewScene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(5, 8, 5)
    this.previewScene.add(dir)

    const grid = new THREE.GridHelper(10, 20, 0x222233, 0x181824)
    this.previewScene.add(grid)

    this.resizePreview()
    this.startPreviewLoop()
  }

  private loadPreviewFromFile(file: File): void {
    this.initPreview()
    const url = URL.createObjectURL(file)
    this.loader.loadAsync(url)
      .then(gltf => {
        URL.revokeObjectURL(url)
        this.setPreviewModel(gltf.scene)
      })
      .catch(() => {
        URL.revokeObjectURL(url)
        const info = this.overlay.querySelector('.upload-preview-info') as HTMLElement
        if (info) info.textContent = getLocale() === 'en' ? 'Model load failed' : '模型加载失败，请检查文件是否完整'
      })
  }

  private setPreviewModel(model: THREE.Group): void {
    if (!this.previewScene || !this.previewCamera || !this.previewControls) return

    if (this.previewPivot && this.previewScene) this.previewScene.remove(this.previewPivot)
    if (this.previewModel && this.previewScene) this.previewScene.remove(this.previewModel)

    const pivot = new THREE.Group()
    pivot.add(model)
    this.previewModel = model
    this.previewPivot = pivot
    this.previewScene.add(pivot)

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    this.rawModelSize.copy(size)

    if (maxDim > 0) {
      this.basePreviewScale = 2.5 / maxDim
      pivot.scale.setScalar(this.basePreviewScale)

      box.setFromObject(pivot)
      box.getCenter(center)
      model.position.sub(new THREE.Vector3(
        center.x / this.basePreviewScale,
        center.y / this.basePreviewScale,
        center.z / this.basePreviewScale,
      ))
      box.setFromObject(pivot)
      model.position.y -= box.min.y / this.basePreviewScale
    }

    const finalBox = new THREE.Box3().setFromObject(pivot)
    const finalCenter = finalBox.getCenter(new THREE.Vector3())
    this.previewControls.target.copy(finalCenter)
    const finalSize = finalBox.getSize(new THREE.Vector3())
    const dist = Math.max(finalSize.x, finalSize.y, finalSize.z) * 2
    this.previewCamera.position.set(
      finalCenter.x + dist * 0.7,
      finalCenter.y + dist * 0.5,
      finalCenter.z + dist * 0.7,
    )

    const infoEl = this.overlay.querySelector('.upload-preview-info') as HTMLElement
    if (infoEl) infoEl.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`

    this.applyPreviewScale()
    this.applyPreviewRotation()
  }

  private resizePreview(): void {
    if (!this.previewCanvas || !this.previewRenderer || !this.previewCamera) return
    const w = this.previewCanvas.clientWidth
    const h = this.previewCanvas.clientHeight
    if (w > 0 && h > 0) {
      this.previewRenderer.setSize(w, h)
      this.previewCamera.aspect = w / h
      this.previewCamera.updateProjectionMatrix()
    }
  }

  private startPreviewLoop(): void {
    const loop = () => {
      if (!this.previewRenderer) return
      this.animId = requestAnimationFrame(loop)
      this.resizePreview()
      this.previewControls?.update()
      this.previewRenderer.render(this.previewScene!, this.previewCamera!)
    }
    this.animId = requestAnimationFrame(loop)
  }

  private stopPreview(): void {
    cancelAnimationFrame(this.animId)
    if (this.previewPivot && this.previewScene) {
      this.previewScene.remove(this.previewPivot)
    }
    this.previewRenderer?.dispose()
    this.previewControls?.dispose()
    this.previewRenderer = null
    this.previewScene = null
    this.previewCamera = null
    this.previewControls = null
    this.previewModel = null
    this.previewPivot = null
    this.previewCanvas = null
  }

  private captureThumbnail(): string | undefined {
    if (!this.previewRenderer || !this.previewScene || !this.previewCamera) return undefined
    this.previewRenderer.render(this.previewScene, this.previewCamera)
    try {
      return this.previewRenderer.domElement.toDataURL('image/png', 0.6)
    } catch { return undefined }
  }

  private static readonly ASSET_TYPE_OPTIONS: { value: string; label: string }[] = [
    { value: 'building', label: getLocale() === 'en' ? 'Building' : '建筑' },
    { value: 'road', label: getLocale() === 'en' ? 'Road' : '道路' },
    { value: 'prop', label: getLocale() === 'en' ? 'Prop' : '道具' },
    { value: 'vehicle', label: getLocale() === 'en' ? 'Vehicle' : '汽车' },
    { value: 'nature', label: getLocale() === 'en' ? 'Nature' : '自然' },
    { value: 'streetProp', label: getLocale() === 'en' ? 'Street' : '街道' },
    { value: 'tile', label: getLocale() === 'en' ? 'Tile' : '瓦片' },
    { value: 'sign', label: getLocale() === 'en' ? 'Sign' : '标牌' },
    { value: 'factory', label: getLocale() === 'en' ? 'Factory' : '工厂' },
    { value: 'food', label: getLocale() === 'en' ? 'Food' : '餐饮' },
    { value: 'roofProp', label: getLocale() === 'en' ? 'Roof' : '屋顶' },
    { value: 'basketball', label: getLocale() === 'en' ? 'Sports' : '球场' },
    { value: 'construction', label: getLocale() === 'en' ? 'Build' : '工地' },
    { value: 'other', label: getLocale() === 'en' ? 'Other' : '其他' },
  ]

  private getAssetTypeLabel(value: string): string {
    return CustomAssetUpload.ASSET_TYPE_OPTIONS.find(o => o.value === value)?.label ?? (getLocale() === 'en' ? 'Prop' : '道具')
  }

  private renderAssetTypeOptions(current: string): string {
    return CustomAssetUpload.ASSET_TYPE_OPTIONS.map(o =>
      `<div class="upload-select-option${o.value === current ? ' active' : ''}" data-value="${o.value}">${o.label}</div>`
    ).join('')
  }

  private bindCustomSelect(): void {
    const select = this.overlay.querySelector('#upload-type-select') as HTMLElement
    const trigger = this.overlay.querySelector('#upload-type-trigger') as HTMLElement
    const dropdown = this.overlay.querySelector('#upload-type-dropdown') as HTMLElement
    const hidden = this.overlay.querySelector('#upload-type') as HTMLInputElement
    const valueSpan = trigger.querySelector('.upload-select-value') as HTMLElement

    if (!select || !trigger || !dropdown || !hidden) return

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = select.classList.contains('open')
      select.classList.toggle('open', !isOpen)
    })

    dropdown.addEventListener('click', (e) => {
      const option = (e.target as HTMLElement).closest('.upload-select-option') as HTMLElement
      if (!option) return
      const val = option.dataset.value!
      hidden.value = val
      valueSpan.textContent = this.getAssetTypeLabel(val)
      dropdown.querySelectorAll('.upload-select-option').forEach(o => o.classList.remove('active'))
      option.classList.add('active')
      select.classList.remove('open')
    })

    document.addEventListener('click', (e) => {
      if (!select.contains(e.target as Node)) {
        select.classList.remove('open')
      }
    })
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
