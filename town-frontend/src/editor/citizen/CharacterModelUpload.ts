import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getLocale } from '../../i18n'
import { apiUrl } from '@/utils/api-base'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.glb', '.gltf']

export type CharacterUploadResult = {
  assetId: string
  meshUrl: string
  groupId: string
  name: string
  thumbnail?: string
  hasEmbeddedAnims?: boolean
  detectedClips?: string[]
}

type CharacterAssetInfo = {
  id: string
  name: string
  scale?: number
  fileName: string
  thumbnail?: string
}

export class CharacterModelUpload {
  private overlay: HTMLElement
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
  private basePreviewScale = 1
  private onComplete: ((result: CharacterUploadResult) => void) | null = null
  private editingAsset: CharacterAssetInfo | null = null
  private detectedClipNames: string[] = []

  constructor() {
    this.overlay = this.createOverlay()
    document.getElementById('editor-root')!.appendChild(this.overlay)
  }

  open(onComplete: (result: CharacterUploadResult) => void): void {
    this.currentFile = null
    this.editingAsset = null
    this.onComplete = onComplete
    this.overlay.classList.add('open')
    this.showStep1()
  }

  openEdit(assetId: string, onComplete: (result: CharacterUploadResult) => void): void {
    this.currentFile = null
    this.editingAsset = null
    this.onComplete = onComplete
    this.overlay.classList.add('open')
    this.loadAssetAndShowEdit(assetId)
  }

  close(): void {
    this.overlay.classList.remove('open')
    this.stopPreview()
    this.currentFile = null
    this.editingAsset = null
    this.detectedClipNames = []
  }

  private createOverlay(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'char-upload-overlay'
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close()
    })
    const panel = document.createElement('div')
    panel.className = 'upload-panel char-upload-panel'
    el.appendChild(panel)
    return el
  }

  private getPanel(): HTMLElement {
    return this.overlay.querySelector('.char-upload-panel') as HTMLElement
  }

  private async loadAssetAndShowEdit(assetId: string): Promise<void> {
    try {
      const r = await fetch(apiUrl('/custom-assets/_api/list'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const d = await r.json()
      const asset = (d.assets ?? []).find((a: any) => a.id === assetId && a.kind === 'character')
      if (!asset) {
        this.close()
        return
      }
      this.editingAsset = {
        id: asset.id,
        name: asset.name,
        scale: asset.scale,
        fileName: asset.fileName,
        thumbnail: asset.thumbnail,
      }
      this.renderStep2Form(asset.name, asset.scale ?? 1.0)
      const meshUrl = apiUrl(`/custom-assets/characters/${asset.fileName}`)
      this.loader.loadAsync(meshUrl)
        .then(gltf => {
          this.setPreviewModel(gltf.scene)
          this.detectedClipNames = gltf.animations
            .map(c => c.name)
            .filter(n => n && n !== 'default')
        })
        .catch(() => {
          const info = this.overlay.querySelector('.upload-preview-info') as HTMLElement
          if (info) info.textContent = getLocale() === 'en' ? 'Model load failed' : '模型加载失败'
        })
    } catch {
      this.close()
    }
  }

  private showStep1(): void {
    const panel = this.getPanel()
    panel.classList.remove('upload-panel--step2')
    panel.innerHTML = `
      <div class="upload-header">
        <span class="upload-title">${getLocale() === 'en' ? 'Add Character' : '添加角色模型'}</span>
        <button class="upload-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="upload-dropzone" id="char-upload-dropzone">
        <div class="dropzone-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="dropzone-text">${getLocale() === 'en' ? 'Drop .glb / .gltf file here' : '拖拽 .glb / .gltf 文件到此处'}</div>
        <div class="dropzone-hint">${getLocale() === 'en' ? 'or click to browse (≤ 50MB)' : '或点击选择文件（≤ 50MB）'}</div>
        <input type="file" accept=".glb,.gltf" hidden id="char-upload-file-input">
      </div>
      <div class="upload-error" id="char-upload-error"></div>
      <div class="upload-divider"><span class="upload-divider-line"></span><span class="upload-divider-text">${getLocale() === 'en' ? 'or' : '或'}</span><span class="upload-divider-line"></span></div>
      <button class="ai-gen-toggle" id="char-ai-gen-toggle">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.09 3.26L16.36 6l-3.27 1.09L12 10.36l-1.09-3.27L7.64 6l3.27-1.09L12 2z"/><path d="M5 15l.55 1.64L7.18 17.2 5.55 17.75 5 19.4l-.55-1.65L2.82 17.2l1.63-.56L5 15z"/><path d="M19 11l.55 1.64 1.63.56-1.63.55L19 15.4l-.55-1.65-1.63-.55 1.63-.56L19 11z"/></svg>
        <span class="ai-gen-label">${getLocale() === 'en' ? 'AI Generate 3D' : 'AI 生成 3D 角色'}</span>
        <svg class="ai-gen-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="ai-gen-tools" id="char-ai-gen-tools">
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

    const dropzone = panel.querySelector('#char-upload-dropzone') as HTMLElement
    const fileInput = panel.querySelector('#char-upload-file-input') as HTMLInputElement

    dropzone.addEventListener('click', () => fileInput.click())
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault()
      dropzone.classList.add('dragover')
    })
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'))
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

    const aiToggle = panel.querySelector('#char-ai-gen-toggle') as HTMLElement
    const aiTools = panel.querySelector('#char-ai-gen-tools') as HTMLElement
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
    const errorEl = this.overlay.querySelector('#char-upload-error') as HTMLElement

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errorEl.textContent = getLocale() === 'en' ? 'Only .glb / .gltf supported' : '仅支持 .glb / .gltf 格式'
      errorEl.classList.add('visible')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      errorEl.textContent = getLocale() === 'en' ? 'File exceeds 50MB' : '文件超过 50MB 限制'
      errorEl.classList.add('visible')
      return
    }

    errorEl.classList.remove('visible')
    this.currentFile = file
    this.showStep2()
  }

  private showStep2(): void {
    const defaultName = this.currentFile!.name.replace(/\.(glb|gltf)$/i, '').slice(0, 20)
    this.renderStep2Form(defaultName, 1.0)
    this.loadPreviewFromFile(this.currentFile!)
  }

  private renderStep2Form(name: string, scale: number): void {
    const panel = this.getPanel()
    const isEdit = !!this.editingAsset
    panel.classList.add('upload-panel--step2')
    panel.innerHTML = `
      <div class="upload-header">
        <span class="upload-title">${isEdit ? (getLocale() === 'en' ? 'Edit Character' : '编辑角色模型') : (getLocale() === 'en' ? 'Add Character' : '添加角色模型')}</span>
        <button class="upload-close-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="upload-body">
        <div class="upload-form">
          <label class="upload-label">
            ${getLocale() === 'en' ? 'Name' : '名称'}
            <input type="text" class="upload-input" id="char-upload-name" value="${this.escHtml(name)}" maxlength="20" placeholder="${getLocale() === 'en' ? 'Character name' : '角色名称'}">
          </label>
          <label class="upload-label">${getLocale() === 'en' ? 'Scale' : '缩放'}</label>
          <div class="upload-scale-row">
            <button class="pi-scale-btn" data-action="scale-minus">−</button>
            <input type="range" class="pi-scale-range" id="char-upload-scale" min="0.05" max="5" step="0.05" value="${scale}" />
            <button class="pi-scale-btn" data-action="scale-plus">+</button>
            <input type="number" class="pi-scale-num" id="char-upload-scale-num" min="0.05" max="5" step="0.05" value="${scale}" />
          </div>
          <div class="upload-error" id="char-upload-error"></div>
          <label class="upload-optimize-label" id="char-optimize-row">
            <input type="checkbox" id="char-upload-optimize" />
            <span class="upload-optimize-check">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <span class="upload-optimize-text">
              <span class="upload-optimize-name">${getLocale() === 'en' ? 'Optimize' : '优化模型'}</span>
              <span class="upload-optimize-hint">${getLocale() === 'en' ? 'Deduplicate & compress' : '去重 + 量化压缩，减小文件体积'}</span>
            </span>
          </label>
          <div class="upload-footer">
            <button class="upload-btn upload-btn-cancel" id="char-upload-cancel">${getLocale() === 'en' ? 'Cancel' : '取消'}</button>
            <button class="upload-btn upload-btn-save" id="char-upload-save">${isEdit ? (getLocale() === 'en' ? 'Save' : '保存修改') : (getLocale() === 'en' ? 'Save' : '保存')}</button>
          </div>
        </div>
        <div class="upload-preview-area">
          <canvas class="upload-preview-canvas"></canvas>
          <div class="upload-preview-info">${getLocale() === 'en' ? 'Loading...' : '加载中...'}</div>
        </div>
      </div>
    `

    panel.querySelector('.upload-close-btn')!.addEventListener('click', () => this.close())
    panel.querySelector('#char-upload-cancel')!.addEventListener('click', () => this.close())
    panel.querySelector('#char-upload-save')!.addEventListener('click', () => this.handleSave())

    this.bindScaleControls()
    this.initPreview()
  }

  private bindScaleControls(): void {
    const range = this.overlay.querySelector('#char-upload-scale') as HTMLInputElement
    const num = this.overlay.querySelector('#char-upload-scale-num') as HTMLInputElement
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

  private applyPreviewScale(): void {
    if (!this.previewPivot) return
    const scaleEl = this.overlay.querySelector('#char-upload-scale') as HTMLInputElement | null
    const userScale = parseFloat(scaleEl?.value ?? '1') || 1
    this.previewPivot.scale.setScalar(this.basePreviewScale * userScale)
  }

  private async handleSave(): Promise<void> {
    const name = (this.overlay.querySelector('#char-upload-name') as HTMLInputElement).value.trim()
    const scale = parseFloat((this.overlay.querySelector('#char-upload-scale') as HTMLInputElement).value) || 1.0
    const errorEl = this.overlay.querySelector('#char-upload-error') as HTMLElement
    const isEdit = !!this.editingAsset

    if (!name) {
      errorEl.textContent = getLocale() === 'en' ? 'Enter a name' : '请输入角色名称'
      errorEl.classList.add('visible')
      return
    }

    if (!isEdit && !this.currentFile) return

    const saveBtn = this.overlay.querySelector('#char-upload-save') as HTMLButtonElement
    saveBtn.disabled = true
    saveBtn.textContent = getLocale() === 'en' ? 'Saving...' : '保存中...'

    const thumbnail = this.captureThumbnail()

    try {
      if (isEdit) {
        const resp = await fetch(apiUrl('/custom-assets/_api/update'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: this.editingAsset!.id,
            name,
            scale,
            thumbnail,
          }),
        })
        const result = await resp.json()
        if (result.error) {
          errorEl.textContent = result.error
          errorEl.classList.add('visible')
          saveBtn.disabled = false
          saveBtn.textContent = getLocale() === 'en' ? 'Save' : '保存修改'
          return
        }
        const asset = result.asset
        await this.maybeOptimize(asset.id, saveBtn)
        this.close()
        this.onComplete?.({
          assetId: asset.id,
          meshUrl: `/custom-assets/characters/${asset.fileName}`,
          groupId: `custom-${asset.id}`,
          name: asset.name,
          thumbnail: asset.thumbnail,
          hasEmbeddedAnims: this.detectedClipNames.length > 0,
          detectedClips: this.detectedClipNames.length > 0 ? [...this.detectedClipNames] : undefined,
        })
      } else {
        const arrayBuf = await this.currentFile!.arrayBuffer()
        const bytes = new Uint8Array(arrayBuf)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)

        const resp = await fetch(apiUrl('/custom-assets/_api/upload'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'character',
            name,
            data: base64,
            scale,
            thumbnail,
          }),
        })
        const result = await resp.json()
        if (result.error) {
          errorEl.textContent = result.error
          errorEl.classList.add('visible')
          saveBtn.disabled = false
          saveBtn.textContent = getLocale() === 'en' ? 'Save' : '保存'
          return
        }
        const asset = result.asset
        await this.maybeOptimize(asset.id, saveBtn)
        this.close()
        this.onComplete?.({
          assetId: asset.id,
          meshUrl: `/custom-assets/characters/${asset.fileName}`,
          groupId: `custom-${asset.id}`,
          name: asset.name,
          thumbnail: asset.thumbnail,
          hasEmbeddedAnims: this.detectedClipNames.length > 0,
          detectedClips: this.detectedClipNames.length > 0 ? [...this.detectedClipNames] : undefined,
        })
      }
    } catch {
      errorEl.textContent = isEdit ? (getLocale() === 'en' ? 'Save failed' : '保存失败，请重试') : (getLocale() === 'en' ? 'Upload failed' : '上传失败，请重试')
      errorEl.classList.add('visible')
      saveBtn.disabled = false
      saveBtn.textContent = isEdit ? (getLocale() === 'en' ? 'Save' : '保存修改') : (getLocale() === 'en' ? 'Save' : '保存')
    }
  }

  private async maybeOptimize(assetId: string, statusBtn: HTMLButtonElement): Promise<void> {
    const checkbox = this.overlay.querySelector('#char-upload-optimize') as HTMLInputElement | null
    if (!checkbox?.checked) return

    statusBtn.textContent = getLocale() === 'en' ? 'Optimizing...' : '优化中...'
    try {
      const r = await fetch(apiUrl('/custom-assets/_api/optimize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assetId }),
      })
      const d = await r.json()
      if (d.success) {
        statusBtn.textContent = getLocale() === 'en' ? `Optimized (-${d.ratio}%)` : `已优化 (-${d.ratio}%)`
      }
    } catch { /* optimize failed, non-blocking */ }
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
    const url = URL.createObjectURL(file)
    this.loader.loadAsync(url)
      .then(gltf => {
        URL.revokeObjectURL(url)
        this.setPreviewModel(gltf.scene)
        this.detectedClipNames = gltf.animations
          .map(c => c.name)
          .filter(n => n && n !== 'default')
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

    model.traverse(child => {
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

    this.previewScene.add(pivot)

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

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
      finalCenter.x,
      finalCenter.y + dist * 0.25,
      finalCenter.z + dist,
    )

    const infoEl = this.overlay.querySelector('.upload-preview-info') as HTMLElement
    if (infoEl) infoEl.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`

    this.applyPreviewScale()
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
    if (this.previewPivot && this.previewScene) this.previewScene.remove(this.previewPivot)
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

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
