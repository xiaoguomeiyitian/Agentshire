import { initLocale, t } from '../i18n'
initLocale()

import '../styles/editor.css'
import * as THREE from 'three'
import type { TownMapConfig } from './TownMapConfig'
import { EditorAssetLoader } from './EditorAssetLoader'
import { PreviewSceneBuilder } from './PreviewSceneBuilder'
import { PreviewPlayerController } from './PreviewPlayerController'
import { PreviewVehicleManager } from './PreviewVehicleManager'
import { PreviewHUD } from './PreviewHUD'
import { AssetLoader } from '../game/visual/AssetLoader'
import { CameraController } from '../game/visual/CameraController'
import { GameClock } from '../game/GameClock'
import { TimeOfDayLighting } from '../game/visual/TimeOfDayLighting'
import { WeatherSystem } from '../game/WeatherSystem'
import { PostProcessManager } from '../game/visual/PostProcessing'
import { Effects } from '../game/visual/Effects'
import { VFXSystem } from '../game/visual/VFXSystem'
import { NPC } from '../npc/NPC'
import { getAudioSystem } from '../audio/AudioSystem'
import { AmbientSoundManager } from '../audio/AmbientSoundManager'
import { BGMManager } from '../audio/BGMManager'
import { detectProfile } from '../engine/Performance'
import { CustomAssetStore } from './CustomAssetStore'

const DRAFT_KEY = 'agentshire_map_draft'

async function boot() {
  applyEditorLocale()

  const container = document.getElementById('preview-container')!
  const loadingEl = document.getElementById('preview-loading')!
  const errorEl = document.getElementById('preview-error')!
  const errorMsg = document.getElementById('preview-error-msg')!

  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) throw new Error('没有找到地图数据，请先在编辑器中保存')
    const config = JSON.parse(raw) as TownMapConfig

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(renderer.domElement)

    // Scene + Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 200)

    // Handle resize
    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
      postProcess?.setSize(container.clientWidth, container.clientHeight)
    })

    // Asset loaders
    const editorAssets = new EditorAssetLoader()
    const customStore = new CustomAssetStore()
    await customStore.init()

    const gameAssets = new AssetLoader()
    await gameAssets.preload(['characters', 'props'])

    // Build scene from map config
    const sceneBuilder = new PreviewSceneBuilder(scene, editorAssets)
    const lightingRefs = await sceneBuilder.build(config)

    // Post-processing
    let postProcess: PostProcessManager | null = null
    try { postProcess = new PostProcessManager(renderer, scene, camera) } catch { /* not critical */ }

    // Game clock
    const gameClock = new GameClock({ startHour: 10 })

    // Time-of-day lighting
    const todLighting = new TimeOfDayLighting(scene, lightingRefs as any, postProcess)

    // Weather system
    const weatherSystem = new WeatherSystem(scene, camera, todLighting, postProcess, detectProfile())

    // Effects + VFX
    const effects = new Effects(scene)
    const vfx = new VFXSystem(scene, effects)
    vfx.setCamera(camera)

    // Camera controller
    const cameraCtrl = new CameraController(camera, container)
    cameraCtrl.init()

    // Player NPC
    NPC.setAssetLoader(gameAssets)
    const centerX = config.grid.cols / 2
    const centerZ = config.grid.rows / 2
    const playerNpc = new NPC({
      id: 'preview-player',
      name: '镇长',
      color: 0x4488CC,
      role: 'general',
      spawn: { x: centerX, y: 0, z: centerZ },
      characterKey: 'char-male-c',
    })
    scene.add(playerNpc.mesh)
    cameraCtrl.follow(playerNpc.mesh)
    cameraCtrl.moveTo({ x: centerX, z: centerZ }, true)

    // Player controller
    const playerController = new PreviewPlayerController(container)
    playerController.setTarget(playerNpc as any)
    playerController.setCamera(camera)
    playerController.start()

    // Vehicles
    const animatedProps = config.props.filter(p => p.animated)
    console.log('[Preview] animated props:', JSON.stringify(animatedProps.map(p => ({
      modelKey: p.modelKey, rotY: p.rotationY, fixRotY: p.fixRotationY,
      route: p.vehicleRoute,
    })), null, 2))
    const vehicleManager = new PreviewVehicleManager(scene, editorAssets)
    await vehicleManager.buildFromConfig(config)

    // Audio
    const ambientSound = new AmbientSoundManager()
    const bgm = new BGMManager()
    const audio = getAudioSystem()
    await audio.preload()
    const actx = audio.getAudioContext()
    const sfxGain = audio.getSfxGain()
    if (actx && sfxGain) {
      ambientSound.init(actx, sfxGain)
      bgm.init(actx, sfxGain).catch(() => {})
    }

    // HUD
    const hud = new PreviewHUD(container, {
      onTimeChange: (h) => gameClock.setTime(h),
      onWeatherChange: (type) => weatherSystem.forceWeather(type as any),
      onSpeedChange: (mul) => gameClock.setSpeed(mul * 60_000),
      onExit: () => window.close(),
    })

    // ESC to close
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close()
    })

    // Drag + Pinch for camera
    let dragPhase: 'idle' | 'dragging' = 'idle'
    let dragLastX = 0, dragLastY = 0
    container.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        dragPhase = 'dragging'
        dragLastX = e.clientX
        dragLastY = e.clientY
        container.setPointerCapture(e.pointerId)
      }
    })
    container.addEventListener('pointermove', (e) => {
      if (dragPhase === 'dragging') {
        const dx = e.clientX - dragLastX
        const dy = e.clientY - dragLastY
        cameraCtrl.onDrag('move', { x: dx, y: dy }, { x: 0, y: 0 })
        dragLastX = e.clientX
        dragLastY = e.clientY
      }
    })
    container.addEventListener('pointerup', () => { dragPhase = 'idle' })
    container.addEventListener('wheel', (e) => {
      e.preventDefault()
      cameraCtrl.onPinch(e.deltaY > 0 ? -0.05 : 0.05)
    }, { passive: false })

    // Hide loading
    loadingEl.style.display = 'none'

    // Render loop
    const clock = new THREE.Timer()
    function animate() {
      requestAnimationFrame(animate)
      clock.update()
      const dt = Math.min(clock.getDelta(), 0.1)

      gameClock.update(dt)
      todLighting.update(gameClock)
      weatherSystem.update(dt, gameClock)

      const hour = gameClock.getGameHour()
      vehicleManager.update(hour, dt)

      playerController.update(dt)
      playerNpc.update(dt)
      cameraCtrl.update(dt)
      vfx.update(dt)

      const clockState = gameClock.getState()
      if (clockState) {
        ambientSound.setEnabled(true)
        ambientSound.update(dt, weatherSystem.getDisplayWeather() ?? 'clear', clockState.period)
        bgm.update(dt, weatherSystem.getDisplayWeather() ?? 'clear', clockState.period, 'town')
      }

      if (playerController.isWalking) {
        getAudioSystem().play('footstep')
      }

      hud.updateTimeSlider(hour)

      if (postProcess) {
        postProcess.render()
      } else {
        renderer.render(scene, camera)
      }
    }
    animate()

  } catch (err: any) {
    loadingEl.style.display = 'none'
    errorEl.style.display = 'flex'
    errorMsg.textContent = err?.message ?? '未知错误'
    console.error('[Preview]', err)
  }
}

boot()

function applyEditorLocale(): void {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!
    const translated = t(key)
    if (translated !== key) el.textContent = translated
  })
  document.querySelectorAll('[data-i18n-tip]').forEach(el => {
    const key = el.getAttribute('data-i18n-tip')!
    const translated = t(key)
    if (translated !== key) el.setAttribute('data-tip', translated)
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!
    const translated = t(key)
    if (translated !== key) el.setAttribute('title', translated)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')!
    const translated = t(key)
    if (translated !== key) (el as HTMLInputElement).placeholder = translated
  })
}
