// @desc Manages mayor↔citizen chat interaction state (approaching, active, disconnect)

import type { NPC } from './NPC'
import type { NPCManager } from './NPCManager'
import type { CameraController } from '../game/visual/CameraController'
import type { FollowBehavior } from './FollowBehavior'
import type { SceneType, NPCConfig } from '../types'

export interface CitizenChatDeps {
  npcManager: NPCManager
  // DailyBehavior removed; getBehavior kept for API compat but returns undefined.
  getBehavior: (npcId: string) => unknown
  getUser: () => NPC | undefined
  getSteward: () => NPC | undefined
  getCameraCtrl: () => CameraController
  getFollowBehavior: () => FollowBehavior
  getSceneType: () => SceneType
  getAvatarUrl: (npcId: string) => string | undefined
  onDialogTargetChange: (npcId: string) => void
  onInputTargetChange: (npc: NPCConfig | null) => void
  /** Issue 7: called when user starts walking toward a citizen (approaching state). */
  onApproachingStart?: (npcId: string) => void
}

interface ActiveInteraction {
  npcId: string
  state: 'approaching' | 'active'
  idleTimer: number
  approachTimer: number
}

const MAX_IDLE_MS = 120_000
const APPROACH_TIMEOUT_MS = 30_000
const ARRIVE_DISTANCE = 3.5
const DISCONNECT_DISTANCE = 5.0

export class CitizenChatManager {
  private interaction: ActiveInteraction | null = null
  private deps: CitizenChatDeps

  constructor(deps: CitizenChatDeps) {
    this.deps = deps
  }

  startChat(npcId: string): void {
    if (this.interaction && this.interaction.npcId !== npcId) {
      this.disconnectSilent()
    } else if (this.interaction) {
      return
    }

    const npc = this.deps.npcManager.get(npcId)
    const user = this.deps.getUser()
    if (!npc || !user) return

    // DailyBehavior removed; pauseForDialogue is a no-op now.
    npc.stopMoving()

    this.interaction = {
      npcId,
      state: 'approaching',
      idleTimer: MAX_IDLE_MS,
      approachTimer: APPROACH_TIMEOUT_MS,
    }

    this.deps.onDialogTargetChange(npcId)

    const npcPos = npc.getPosition()
    const dx = user.mesh.position.x - npcPos.x
    const dz = user.mesh.position.z - npcPos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < ARRIVE_DISTANCE) {
      this.transitionToActive(npc, user)
    } else {
      const angle = Math.atan2(dx, dz)
      const targetX = npcPos.x + Math.sin(angle) * (ARRIVE_DISTANCE * 0.6)
      const targetZ = npcPos.z + Math.cos(angle) * (ARRIVE_DISTANCE * 0.6)
      user.moveTo({ x: targetX, z: targetZ }, 2.5)

      const camera = this.deps.getCameraCtrl()
      camera.follow(user.mesh)

      const steward = this.deps.getSteward()
      if (steward && steward.mesh.visible) {
        const follow = this.deps.getFollowBehavior()
        follow.setTarget(user, steward)
        if (!follow.isActive()) follow.start()
      }

      // Issue 7: notify UI that user is walking toward this citizen
      this.deps.onApproachingStart?.(npcId)
    }
  }

  private disconnectSilent(): void {
    if (!this.interaction) return
    this.interaction = null
  }

  disconnect(): void {
    if (!this.interaction) return
    this.interaction = null
    this.deps.onDialogTargetChange('steward')
    this.deps.onInputTargetChange(null)
  }

  update(dtMs: number): void {
    if (!this.interaction) return

    const { npcId, state } = this.interaction
    const npc = this.deps.npcManager.get(npcId)
    const user = this.deps.getUser()

    if (!npc || !user) {
      this.disconnect()
      return
    }

    const userScene = this.deps.getSceneType()
    const npcInScene = npc.isInActiveScene ?? true
    const sameScene = userScene === 'town' && npcInScene

    if (!sameScene) {
      this.disconnect()
      return
    }

    const dx = user.mesh.position.x - npc.mesh.position.x
    const dz = user.mesh.position.z - npc.mesh.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (state === 'approaching') {
      if (dist < ARRIVE_DISTANCE) {
        this.transitionToActive(npc, user)
        return
      }
      this.interaction.approachTimer -= dtMs
      if (this.interaction.approachTimer <= 0) {
        this.disconnect()
      }
      return
    }

    // state === 'active'
    if (dist > DISCONNECT_DISTANCE) {
      this.disconnect()
      return
    }

    this.interaction.idleTimer -= dtMs
    if (this.interaction.idleTimer <= 0) {
      this.disconnect()
      return
    }
  }

  onUserMessage(targetNpcId: string): void {
    if (!this.interaction) return
    if (this.interaction.state !== 'active') return
    if (targetNpcId === this.interaction.npcId) {
      this.interaction.idleTimer = MAX_IDLE_MS
    }
  }

  resetIdleTimer(): void {
    if (!this.interaction) return
    if (this.interaction.state === 'active') {
      this.interaction.idleTimer = MAX_IDLE_MS
    }
  }

  onPlayerMoveInterrupt(): void {
    if (!this.interaction) return
    if (this.interaction.state === 'approaching') {
      this.disconnect()
    }
  }

  isActive(): boolean {
    return this.interaction?.state === 'active'
  }

  getActiveNpcId(): string | null {
    return this.interaction?.npcId ?? null
  }

  canSwitchToCitizen(): boolean {
    if (!this.interaction) return false
    if (this.interaction.state !== 'active') return false
    if (this.interaction.idleTimer <= 0) return false

    const npc = this.deps.npcManager.get(this.interaction.npcId)
    const user = this.deps.getUser()
    if (!npc || !user) return false

    const dx = user.mesh.position.x - npc.mesh.position.x
    const dz = user.mesh.position.z - npc.mesh.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    return dist <= DISCONNECT_DISTANCE
  }

  private transitionToActive(npc: NPC, user: NPC): void {
    if (!this.interaction) return

    this.interaction.state = 'active'
    this.interaction.idleTimer = MAX_IDLE_MS

    npc.smoothLookAt({ x: user.mesh.position.x, z: user.mesh.position.z })

    this.deps.onDialogTargetChange(this.interaction.npcId)
    this.deps.onInputTargetChange({
      id: npc.id,
      name: npc.name ?? npc.id,
      color: 0x888888,
      spawn: { x: 0, y: 0, z: 0 },
      role: 'worker',
      label: npc.label ?? npc.name ?? npc.id,
      characterKey: npc.characterKey,
      avatarUrl: this.deps.getAvatarUrl(npc.id),
    })
  }

  destroy(): void {
    if (this.interaction) {
      this.disconnect()
    }
  }
}
