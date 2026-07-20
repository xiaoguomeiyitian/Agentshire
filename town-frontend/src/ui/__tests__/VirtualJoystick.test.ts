// @desc Tests for VirtualJoystick: dynamic joystick output normalization & clamp
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Minimal DOM mock ───────────────────────────────────
// VirtualJoystick 依赖 document.createElement、document.body.appendChild、
// element.addEventListener、window.addEventListener、PointerEvent。
// 用最小 mock 覆盖,不引入 jsdom 依赖(对齐项目现有测试风格)。

interface MockEl {
  tagName: string
  style: Record<string, string>
  children: MockEl[]
  _listeners: Record<string, ((e: any) => void)[]>
  appendChild(child: MockEl): void
  remove(): void
  addEventListener(type: string, cb: (e: any) => void): void
  removeEventListener(type: string, cb: (e: any) => void): void
  setAttribute(): void
}

function createMockEl(tag = 'div'): MockEl {
  const el: MockEl = {
    tagName: tag,
    style: {},
    children: [],
    _listeners: {},
    appendChild(child: MockEl) { this.children.push(child) },
    remove() { /* no-op */ },
    addEventListener(type, cb) {
      (this._listeners[type] ??= []).push(cb)
    },
    removeEventListener(type, cb) {
      this._listeners[type] = (this._listeners[type] ?? []).filter(l => l !== cb)
    },
    setAttribute() { /* no-op */ },
  }
  return el
}

function dispatch(el: MockEl, type: string, payload: any): void {
  for (const cb of el._listeners[type] ?? []) cb(payload)
}

const body = createMockEl('body')
const windowListeners: Record<string, ((e: any) => void)[]> = {}

vi.stubGlobal('document', {
  body,
  createElement: createMockEl,
  querySelector: () => null,
})
vi.stubGlobal('window', {
  addEventListener: (type: string, cb: (e: any) => void) => {
    (windowListeners[type] ??= []).push(cb)
  },
  removeEventListener: (type: string, cb: (e: any) => void) => {
    windowListeners[type] = (windowListeners[type] ?? []).filter(l => l !== cb)
  },
})
vi.stubGlobal('PointerEvent', class PointerEvent {
  clientX: number; clientY: number; pointerId: number
  constructor(_type: string, init: any = {}) {
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
    this.pointerId = init.pointerId ?? 0
  }
  preventDefault() { /* no-op */ }
})

const { VirtualJoystick } = await import('../VirtualJoystick')

function fireWindow(type: string, payload: any): void {
  for (const cb of windowListeners[type] ?? []) cb(payload)
}

describe('VirtualJoystick', () => {
  let container: MockEl
  let joystick: any

  beforeEach(() => {
    container = createMockEl('div')
    for (const k of Object.keys(windowListeners)) delete windowListeners[k]
    joystick = new VirtualJoystick(container as unknown as HTMLElement)
  })

  afterEach(() => {
    joystick.destroy()
  })

  it('initial state is inactive with zero output', () => {
    expect(joystick.active).toBe(false)
    expect(joystick.state.magnitude).toBe(0)
    expect(joystick.state.horizontal).toBe(0)
    expect(joystick.state.vertical).toBe(0)
  })

  it('pointerdown activates joystick and emits active state', () => {
    const listener = vi.fn()
    joystick.on(listener)
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 1 }))
    expect(joystick.active).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].active).toBe(true)
    expect(listener.mock.calls[0][0].magnitude).toBe(0)
  })

  it('pointermove within radius emits normalized output (right = +horizontal)', () => {
    const listener = vi.fn()
    joystick.on(listener)
    const startX = 100, startY = 200
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 2 }))
    listener.mockClear()
    fireWindow('pointermove', new PointerEvent('pointermove', { clientX: startX + 45, clientY: startY, pointerId: 2 }))
    const s = joystick.state
    expect(s.active).toBe(true)
    expect(s.magnitude).toBeCloseTo(0.5, 2)
    expect(s.horizontal).toBeCloseTo(0.5, 2)
    expect(s.vertical).toBeCloseTo(0, 2)
  })

  it('pointermove up emits positive vertical (screen y down → world up)', () => {
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 3 }))
    fireWindow('pointermove', new PointerEvent('pointermove', { clientX: 100, clientY: 200 - 45, pointerId: 3 }))
    const s = joystick.state
    expect(s.vertical).toBeCloseTo(0.5, 2)
    expect(s.horizontal).toBeCloseTo(0, 2)
  })

  it('pointermove beyond radius clamps magnitude to 1', () => {
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 4 }))
    fireWindow('pointermove', new PointerEvent('pointermove', { clientX: 100 + 500, clientY: 200, pointerId: 4 }))
    const s = joystick.state
    expect(s.magnitude).toBeLessThanOrEqual(1)
    expect(s.magnitude).toBeCloseTo(1, 2)
    expect(s.horizontal).toBeCloseTo(1, 2)
  })

  it('pointerup deactivates joystick and resets output to zero', () => {
    const listener = vi.fn()
    joystick.on(listener)
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 5 }))
    fireWindow('pointermove', new PointerEvent('pointermove', { clientX: 145, clientY: 200, pointerId: 5 }))
    listener.mockClear()
    fireWindow('pointerup', new PointerEvent('pointerup', { clientX: 145, clientY: 200, pointerId: 5 }))
    expect(joystick.active).toBe(false)
    expect(joystick.state.magnitude).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].active).toBe(false)
  })

  it('pointercancel also deactivates joystick', () => {
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 6 }))
    expect(joystick.active).toBe(true)
    fireWindow('pointercancel', new PointerEvent('pointercancel', { clientX: 100, clientY: 200, pointerId: 6 }))
    expect(joystick.active).toBe(false)
  })

  it('ignores second pointer while first is active', () => {
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 7 }))
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 300, clientY: 400, pointerId: 8 }))
    fireWindow('pointermove', new PointerEvent('pointermove', { clientX: 145, clientY: 200, pointerId: 7 }))
    expect(joystick.state.magnitude).toBeCloseTo(0.5, 2)
  })

  it('off() removes listener', () => {
    const listener = vi.fn()
    joystick.on(listener)
    joystick.off(listener)
    dispatch(container, 'pointerdown', new PointerEvent('pointerdown', { clientX: 100, clientY: 200, pointerId: 9 }))
    expect(listener).not.toHaveBeenCalled()
  })
})
