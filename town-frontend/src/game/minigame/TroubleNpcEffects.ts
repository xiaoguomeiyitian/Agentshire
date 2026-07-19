import * as THREE from 'three'
import type { NPC } from '../../npc/NPC'

const EMISSIVE_COLOR = new THREE.Color(0x5d3d8a)
const _hsl = { h: 0, s: 0, l: 0 }

export class TroubleNpcEffects {
  private origColors = new Map<string, Map<THREE.Material, THREE.Color>>()
  private origTimeScales = new Map<string, number>()

  snapshot(npc: NPC): void {
    if (this.origColors.has(npc.id)) return
    const colors = new Map<THREE.Material, THREE.Color>()
    npc.mesh.traverse((c: any) => {
      if (!c.isMesh || !c.material) return
      const mats = Array.isArray(c.material) ? c.material : [c.material]
      for (const m of mats) {
        if ((m as any).color) colors.set(m, (m as any).color.clone())
      }
    })
    this.origColors.set(npc.id, colors)
    this.origTimeScales.set(npc.id, npc.animationMixer?.timeScale ?? 1)
  }

  applyWorry(npc: NPC, worry: number): void {
    const origMap = this.origColors.get(npc.id)
    if (!origMap) return

    const t = worry / 100
    const desat = t * 0.85
    const emissiveIntensity = t * 0.65

    for (const [m, orig] of origMap) {
      const mat = m as any
      if (!mat.color) continue
      orig.getHSL(_hsl)
      _hsl.s = Math.max(0, _hsl.s * (1 - desat))
      _hsl.l = _hsl.l + (0.6 - _hsl.l) * t * 0.5
      mat.color.setHSL(_hsl.h, _hsl.s, _hsl.l)

      if (mat.emissive !== undefined) {
        mat.emissive.copy(EMISSIVE_COLOR)
        mat.emissiveIntensity = emissiveIntensity
      }
    }

    const squash = 1.0 - t * 0.15
    npc.mesh.scale.set(1 + (1 - squash) * 0.4, squash, 1 + (1 - squash) * 0.4)

    const mixer = npc.animationMixer
    if (mixer) {
      const origTs = this.origTimeScales.get(npc.id) ?? 1
      mixer.timeScale = origTs * (1 - worry * 0.005)
    }
  }

  restore(npc: NPC): void {
    const origMap = this.origColors.get(npc.id)
    if (origMap) {
      for (const [m, c] of origMap) {
        const mat = m as any
        if (mat.color) mat.color.copy(c)
        if (mat.emissive) { mat.emissive.set(0x000000); mat.emissiveIntensity = 0 }
      }
    }
    npc.mesh.scale.set(1, 1, 1)
    const mixer = npc.animationMixer
    if (mixer) {
      mixer.timeScale = this.origTimeScales.get(npc.id) ?? 1
    }
    this.origColors.delete(npc.id)
    this.origTimeScales.delete(npc.id)
  }

  restoreAll(): void {
    for (const npcId of [...this.origColors.keys()]) {
      const origMap = this.origColors.get(npcId)
      if (origMap) {
        for (const [m, c] of origMap) {
          const mat = m as any
          if (mat.color) mat.color.copy(c)
          if (mat.emissive) { mat.emissive.set(0x000000); mat.emissiveIntensity = 0 }
        }
      }
    }
    this.origColors.clear()
    this.origTimeScales.clear()
  }

  destroy(): void {
    this.restoreAll()
  }
}
