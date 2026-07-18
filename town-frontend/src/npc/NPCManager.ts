import * as THREE from 'three'
import { NPC } from './NPC'
import type { NPCConfig } from '../types'

export class NPCManager {
  private npcs: Map<string, NPC> = new Map()
  private scene: THREE.Scene
  private labelContainer: HTMLElement

  constructor(scene: THREE.Scene, labelContainer: HTMLElement) {
    this.scene = scene
    this.labelContainer = labelContainer
  }

  createNPCs(configs: NPCConfig[]): void {
    for (const cfg of configs) {
      const existing = this.npcs.get(cfg.id)
      if (existing) {
        existing.destroy()
        this.npcs.delete(cfg.id)
      }
      const npc = new NPC(cfg)
      this.scene.add(npc.mesh)
      npc.createLabel(this.labelContainer)
      this.npcs.set(cfg.id, npc)
    }
  }

  get(id: string): NPC | undefined { return this.npcs.get(id) }
  getAll(): NPC[] { return Array.from(this.npcs.values()) }
  getWorkers(): NPC[] { return this.getAll().filter(n => n.role === 'worker') }

  remove(id: string): void {
    const npc = this.npcs.get(id)
    if (!npc) return
    npc.destroy()
    this.npcs.delete(id)
  }

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer, activeScene?: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      npc.isInActiveScene = !activeScene || npc.mesh.parent === activeScene
      npc.mesh.userData.isInActiveScene = npc.isInActiveScene
      npc.update(dt)
      npc.updateLabel(camera, renderer)
    }

    // Issue 7: NPC-to-NPC separation — push apart NPCs that are too close.
    // This prevents NPCs from overlapping and getting stuck on each other,
    // especially when multiple NPCs converge on the same destination.
    const allNpcs = Array.from(this.npcs.values()).filter(n => n.mesh.visible)
    const MIN_DIST = 1.2 // minimum comfortable distance between NPCs
    const PUSH = 0.15 // separation force per frame
    for (let i = 0; i < allNpcs.length; i++) {
      const a = allNpcs[i]
      if (!a.moving) continue // only apply to moving NPCs (reduces jitter)
      for (let j = i + 1; j < allNpcs.length; j++) {
        const b = allNpcs[j]
        const dx = b.mesh.position.x - a.mesh.position.x
        const dz = b.mesh.position.z - a.mesh.position.z
        const d2 = dx * dx + dz * dz
        if (d2 < MIN_DIST * MIN_DIST && d2 > 0.001) {
          const d = Math.sqrt(d2)
          const overlap = (MIN_DIST - d) / 2
          const ux = dx / d
          const uz = dz / d
          // Push both NPCs apart (only if not at target)
          if (a.moving) {
            const newX = a.mesh.position.x - ux * overlap * PUSH
            const newZ = a.mesh.position.z - uz * overlap * PUSH
            // Don't push into obstacles
            if (!NPC.obstacleQuery || !NPC.obstacleQuery(newX, newZ, 0.5)) {
              a.mesh.position.x = newX
              a.mesh.position.z = newZ
            }
          }
          if (b.moving) {
            const newX = b.mesh.position.x + ux * overlap * PUSH
            const newZ = b.mesh.position.z + uz * overlap * PUSH
            if (!NPC.obstacleQuery || !NPC.obstacleQuery(newX, newZ, 0.5)) {
              b.mesh.position.x = newX
              b.mesh.position.z = newZ
            }
          }
        }
      }
    }
  }

  findNearestNPC(worldPos: THREE.Vector3, maxDist = 3): NPC | null {
    let best: NPC | null = null
    let bestDist = maxDist
    for (const npc of this.npcs.values()) {
      if (!npc.mesh.visible) continue
      if (!npc.isInActiveScene) continue
      const d = npc.getPosition().distanceTo(worldPos)
      if (d < bestDist) { bestDist = d; best = npc }
    }
    return best
  }

  setScene(scene: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
    this.scene = scene
  }

  moveNpcsToScene(npcIds: string[], scene: THREE.Scene): void {
    for (const id of npcIds) {
      const npc = this.npcs.get(id)
      if (!npc) continue
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
  }

  setAllVisible(visible: boolean): void {
    for (const npc of this.npcs.values()) npc.setVisible(visible)
  }

  destroy(): void {
    for (const npc of this.npcs.values()) npc.destroy()
    this.npcs.clear()
  }
}
