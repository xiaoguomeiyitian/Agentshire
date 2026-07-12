import { NPC } from './NPC'
import { WAYPOINTS, BUILDING_REGISTRY, type BuildingDef, type NPCRouteProfile } from '../types'
import type { GameClock } from '../game/GameClock'
import type { ActivityJournal } from './ActivityJournal'
import type { AgentBrain } from './AgentBrain'
import { matchTemplate, getTemplateById, getScheduleSlotForPeriod, randInRange } from './RoutineTemplates'
import { getLocale } from '../i18n'

export type BehaviorState =
  | 'sleeping' | 'leaving_home' | 'roaming' | 'at_building' | 'walking_home'
  | 'summoned' | 'gathered' | 'assigned' | 'at_office'

const IDLE_ANIMS: string[] = ['idle', 'sitting', 'thinking']
const PARK_KEYS = ['park_bench_1', 'park_bench_2', 'park_center']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

// ── Shared occupancy tracker across all DailyBehavior instances ──
const occupancy = new Map<string, Set<string>>()

function getOccupancy(buildingKey: string): Set<string> {
  let set = occupancy.get(buildingKey)
  if (!set) {
    set = new Set()
    occupancy.set(buildingKey, set)
  }
  return set
}

// ── Destination intent tracker (includes in-transit + arrived NPCs) ──
const destinationCounts = new Map<string, number>()

function claimDestination(buildingKey: string): void {
  destinationCounts.set(buildingKey, (destinationCounts.get(buildingKey) ?? 0) + 1)
}

function releaseDestination(buildingKey: string): void {
  const c = (destinationCounts.get(buildingKey) ?? 1) - 1
  if (c <= 0) destinationCounts.delete(buildingKey)
  else destinationCounts.set(buildingKey, c)
}

function getDestinationCount(buildingKey: string): number {
  return destinationCounts.get(buildingKey) ?? 0
}

export function generateRouteProfile(npcId: string, homeBuilding: string, specialty?: string): NPCRouteProfile {
  const template = matchTemplate(specialty ?? '')
  const affinities: Record<string, number> = {}
  let total = 0
  for (const b of BUILDING_REGISTRY) {
    let w = 0.5 + Math.random() * 0.5
    if (b.key === homeBuilding) w *= 1.2
    if (b.category === 'commercial') w *= 1.3
    if (b.category === 'public') w *= 1.2
    if (b.category === 'workspace') w *= 1.1
    if (b.key === 'user_home_door') w *= 0.3
    affinities[b.key] = w
    total += w
  }
  for (const k of Object.keys(affinities)) {
    affinities[k] /= total
  }

  return {
    npcId,
    homeBuilding,
    affinities,
    stayMultiplier: randInRange(template.stayMultiplier),
    wakeDelay: Math.max(0, randInRange(template.wakeOffset)),
    homeDelay: Math.max(0, randInRange(template.sleepOffset)),
    templateId: template.id,
    walkSpeed: randInRange(template.walkSpeed),
    socialLevel: template.socialLevel,
  }
}

export class DailyBehavior {
  private npc: NPC
  private gameClock: GameClock
  private profile: NPCRouteProfile
  private spotAllocator: import('./SpotAllocator').SpotAllocator | null
  private lastVisitedKey: string | null = null
  private pendingDestKey: string | null = null
  private state: BehaviorState = 'sleeping'
  private stateTimer = 0
  private stateDuration = 0
  private active = false
  private walkToken = 0
  private _inDialogue = false
  private _dialoguePausedState: BehaviorState | null = null
  private currentBuilding: string | null = null
  private microTimer = 0
  private microInterval = 0
  private periodListenerId: string
  private pendingWake = false
  private pendingHome = false
  private stuckTimer = 0
  private wakeTimer = 0
  private homeTimer = 0
  private journal: ActivityJournal | null = null
  private brain: AgentBrain | null = null

  constructor(npc: NPC, gameClock: GameClock, profile: NPCRouteProfile, spotAllocator?: import('./SpotAllocator').SpotAllocator) {
    this.npc = npc
    this.gameClock = gameClock
    this.profile = profile
    this.spotAllocator = spotAllocator ?? null
    this.periodListenerId = `daily-${npc.id}`

    this.gameClock.onPeriodChange(this.periodListenerId, (state) => {
      if (!this.active) return
      if (state.period === 'dawn' && this.state === 'sleeping') {
        this.pendingWake = true
        this.wakeTimer = this.profile.wakeDelay
        this.brain?.onDawn()
      }
      if (state.period === 'dusk' && this.isLifeState() && this.state !== 'walking_home') {
        this.pendingHome = true
        this.homeTimer = this.profile.homeDelay
      }
    })
  }

  start(initialDelay?: number): void {
    this.active = true

    const clockState = this.gameClock.getState()
    if (clockState.isNight || clockState.period === 'dawn') {
      this.enterSleeping()
      if (clockState.period === 'dawn') {
        this.pendingWake = true
        this.wakeTimer = (initialDelay ?? 0) + this.profile.wakeDelay
      }
    } else {
      const delay = initialDelay ?? 0
      if (delay > 0) {
        this.pendingWake = true
        this.wakeTimer = delay
      } else {
        this.transitionTo('leaving_home')
        this.startWalkFromHome()
      }
    }
  }

  stop(): void {
    this.active = false
    this.leaveCurrentBuilding()
    this.setDestination(null)
    this.pendingWake = false
    this.pendingHome = false
    this.walkToken++
    this.gameClock.offPeriodChange(this.periodListenerId)
  }

  setJournal(journal: ActivityJournal): void {
    this.journal = journal
  }

  setAgentBrain(brain: AgentBrain): void {
    this.brain = brain
  }

  getAgentBrain(): AgentBrain | null {
    return this.brain
  }

  get inDialogue(): boolean {
    return this._inDialogue
  }

  getWalkSpeed(): number {
    return this.profile.walkSpeed ?? 2.5
  }

  pauseForDialogue(): void {
    this._inDialogue = true
    this._dialoguePausedState = this.state
    this.walkToken++
  }

  resumeFromDialogue(): void {
    this._inDialogue = false
    const wasState = this._dialoguePausedState
    this._dialoguePausedState = null

    if (wasState === 'leaving_home' || wasState === 'roaming') {
      this.transitionTo('roaming')
      this.selectNextDestination()
    }
  }

  getState(): BehaviorState {
    return this.state
  }

  interrupt(_reason: 'summoned'): void {
    this.leaveCurrentBuilding()
    this.setDestination(null)
    this.walkToken++
    this.pendingWake = false
    this.pendingHome = false
    if (this.state === 'sleeping') {
      this.npc.setVisible(true)
    }
    this.journal?.record({
      location: this.currentBuilding ?? 'plaza_center',
      locationName: this.currentBuilding ? this.buildingName(this.currentBuilding) : (getLocale() === 'en' ? 'Plaza' : '广场'),
      action: 'summoned',
      detail: getLocale() === 'en' ? 'Called to briefing' : '被管家叫去开会',
    })
    this.transitionTo('summoned')
  }

  advanceTo(state: 'gathered' | 'assigned' | 'at_office'): void {
    this.transitionTo(state)
  }

  resume(): void {
    this.transitionTo('roaming')
    this.selectNextDestination()
  }

  resumeFromCurrentPosition(): void {
    this.active = true
    this.pendingWake = false
    this.pendingHome = false
    this.transitionTo('roaming')
    this.selectNextDestination()
  }

  update(deltaTime: number, _allNpcs: NPC[]): void {
    if (!this.active || this._inDialogue) return
    if (!this.isLifeState()) return
    const dtMs = deltaTime * 1000

    if (this.pendingWake) {
      this.wakeTimer -= dtMs
      if (this.wakeTimer <= 0) {
        this.pendingWake = false
        if (this.state === 'sleeping') {
          this.npc.setVisible(true)
          this.journal?.record({
            location: this.profile.homeBuilding,
            locationName: this.buildingName(this.profile.homeBuilding),
            action: 'woke_up',
            detail: getLocale() === 'en' ? 'Woke up, heading out' : '起床出门',
          })
          this.transitionTo('leaving_home')
          this.startWalkFromHome()
        }
      }
    }

    if (this.pendingHome) {
      this.homeTimer -= dtMs
      if (this.homeTimer <= 0) {
        this.pendingHome = false
        if (this.isLifeState() && this.state !== 'walking_home' && this.state !== 'sleeping') {
          this.leaveCurrentBuilding()
          this.walkToken++
          this.journal?.record({
            location: this.profile.homeBuilding,
            locationName: this.buildingName(this.profile.homeBuilding),
            action: 'walking',
            detail: getLocale() === 'en' ? 'Getting dark, going home' : '天黑了，准备回家',
          })
          this.transitionTo('walking_home')
          this.startWalkHome()
        }
      }
    }

    if (this.state === 'at_building') {
      this.stateTimer += dtMs
      this.microTimer += dtMs

      // Let AgentBrain drive decisions when available
      if (this.brain) {
        this.brain.update(dtMs)
        const override = this.brain.consumeOverriddenDestination()
        if (override) {
          this.leaveCurrentBuilding()
          if (override === '__home__') {
            this.transitionTo('walking_home')
            this.startWalkHome()
          } else {
            this.transitionTo('roaming')
            this.walkToBuilding(override)
          }
          return
        }
      }

      if (this.microTimer >= this.microInterval) {
        this.microTimer = 0
        this.microInterval = randRange(15_000, 30_000)
        this.doMicroBehavior()
      }

      if (this.stateTimer >= this.stateDuration) {
        this.leaveCurrentBuilding()
        this.transitionTo('roaming')
        this.selectNextDestination()
      }
    }

    // Watchdog: recover NPCs stuck in roaming/leaving_home without active movement
    if ((this.state === 'roaming' || this.state === 'leaving_home') && !this._inDialogue) {
      this.stuckTimer += dtMs
      if (this.stuckTimer > 15_000) {
        this.stuckTimer = 0
        this.npc.setVisible(true)
        this.transitionTo('roaming')
        this.selectNextDestination()
      }
    }

  }

  // ── State transitions ──

  private transitionTo(next: BehaviorState): void {
    this.state = next
    this.stateTimer = 0
    this.stateDuration = 0
    this.stuckTimer = 0
  }

  private enterSleeping(): void {
    this.journal?.record({
      location: this.profile.homeBuilding,
      locationName: this.buildingName(this.profile.homeBuilding),
      action: 'went_home',
      detail: getLocale() === 'en' ? 'Went home' : '回家了',
    })
    this.transitionTo('sleeping')
    this.npc.setVisible(false)
    const home = WAYPOINTS[this.profile.homeBuilding]
    if (home) this.npc.mesh.position.set(home.x, 0, home.z)
  }

  private startWalkFromHome(): void {
    const home = WAYPOINTS[this.profile.homeBuilding]
    if (!home) {
      this.npc.setVisible(true)
      this.transitionTo('roaming')
      this.selectNextDestination()
      return
    }
    this.npc.setVisible(true)
    const target = { x: home.x + 2 + Math.random() * 2, z: home.z + 2 + Math.random() * 2 }
    this.doWalk('leaving_home', target, 2, () => {
      this.transitionTo('roaming')
      this.selectNextDestination()
    })
  }

  private startWalkHome(): void {
    const home = WAYPOINTS[this.profile.homeBuilding]
    if (!home) {
      this.enterSleeping()
      return
    }
    this.doWalk('walking_home', home, 2, () => {
      this.enterSleeping()
    })
  }

  // ── Building selection ──

  private selectNextDestination(): void {
    // Priority 1: AgentBrain override from L2 tactical decision
    if (this.brain) {
      const override = this.brain.consumeOverriddenDestination()
      if (override) {
        if (override === '__home__') {
          this.transitionTo('walking_home')
          this.startWalkHome()
          return
        }
        this.walkToBuilding(override)
        return
      }

      // Priority 2: AgentBrain daily plan
      const planDest = this.brain.getNextPlanDestination()
      if (planDest) {
        this.walkToBuilding(planDest.placeKey)
        return
      }
    }

    // Fallback: original weighted random selection
    const chosen = this.pickBuilding()
    if (!chosen) {
      this.wanderPark()
      return
    }

    const wp = WAYPOINTS[chosen.key]
    if (!wp) {
      this.wanderPark()
      return
    }

    this.setDestination(chosen.key)

    const target = { x: wp.x + (Math.random() - 0.5) * 1.5, z: wp.z + (Math.random() - 0.5) * 1.5 }
    const allocated = this.spotAllocator
      ? this.spotAllocator.allocate(target, this.npc.id, 1.2)
      : target
    const speed = this.profile.walkSpeed ?? 2.5
    this.doWalk('roaming', allocated, speed, () => {
      this.enterBuilding(chosen)
    })
  }

  private pickBuilding(): BuildingDef | null {
    const candidates = BUILDING_REGISTRY.filter(b => {
      if (b.key === this.currentBuilding) return false
      const occ = getOccupancy(b.key)
      return occ.size < b.capacity
    })
    if (candidates.length === 0) return null

    const period = this.gameClock.getPeriod()
    const template = this.profile.templateId ? getTemplateById(this.profile.templateId) : null
    const slot = template ? getScheduleSlotForPeriod(template, period) : null
    const skipSchedule = slot && Math.random() < slot.skipChance
    const preferredTag = skipSchedule ? null : (slot?.preferredTag ?? null)

    let totalWeight = 0
    const weights: number[] = []
    for (const b of candidates) {
      let w = this.profile.affinities[b.key] ?? 0.1

      // Template preference
      if (preferredTag) {
        if (b.tag === preferredTag) w *= 3.0
        else if (b.tag === 'home' && preferredTag !== 'home') w *= 0.2
        else w *= 0.5
      }

      // Crowding penalty: more people heading there = less attractive
      const crowdCount = getDestinationCount(b.key)
      w *= 1 / (1 + crowdCount)

      // Recently visited penalty
      if (b.key === this.lastVisitedKey) w *= 0.15

      weights.push(w)
      totalWeight += w
    }

    let r = Math.random() * totalWeight
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]
      if (r <= 0) return candidates[i]
    }
    return candidates[candidates.length - 1]
  }

  private wanderPark(): void {
    // Try park waypoints first; if not available, wander to a random building area
    const validParkKeys = PARK_KEYS.filter(k => WAYPOINTS[k])
    if (validParkKeys.length > 0) {
      const park = WAYPOINTS[pick(validParkKeys)]
      const target = { x: park.x + (Math.random() - 0.5) * 3, z: park.z + (Math.random() - 0.5) * 3 }
      this.doWalk('roaming', target, 2, () => {
        this.transitionTo('at_building')
        this.stateDuration = randRange(20_000, 40_000)
        this.microInterval = randRange(15_000, 30_000)
        this.npc.playAnim('idle')
      })
      return
    }
    // Fallback: wander near a random building from the registry
    if (BUILDING_REGISTRY.length > 0) {
      const b = pick(BUILDING_REGISTRY)
      const wp = WAYPOINTS[b.key]
      if (wp) {
        const target = { x: wp.x + (Math.random() - 0.5) * 4, z: wp.z + (Math.random() - 0.5) * 4 }
        this.doWalk('roaming', target, 2, () => {
          this.transitionTo('at_building')
          this.stateDuration = randRange(20_000, 40_000)
          this.microInterval = randRange(15_000, 30_000)
          this.npc.playAnim('idle')
        })
        return
      }
    }
    // Last resort: wander near current position
    const pos = this.npc.getPosition()
    const target = { x: pos.x + (Math.random() - 0.5) * 6, z: pos.z + (Math.random() - 0.5) * 6 }
    this.doWalk('roaming', target, 2, () => {
      this.transitionTo('at_building')
      this.stateDuration = randRange(20_000, 40_000)
      this.microInterval = randRange(15_000, 30_000)
      this.npc.playAnim('idle')
    })
  }

  // ── Building stay ──

  private enterBuilding(building: BuildingDef): void {
    this.currentBuilding = building.key
    getOccupancy(building.key).add(this.npc.id)

    this.journal?.record({
      location: building.key,
      locationName: building.name,
      action: 'arrived',
      detail: getLocale() === 'en' ? `Arrived at ${building.name}` : `到达${building.name}`,
    })

    this.brain?.onArrival(building.key)

    this.transitionTo('at_building')
    const [min, max] = building.stayRange
    this.stateDuration = randRange(min, max) * this.profile.stayMultiplier
    this.microInterval = randRange(15_000, 30_000)

    const anim = this.getInitialAnimForBuilding(building)
    this.npc.playAnim(anim as any)
  }

  private walkToBuilding(buildingKey: string): void {
    const building = BUILDING_REGISTRY.find(b => b.key === buildingKey)
    const wp = WAYPOINTS[buildingKey]
    if (!building || !wp) {
      this.wanderPark()
      return
    }
    this.setDestination(buildingKey)
    const target = { x: wp.x + (Math.random() - 0.5) * 1.5, z: wp.z + (Math.random() - 0.5) * 1.5 }
    const allocated = this.spotAllocator
      ? this.spotAllocator.allocate(target, this.npc.id, 1.2)
      : target
    const speed = this.profile.walkSpeed ?? 2.5
    this.doWalk('roaming', allocated, speed, () => {
      this.enterBuilding(building)
    })
  }

  private leaveCurrentBuilding(): void {
    if (this.currentBuilding) {
      this.lastVisitedKey = this.currentBuilding
      this.journal?.record({
        location: this.currentBuilding,
        locationName: this.buildingName(this.currentBuilding),
        action: 'departed',
        detail: getLocale() === 'en' ? `Left ${this.buildingName(this.currentBuilding)}` : `离开${this.buildingName(this.currentBuilding)}`,
      })
      getOccupancy(this.currentBuilding).delete(this.npc.id)
      this.spotAllocator?.release(this.npc.id)
      this.setDestination(null)
      this.currentBuilding = null
    }
  }

  private getInitialAnimForBuilding(b: BuildingDef): string {
    if (b.tag === 'cafe') return 'sitting'
    if (b.tag === 'museum') return Math.random() < 0.4 ? 'thinking' : 'idle'
    return 'idle'
  }

  // ── Micro-behaviors during stay ──

  private doMicroBehavior(): void {
    if (Math.random() < 0.4) {
      this.npc.playAnim(pick(IDLE_ANIMS) as any)
    }

    if (Math.random() < 0.3 && this.currentBuilding) {
      const wp = WAYPOINTS[this.currentBuilding]
      if (wp) {
        const nudge = { x: wp.x + (Math.random() - 0.5) * 1.5, z: wp.z + (Math.random() - 0.5) * 1.5 }
        this.doWalk('at_building', nudge, 1, () => {
          this.npc.playAnim(pick(IDLE_ANIMS) as any)
        })
      }
    }
  }

  // ── Movement helper ──

  private doWalk(duringState: BehaviorState, target: { x: number; z: number }, speed: number, onArrive: () => void): void {
    const token = ++this.walkToken
    this.npc.moveTo(target, speed).then((status) => {
      if (!this.active || this.walkToken !== token || this.state !== duringState) return
      if (status === 'arrived') onArrive()
    })
  }

  // ── Helpers ──

  private setDestination(newKey: string | null): void {
    if (this.pendingDestKey) releaseDestination(this.pendingDestKey)
    this.pendingDestKey = newKey
    if (newKey) claimDestination(newKey)
  }

  private isLifeState(): boolean {
    const lifeStates: BehaviorState[] = ['sleeping', 'leaving_home', 'roaming', 'at_building', 'walking_home']
    return lifeStates.includes(this.state)
  }

  private buildingName(key: string): string {
    return BUILDING_REGISTRY.find(b => b.key === key)?.name ?? key
  }

  isActive(): boolean {
    return this.active
  }
}
