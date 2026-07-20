/**
 * MayorInputController — 镇长(玩家)连续移动控制器(上帝视角模式)。
 *
 * 参考:
 *  - `town-frontend/src/editor/PreviewPlayerController.ts`(键盘分支)
 *  - `sheShou/client_dev/assets/src/game/sheshou/gameLogic/MoveMentSystem.ts:handleGodViewMovement`(摇杆分支)
 *
 * 职责:
 *  - 统一抽象键盘(WASD/方向键)与虚拟摇杆输入,输出归一化方向 `{x, z, magnitude}`
 *  - 键盘按下时禁用摇杆(互斥),避免双重驱动
 *  - 速度档位:magnitude < 0.8 行走,≥ 0.8 奔跑;PC 端 Shift 加速
 *  - 每帧驱动镇长位移 + 朝向 + 动画状态机(`transitionTo('walking'/'idle')`)
 *  - 候选新位置先经 `CrowdService.getClosestPoint` 贴导航网格,防穿墙进入建筑内部
 *  - 移动时中断 citizen 对话、相机跟随镇长、管家同步跟随
 *
 * 与现有「点击地面寻路」(`MainScene.handleGroundTap` → `NPC.moveTo`)的关系:
 *  - 本控制器走「直接位移 + 贴地」路径,不调用 `moveTo()` 寻路
 *  - 激活期间设 `playerMoveEnabled = false`,防止与点击寻路冲突,松开后恢复
 *
 * 不引入:
 *  - 帧同步(Agentshire 单机,直接驱动本地 NPC)
 *  - 视角切换(只做上帝视角)
 *  - WASD 平移相机(WASD 控制镇长,相机跟随)
 */
import * as THREE from 'three'
import type { NPC } from '../npc/NPC'
import type { CameraController } from './visual/CameraController'
import type { CitizenChatManager } from '../npc/CitizenChatManager'
import type { FollowBehavior } from '../npc/FollowBehavior'
import type { VirtualJoystick } from '../ui/VirtualJoystick'
import type { CrowdService } from './nav/CrowdService'

/** 镇长移动速度(单位:世界单位/秒)。 */
const WALK_SPEED = 2.5
const RUN_SPEED = 4.5
/** 摇杆推动幅度阈值:≥ 此值切换为奔跑。 */
const RUN_MAGNITUDE_THRESHOLD = 0.8
/** 键盘方向归一化阈值(避免微小漂移)。 */
const KEYBOARD_DEADZONE = 0.01

export interface MayorInputControllerDeps {
  /** 镇长 NPC(id='user')。运行期间可能为 null(spawn 前/场景切换中)。 */
  getMayor: () => NPC | null
  /** 管家 NPC(id='steward'),镇长移动时同步跟随。 */
  getSteward: () => NPC | null
  /** 相机控制器,移动时跟随镇长。 */
  cameraCtrl: CameraController
  /** citizen 对话管理器,移动时中断对话。 */
  citizenChat: CitizenChatManager
  /** 管家跟随行为。 */
  followBehavior: FollowBehavior
  /** 当前场景的 CrowdService(用于 getClosestPoint 贴地)。可能为 null。 */
  getCrowd: () => CrowdService | null
  /** 虚拟摇杆(移动端)。PC 端传 null。 */
  joystick: VirtualJoystick | null
  /** 输入开关回调:激活时设 false(禁用点击寻路),松开时设 true。 */
  setPlayerMoveEnabled: (enabled: boolean) => void
  /** 输入总开关(进虚拟建筑/对话时为 false)。本控制器在 false 时停止响应。 */
  isInputEnabled: () => boolean
  /**
   * 门接近检测回调(摇杆/键盘移动时每帧调用)。
   * 返回 true 表示已触发进入建筑(本帧应停止移动驱动,交由 walkToDoor 接管)。
   * 仅在 town 场景且有门标记时由 MainScene 注入有效实现;无门场景传 () => false。
   */
  onDoorProximity: (mayorPos: THREE.Vector3) => boolean
}

export class MayorInputController {
  private deps: MayorInputControllerDeps
  private keys = { w: false, a: false, s: false, d: false, shift: false }
  /** 当前是否处于「摇杆驱动」状态(用于互斥与状态恢复)。 */
  private joystickActive = false
  /** 上一帧是否在移动(用于动画状态切换)。 */
  private wasMoving = false
  /** 复用向量,避免每帧分配。 */
  private moveDir = new THREE.Vector3()
  private candidatePos = new THREE.Vector3()

  constructor(deps: MayorInputControllerDeps) {
    this.deps = deps
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)
  }

  /** 启动:注册键盘事件 + 摇杆监听。 */
  start(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    if (this.deps.joystick) {
      this.deps.joystick.on(this.onJoystickUpdate)
    }
  }

  /** 停止:注销事件 + 重置状态。 */
  stop(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    if (this.deps.joystick) {
      this.deps.joystick.off(this.onJoystickUpdate)
    }
    this.keys = { w: false, a: false, s: false, d: false, shift: false }
    this.joystickActive = false
    if (this.wasMoving) {
      this.setIdle()
      this.deps.setPlayerMoveEnabled(true)
    }
    this.wasMoving = false
  }

  /** 销毁(等价于 stop)。 */
  destroy(): void {
    this.stop()
  }

  // ── 事件处理 ──────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    // 忽略输入框中的按键(聊天输入栏)
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const k = e.key.toLowerCase()
    if (k === 'w' || k === 'arrowup') this.keys.w = true
    else if (k === 'a' || k === 'arrowleft') this.keys.a = true
    else if (k === 's' || k === 'arrowdown') this.keys.s = true
    else if (k === 'd' || k === 'arrowright') this.keys.d = true
    else if (k === 'shift') this.keys.shift = true
    else return
    // 键盘按下时禁用摇杆(互斥):键盘优先级高,摇杆归零
    if (this.joystickActive) {
      this.joystickActive = false
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase()
    if (k === 'w' || k === 'arrowup') this.keys.w = false
    else if (k === 'a' || k === 'arrowleft') this.keys.a = false
    else if (k === 's' || k === 'arrowdown') this.keys.s = false
    else if (k === 'd' || k === 'arrowright') this.keys.d = false
    else if (k === 'shift') this.keys.shift = false
  }

  /** 摇杆状态更新回调。 */
  private onJoystickUpdate = (state: { magnitude: number; horizontal: number; vertical: number; active: boolean }): void => {
    // 键盘按下时忽略摇杆(互斥)
    if (this.hasKeyboardInput()) {
      this.joystickActive = false
      return
    }
    this.joystickActive = state.active && state.magnitude > 0
  }

  // ── 每帧驱动 ──────────────────────────────────────────

  /** 每帧调用,驱动镇长移动。应在 MainScene.update 中调用。 */
  update(dt: number): void {
    // 输入总开关关闭(进虚拟建筑/对话)时,停止响应并确保镇长静止
    if (!this.deps.isInputEnabled()) {
      if (this.wasMoving) {
        this.setIdle()
        this.wasMoving = false
        this.deps.setPlayerMoveEnabled(true)
      }
      return
    }

    const mayor = this.deps.getMayor()
    if (!mayor || !mayor.mesh.visible) {
      this.resetMovingState()
      return
    }

    // 计算归一化方向 + magnitude
    const input = this.computeInput()
    const moving = input.magnitude > KEYBOARD_DEADZONE

    if (!moving) {
      if (this.wasMoving) {
        this.setIdle()
        this.deps.setPlayerMoveEnabled(true)
        this.wasMoving = false
      }
      return
    }

    // 开始/持续移动:禁用点击寻路,中断对话,相机跟随
    if (!this.wasMoving) {
      // 问题2/3修复:开始摇杆/键盘驱动前,清除镇长任何未完成的寻路任务
      // (walkToDoor/handleGroundTap 调用的 mayor.moveTo)。否则 Crowd 每帧
      // 把 agent 拉向旧寻路目标,与这里的直接位移冲突,导致行走不受
      // 控制/惯性异常。
      mayor.stopMoving()
      this.deps.setPlayerMoveEnabled(false)
      this.deps.citizenChat.onPlayerMoveInterrupt()
      this.deps.cameraCtrl.follow(mayor.mesh)
      // 管家同步跟随
      const steward = this.deps.getSteward()
      if (steward && steward.mesh.visible) {
        this.deps.followBehavior.setTarget(mayor, steward)
        if (!this.deps.followBehavior.isActive()) this.deps.followBehavior.start()
      }
    }

    // 速度档位:摇杆幅度 ≥0.8 奔跑;键盘 Shift 加速
    const running = this.isRunning(input.magnitude)
    const speed = running ? RUN_SPEED : WALK_SPEED

    // 方向:屏幕坐标系 → 世界坐标系(相机固定俯角不旋转,直接映射)
    //   horizontal 右为正 → world +x
    //   vertical   上为正 → world -z(屏幕上对应世界 z 负方向)
    this.moveDir.set(input.x, 0, -input.z)
    if (this.moveDir.lengthSq() > 0) this.moveDir.normalize()

    // 候选新位置 = 当前位置 + 方向 * 速度 * dt
    this.candidatePos.copy(mayor.mesh.position)
    this.candidatePos.x += this.moveDir.x * speed * dt
    this.candidatePos.z += this.moveDir.z * speed * dt

    // 贴导航网格防穿墙(与点击寻路一致性)
    const crowd = this.deps.getCrowd()
    let finalX = this.candidatePos.x
    let finalZ = this.candidatePos.z
    if (crowd?.ready) {
      const snapped = crowd.getClosestPoint({ x: this.candidatePos.x, z: this.candidatePos.z })
      finalX = snapped.x
      finalZ = snapped.z
    }

    mayor.mesh.position.x = finalX
    mayor.mesh.position.z = finalZ

    // 同步 Crowd agent 位置到镇长 mesh 新位置。
    // MayorInputController 走「直接位移 + 贴地」路径,不调用 moveTo 寻路,
    // 若不同步 Crowd agent,agent 会停在旧位置,导致:
    //  1) NavMeshDebugHelper 的 CrowdHelper 红色圆柱与镇长 mesh 脱节
    //  2) 其他 NPC 的 RVO 避障基于旧 agent 位置,无法正确避开镇长
    //  3) 后续点击寻路时 Crowd agent 从旧位置开始,路径异常
    // teleportAgent 会清除 pending move(若有),把 agent 瞬移到新位置。
    if (crowd?.ready && crowd.hasAgent('user')) {
      crowd.teleportAgent('user', { x: finalX, y: 0, z: finalZ })
    }

    // 门接近检测:摇杆/键盘走到门口时自动进入建筑(与点击建筑一致)。
    // 回调返回 true 表示已触发进入,本帧停止移动驱动,交由 walkToDoor 接管动画。
    if (this.deps.onDoorProximity(mayor.mesh.position)) {
      // 不切 idle:walkToDoor 会调用 mayor.moveTo 触发 walking 动画
      // 保持 wasMoving=true,避免下一帧重复触发"开始移动"副作用
      return
    }

    // 朝向:atan2(x, z) 使镇长面向移动方向
    if (this.moveDir.lengthSq() > 0) {
      const angle = Math.atan2(this.moveDir.x, this.moveDir.z)
      mayor.mesh.rotation.y = angle
    }

    // 动画状态机:transitionTo('walking')(幂等,已在 walking 时无操作)
    mayor.transitionTo('walking')
    this.wasMoving = true
  }

  // ── 内部工具 ──────────────────────────────────────────

  /** 计算当前输入(键盘优先,摇杆次之),返回归一化方向 + magnitude。 */
  private computeInput(): { x: number; z: number; magnitude: number } {
    // 键盘优先
    if (this.hasKeyboardInput()) {
      let x = 0, z = 0
      if (this.keys.w) z += 1
      if (this.keys.s) z -= 1
      if (this.keys.a) x -= 1
      if (this.keys.d) x += 1
      const len = Math.sqrt(x * x + z * z)
      if (len > 0) {
        // 键盘:方向归一化,magnitude=1(或 Shift 时视为满档奔跑)
        return { x: x / len, z: z / len, magnitude: this.keys.shift ? 1 : 0.5 }
      }
    }

    // 摇杆
    if (this.deps.joystick && this.joystickActive) {
      const s = this.deps.joystick.state
      return { x: s.horizontal, z: s.vertical, magnitude: s.magnitude }
    }

    return { x: 0, z: 0, magnitude: 0 }
  }

  /** 是否有键盘方向输入。 */
  private hasKeyboardInput(): boolean {
    return this.keys.w || this.keys.a || this.keys.s || this.keys.d
  }

  /** 是否切换为奔跑速度。 */
  private isRunning(magnitude: number): boolean {
    // 键盘 Shift 优先
    if (this.keys.shift && this.hasKeyboardInput()) return true
    // 摇杆幅度 ≥ 阈值
    return magnitude >= RUN_MAGNITUDE_THRESHOLD
  }

  /** 镇长切回 idle 动画。 */
  private setIdle(): void {
    const mayor = this.deps.getMayor()
    if (mayor && mayor.mesh.visible) {
      mayor.transitionTo('idle')
    }
  }

  /** 重置移动状态(镇长不可用时)。 */
  private resetMovingState(): void {
    if (this.wasMoving) {
      this.wasMoving = false
      this.deps.setPlayerMoveEnabled(true)
    }
  }
}
