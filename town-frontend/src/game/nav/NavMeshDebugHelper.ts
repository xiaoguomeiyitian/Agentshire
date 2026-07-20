/**
 * NavMeshDebugHelper — 调试可视化 NavMesh + Crowd agent。
 *
 * 启用方式(二选一):
 *  - URL 参数 ?navDebug=1(启动时自动启用)
 *  - 运行时开关 setEnabled(true/false)(小镇设置面板「显示导航网格」)
 *
 * 可视化:
 *  - NavMeshHelper: 显示 NavMesh 三角网格(红色线框,问题6要求)
 *  - CrowdHelper: 显示 Crowd agent 的位置/速度/目标(圆环+连线)
 *
 * 运行时开关原理:
 *  - attachToScene 记录每个场景的 (scene, crowd, navMesh) 引用
 *  - setEnabled(true) 时遍历记录,为每个场景创建 helper 并加入
 *  - setEnabled(false) 时遍历已创建 helper,从场景移除并销毁
 *  - NavMesh 重建(buildTownCrowdFromConfig)时若已启用,自动重新 attach
 */
import * as THREE from 'three'
import { NavMeshHelper, CrowdHelper } from '@recast-navigation/three'
import type { CrowdService } from './CrowdService'
import type { NavMesh } from 'recast-navigation'

interface AttachedScene {
  scene: THREE.Scene
  crowdService: CrowdService
  navMesh: NavMesh | null
  /** 该场景对应的 CrowdHelper(创建后赋值,用于 update 时可见性过滤) */
  crowdHelper?: CrowdHelper
}

export class NavMeshDebugHelper {
  private navMeshHelpers: THREE.Object3D[] = []
  private crowdHelpers: THREE.Object3D[] = []
  /** 已 attach 的场景记录(用于运行时开关重新创建 helper) */
  private attachedScenes: AttachedScene[] = []
  private enabled = false
  /**
   * NPC 可见性过滤回调:(npcId) => boolean。
   * 注入后,update() 会隐藏不可见 NPC 对应的 CrowdHelper 圆柱,
   * 避免居民 spawn 时 agent 已加入 Crowd 但模型未加载完,
   * 红色圆柱先于居民出现的问题。
   */
  private isVisibleNpc: ((npcId: string) => boolean) | null = null

  /** 检查是否启用(?navDebug=1) */
  static isEnabled(): boolean {
    try {
      const params = new URLSearchParams(window.location.search)
      return params.get('navDebug') === '1'
    } catch {
      return false
    }
  }

  /**
   * 注入 NPC 可见性过滤回调。
   * 设置后,CrowdHelper 只显示可见 NPC 的 agent 圆柱。
   */
  setVisibleFilter(fn: ((npcId: string) => boolean) | null): void {
    this.isVisibleNpc = fn
  }

  /** 为指定 CrowdService 创建可视化 helper 并加入场景 */
  attachToScene(scene: THREE.Scene, crowdService: CrowdService, navMesh: NavMesh | null): void {
    // 记录引用,以便运行时开关重新创建
    this.attachedScenes.push({ scene, crowdService, navMesh })

    // 仅当已启用时才真正创建 helper(?navDebug=1 或运行时开关已开)
    if (!this.enabled) {
      // 启动时若 URL 带了 navDebug=1,则自动启用
      if (NavMeshDebugHelper.isEnabled()) {
        this.enabled = true
      } else {
        return
      }
    }

    this.createHelpersForScene(scene, crowdService, navMesh)
  }

  /** 实际创建 helper 并加入场景(内部) */
  private createHelpersForScene(scene: THREE.Scene, crowdService: CrowdService, navMesh: NavMesh | null): void {
    // NavMesh 线框(红色,问题6要求)
    if (navMesh) {
      const helper = new NavMeshHelper(navMesh)
      // 红色线条 + 半透明,清晰显示导航网格三角形边界
      const mat = helper.navMeshMaterial as THREE.MeshBasicMaterial
      mat.transparent = true
      mat.opacity = 0.5
      mat.color.setHex(0xff0000)
      mat.wireframe = true
      scene.add(helper)
      this.navMeshHelpers.push(helper)
    }

    // Crowd agent 标记
    const crowd = crowdService.crowdInstance
    if (crowd) {
      const helper = new CrowdHelper(crowd)
      scene.add(helper)
      this.crowdHelpers.push(helper)
      // 记录到 attachedScene,供 update 时可见性过滤
      const attached = this.attachedScenes.find(
        a => a.scene === scene && a.crowdService === crowdService,
      )
      if (attached) attached.crowdHelper = helper
    }
  }

  /** 运行时开关:启用/禁用调试网格显示 */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (enabled) {
      // 为所有已记录的场景创建 helper
      for (const a of this.attachedScenes) {
        this.createHelpersForScene(a.scene, a.crowdService, a.navMesh)
      }
    } else {
      // 从所有场景移除并销毁 helper
      for (const a of this.attachedScenes) {
        this.disposeScene(a.scene)
      }
      this.navMeshHelpers = []
      this.crowdHelpers = []
    }
  }

  /** 当前是否启用 */
  isEnabledRuntime(): boolean {
    return this.enabled
  }

  /** 每帧更新 helper 位置(CrowdHelper 需要同步) */
  update(): void {
    if (!this.enabled) return
    for (const attached of this.attachedScenes) {
      const helper = attached.crowdHelper
      if (!helper) continue
      // CrowdHelper 内部会自动同步 agent 位置
      // (recast-navigation/three 的 CrowdHelper 在 update() 中刷新)
      helper.update()
      // 可见性过滤:隐藏不可见 NPC 的 agent 圆柱。
      // 居民 spawn 时 agent 立即加入 Crowd,但 GLTF 模型异步加载,
      // 若不过滤,红色圆柱会先于居民出现。
      if (this.isVisibleNpc) {
        const crowdService = attached.crowdService
        for (const [agentIndex, agentMesh] of helper.agentMeshes) {
          const npcId = crowdService.getNpcIdByAgentIndex(agentIndex)
          // npcId 为 null 时(未知 agent)默认显示;否则按 NPC 可见性
          agentMesh.visible = npcId === null ? true : this.isVisibleNpc(npcId)
        }
      }
    }
  }

  /** 从指定场景移除并销毁该场景的 helper */
  private disposeScene(scene: THREE.Scene): void {
    // 移除该场景下的所有 navMeshHelpers 与 crowdHelpers
    this.navMeshHelpers = this.navMeshHelpers.filter(h => {
      if (h.parent === scene) { scene.remove(h); return false }
      return true
    })
    this.crowdHelpers = this.crowdHelpers.filter(h => {
      if (h.parent === scene) { scene.remove(h); return false }
      return true
    })
  }

  /** 从场景移除并销毁所有 helper(全量,用于销毁整个 helper) */
  dispose(scene: THREE.Scene): void {
    for (const h of this.navMeshHelpers) {
      scene.remove(h)
    }
    for (const h of this.crowdHelpers) {
      scene.remove(h)
    }
    this.navMeshHelpers = []
    this.crowdHelpers = []
    this.attachedScenes = this.attachedScenes.filter(a => a.scene !== scene)
    this.enabled = false
  }
}
