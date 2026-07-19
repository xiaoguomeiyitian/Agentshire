import type * as THREE from 'three'
import type { NPC } from '../../npc/NPC'
import type { NPCConfig } from '../../types'

export interface MinigameContext {
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  container: HTMLElement
  getNpc: (id: string) => NPC | undefined
  getNpcVoiceConfig: (id: string) => NPCConfig | null
  getTroubledNpcIds: () => string[]
  getSceneType: () => string
  onUpdate: (cb: (dt: number) => void) => void
  offUpdate: (cb: (dt: number) => void) => void
}

export interface MinigameSlot {
  readonly id: string
  mount(ctx: MinigameContext): void
  unmount(): void
  start(): void
  stop(): void
  addTroubledNpc(npcId: string): void
  removeTroubledNpc(npcId: string): void
}
