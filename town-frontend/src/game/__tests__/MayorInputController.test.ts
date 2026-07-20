// @desc Tests for MayorInputController: keyboard/joystick input → mayor movement
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as THREE from 'three'

// ── Minimal window mock for keyboard events ───────────
const windowListeners: Record<string, ((e: any) => void)[]> = {}
vi.stubGlobal('window', {
  addEventListener: (type: string, cb: (e: any) => void) => {
    (windowListeners[type] ??= []).push(cb)
  },
  removeEventListener: (type: string, cb: (e: any) => void) => {
    windowListeners[type] = (windowListeners[type] ?? []).filter(l => l !== cb)
  },
})
vi.stubGlobal('KeyboardEvent', class KeyboardEvent {
  key: string
  target: any
  constructor(type: string, init: any = {}) {
    this.key = init.key ?? ''
    this.target = init.target ?? null
  }
})
// MayorInputController.onKeyDown 用 instanceof 检查输入框,在 node 环境需 stub。
vi.stubGlobal('HTMLInputElement', class HTMLInputElement {})
vi.stubGlobal('HTMLTextAreaElement', class HTMLTextAreaElement {})

const { MayorInputController } = await import('../MayorInputController')
import type { MayorInputControllerDeps } from '../MayorInputController'

function fireKey(key: string): void {
  for (const cb of windowListeners['keydown'] ?? []) cb(new KeyboardEvent('keydown', { key }))
}
function releaseKey(key: string): void {
  for (const cb of windowListeners['keyup'] ?? []) cb(new KeyboardEvent('keyup', { key }))
}

// ── Mocks ──────────────────────────────────────────────

function createMockNPC(): any {
  const mesh = new THREE.Group()
  mesh.position.set(10, 0, 10)
  return {
    mesh,
    transitionTo: vi.fn(),
    stopMoving: vi.fn(),
    getPosition: () => mesh.position.clone(),
  }
}

function createMockDeps(overrides: Partial<MayorInputControllerDeps> = {}): MayorInputControllerDeps {
  const mayor = createMockNPC()
  const steward = createMockNPC()
  return {
    getMayor: () => mayor,
    getSteward: () => steward,
    cameraCtrl: { follow: vi.fn() } as any,
    citizenChat: { onPlayerMoveInterrupt: vi.fn() } as any,
    followBehavior: {
      setTarget: vi.fn(),
      isActive: () => false,
      start: vi.fn(),
    } as any,
    getCrowd: () => null,
    joystick: null,
    setPlayerMoveEnabled: vi.fn(),
    isInputEnabled: () => true,
    onDoorProximity: vi.fn(() => false),
    ...overrides,
  }
}

describe('MayorInputController', () => {
  let deps: MayorInputControllerDeps
  let controller: any

  beforeEach(() => {
    for (const k of Object.keys(windowListeners)) delete windowListeners[k]
    deps = createMockDeps()
    controller = new MayorInputController(deps)
    controller.start()
  })

  afterEach(() => {
    controller.destroy()
  })

  it('no input → mayor stays idle, no movement', () => {
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.transitionTo).not.toHaveBeenCalledWith('walking')
    expect(deps.setPlayerMoveEnabled).not.toHaveBeenCalledWith(false)
    expect(mayor.mesh.position.x).toBe(10)
    expect(mayor.mesh.position.z).toBe(10)
  })

  it('WASD W key moves mayor forward (-z direction)', () => {
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.z).toBeLessThan(10)
    expect(mayor.mesh.position.x).toBe(10)
    expect(mayor.transitionTo).toHaveBeenCalledWith('walking')
    expect(deps.setPlayerMoveEnabled).toHaveBeenCalledWith(false)
    expect(deps.citizenChat.onPlayerMoveInterrupt).toHaveBeenCalled()
    expect(deps.cameraCtrl.follow).toHaveBeenCalled()
  })

  it('D key moves mayor right (+x direction)', () => {
    fireKey('d')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.x).toBeGreaterThan(10)
    expect(mayor.mesh.position.z).toBe(10)
  })

  it('key release returns mayor to idle and re-enables click movement', () => {
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    mayor.transitionTo.mockClear()
    ;(deps.setPlayerMoveEnabled as any).mockClear()

    releaseKey('w')
    controller.update(0.016)
    expect(mayor.transitionTo).toHaveBeenCalledWith('idle')
    expect(deps.setPlayerMoveEnabled).toHaveBeenCalledWith(true)
  })

  it('Shift key triggers running speed (faster than walk)', () => {
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    const walkDelta = 10 - mayor.mesh.position.z
    mayor.mesh.position.set(10, 0, 10)

    fireKey('shift')
    controller.update(0.016)
    const runDelta = 10 - mayor.mesh.position.z
    expect(runDelta).toBeGreaterThan(walkDelta)
  })

  it('arrow keys work as WASD aliases', () => {
    fireKey('arrowup')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.z).toBeLessThan(10)
  })

  it('isInputEnabled=false stops movement and resets to idle', () => {
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    mayor.mesh.position.set(10, 0, 10)
    mayor.transitionTo.mockClear()

    ;(deps.isInputEnabled as any) = () => false
    controller.update(0.016)
    expect(mayor.transitionTo).toHaveBeenCalledWith('idle')
    expect(deps.setPlayerMoveEnabled).toHaveBeenCalledWith(true)
  })

  it('mayor null (not spawned) → no errors, no movement', () => {
    ;(deps.getMayor as any) = () => null
    controller.update(0.016)
    expect(true).toBe(true)
  })

  it('mayor invisible → no movement', () => {
    const mayor = deps.getMayor() as any
    mayor.mesh.visible = false
    fireKey('w')
    controller.update(0.016)
    expect(mayor.transitionTo).not.toHaveBeenCalledWith('walking')
  })

  it('joystick input drives movement when keyboard is idle', () => {
    const joystickState = { magnitude: 0.5, horizontal: 1, vertical: 0, rotation: 0, active: true }
    const joystick = {
      state: joystickState,
      active: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    }
    deps = createMockDeps({ joystick: joystick as any })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    const joystickListener = joystick.on.mock.calls[0][0]
    joystickListener(joystickState)
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.x).toBeGreaterThan(10)
    expect(mayor.transitionTo).toHaveBeenCalledWith('walking')
  })

  it('keyboard takes priority over joystick (mutual exclusion)', () => {
    const joystickState = { magnitude: 0.5, horizontal: 1, vertical: 0, rotation: 0, active: true }
    const joystick = {
      state: joystickState,
      active: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    }
    deps = createMockDeps({ joystick: joystick as any })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    const joystickListener = joystick.on.mock.calls[0][0]
    joystickListener(joystickState)
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.z).toBeLessThan(10)
    expect(mayor.mesh.position.x).toBe(10)
  })

  it('joystick magnitude ≥ 0.8 triggers running speed', () => {
    const joystickState = { magnitude: 1, horizontal: 1, vertical: 0, rotation: 0, active: true }
    const joystick = {
      state: joystickState,
      active: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    }
    deps = createMockDeps({ joystick: joystick as any })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    const joystickListener = joystick.on.mock.calls[0][0]
    joystickListener(joystickState)
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    const runDelta = mayor.mesh.position.x - 10
    expect(runDelta).toBeGreaterThan(0.05)
  })

  it('crowd getClosestPoint is called to snap position to navmesh', () => {
    const getClosestPoint = vi.fn((p: { x: number; z: number }) => ({ x: p.x + 0.1, y: 0, z: p.z + 0.1 }))
    const crowd = { ready: true, getClosestPoint } as any
    deps = createMockDeps({ getCrowd: () => crowd })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    fireKey('d')
    controller.update(0.016)
    expect(getClosestPoint).toHaveBeenCalled()
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.position.x).toBeGreaterThan(10.1)
  })

  it('rotation.y faces movement direction', () => {
    fireKey('d')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(mayor.mesh.rotation.y).toBeCloseTo(Math.PI / 2, 2)
  })

  it('destroy stops keyboard listeners and resets state', () => {
    fireKey('w')
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    mayor.mesh.position.set(10, 0, 10)
    controller.destroy()
    fireKey('w')
    controller.update(0.016)
    expect(mayor.mesh.position.z).toBe(10)
  })

  it('onDoorProximity=true interrupts movement (walkToDoor takes over animation)', () => {
    const onDoorProximity = vi.fn(() => true)
    deps = createMockDeps({ onDoorProximity })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    fireKey('w')
    // 第一帧:移动开始,门检测返回 true → 中断本帧位移,交由 walkToDoor 接管
    controller.update(0.016)
    expect(onDoorProximity).toHaveBeenCalled()
    const mayor = deps.getMayor() as any
    // 不应切 idle(walkToDoor 会接管动画);也不应继续 walking(本帧位移被跳过)
    // wasMoving 保持 true,避免下一帧重复触发"开始移动"副作用
    expect(mayor.transitionTo).not.toHaveBeenCalledWith('idle')
  })

  it('onDoorProximity=false does not interrupt movement', () => {
    const onDoorProximity = vi.fn(() => false)
    deps = createMockDeps({ onDoorProximity })
    controller.destroy()
    controller = new MayorInputController(deps)
    controller.start()
    fireKey('w')
    controller.update(0.016)
    controller.update(0.016)
    const mayor = deps.getMayor() as any
    expect(onDoorProximity).toHaveBeenCalledTimes(2)
    expect(mayor.transitionTo).toHaveBeenCalledWith('walking')
  })
})
