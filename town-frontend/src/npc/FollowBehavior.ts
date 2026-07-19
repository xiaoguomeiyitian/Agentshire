import type { NPC } from './NPC'

/**
 * 让 follower NPC 持续跟随 leader NPC，保持在其身后一定距离。
 * 用于管家跟随镇长场景。
 */
export class FollowBehavior {
  private follower: NPC | null = null
  private leader: NPC | null = null
  private active = false

  private followDistance = 1.8
  private stopDistance = 1.2
  private offsetAngle = Math.PI * 0.75
  private followerSpeed = 3.5
  private recheckInterval = 150
  private timeSinceCheck = 0
  /** 上次记录的 leader 位置(用于位移阈值判断,避免频繁 requestMoveTarget) */
  private lastLeaderX = 0
  private lastLeaderZ = 0
  /** leader 位移超过此阈值才重新下发跟随目标 */
  private static readonly LEADER_MOVE_THRESHOLD = 0.3

  setTarget(leader: NPC | null, follower: NPC | null): void {
    this.leader = leader
    this.follower = follower
  }

  start(): void {
    this.active = true
    this.timeSinceCheck = 0
    if (this.leader) {
      const p = this.leader.getPosition()
      this.lastLeaderX = p.x
      this.lastLeaderZ = p.z
    }
  }

  stop(): void {
    this.active = false
  }

  isActive(): boolean {
    return this.active
  }

  update(dtMs: number): void {
    if (!this.active || !this.leader || !this.follower) return

    this.timeSinceCheck += dtMs
    if (this.timeSinceCheck < this.recheckInterval) return
    this.timeSinceCheck = 0

    const leaderPos = this.leader.getPosition()
    const followerPos = this.follower.getPosition()
    const dx = leaderPos.x - followerPos.x
    const dz = leaderPos.z - followerPos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist <= this.stopDistance) return
    if (dist <= this.followDistance && this.follower.state === 'walking') return

    if (dist > this.followDistance) {
      // 仅当 leader 位移超过阈值时才重新下发目标,避免频繁 requestMoveTarget 抖动
      const leaderDx = leaderPos.x - this.lastLeaderX
      const leaderDz = leaderPos.z - this.lastLeaderZ
      const leaderMoveDist = Math.sqrt(leaderDx * leaderDx + leaderDz * leaderDz)
      this.lastLeaderX = leaderPos.x
      this.lastLeaderZ = leaderPos.z
      if (leaderMoveDist < FollowBehavior.LEADER_MOVE_THRESHOLD) return

      const leaderAngle = Math.atan2(
        this.leader.mesh.rotation.y ? -Math.sin(this.leader.mesh.rotation.y) : 0,
        this.leader.mesh.rotation.y ? -Math.cos(this.leader.mesh.rotation.y) : -1,
      )
      const targetX = leaderPos.x + Math.cos(leaderAngle + this.offsetAngle) * this.stopDistance
      const targetZ = leaderPos.z + Math.sin(leaderAngle + this.offsetAngle) * this.stopDistance
      this.follower.moveTo({ x: targetX, z: targetZ }, this.followerSpeed)
    }
  }
}
