import * as THREE from 'three'

export class CameraController {
  private camera: THREE.PerspectiveCamera
  private container: HTMLElement

  private targetLookAt = new THREE.Vector3(20, 0, 12)
  private currentLookAt = new THREE.Vector3(20, 0, 12)
  private cameraOffset = new THREE.Vector3(0, 18, 14)
  private baseOffset = new THREE.Vector3(0, 18, 14)

  private dragStartLookAt = new THREE.Vector3()
  private isDragging = false

  private autoPilotEnabled = false
  private lastInteractionTime = 0
  private autoPilotTarget: THREE.Vector3 | null = null
  private autoIdleDelay = 5000

  private followTarget: THREE.Object3D | null = null
  private lerpSpeed = 0.04

  private officeMode = false
  private officeBaseOffset = new THREE.Vector3(0, 20, 16)
  private static readonly OFFICE_LOOK_AT = new THREE.Vector3(14, 0, 12)
  private static readonly OFFICE_PAN_BOUNDS = { minX: 3, maxX: 26, minZ: 5, maxZ: 22 }

  private static readonly DRAG_SCALE = 0.06
  private static readonly AUTO_PILOT_LERP = 0.01
  private static readonly ZOOM_MIN = 0.5
  /** 拉远(拉高)上限提升至 2.2,让玩家能获得更高的俯视角(相机最高约 40 单位)。 */
  private static readonly ZOOM_MAX = 2.2
  private zoomLevel = 1.0

  /** Default town pan bounds (matches the original 40×24 map). Updated via setMapBounds(). */
  private panBounds = { minX: 5, maxX: 35, minZ: 3, maxZ: 21 }
  /** Auto-pilot patrol points, regenerated from map bounds. */
  private patrolPoints: { x: number; z: number }[] = [
    { x: 18, z: 13 },
    { x: 17, z: 5 },
    { x: 3, z: 10 },
    { x: 32, z: 9 },
    { x: 12, z: 20 },
    { x: 32, z: 15 },
    { x: 7, z: 18 },
  ]

  constructor(camera: THREE.PerspectiveCamera, container: HTMLElement) {
    this.camera = camera
    this.container = container
  }

  init(): void {
    this.camera.fov = 42
    this.camera.updateProjectionMatrix()
    this.updateCameraPosition(true)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    this.lastInteractionTime = performance.now()
  }

  /**
   * Update the town pan bounds based on the loaded TownMapConfig grid size.
   * Keeps a small margin so the camera can't look past the map edge, and
   * regenerates auto-pilot patrol points to cover the (possibly larger) map.
   */
  setMapBounds(cols: number, rows: number): void {
    const margin = 5
    this.panBounds = {
      minX: margin,
      maxX: Math.max(margin * 2, cols - margin),
      minZ: Math.max(2, margin - 2),
      maxZ: Math.max(margin, rows - 2),
    }
    // Regenerate patrol points spread across the map.
    const { minX, maxX, minZ, maxZ } = this.panBounds
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const rx = (maxX - minX) / 2
    const rz = (maxZ - minZ) / 2
    this.patrolPoints = [
      { x: cx, z: cz },
      { x: minX + rx * 0.6, z: cz },
      { x: maxX - rx * 0.6, z: cz },
      { x: cx, z: minZ + rz * 0.6 },
      { x: cx, z: maxZ - rz * 0.6 },
      { x: minX + rx * 0.3, z: minZ + rz * 0.3 },
      { x: maxX - rx * 0.3, z: maxZ - rz * 0.3 },
    ]
    // Re-clamp the current target so the camera doesn't sit outside the new bounds.
    this.clampBounds(this.targetLookAt)
    this.clampBounds(this.currentLookAt)
  }

  follow(target: THREE.Object3D | null): void {
    this.followTarget = target
    if (target) {
      this.autoPilotEnabled = false
      this.autoPilotTarget = null
      this.targetLookAt.set(target.position.x, 0, target.position.z)
    }
  }

  moveTo(target: { x: number; z: number }, immediate?: boolean): void {
    this.targetLookAt.set(target.x, 0, target.z)
    this.clampBounds(this.targetLookAt)
    if (immediate) {
      this.currentLookAt.copy(this.targetLookAt)
      this.updateCameraPosition(true)
    }
  }

  /**
   * Pan the camera target by a delta (used by WASD keyboard control).
   * Stops following the mayor (decouples camera from mayor while panning).
   */
  panBy(dx: number, dz: number): void {
    this.followTarget = null
    this.autoPilotEnabled = false
    this.autoPilotTarget = null
    this.targetLookAt.x += dx
    this.targetLookAt.z += dz
    this.clampBounds(this.targetLookAt)
    this.lastInteractionTime = performance.now()
  }

  /** Current lookAt target (for snap-back distance check). */
  getLookAt(): { x: number; z: number } {
    return { x: this.currentLookAt.x, z: this.currentLookAt.z }
  }

  /** Resume following the mayor NPC (re-bind follow target by id lookup). */
  followMayor(): void {
    // The actual follow target is set by MainScene via follow(mayor.mesh).
    // Here we just signal that the next update should re-follow; MainScene
    // calls cameraCtrl.follow(mayor.mesh) when snap-back completes.
    // To keep this self-contained, we expose a flag MainScene can check.
    this._wantsFollowMayor = true
  }

  /** Internal flag: MainScene polls this to re-bind follow target after WASD snap-back. */
  _wantsFollowMayor = false

  setAutoPilot(enabled: boolean): void {
    this.autoPilotEnabled = enabled
    if (!enabled) {
      this.autoPilotTarget = null
    }
  }

  /** Called by Input system's drag gesture */
  onDrag(phase: 'start' | 'move' | 'end', _delta: { x: number; y: number }, totalDelta: { x: number; y: number }): void {
    if (phase === 'start') {
      this.isDragging = true
      this.dragStartLookAt.copy(this.targetLookAt)
      this.followTarget = null
      this.autoPilotEnabled = false
      this.autoPilotTarget = null
      this.lastInteractionTime = performance.now()
    } else if (phase === 'move' && this.isDragging) {
      this.targetLookAt.set(
        this.dragStartLookAt.x - totalDelta.x * CameraController.DRAG_SCALE,
        0,
        this.dragStartLookAt.z - totalDelta.y * CameraController.DRAG_SCALE,
      )
      if (this.officeMode) {
        this.clampOfficeBounds(this.targetLookAt)
      } else {
        this.clampBounds(this.targetLookAt)
      }
    } else if (phase === 'end') {
      this.isDragging = false
      this.lastInteractionTime = performance.now()
    }
  }

  /**
   * Called by Input system's pinch gesture.
   *
   * 按 deltaScale(本帧两指距离 / 上一帧距离)比例缩放,而非固定步长,
   * 让大幅捏合快速缩放、微调捏合精细缩放,提升移动端灵敏度。
   * 反转方向以符合手机相册直觉:
   * deltaScale>1(两指拉开)→ zoomLevel 减小(相机拉近,画面放大);
   * deltaScale<1(两指捏合)→ zoomLevel 增大(相机拉远,画面缩小)。
   */
  onPinch(deltaScale: number): void {
    // 反转:用 1/deltaScale 作为缩放因子,clamp 在 [0.85, 1.15] 防止抖动
    const factor = Math.max(0.85, Math.min(1.15, 1 / deltaScale))
    this.applyZoom(factor)
    this.lastInteractionTime = performance.now()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.applyZoom(e.deltaY > 0 ? 1.12 : 0.88)
    this.lastInteractionTime = performance.now()
    this.followTarget = null
    this.autoPilotEnabled = false
    this.autoPilotTarget = null
  }

  private applyZoom(factor: number): void {
    this.zoomLevel = Math.max(
      CameraController.ZOOM_MIN,
      Math.min(CameraController.ZOOM_MAX, this.zoomLevel * factor),
    )
    this.cameraOffset.copy(this.baseOffset).multiplyScalar(this.zoomLevel)
  }

  update(_deltaTime: number): void {
    if (this.followTarget) {
      this.targetLookAt.set(
        this.followTarget.position.x,
        0,
        this.followTarget.position.z,
      )
      this.clampBounds(this.targetLookAt)
    } else if (this.autoPilotEnabled) {
      const elapsed = performance.now() - this.lastInteractionTime
      if (elapsed > this.autoIdleDelay) {
        if (!this.autoPilotTarget) {
          this.updateAutoPilot()
        }
        if (this.autoPilotTarget) {
          this.targetLookAt.lerp(this.autoPilotTarget, CameraController.AUTO_PILOT_LERP)
          const dist = this.targetLookAt.distanceTo(this.autoPilotTarget)
          if (dist < 0.3) {
            this.autoPilotTarget = null
          }
        }
      }
    }

    this.currentLookAt.lerp(this.targetLookAt, this.lerpSpeed)
    this.updateCameraPosition(false)
  }

  private updateAutoPilot(): void {
    const points = this.patrolPoints
    const idx = Math.floor(Math.random() * points.length)
    this.autoPilotTarget = new THREE.Vector3(points[idx].x, 0, points[idx].z)
  }

  private updateCameraPosition(immediate?: boolean): void {
    const pos = this.currentLookAt.clone().add(this.cameraOffset)
    if (immediate) {
      this.camera.position.copy(pos)
    } else {
      this.camera.position.lerp(pos, this.lerpSpeed)
    }
    this.camera.lookAt(this.currentLookAt)
  }

  enterOfficeMode(): void {
    this.officeMode = true
    this.followTarget = null
    this.autoPilotEnabled = false
    this.autoPilotTarget = null
    this.zoomLevel = 1.0
    this.targetLookAt.copy(CameraController.OFFICE_LOOK_AT)
    this.currentLookAt.copy(CameraController.OFFICE_LOOK_AT)
    const pos = CameraController.OFFICE_LOOK_AT.clone().add(this.officeBaseOffset)
    this.camera.position.copy(pos)
    this.camera.lookAt(this.currentLookAt)
  }

  /**
   * Issue 2: enter home scene camera mode. Looks at z=10 (center of the
   * room) so NPCs walking in from the door (z=25) toward z=10 appear in the
   * upper-center of the screen, visible above the chat input bar.
   */
  enterHomeMode(): void {
    this.officeMode = true // reuse office pan/clamp logic
    this.followTarget = null
    this.autoPilotEnabled = false
    this.autoPilotTarget = null
    this.zoomLevel = 1.0
    this.targetLookAt.set(15, 0, 10)
    this.currentLookAt.set(15, 0, 10)
    const pos = this.currentLookAt.clone().add(this.officeBaseOffset)
    this.camera.position.copy(pos)
    this.camera.lookAt(this.currentLookAt)
  }

  leaveOfficeMode(): void {
    this.officeMode = false
  }

  updateOfficePan(_deltaTime: number): void {
    // 室内场景也支持跟随镇长(摇杆/键盘移动时 cameraCtrl.follow(mayor.mesh) 设置 followTarget)
    if (this.followTarget) {
      this.targetLookAt.set(
        this.followTarget.position.x,
        0,
        this.followTarget.position.z,
      )
      // 室内场景不 clamp bounds(房间范围小,clamp 会把镜头锁死)
    }
    this.currentLookAt.lerp(this.targetLookAt, this.lerpSpeed)
    const offset = this.officeBaseOffset.clone().multiplyScalar(this.zoomLevel)
    const pos = this.currentLookAt.clone().add(offset)
    this.camera.position.lerp(pos, this.lerpSpeed)
    this.camera.lookAt(this.currentLookAt)
  }

  animateTo(target: { x: number; z: number }, durationMs = 2000): Promise<void> {
    this.followTarget = null
    this.autoPilotEnabled = false
    this.autoPilotTarget = null
    const start = this.targetLookAt.clone()
    const end = new THREE.Vector3(target.x, 0, target.z)
    this.clampBounds(end)
    const startTime = performance.now()

    return new Promise(resolve => {
      const tick = () => {
        const t = Math.min((performance.now() - startTime) / durationMs, 1)
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        this.targetLookAt.lerpVectors(start, end, ease)
        if (t < 1) {
          requestAnimationFrame(tick)
        } else {
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
  }

  private clampBounds(p: THREE.Vector3): THREE.Vector3 {
    p.x = Math.max(this.panBounds.minX, Math.min(this.panBounds.maxX, p.x))
    p.z = Math.max(this.panBounds.minZ, Math.min(this.panBounds.maxZ, p.z))
    return p
  }

  private clampOfficeBounds(p: THREE.Vector3): THREE.Vector3 {
    const b = CameraController.OFFICE_PAN_BOUNDS
    p.x = Math.max(b.minX, Math.min(b.maxX, p.x))
    p.z = Math.max(b.minZ, Math.min(b.maxZ, p.z))
    return p
  }

  destroy(): void {
    this.container.removeEventListener('wheel', this.onWheel)
    this.followTarget = null
    this.autoPilotTarget = null
  }
}
