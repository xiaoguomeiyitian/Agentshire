/**
 * CrowdService — 封装 recast-navigation Crowd,管理 NPC agent。
 *
 * 职责:
 *  - 创建/销毁 Crowd 实例(每场景一个)
 *  - addAgent/removeAgent/teleportAgent(NPC 生命周期)
 *  - requestMoveTarget/resetMoveTarget(移动控制)
 *  - update(dt)(每帧推进 Crowd 模拟)
 *  - 到达检测:position 到 target < 0.8 且 state=WALKING → resolve arrived
 *  - 超时 30s → resolve interrupted(对齐 Bridge moveNpcAndWait 25s + 5s 余量)
 *
 * 每个 agent 维护一个 pending Promise,moveTo 调用时创建,到达/中断时 resolve。
 */
import { Crowd, CrowdAgent, NavMesh, Vector3 } from 'recast-navigation'

/** agent 移动状态 */
export type MoveStatus = 'arrived' | 'interrupted'

/** agent 默认参数(对齐现有 NPC: speed=3, MIN_DIST=1.2) */
const DEFAULT_AGENT_PARAMS = {
  radius: 0.8,
  height: 1.0,
  maxAcceleration: 8,
  maxSpeed: 3,
  collisionQueryRange: 2.0,
  pathOptimizationRange: 0.5,
  separationWeight: 3.0,
  obstacleAvoidanceType: 1,
  // Recast CrowdUpdateFlags 位定义:
  //   DT_CROWD_ANTICIPATE_TURNS = 1
  //   DT_CROWD_OBSTACLE_AVOIDANCE = 4
  //   DT_CROWD_SEPARATION = 8        ← RVO 群体避障(防 NPC 重叠)
  //   DT_CROWD_OPTIMIZE_VIS = 16
  //   DT_CROWD_OPTIMIZE_TOPO = 32
  // 1 | 4 | 8 | 16 | 32 = 61
  updateFlags: 61,
}

/**
 * Mayor (user NPC) agent params — stronger separation so it can push through
 * crowds of citizens (e.g. during topic mode when the mayor reverses into a
 * group of followers). Higher separationWeight + larger collisionQueryRange
 * + higher maxAcceleration lets the mayor barge through, while citizens
 * (DEFAULT_AGENT_PARAMS) yield more readily.
 *
 * updateFlags = 60 (4|8|16|32) — excludes DT_CROWD_ANTICIPATE_TURNS (1).
 * ANTICIPATE_TURNS makes the agent slow down before/while turning, which
 * causes the mayor to move sluggishly when the player clicks a new target
 * in the opposite direction (e.g. clicked map edge then clicked center).
 * Without it, the mayor turns and accelerates immediately, feeling responsive.
 */
export const MAYOR_AGENT_PARAMS = {
  radius: 0.8,
  height: 1.0,
  maxAcceleration: 20,
  maxSpeed: 3.5,
  collisionQueryRange: 3.5,
  // Larger optimization range so the mayor takes straighter shortcuts through
  // the navmesh instead of hugging polygon edges (which caused big detours
  // when clicking on the ground).
  pathOptimizationRange: 2.5,
  separationWeight: 10.0,
  obstacleAvoidanceType: 1,
  updateFlags: 60,
}

/** 到达判定阈值 */
const ARRIVE_DISTANCE = 0.8
/** 超时(ms),对齐 Bridge moveNpcAndWait 25s + 5s 余量 */
const MOVE_TIMEOUT_MS = 30000

/** 单个 agent 的 pending 移动状态 */
interface PendingMove {
  target: Vector3
  resolve: (status: MoveStatus) => void
  startTime: number
  timeoutTimer: ReturnType<typeof setTimeout>
}

export class CrowdService {
  private crowd: Crowd | null = null
  private navMesh: NavMesh | null = null
  /** npcId → CrowdAgent */
  private agents = new Map<string, CrowdAgent>()
  /** npcId → pending move */
  private pendingMoves = new Map<string, PendingMove>()

  /** 是否已就绪(Crowd 已创建) */
  get ready(): boolean {
    return this.crowd !== null
  }

  /** 暴露 Crowd 实例(供 NavMeshDebugHelper 可视化) */
  get crowdInstance(): Crowd | null {
    return this.crowd
  }

  /** 暴露 NavMesh 实例(供 NavMeshDebugHelper 可视化) */
  get navMeshInstance(): NavMesh | null {
    return this.navMesh
  }

  /** 附加 NavMesh 并创建 Crowd。maxAgents 默认 20(town),小场景传 5。 */
  attach(navMesh: NavMesh, maxAgents = 20): void {
    if (this.crowd) {
      this.detach()
    }
    this.navMesh = navMesh
    this.crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius: 0.8 })
  }

  /** 销毁 Crowd,释放资源。保留 NavMesh(由 NavMeshService 管理生命周期)。 */
  detach(): void {
    // resolve 所有 pending 为 interrupted
    for (const [id, pending] of this.pendingMoves) {
      clearTimeout(pending.timeoutTimer)
      pending.resolve('interrupted')
      this.pendingMoves.delete(id)
    }
    this.agents.clear()
    if (this.crowd) {
      try {
        this.crowd.destroy()
      } catch { /* ignore */ }
      this.crowd = null
    }
    this.navMesh = null
  }

  /** 添加 agent。返回是否成功。 */
  addAgent(npcId: string, position: Vector3, params?: Partial<typeof DEFAULT_AGENT_PARAMS>): boolean {
    if (!this.crowd) return false
    if (this.agents.has(npcId)) {
      // 已存在,先移除
      this.removeAgent(npcId)
    }
    const agentParams = { ...DEFAULT_AGENT_PARAMS, ...params }
    const agent = this.crowd.addAgent(position, agentParams)
    this.agents.set(npcId, agent)
    return true
  }

  /** 移除 agent。若有 pending move,resolve interrupted。 */
  removeAgent(npcId: string): void {
    const pending = this.pendingMoves.get(npcId)
    if (pending) {
      clearTimeout(pending.timeoutTimer)
      pending.resolve('interrupted')
      this.pendingMoves.delete(npcId)
    }
    const agent = this.agents.get(npcId)
    if (agent && this.crowd) {
      try {
        this.crowd.removeAgent(agent)
      } catch { /* ignore */ }
    }
    this.agents.delete(npcId)
  }

  /** 传送 agent 到新位置(场景切换/重定位)。若有 pending move,resolve interrupted。 */
  teleportAgent(npcId: string, position: Vector3): void {
    const agent = this.agents.get(npcId)
    if (!agent) return
    const pending = this.pendingMoves.get(npcId)
    if (pending) {
      clearTimeout(pending.timeoutTimer)
      pending.resolve('interrupted')
      this.pendingMoves.delete(npcId)
    }
    try {
      agent.teleport(position)
    } catch { /* ignore */ }
  }

  /**
   * 请求移动到目标点。返回 Promise,到达 resolve 'arrived',超时/中断 resolve 'interrupted'。
   * 若该 npcId 有未完成的 move,先 resolve interrupted。
   */
  requestMoveTarget(npcId: string, target: Vector3): Promise<MoveStatus> {
    return new Promise<MoveStatus>((resolve) => {
      const agent = this.agents.get(npcId)
      if (!agent || !this.crowd) {
        resolve('interrupted')
        return
      }

      // 中断已有 pending
      const existing = this.pendingMoves.get(npcId)
      if (existing) {
        clearTimeout(existing.timeoutTimer)
        existing.resolve('interrupted')
      }

      const timeoutTimer = setTimeout(() => {
        const pending = this.pendingMoves.get(npcId)
        if (pending) {
          this.pendingMoves.delete(npcId)
          resolve('interrupted')
        }
      }, MOVE_TIMEOUT_MS)

      this.pendingMoves.set(npcId, {
        target,
        resolve,
        startTime: Date.now(),
        timeoutTimer,
      })

      try {
        agent.requestMoveTarget(target)
      } catch {
        clearTimeout(timeoutTimer)
        this.pendingMoves.delete(npcId)
        resolve('interrupted')
      }
    })
  }

  /** 停止寻路,保持当前位置。若有 pending move,resolve interrupted。 */
  resetMoveTarget(npcId: string): void {
    const agent = this.agents.get(npcId)
    if (!agent) return
    const pending = this.pendingMoves.get(npcId)
    if (pending) {
      clearTimeout(pending.timeoutTimer)
      pending.resolve('interrupted')
      this.pendingMoves.delete(npcId)
    }
    try {
      agent.resetMoveTarget()
    } catch { /* ignore */ }
  }

  /** 获取 agent 位置(若不存在返回 null)。 */
  getAgentPosition(npcId: string): Vector3 | null {
    const agent = this.agents.get(npcId)
    if (!agent) return null
    return agent.position()
  }

  /** 获取 agent 速度(若不存在返回 null)。 */
  getAgentVelocity(npcId: string): Vector3 | null {
    const agent = this.agents.get(npcId)
    if (!agent) return null
    return agent.velocity()
  }

  /** agent 是否存在。 */
  hasAgent(npcId: string): boolean {
    return this.agents.has(npcId)
  }

  /** agent 是否在移动(velocity 长度 > 0.05)。 */
  isAgentMoving(npcId: string): boolean {
    const v = this.getAgentVelocity(npcId)
    if (!v) return false
    return Math.abs(v.x) + Math.abs(v.z) > 0.05
  }

  /**
   * 每帧推进 Crowd 模拟 + 到达检测。
   * 应在 NPCManager.update 中、所有 npc.update 之前调用一次。
   */
  update(dt: number): void {
    if (!this.crowd) return
    // 限制 dt 防止大步长导致模拟异常
    const clampedDt = Math.min(dt, 0.1)
    this.crowd.update(clampedDt)

    // 到达检测
    for (const [npcId, pending] of this.pendingMoves) {
      const agent = this.agents.get(npcId)
      if (!agent) {
        clearTimeout(pending.timeoutTimer)
        pending.resolve('interrupted')
        this.pendingMoves.delete(npcId)
        continue
      }
      const pos = agent.position()
      const dx = pos.x - pending.target.x
      const dz = pos.z - pending.target.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      // state: 0=INVALID, 1=WALKING, 2=OFFMESH
      const state = agent.state()
      // 只看距离(不看速度):RVO 群体避障会让 agent 在目标附近持续微调
      // 速度长期 >0.1,导致永远不到达。dist<0.8 即视为到达。
      if (dist < ARRIVE_DISTANCE && state === 1) {
        clearTimeout(pending.timeoutTimer)
        pending.resolve('arrived')
        this.pendingMoves.delete(npcId)
      }
    }
  }

  /** 获取所有 agent 的 npcId(用于调试)。 */
  getAgentIds(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * 静止 agent 之间的 separation。
   *
   * Recast Crowd 的 SEPARATION flag 只在 agent 有移动目标(WALKING 状态)时施加分离力。
   * 当 NPC 到达目标停下后,separation 不再起作用,两个 NPC 可能紧贴/重合。
   * 此方法在 update 之后调用,对静止 agent 做 pairwise 推开,确保最小间距。
   *
   * 策略:遍历所有静止 agent 对,若距离 < minDist,沿连线方向各推开一半差距。
   * 用 agent.teleport 微调位置(静止 agent 无 pending move,teleport 安全)。
   *
   * @param minDist  最小间距(默认 1.8,= 2 × radius 0.8 + 余量 0.2)
   * @param maxPush  单帧最大推开距离(默认 0.05,避免视觉突变)
   */
  applyStaticSeparation(minDist = 1.8, maxPush = 0.05): void {
    if (!this.crowd) return
    const ids = this.getAgentIds()
    if (ids.length < 2) return

    // 收集静止 agent 的位置(只处理 velocity ≈ 0 的)
    const statics: { id: string; x: number; z: number }[] = []
    for (const id of ids) {
      const v = this.getAgentVelocity(id)
      if (!v) continue
      if (Math.abs(v.x) + Math.abs(v.z) > 0.05) continue // 移动中,跳过
      const p = this.getAgentPosition(id)
      if (!p) continue
      statics.push({ id, x: p.x, z: p.z })
    }
    if (statics.length < 2) return

    // pairwise 推开
    for (let i = 0; i < statics.length; i++) {
      for (let j = i + 1; j < statics.length; j++) {
        const a = statics[i]
        const b = statics[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const distSq = dx * dx + dz * dz
        if (distSq >= minDist * minDist) continue
        const dist = Math.sqrt(distSq) || 0.0001
        const overlap = minDist - dist
        const push = Math.min(overlap * 0.5, maxPush)
        const nx = dx / dist
        const nz = dz / dist
        // a 推向 -n 方向,b 推向 +n 方向
        a.x -= nx * push
        a.z -= nz * push
        b.x += nx * push
        b.z += nz * push
      }
    }

    // 应用新位置(teleport 静止 agent,无 pending move)
    for (const s of statics) {
      const agent = this.agents.get(s.id)
      if (!agent) continue
      // 静止 agent 不应有 pending move(已到达),但防御性检查
      if (this.pendingMoves.has(s.id)) continue
      try {
        agent.teleport({ x: s.x, y: 0, z: s.z })
      } catch { /* ignore */ }
    }
  }
}
