// ────────────────────────────────────────────────────────────
// Engine — Three.js 3D game engine core
//
// Integrates: render loop, touch input, screen management,
// scene lifecycle, world graph, and post-processing.
// Scenes access subsystems via the `engine.*` properties.
// ────────────────────────────────────────────────────────────

import * as THREE from 'three'
import { Input } from './Input'
import { Screen } from './Screen'
import { World } from './World'
import { PostProcessManager } from '../game/visual/PostProcessing'

// ── Scene interface ──────────────────────────────────────────

export interface GameScene {
  init(): void | Promise<void>
  update(deltaTime: number): void
  destroy(): void
}

// ── Engine ───────────────────────────────────────────────────

export class Engine {
  // Three.js core
  public renderer: THREE.WebGLRenderer
  public camera: THREE.PerspectiveCamera
  public world: World

  // Subsystems
  public readonly input: Input
  public readonly screen: Screen

  private container: HTMLElement
  private clock: THREE.Timer
  private currentScene: GameScene | null = null
  private animationId: number | null = null

  public postProcess: PostProcessManager | null = null

  private _running = false
  private _paused = false
  private _tick = 0
  private _elapsedTime = 0
  private _fps = 0
  private _frameCount = 0
  private _lastFpsUpdate = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.clock = new THREE.Timer()

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1000,
    )
    this.camera.position.set(0, 5, 10)
    this.camera.lookAt(0, 0, 0)

    // World
    this.world = new World()

    // Subsystems
    this.input = new Input()
    this.screen = new Screen()
  }

  // ── Init ────────────────────────────────────────────────────
  async init(): Promise<void> {
    // Bind touch input
    this.input.bind(this.container)

    // Screen management + window resize
    this.screen.init({
      onResize: (w, h) => {
        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix()
        this.renderer.setSize(w, h)
        this.postProcess?.setSize(w, h)
      },
    })

    // Auto-pause when tab goes hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this._running && !this._paused) this.pause()
      } else {
        if (this._running && this._paused) this.play()
      }
    })
  }

    // ── Scene management ───────────────────────────────────────

  async loadScene(scene: GameScene): Promise<void> {
    if (this.currentScene) this.currentScene.destroy()
    this.currentScene = scene
    await scene.init()
  }

  // ── Lifecycle ──────────────────────────────────────────────

  start(): void {
    if (this._running) return
    this._running = true
    this._paused = false
    this.clock.update()
    this.animate()
  }

  stop(): void {
    this._running = false
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  play(): void {
    this._paused = false
    this.clock.update()
    if (this._running && this.animationId === null) this.animate()
  }

  pause(): void {
    this._paused = true
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
  }

  reset(): void {
    this._tick = 0
    this._elapsedTime = 0
    if (this.currentScene) {
      this.currentScene.destroy()
      this.world.clear()
      this.currentScene.init()
    }
  }

  // ── Render loop ────────────────────────────────────────────

  private animate = (): void => {
    if (!this._running || this._paused) return
    this.animationId = requestAnimationFrame(this.animate)

    this.clock.update()
    const deltaTime = this.clock.getDelta()
    this._elapsedTime += deltaTime
    this._tick++

    // Update subsystems
    this.input.update()

    // Update world
    this.world.update(deltaTime)

    // Update scene
    if (this.currentScene) this.currentScene.update(deltaTime)

    // Render
    if (this.postProcess) {
      this.postProcess.setScene(this.world.scene)
      this.postProcess.setCamera(this.camera)
      this.postProcess.render()
    } else {
      this.renderer.render(this.world.scene, this.camera)
    }

    // FPS counter
    this._frameCount++
    const now = performance.now()
    if (now - this._lastFpsUpdate >= 1000) {
      this._fps = this._frameCount
      this._frameCount = 0
      this._lastFpsUpdate = now
    }
  }

  // ── State queries ──────────────────────────────────────────

  get tick(): number { return this._tick }
  get elapsedTime(): number { return this._elapsedTime }
  get isRunning(): boolean { return this._running && !this._paused }
  get fps(): number { return this._fps }
  get objectCount(): number { return this.world.scene.children.length }

  // ── Utilities ──────────────────────────────────────────────

  random(): number { return Math.random() }
  randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min)) + min }
  randomFloat(min: number, max: number): number { return Math.random() * (max - min) + min }

  initPostProcess(): void {
    this.postProcess = new PostProcessManager(this.renderer, this.world.scene, this.camera)
  }

  // ── Teardown ───────────────────────────────────────────────

  destroy(): void {
    this.stop()
    this.input.destroy()
    this.screen.destroy()
    this.currentScene?.destroy()
    this.world.clear()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
  }
}
