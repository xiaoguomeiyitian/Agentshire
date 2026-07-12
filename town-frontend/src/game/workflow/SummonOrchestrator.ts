import type { NPC } from '../../npc/NPC'
import type { ModeManager } from './ModeManager'
import type { DailyBehavior } from '../../npc/DailyBehavior'
import type { EncounterManager } from '../../npc/EncounterManager'
import type { ActivityJournal } from '../../npc/ActivityJournal'
import { BaseOrchestrator } from './BaseOrchestrator'
import { getLocale } from '../../i18n'

// ── Obstacle map for formation collision avoidance ──

interface Obstacle { x: number; z: number; radius: number }

const OBSTACLES: Obstacle[] = [
  { x: 18, z: 13, radius: 2.0 },
  { x: 15, z: 11, radius: 0.6 },
  { x: 21, z: 11, radius: 0.6 },
  { x: 15, z: 15, radius: 0.6 },
  { x: 21, z: 15, radius: 0.6 },
  { x: 17, z: 10, radius: 0.6 },
  { x: 19, z: 16, radius: 0.6 },
  { x: 10, z: 19, radius: 0.6 },
  { x: 15, z: 19, radius: 0.6 },
]

const FORMATION_RADIUS = 3.0
const ARC_ANGLE = Math.PI
const ARRIVE_THRESHOLD = 0.8
const TIMEOUT_TELEPORT_MS = 10_000
const TIMEOUT_FORCE_MS = 15_000
const REACTION_DELAY_MS = 1000
const WALK_SPEED = 3.5

export interface SummonConfig {
  steward: NPC
  npcs: NPC[]
  gatheringPoint: { x: number; z: number }
  userPosition?: { x: number; z: number }
  modeManager: ModeManager
  getBehavior: (npcId: string) => DailyBehavior | undefined
  getJournal: (npcId: string) => ActivityJournal | undefined
  encounterManager: EncounterManager
  onBubble: (npc: NPC, text: string, durationMs: number) => void
  onBubbleEnd: (npc: NPC) => void
  onCameraFocus: (target: { x: number; z: number }) => void
  onAllGathered: () => void
}

export class SummonOrchestrator extends BaseOrchestrator<SummonConfig> {

  async run(cfg: SummonConfig): Promise<void> {
    const { steward, npcs, gatheringPoint, modeManager } = cfg

    if (npcs.length === 0) {
      cfg.onAllGathered()
      return
    }

    modeManager.setSummonedNpcs(npcs.map(n => n.id))
    cfg.encounterManager.setExcludedNpcs(new Set(npcs.map(n => n.id)))

    cfg.onCameraFocus(gatheringPoint)

    await this.moveStewardToGathering(steward, gatheringPoint)
    if (this.shouldAbort()) return

    steward.lookAtTarget({ x: gatheringPoint.x, z: gatheringPoint.z + 3 })

    await this.playNpcReactions(npcs, cfg)
    if (this.shouldAbort()) return

    const positions = this.computeFormation(gatheringPoint, npcs.length, cfg.userPosition)

    const movePromises = npcs.map((npc, i) =>
      npc.moveTo({ x: positions[i].x, z: positions[i].z }, WALK_SPEED),
    )

    const startedAt = Date.now()
    await this.waitForGathering(npcs, positions, movePromises, startedAt)
    if (this.shouldAbort()) return

    for (const npc of npcs) {
      npc.lookAtTarget({ x: gatheringPoint.x, z: gatheringPoint.z })
      npc.playAnim('wave')
    }
    await this.delay(800)
    for (const npc of npcs) {
      npc.playAnim('idle')
    }

    for (const npc of npcs) {
      cfg.getJournal?.(npc.id)?.record({
        location: 'gathering_point',
        locationName: getLocale() === 'en' ? 'Rally Point' : '聚集点',
        action: 'arrived',
        detail: getLocale() === 'en' ? 'Arrived for briefing' : '到达管家身边，准备开会',
      })
    }

    modeManager.advanceWorkState('assigning')
    cfg.onAllGathered()
  }

  // ── Steward movement ──

  private async moveStewardToGathering(steward: NPC, gp: { x: number; z: number }): Promise<void> {
    const pos = steward.getPosition()
    const dx = pos.x - gp.x
    const dz = pos.z - gp.z
    if (dx * dx + dz * dz > 4) {
      await steward.moveTo(gp, 3)
    }
    steward.playAnim('idle')
  }

  // ── NPC reaction animations (staggered) ──

  private async playNpcReactions(npcs: NPC[], _cfg: SummonConfig): Promise<void> {
    const stagger = 200
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]
      npc.setStatusEmoji('❗')
      npc.setGlow('gold')
      npc.playAnim('wave')
      if (i > 0) await this.delay(stagger)
    }
    await this.delay(REACTION_DELAY_MS - (npcs.length - 1) * stagger)
    for (const npc of npcs) {
      npc.setStatusEmoji(null as any)
      npc.setGlow('none')
      npc.playAnim('walk')
    }
  }

  // ── Half-circle formation with obstacle avoidance ──

  computeFormation(center: { x: number; z: number }, count: number, userPos?: { x: number; z: number }): Array<{ x: number; z: number }> {
    const positions: Array<{ x: number; z: number }> = []
    if (count === 0) return positions

    if (count === 1) {
      positions.push({ x: center.x, z: center.z + FORMATION_RADIUS })
      return this.avoidObstacles(positions, userPos)
    }

    const startAngle = -ARC_ANGLE / 2
    const step = ARC_ANGLE / Math.max(count - 1, 1)

    for (let i = 0; i < count; i++) {
      const angle = startAngle + step * i
      const ox = Math.sin(angle) * FORMATION_RADIUS
      const oz = Math.cos(angle) * FORMATION_RADIUS
      positions.push({ x: center.x + ox, z: center.z + oz })
    }

    return this.avoidObstacles(positions, userPos)
  }

  private avoidObstacles(positions: Array<{ x: number; z: number }>, userPos?: { x: number; z: number }): Array<{ x: number; z: number }> {
    const MIN_CLEARANCE = 1.0
    const dynamicObstacles = userPos ? [...OBSTACLES, { x: userPos.x, z: userPos.z, radius: 1.5 }] : OBSTACLES
    return positions.map(p => {
      for (const obs of dynamicObstacles) {
        const dx = p.x - obs.x
        const dz = p.z - obs.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const minDist = obs.radius + MIN_CLEARANCE
        if (dist < minDist && dist > 0.01) {
          const push = (minDist - dist) / dist
          p = { x: p.x + dx * push, z: p.z + dz * push }
        }
      }
      return p
    })
  }

  // ── Wait for all NPCs to arrive with timeout ──

  private async waitForGathering(
    npcs: NPC[],
    targets: Array<{ x: number; z: number }>,
    movePromises: Promise<'arrived' | 'interrupted'>[],
    startedAt: number,
  ): Promise<void> {
    const settled = new Set<string>()

    const check = () => {
      for (let i = 0; i < npcs.length; i++) {
        if (settled.has(npcs[i].id)) continue
        const pos = npcs[i].getPosition()
        const dx = pos.x - targets[i].x
        const dz = pos.z - targets[i].z
        if (dx * dx + dz * dz < ARRIVE_THRESHOLD * ARRIVE_THRESHOLD) {
          settled.add(npcs[i].id)
        }
      }
      return settled.size >= npcs.length
    }

    while (!check() && !this.shouldAbort()) {
      const elapsed = Date.now() - startedAt
      if (elapsed > TIMEOUT_FORCE_MS) break

      if (elapsed > TIMEOUT_TELEPORT_MS) {
        for (let i = 0; i < npcs.length; i++) {
          if (!settled.has(npcs[i].id)) {
            npcs[i].mesh.position.set(targets[i].x, 0, targets[i].z)
            settled.add(npcs[i].id)
          }
        }
        break
      }

      await this.delay(300)
    }

    await Promise.allSettled(movePromises)
  }

  // ── Utility ──

}
