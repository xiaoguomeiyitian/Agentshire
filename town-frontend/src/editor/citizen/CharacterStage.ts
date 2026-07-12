import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AnimMapping, ModelTransform, ModelSource } from '../../data/CitizenWorkshopConfig'
import { computeDefaultTransform } from '../../data/CitizenWorkshopConfig'

const PLATFORM_Y = 0.55
const EXT_BASE = '/ext-assets'

/**
 * PREVIEW_FACTOR converts the town-space scale to a preview-space scale
 * so that a builtin character (town scale=2.8, raw height ≈ 1.0) appears
 * at a comfortable height (~2.4) on the preview stage.
 */
const PREVIEW_FACTOR = 2.4 / 2.8

export class CharacterStage {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private loader = new GLTFLoader()
  private clock = new THREE.Clock()

  private currentModel: THREE.Group | null = null
  private mixer: THREE.AnimationMixer | null = null
  private currentAction: THREE.AnimationAction | null = null
  private animMap = new Map<string, THREE.AnimationClip>()
  private animQueue: string[] = []
  private animIdx = 0
  private animLoopTimer = 0

  private animId = 0
  private loadId = 0
  private active = false
  private currentScale = 1
  private onRawHeight: ((h: number, source: ModelSource) => void) | null = null

  setOnRawHeight(cb: (h: number, source: ModelSource) => void): void {
    this.onRawHeight = cb
  }

  constructor(container: HTMLElement) {
    this.container = container

    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.AgXToneMapping
    this.renderer.toneMappingExposure = 1

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
    this.camera.position.set(0, 4.5, 9.0)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 1.2, 0)
    this.controls.minDistance = 4
    this.controls.maxDistance = 14
    this.controls.maxPolarAngle = Math.PI * 0.48
    this.controls.minPolarAngle = Math.PI * 0.15
    this.controls.enablePan = false

    this.buildBackground()
    this.buildLighting()
    this.buildGrassPlatform()

    new ResizeObserver(() => { if (this.active) this.resize() }).observe(container)
  }

  private buildBackground(): void {
    const bgGeo = new THREE.SphereGeometry(50, 32, 32)



    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        colorA: { value: new THREE.Vector3(0.866, 0.702, 0.412) },
        colorB: { value: new THREE.Vector3(0.835, 0.686, 0.431) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 colorA;
        uniform vec3 colorB;
        varying vec2 vUv;
        void main() {
          float t = 1.0 - (vUv.x * 0.4 + vUv.y * 0.6);
          gl_FragColor = vec4(mix(colorA, colorB, t), 1.0);
        }
      `,
    })
    this.scene.add(new THREE.Mesh(bgGeo, bgMat))

    const groundGeo = new THREE.PlaneGeometry(30, 30)
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    this.scene.add(ground)
  }

  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(0xfff5e0, 1.0)
    this.scene.add(ambient)

    const key = new THREE.DirectionalLight(0xffffff, 1.8)
    key.position.set(6, 8, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 30
    key.shadow.camera.left = -12
    key.shadow.camera.right = 8
    key.shadow.camera.top = 10
    key.shadow.camera.bottom = -8
    key.shadow.bias = -0.0003
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    const fill = new THREE.DirectionalLight(0xffeedd, 0.5)
    fill.position.set(-5, 6, -4)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0xfff0dd, 0.4)
    rim.position.set(-2, 4, -7)
    this.scene.add(rim)
  }

  private async buildGrassPlatform(): Promise<void> {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x999999), roughness: 0.35, metalness: 0.0, side: THREE.DoubleSide })
    const R = 0.17
    const cx = 1.90
    const cy = 0.0
    const rimPoints: THREE.Vector2[] = []
    const steps = 16
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI / 2 - (Math.PI * i) / steps
      rimPoints.push(new THREE.Vector2(cx + R * Math.cos(a), cy + R * Math.sin(a)))
    }
    const points = [
      new THREE.Vector2(0, 0.08),
      new THREE.Vector2(1.82, 0.08),
      ...rimPoints,
      new THREE.Vector2(1.82, -0.20),
      new THREE.Vector2(0, -0.20),
    ]
    const baseGeo = new THREE.LatheGeometry(points, 128)
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.position.y = 0.15
    base.receiveShadow = true
    base.castShadow = true
    this.scene.add(base)

    const DECO = 'assets/models/stage-deco'

    try {
      const gltf = await this.loader.loadAsync(`${DECO}/Park_GrassHill_A.glb`)
      const grassHill = gltf.scene
      grassHill.scale.setScalar(1)
      grassHill.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(grassHill)
      const rawRadius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2
      const targetRadius = 1.80
      const s = rawRadius > 0.01 ? targetRadius / rawRadius : 1
      grassHill.scale.setScalar(s)
      grassHill.position.set(0, 0.30, 0)
      grassHill.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).castShadow = true
          ;(child as THREE.Mesh).receiveShadow = true
        }
      })
      this.scene.add(grassHill)
    } catch { /* not critical */ }

    this.loadDeco(`${DECO}/Grass_A_1.glb`, 0.35, 0, 0.54, -0.6, 0.2)
    this.loadDeco(`${DECO}/Grass_A_1.glb`, 0.30, 1.8, 0.54, 0.3, -0.7)
    this.loadDeco(`${DECO}/Grass_A_1.glb`, 0.28, 3.0, 0.52, 0.9, 0.5)
    this.loadDeco(`${DECO}/Grass_A_1.glb`, 0.35, 3.0, 0.48, -0.4, 1.2)
    this.loadDeco(`${DECO}/Flowers_2_B.glb`, 0.60, 0.5, 0.5, -1.0, -0.5)

    this.loadDeco(`${DECO}/Flowers_1_D.glb`, 0.6, 0, 0.49, 0.45,1.2)

    this.loadDeco(`${DECO}/Pebles_1_A_2.glb`, 0.35, 0, 0.53, 0.1, 0.7)
  }

  private async loadDeco(url: string, scale: number, rotY: number, y: number, x: number, z: number): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync(url)
      const m = gltf.scene
      m.scale.setScalar(scale)
      m.position.set(x, y, z)
      m.rotation.y = rotY
      m.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).castShadow = true
          ;(child as THREE.Mesh).receiveShadow = true
        }
      })
      this.scene.add(m)
    } catch { /* not critical */ }
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.resize()
    this.clock.start()
    this.loop()
  }

  stop(): void {
    this.active = false
    cancelAnimationFrame(this.animId)
  }

  async setCharacter(meshUrl: string, animClips?: THREE.AnimationClip[], animMapping?: AnimMapping, animFileUrls?: string[], transform?: ModelTransform): Promise<void> {
    const myLoadId = ++this.loadId
    this.clearCharacter()

    try {
      const gltf = await this.loader.loadAsync(meshUrl)
      if (this.loadId !== myLoadId) return

      const model = gltf.scene

      model.scale.setScalar(1)
      model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(model)
      const rawHeight = box.max.y - box.min.y

      const source: ModelSource = meshUrl.includes('Characters_1') ? 'library'
        : meshUrl.includes('custom-assets') ? 'custom'
        : 'builtin'

      this.onRawHeight?.(rawHeight, source)

      const t = transform ?? computeDefaultTransform(rawHeight, source)
      const previewScale = t.scale * PREVIEW_FACTOR
      this.currentScale = previewScale

      model.scale.setScalar(previewScale)
      model.position.set(
        t.offsetX * PREVIEW_FACTOR,
        t.offsetY * PREVIEW_FACTOR + PLATFORM_Y,
        t.offsetZ * PREVIEW_FACTOR,
      )
      model.rotation.set(
        (t.rotationX * Math.PI) / 180,
        (t.rotationY * Math.PI) / 180,
        (t.rotationZ * Math.PI) / 180,
      )

      model.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).castShadow = true
          const mats = Array.isArray((child as THREE.Mesh).material)
            ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
            : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
          for (const mat of mats) {
            if (source === 'custom') {
              if (mat.transparent) {
                mat.transparent = false
                mat.alphaTest = 0.5
                mat.opacity = 1
              }
              if (mat.alphaMap) mat.alphaTest = Math.max(mat.alphaTest, 0.5)
              mat.depthWrite = true
              mat.side = THREE.FrontSide
            }
            if (source === 'custom' || source === 'builtin') {
              mat.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <dithering_fragment>',
                  `{
                    float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                    gl_FragColor.rgb = mix(vec3(luma), gl_FragColor.rgb, 1.6);
                  }
                  #include <dithering_fragment>`
                )
              }
              mat.needsUpdate = true
            }
          }
        }
      })

      if (this.loadId !== myLoadId) return

      this.currentModel = model
      this.scene.add(model)

      let clips = gltf.animations.length > 0 ? gltf.animations : (animClips ?? [])
      if (clips.length === 0 && source === 'library') {
        try {
          const animGltf = await this.loader.loadAsync(`${EXT_BASE}/Characters_1/gLTF/Animations/Animations.glb`)
          if (this.loadId !== myLoadId) { this.scene.remove(model); return }
          clips = animGltf.animations
        } catch { /* animation load failed */ }
      }
      if (clips.length === 0 && animFileUrls && animFileUrls.length > 0) {
        for (const url of animFileUrls) {
          try {
            const animGltf = await this.loader.loadAsync(url)
            if (this.loadId !== myLoadId) { this.scene.remove(model); return }
            clips = [...clips, ...animGltf.animations]
          } catch { /* anim file load failed */ }
        }
      }

      if (this.loadId !== myLoadId) { this.scene.remove(model); return }

      if (clips.length > 0) {
        this.mixer = new THREE.AnimationMixer(model)
        this.animMap.clear()

        if (animMapping && Object.keys(animMapping).length > 0) {
          const clipByName = new Map<string, THREE.AnimationClip>()
          for (const clip of clips) clipByName.set(clip.name, clip)
          for (const [slot, clipName] of Object.entries(animMapping)) {
            if (!clipName) continue
            const clip = clipByName.get(clipName)
            if (clip) this.animMap.set(slot, clip)
          }
        } else {
          for (const clip of clips) this.animMap.set(clip.name.toLowerCase(), clip)
        }

        this.buildAnimQueue()
        this.animIdx = 0
        this.animLoopTimer = 0
        this.playNextInQueue()
      }

      this.fadeInCurrent()
    } catch (err) {
      console.warn('[CharacterStage] Failed to load:', err)
    }
  }

  private buildAnimQueue(): void {
    const order = ['idle', 'wave', 'idle', 'walk', 'idle', 'typing', 'idle', 'cheer', 'idle', 'dancing', 'idle']
    this.animQueue = []
    for (const name of order) {
      if (this.findClip(name)) this.animQueue.push(name)
    }
    if (this.animQueue.length === 0 && this.animMap.size > 0) {
      this.animQueue.push(this.animMap.keys().next().value!)
    }
  }

  private playNextInQueue(): void {
    if (this.animQueue.length === 0) return
    const name = this.animQueue[this.animIdx % this.animQueue.length]
    if (name === 'idle') {
      this.playAnim(name)
      this.animLoopTimer = 0
      this.animIdx = (this.animIdx + 1) % this.animQueue.length
    } else {
      this.playAnimOnce(name, () => {
        this.animIdx = (this.animIdx + 1) % this.animQueue.length
        this.playNextInQueue()
      })
    }
  }

  private clearCharacter(): void {
    if (this.currentModel) { this.scene.remove(this.currentModel); this.currentModel = null }
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer = null }
    this.animMap.clear()
    this.currentAction = null
    this.animQueue = []
  }

  private fadeInCurrent(): void {
    if (!this.currentModel) return
    const model = this.currentModel
    const target = this.currentScale
    model.scale.setScalar(target * 0.88)
    const dur = 180
    const t0 = performance.now()
    const tick = () => {
      const p = Math.min((performance.now() - t0) / dur, 1)
      model.scale.setScalar(target * (0.88 + 0.12 * p * (2 - p)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  private findClip(...names: string[]): THREE.AnimationClip | null {
    for (const n of names) { if (this.animMap.has(n)) return this.animMap.get(n)! }
    for (const n of names) { for (const [k, c] of this.animMap) { if (k.includes(n)) return c } }
    return null
  }

  private playAnim(name: string): void {
    if (!this.mixer) return
    const clip = this.findClip(name)
    if (!clip) return
    const action = this.mixer.clipAction(clip)
    if (this.currentAction && this.currentAction !== action) {
      action.reset().play()
      this.currentAction.crossFadeTo(action, 0.3, false)
    } else { action.reset().play() }
    this.currentAction = action
  }

  private playAnimOnce(name: string, onComplete?: () => void): void {
    if (!this.mixer) { onComplete?.(); return }
    const clip = this.findClip(name)
    if (!clip) { onComplete?.(); return }
    const action = this.mixer.clipAction(clip)
    action.reset(); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play()
    if (this.currentAction && this.currentAction !== action) this.currentAction.crossFadeTo(action, 0.3, false)
    this.currentAction = action
    const h = () => { this.mixer?.removeEventListener('finished', h); onComplete?.() }
    this.mixer.addEventListener('finished', h)
  }

  resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w > 0 && h > 0) {
      this.renderer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  applyTransform(t: ModelTransform): void {
    if (!this.currentModel) return
    const previewScale = t.scale * PREVIEW_FACTOR
    this.currentScale = previewScale
    this.currentModel.scale.setScalar(previewScale)
    this.currentModel.position.set(
      t.offsetX * PREVIEW_FACTOR,
      t.offsetY * PREVIEW_FACTOR + PLATFORM_Y,
      t.offsetZ * PREVIEW_FACTOR,
    )
    this.currentModel.rotation.set(
      (t.rotationX * Math.PI) / 180,
      (t.rotationY * Math.PI) / 180,
      (t.rotationZ * Math.PI) / 180,
    )
  }

  private loop = (): void => {
    if (!this.active) return
    this.animId = requestAnimationFrame(this.loop)
    const dt = this.clock.getDelta()
    this.mixer?.update(dt)

    if (this.animQueue.length > 0) {
      this.animLoopTimer += dt
      if (this.animLoopTimer > 3.0) {
        this.animLoopTimer = 0
        this.playNextInQueue()
      }
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void { this.stop(); this.clearCharacter(); this.renderer.dispose() }
}
