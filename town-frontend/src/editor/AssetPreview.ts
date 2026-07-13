import { getLocale } from '../i18n'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { apiUrl } from '@/utils/api-base'
const BG_COLOR = 0x101018
const TARGET_SIZE = 2.5

export class AssetPreview {
  private container: HTMLElement
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private loader = new GLTFLoader()
  private currentModel: THREE.Group | null = null
  private infoName: HTMLElement
  private infoSize: HTMLElement
  private animId = 0
  private visible = false

  constructor(container: HTMLElement) {
    this.container = container
    this.canvas = container.querySelector('canvas')!
    this.infoName = container.querySelector('.preview-name')!
    this.infoSize = container.querySelector('.preview-size')!

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(BG_COLOR)

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200)
    this.camera.position.set(3, 2, 3)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 1.5
    this.controls.minDistance = 0.1
    this.controls.maxDistance = 50

    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false
    })

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    this.scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(5, 8, 5)
    this.scene.add(dir)
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3)
    fill.position.set(-5, 3, -5)
    this.scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: 0x141420, roughness: 0.9 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    this.scene.add(ground)

    const grid = new THREE.GridHelper(20, 40, 0x222233, 0x181824)
    this.scene.add(grid)

    container.querySelector('.preview-close')?.addEventListener('click', () => this.hide())

    new ResizeObserver(() => this.resize()).observe(this.canvas)
  }

  private pendingFixRotationX = 0

  show(url: string, name: string, fixRotationX?: number): void {
    this.pendingFixRotationX = fixRotationX ?? 0
    this.container.classList.add('visible')
    if (!this.visible) {
      this.visible = true
      this.resize()
      this.startLoop()
    }
    this.loadModel(url, name)
  }

  hide(): void {
    this.container.classList.remove('visible')
    this.visible = false
    cancelAnimationFrame(this.animId)
  }

  isOpen(): boolean { return this.visible }

  private async loadModel(url: string, name: string): Promise<void> {
    this.infoName.textContent = name
    this.infoSize.textContent = getLocale() === 'en' ? 'Loading...' : '加载中...'

    const resolvedUrl = /^(blob:|https?:\/\/)/.test(url) ? url : apiUrl((import.meta.env.BASE_URL ?? '/') + url)
    try {
      const gltf = await this.loader.loadAsync(resolvedUrl)
      this.setModel(gltf.scene, name)
    } catch {
      this.infoSize.textContent = getLocale() === 'en' ? 'Load failed' : '加载失败'
      if (this.currentModel) {
        this.scene.remove(this.currentModel)
        this.currentModel = null
      }
    }
  }

  private setModel(model: THREE.Group, name: string): void {
    if (this.currentModel) this.scene.remove(this.currentModel)

    if (this.pendingFixRotationX) {
      const pivot = new THREE.Group()
      pivot.rotation.x = (this.pendingFixRotationX * Math.PI) / 180
      while (model.children.length > 0) pivot.add(model.children[0])
      const wrapper = new THREE.Group()
      wrapper.add(pivot)
      model = wrapper
    }

    this.currentModel = model
    this.scene.add(model)

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)

    if (maxDim > 0) {
      const scale = TARGET_SIZE / maxDim
      model.scale.setScalar(scale)
      box.setFromObject(model)
      box.getCenter(center)
      model.position.sub(center)
      box.setFromObject(model)
      model.position.y -= box.min.y
    }

    const finalBox = new THREE.Box3().setFromObject(model)
    const finalCenter = finalBox.getCenter(new THREE.Vector3())
    this.controls.target.copy(finalCenter)
    const finalSize = finalBox.getSize(new THREE.Vector3())
    const dist = Math.max(finalSize.x, finalSize.y, finalSize.z) * 2
    this.camera.position.set(
      finalCenter.x + dist * 0.7,
      finalCenter.y + dist * 0.5,
      finalCenter.z + dist * 0.7,
    )
    this.controls.autoRotate = true
    this.controls.update()

    this.infoName.textContent = name
    this.infoSize.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)}`
  }

  private resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (w > 0 && h > 0) {
      this.renderer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  private startLoop(): void {
    const loop = () => {
      if (!this.visible) return
      this.animId = requestAnimationFrame(loop)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.animId = requestAnimationFrame(loop)
  }
}
