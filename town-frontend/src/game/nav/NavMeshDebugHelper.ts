/**
 * NavMeshDebugHelper — 调试可视化 NavMesh + Crowd agent。
 *
 * 通过 URL 参数 ?navDebug=1 启用。
 * - NavMeshHelper: 显示 NavMesh 三角网格(线框)
 * - CrowdHelper: 显示 Crowd agent 的位置/速度/目标(圆环+连线)
 */
import * as THREE from 'three'
import { NavMeshHelper, CrowdHelper } from '@recast-navigation/three'
import type { CrowdService } from './CrowdService'
import type { NavMesh } from 'recast-navigation'

export class NavMeshDebugHelper {
  private navMeshHelpers: THREE.Object3D[] = []
  private crowdHelpers: THREE.Object3D[] = []
  private enabled = false

  /** 检查是否启用(?navDebug=1) */
  static isEnabled(): boolean {
    try {
      const params = new URLSearchParams(window.location.search)
      return params.get('navDebug') === '1'
    } catch {
      return false
    }
  }

  /** 为指定 CrowdService 创建可视化 helper 并加入场景 */
  attachToScene(scene: THREE.Scene, crowdService: CrowdService, navMesh: NavMesh | null): void {
    if (!NavMeshDebugHelper.isEnabled()) return
    this.enabled = true

    // NavMesh 线框
    if (navMesh) {
      const helper = new NavMeshHelper(navMesh)
      helper.navMeshMaterial.transparent = true
      helper.navMeshMaterial.opacity = 0.5
      scene.add(helper)
      this.navMeshHelpers.push(helper)
    }

    // Crowd agent 标记
    const crowd = crowdService.crowdInstance
    if (crowd) {
      const helper = new CrowdHelper(crowd)
      scene.add(helper)
      this.crowdHelpers.push(helper)
    }
  }

  /** 每帧更新 helper 位置(CrowdHelper 需要同步) */
  update(): void {
    if (!this.enabled) return
    for (const helper of this.crowdHelpers) {
      // CrowdHelper 内部会自动同步 agent 位置
      // (recast-navigation/three 的 CrowdHelper 在 update() 中刷新)
      if ('update' in helper && typeof (helper as any).update === 'function') {
        ;(helper as any).update()
      }
    }
  }

  /** 从场景移除并销毁所有 helper */
  dispose(scene: THREE.Scene): void {
    for (const h of this.navMeshHelpers) {
      scene.remove(h)
    }
    for (const h of this.crowdHelpers) {
      scene.remove(h)
    }
    this.navMeshHelpers = []
    this.crowdHelpers = []
    this.enabled = false
  }
}
