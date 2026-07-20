// ────────────────────────────────────────────────────────────
// Input — Touch input & gesture recognition
//
// Unified pointer tracking with built-in gesture detection:
// tap, double-tap, long-press, swipe, pinch, rotate, drag.
// ────────────────────────────────────────────────────────────

import type { Vector2 } from '../utils/Math'
import { magnitude2D, subtract2D, angle2D, radToDeg } from '../utils/Math'

// ── Touch types ─────────────────────────────────────────────

/** Normalized coordinates (0–1) */
export interface NormalizedVector2 {
  x: number
  y: number
}

/** Single pointer */
export interface TouchPoint {
  id: number
  x: number
  y: number
  screenNormalized: NormalizedVector2
  pressure: number
  radius: number
  isNew: boolean
  startPos: Vector2
  startTime: number
}

/** Touch state snapshot */
export interface TouchState {
  pointers: TouchPoint[]
  count: number
  isDown: boolean
  primary: TouchPoint | null
}

// ── Gesture types ───────────────────────────────────────────

export type GestureType = 'tap' | 'doubletap' | 'longpress' | 'swipe' | 'pinch' | 'rotate' | 'drag'
export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

export interface GestureEvent { type: GestureType; timestamp: number; center: Vector2 }
export interface TapGesture extends GestureEvent { type: 'tap'; position: Vector2 }
export interface DoubleTapGesture extends GestureEvent { type: 'doubletap'; position: Vector2 }
export interface LongPressGesture extends GestureEvent { type: 'longpress'; position: Vector2; duration: number }
export interface SwipeGesture extends GestureEvent {
  type: 'swipe'; direction: SwipeDirection
  startPos: Vector2; endPos: Vector2
  distance: number; velocity: number; duration: number
}
export interface PinchGesture extends GestureEvent {
  type: 'pinch'; scale: number; deltaScale: number; distance: number
}
export interface RotateGesture extends GestureEvent {
  type: 'rotate'; rotation: number; deltaRotation: number
}
export type DragPhase = 'start' | 'move' | 'end'
export interface DragGesture extends GestureEvent {
  type: 'drag'; phase: DragPhase
  position: Vector2; delta: Vector2; totalDelta: Vector2
  clientX: number; clientY: number
}

export type Gesture = TapGesture | DoubleTapGesture | LongPressGesture | SwipeGesture | PinchGesture | RotateGesture | DragGesture
export type GestureCallback<T extends Gesture = Gesture> = (gesture: T) => void

// ── Gesture config ──────────────────────────────────────────

export interface GestureConfig {
  tapMaxDuration: number
  tapMaxDistance: number
  doubleTapMaxInterval: number
  longPressMinDuration: number
  swipeMinDistance: number
  swipeMinVelocity: number
  pinchMinDistance: number
  rotateMinAngle: number
  dragThreshold: number
}

const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  tapMaxDuration: 300,
  tapMaxDistance: 20,
  doubleTapMaxInterval: 300,
  longPressMinDuration: 500,
  swipeMinDistance: 50,
  swipeMinVelocity: 200,
  pinchMinDistance: 3,
  rotateMinAngle: 5,
  dragThreshold: 8,
}

// ── Input class ─────────────────────────────────────────────
export class Input {
  private _pointers: Map<number, TouchPoint> = new Map()
  private lastFramePointers: Set<number> = new Set()
  private _pressureSupported = false
  private element: HTMLElement | null = null

  // Gesture state
  private gestureConfig: GestureConfig
  private lastTapTime = 0
  private lastTapPosition: Vector2 = { x: 0, y: 0 }
  private longPressTimer: number | null = null
  private activePinch: {
    startDistance: number; lastDistance: number
    startAngle: number; lastAngle: number
    center: Vector2; pointer1Id: number; pointer2Id: number
  } | null = null

  private activeDrag: {
    pointerId: number; startPos: Vector2; lastPos: Vector2
  } | null = null

  // Event listeners
  private listeners: Map<string, Set<GestureCallback>> = new Map()

  // ── Touch state API ──────────────────────────────────────

  get state(): TouchState {
    const pointers = Array.from(this._pointers.values())
    return { pointers, count: pointers.length, isDown: pointers.length > 0, primary: pointers[0] ?? null }
  }

  get pressureSupported(): boolean { return this._pressureSupported }
  get count(): number { return this._pointers.size }
  get isDown(): boolean { return this._pointers.size > 0 }

  get primary(): TouchPoint | null {
    const first = this._pointers.values().next()
    return first.done ? null : first.value
  }

  constructor(gestureConfig: Partial<GestureConfig> = {}) {
    this.gestureConfig = { ...DEFAULT_GESTURE_CONFIG, ...gestureConfig }
  }

  // ── Bind / unbind ────────────────────────────────────────

  bind(element: HTMLElement): void {
    this.element = element
    element.addEventListener('pointerdown', this.handlePointerDown)
    element.addEventListener('pointermove', this.handlePointerMove)
    element.addEventListener('pointerup', this.handlePointerUp)
    element.addEventListener('pointercancel', this.handlePointerUp)
    element.addEventListener('pointerleave', this.handlePointerUp)
    element.style.touchAction = 'none'
    element.style.userSelect = 'none'
    ;(element.style as any).webkitUserSelect = 'none'
    ;(element.style as any).webkitTouchCallout = 'none'
  }

  unbind(): void {
    if (!this.element) return
    this.element.removeEventListener('pointerdown', this.handlePointerDown)
    this.element.removeEventListener('pointermove', this.handlePointerMove)
    this.element.removeEventListener('pointerup', this.handlePointerUp)
    this.element.removeEventListener('pointercancel', this.handlePointerUp)
    this.element.removeEventListener('pointerleave', this.handlePointerUp)
    this.element = null
    this._pointers.clear()
  }

  // ── Frame update ─────────────────────────────────────────

  update(): void {
    for (const pointer of this._pointers.values()) pointer.isNew = false
    this.lastFramePointers = new Set(this._pointers.keys())
  }

  // ── Pointer queries ──────────────────────────────────────

  getPointer(id: number): TouchPoint | undefined { return this._pointers.get(id) }
  getPointers(): TouchPoint[] { return Array.from(this._pointers.values()) }

  getDistance(id1: number, id2: number): number {
    const p1 = this._pointers.get(id1), p2 = this._pointers.get(id2)
    if (!p1 || !p2) return 0
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
  }

  getCenterAll(): Vector2 {
    if (this._pointers.size === 0) return { x: 0, y: 0 }
    let sx = 0, sy = 0
    for (const p of this._pointers.values()) { sx += p.x; sy += p.y }
    return { x: sx / this._pointers.size, y: sy / this._pointers.size }
  }

  // ── Gesture event API ────────────────────────────────────

  on<K extends Gesture['type']>(type: K, callback: GestureCallback<Extract<Gesture, { type: K }>>): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(callback as GestureCallback)
  }

  onGesture(callback: GestureCallback): void {
    if (!this.listeners.has('*')) this.listeners.set('*', new Set())
    this.listeners.get('*')!.add(callback)
  }

  off<K extends Gesture['type']>(type: K, callback: GestureCallback<Extract<Gesture, { type: K }>>): void {
    this.listeners.get(type)?.delete(callback as GestureCallback)
  }

  removeAllListeners(): void { this.listeners.clear() }

  // ── Pointer event handlers ───────────────────────────────

  private handlePointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return
    const rect = this.element!.getBoundingClientRect()
    const now = performance.now()

    if (e.pressure > 0 && e.pressure < 1) this._pressureSupported = true

    const localPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const screenNormalized = this.toNormalized(localPos, rect)

    const point: TouchPoint = {
      id: e.pointerId,
      x: localPos.x, y: localPos.y,
      screenNormalized,
      pressure: e.pressure || 1,
      radius: Math.max(e.width || 0, e.height || 0) / 2 || 10,
      isNew: !this.lastFramePointers.has(e.pointerId),
      startPos: { ...localPos },
      startTime: now,
    }

    this._pointers.set(e.pointerId, point)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

    // Gesture: touch start
    this.onTouchStart(point)
  }

  private handlePointerMove = (e: PointerEvent): void => {
    const point = this._pointers.get(e.pointerId)
    if (!point) return
    const rect = this.element!.getBoundingClientRect()
    const localPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    point.x = localPos.x
    point.y = localPos.y
    point.screenNormalized = this.toNormalized(localPos, rect)
    point.pressure = e.pressure || 1
    point.radius = Math.max(e.width || 0, e.height || 0) / 2 || 10

    this.onTouchMove(point)
  }

  private handlePointerUp = (e: PointerEvent): void => {
    const point = this._pointers.get(e.pointerId)
    if (!point) return

    if (this.element) {
      const rect = this.element.getBoundingClientRect()
      point.x = e.clientX - rect.left
      point.y = e.clientY - rect.top
      point.screenNormalized = this.toNormalized({ x: point.x, y: point.y }, rect)
    }

    this._pointers.delete(e.pointerId)
    this.onTouchEnd(point)
  }

  // ── Gesture recognition ──────────────────────────────────

  private onTouchStart(point: TouchPoint): void {
    this.clearLongPressTimer()
    const pointers = this.getPointers()
    if (pointers.length === 1) {
      this.startLongPressTimer(point)
    } else if (pointers.length === 2) {
      this.startPinchRotate(pointers[0], pointers[1])
    }
  }

  private onTouchMove(point: TouchPoint): void {
    const pointers = this.getPointers()
    if (pointers.length === 1) {
      const distance = magnitude2D(subtract2D({ x: point.x, y: point.y }, point.startPos))
      if (distance > this.gestureConfig.tapMaxDistance) this.clearLongPressTimer()

      if (!this.activeDrag && distance >= this.gestureConfig.dragThreshold) {
        this.activeDrag = {
          pointerId: point.id,
          startPos: { ...point.startPos },
          lastPos: { ...point.startPos },
        }
        this.clearLongPressTimer()
        const now = performance.now()
        const pos = { x: point.x, y: point.y }
        this.emitGesture({
          type: 'drag', phase: 'start', position: pos,
          delta: { x: 0, y: 0 },
          totalDelta: subtract2D(pos, this.activeDrag.startPos),
          clientX: point.x, clientY: point.y,
          center: pos, timestamp: now,
        })
        this.activeDrag.lastPos = pos
      } else if (this.activeDrag && this.activeDrag.pointerId === point.id) {
        const now = performance.now()
        const pos = { x: point.x, y: point.y }
        this.emitGesture({
          type: 'drag', phase: 'move', position: pos,
          delta: subtract2D(pos, this.activeDrag.lastPos),
          totalDelta: subtract2D(pos, this.activeDrag.startPos),
          clientX: point.x, clientY: point.y,
          center: pos, timestamp: now,
        })
        this.activeDrag.lastPos = pos
      }
    } else if (pointers.length === 2 && this.activePinch) {
      this.updatePinchRotate(pointers[0], pointers[1])
    }
  }

  private onTouchEnd(point: TouchPoint): void {
    this.clearLongPressTimer()
    const pointers = this.getPointers()
    const now = performance.now()
    const duration = now - point.startTime
    const delta = subtract2D({ x: point.x, y: point.y }, point.startPos)
    const distance = magnitude2D(delta)

    if (this.activePinch && (point.id === this.activePinch.pointer1Id || point.id === this.activePinch.pointer2Id)) {
      this.activePinch = null
    }

    if (this.activeDrag && this.activeDrag.pointerId === point.id) {
      const pos = { x: point.x, y: point.y }
      this.emitGesture({
        type: 'drag', phase: 'end', position: pos,
        delta: subtract2D(pos, this.activeDrag.lastPos),
        totalDelta: subtract2D(pos, this.activeDrag.startPos),
        clientX: point.x, clientY: point.y,
        center: pos, timestamp: now,
      })
      this.activeDrag = null
      return
    }

    if (pointers.length === 0) {
      if (distance >= this.gestureConfig.swipeMinDistance) {
        const velocity = distance / (duration / 1000)
        if (velocity >= this.gestureConfig.swipeMinVelocity) {
          this.emitGesture({
            type: 'swipe', direction: this.getSwipeDirection(delta),
            startPos: point.startPos, endPos: { x: point.x, y: point.y },
            distance, velocity, duration,
            center: { x: point.x, y: point.y }, timestamp: now,
          })
          return
        }
      }

      if (duration <= this.gestureConfig.tapMaxDuration && distance <= this.gestureConfig.tapMaxDistance) {
        const position = { x: point.x, y: point.y }

        if (now - this.lastTapTime <= this.gestureConfig.doubleTapMaxInterval) {
          const tapDist = magnitude2D(subtract2D(position, this.lastTapPosition))
          if (tapDist <= this.gestureConfig.tapMaxDistance * 2) {
            this.emitGesture({ type: 'doubletap', position, center: position, timestamp: now })
            this.lastTapTime = 0
            return
          }
        }

        this.emitGesture({ type: 'tap', position, center: position, timestamp: now })
        this.lastTapTime = now
        this.lastTapPosition = position
      }
    }
  }

  // ── Gesture helpers ──────────────────────────────────────

  private startLongPressTimer(point: TouchPoint): void {
    this.longPressTimer = window.setTimeout(() => {
      const now = performance.now()
      this.emitGesture({
        type: 'longpress', position: { x: point.x, y: point.y },
        duration: now - point.startTime,
        center: { x: point.x, y: point.y }, timestamp: now,
      })
      this.longPressTimer = null
    }, this.gestureConfig.longPressMinDuration)
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null }
  }

  private startPinchRotate(p1: TouchPoint, p2: TouchPoint): void {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    const angle = radToDeg(Math.atan2(dy, dx))
    this.activePinch = {
      startDistance: distance, lastDistance: distance,
      startAngle: angle, lastAngle: angle,
      center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      pointer1Id: p1.id, pointer2Id: p2.id,
    }
  }

  private updatePinchRotate(p1: TouchPoint, p2: TouchPoint): void {
    if (!this.activePinch) return
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    const angle = radToDeg(Math.atan2(dy, dx))
    const now = performance.now()
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    if (Math.abs(distance - this.activePinch.lastDistance) >= this.gestureConfig.pinchMinDistance) {
      this.emitGesture({
        type: 'pinch',
        scale: distance / this.activePinch.startDistance,
        deltaScale: distance / this.activePinch.lastDistance,
        distance, center, timestamp: now,
      })
    }

    let angleDelta = angle - this.activePinch.lastAngle
    if (angleDelta > 180) angleDelta -= 360
    if (angleDelta < -180) angleDelta += 360
    if (Math.abs(angleDelta) >= this.gestureConfig.rotateMinAngle) {
      this.emitGesture({
        type: 'rotate',
        rotation: angle - this.activePinch.startAngle,
        deltaRotation: angleDelta,
        center, timestamp: now,
      })
    }

    this.activePinch.lastDistance = distance
    this.activePinch.lastAngle = angle
    this.activePinch.center = center
  }

  private getSwipeDirection(delta: Vector2): SwipeDirection {
    const a = radToDeg(angle2D(delta))
    if (a >= -45 && a < 45) return 'right'
    if (a >= 45 && a < 135) return 'down'
    if (a >= -135 && a < -45) return 'up'
    return 'left'
  }

  private emitGesture(gesture: Gesture): void {
    this.listeners.get(gesture.type)?.forEach(cb => cb(gesture))
    this.listeners.get('*')?.forEach(cb => cb(gesture))
  }

  private toNormalized(pos: Vector2, rect: DOMRect): NormalizedVector2 {
    return {
      x: Math.max(0, Math.min(1, rect.width > 0 ? pos.x / rect.width : 0)),
      y: Math.max(0, Math.min(1, rect.height > 0 ? pos.y / rect.height : 0)),
    }
  }

  // ── Teardown ────────────────────────────────────────────

  destroy(): void {
    this.unbind()
    this.clearLongPressTimer()
    this.removeAllListeners()
    this._pointers.clear()
    this.activePinch = null
    this.activeDrag = null
  }
}
