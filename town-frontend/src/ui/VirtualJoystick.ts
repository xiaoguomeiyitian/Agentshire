/**
 * VirtualJoystick — 动态虚拟摇杆(移动端)。
 *
 * 参考 sheShou/client_dev/assets/src/core/ui/JoyStick.ts 的交互模型:
 *  - 触摸开始时,摇杆背景出现在触摸点位置(动态摇杆,不遮挡画面)
 *  - 触摸移动时,摇杆点(thumb)跟随手指,被 clamp 在半径范围内
 *  - 触摸结束时,摇杆隐藏,输出归零
 *
 * 输出(每帧或事件):
 *  - magnitude: 推动百分比 0..1(归一化距离 / 半径)
 *  - horizontal: -1..1(归一化 x 分量)
 *  - vertical:   -1..1(归一化 y 分量,上为正)
 *  - rotation:   -180..180(摇杆旋转角度,用于朝向)
 *  - active:     是否正在触摸
 *
 * 与 sheShou 的差异:
 *  - 纯 DOM/Canvas 实现(非 Cocos Creator),无引擎依赖
 *  - 不打包输入帧(Agentshire 单机,直接驱动本地 NPC)
 *  - 触摸事件用 PointerEvent(与 Agentshire Input 系统一致)
 *
 * 容器要求:一个覆盖左下 1/3 区域的透明 DOM 元素,pointer-events: auto。
 * 摇杆背景与摇杆点由本类动态创建并附加到 document.body,定位用 fixed。
 */
export interface JoystickState {
  /** 推动百分比 0..1 */
  magnitude: number
  /** 归一化 x 分量 -1..1(右为正) */
  horizontal: number
  /** 归一化 y 分量 -1..1(上为正) */
  vertical: number
  /** 旋转角度 -180..180 */
  rotation: number
  /** 是否正在触摸 */
  active: boolean
}

export type JoystickListener = (state: JoystickState) => void

export class VirtualJoystick {
  /** 摇杆半径(px),thumb 超出此半径被 clamp。与背景圆尺寸耦合(=背景圆宽度/2)。 */
  readonly radius = 90

  private container: HTMLElement
  private bg: HTMLDivElement
  private thumb: HTMLDivElement

  private pointerId: number | null = null
  private startX = 0
  private startY = 0

  private _state: JoystickState = {
    magnitude: 0, horizontal: 0, vertical: 0, rotation: 0, active: false,
  }

  private listeners = new Set<JoystickListener>()

  constructor(container: HTMLElement) {
    this.container = container
    this.bg = this.createBg()
    this.thumb = this.createThumb()
    document.body.appendChild(this.bg)
    this.bg.appendChild(this.thumb)
    this.hide()

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)

    this.container.addEventListener('pointerdown', this.onPointerDown)
  }

  /** 当前摇杆状态快照。 */
  get state(): JoystickState {
    return { ...this._state }
  }

  /** 是否正在触摸(等价于 state.active)。 */
  get active(): boolean {
    return this._state.active
  }

  /** 注册状态变化监听器。 */
  on(listener: JoystickListener): void {
    this.listeners.add(listener)
  }

  /** 注销监听器。 */
  off(listener: JoystickListener): void {
    this.listeners.delete(listener)
  }

  /** 销毁,移除所有事件监听与 DOM。 */
  destroy(): void {
    this.detachWindowListeners()
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.bg.remove()
    this.listeners.clear()
  }

  // ── 内部实现 ──────────────────────────────────────────

  private createBg(): HTMLDivElement {
    const el = document.createElement('div')
    el.setAttribute('data-joystick', 'bg')
    el.style.cssText = [
      'position:fixed',
      'width:180px', 'height:180px',
      'border-radius:50%',
      'border:2px solid rgba(212,165,116,0.5)',
      'background:rgba(20,20,30,0.35)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
      'pointer-events:none',
      'z-index:1200',
      'transform:translate(-50%,-50%)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
    ].join(';')
    return el
  }

  private createThumb(): HTMLDivElement {
    const el = document.createElement('div')
    el.setAttribute('data-joystick', 'thumb')
    el.style.cssText = [
      'position:absolute',
      'width:60px', 'height:60px',
      'border-radius:50%',
      'background:rgba(212,165,116,0.85)',
      'border:2px solid rgba(255,255,255,0.4)',
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'left:50%', 'top:50%',
    ].join(';')
    return el
  }

  private show(x: number, y: number): void {
    this.bg.style.left = `${x}px`
    this.bg.style.top = `${y}px`
    this.bg.style.display = 'flex'
    this.thumb.style.left = '50%'
    this.thumb.style.top = '50%'
  }

  private hide(): void {
    this.bg.style.display = 'none'
  }

  private attachWindowListeners(): void {
    window.addEventListener('pointermove', this.onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
  }

  private detachWindowListeners(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== null) return
    this.pointerId = e.pointerId
    this.startX = e.clientX
    this.startY = e.clientY
    this.show(e.clientX, e.clientY)
    this.attachWindowListeners()
    this.emitState({ magnitude: 0, horizontal: 0, vertical: 0, rotation: 0, active: true })
    e.preventDefault()
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return
    const dx = e.clientX - this.startX
    const dy = e.clientY - this.startY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const clamped = Math.min(dist, this.radius)
    const nx = dist > 0 ? dx / dist : 0
    const ny = dist > 0 ? dy / dist : 0
    // thumb 位置(相对 bg 中心)
    const tx = nx * clamped
    const ty = ny * clamped
    this.thumb.style.left = `calc(50% + ${tx}px)`
    this.thumb.style.top = `calc(50% + ${ty}px)`

    // 归一化输出:horizontal 右为正,vertical 上为正(屏幕 y 向下,故取反)
    const horizontal = (nx * clamped) / this.radius
    const vertical = -(ny * clamped) / this.radius
    const magnitude = clamped / this.radius
    const rotation = -Math.atan2(horizontal, vertical) * (180 / Math.PI)
    this.emitState({ magnitude, horizontal, vertical, rotation, active: true })
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pointerId !== e.pointerId) return
    this.pointerId = null
    this.detachWindowListeners()
    this.hide()
    this.emitState({ magnitude: 0, horizontal: 0, vertical: 0, rotation: 0, active: false })
  }

  private emitState(state: JoystickState): void {
    this._state = state
    for (const l of this.listeners) {
      try { l(this._state) } catch { /* ignore listener errors */ }
    }
  }
}
