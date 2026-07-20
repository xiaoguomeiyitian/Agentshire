/**
 * AnimalModeManager — central orchestrator for Animal Mode.
 *
 * Animal Mode is an opt-in alternative to the existing work mode.
 * When enabled, citizens become autonomous: they have needs/moods,
 * make their own daily plans, wander the town, visit buildings,
 * socialize, and react to weather/time — all driven by LLM.
 *
 * This manager owns the lifecycle of all Animal Mode subsystems:
 *   - IndoorTracker (who is inside which building)
 *   - RulesEngine   (Markdown rules handbook for LLM prompts)
 *   - NeedsEngine   (8 needs per citizen)
 *   - MoodEngine    (mood from needs + events)
 *   - AutonomyEngine (LLM-driven L2 tactical decisions)
 *   - RelationshipEngine (sentiment between citizens)
 *   - FestivalEngine (scheduled town festivals)
 *   - MoveEngine (citizens moving in/out)
 */

import { IndoorTracker } from './IndoorTracker'
import { RulesEngine } from './RulesEngine'
import { NeedsEngine } from './NeedsEngine'
import { MoodEngine } from './MoodEngine'
import { NeedActionMapper } from './NeedActionMapper'
import { MoodAnimator } from './MoodAnimator'
import { MemoryStore } from './MemoryStore'
import { AutonomyEngine } from './AutonomyEngine'
import type { AutonomyAction, AutonomyDeps } from './AutonomyEngine'
import { RelationshipEngine } from './RelationshipEngine'
import { FestivalEngine } from './FestivalEngine'
import { MoveEngine } from './MoveEngine'
import { EconomyEngine } from './EconomyEngine'
import { DailySettlementEngine } from './DailySettlementEngine'
import { CitizenTradeSystem } from './CitizenTradeSystem'
import { EconomyEventEngine } from './EconomyEventEngine'
import type { EconomyEvent } from './EconomyEventEngine'
import { InventoryEngine } from './InventoryEngine'
import type { InventorySnapshot } from './InventoryEngine'
import type { MemoryEventReporter } from './MemoryStore'
import type { GameClock } from '../GameClock'
import type { TimePeriod } from '../../types'
import { BUILDING_REGISTRY } from '../../types'
import type { IWorldDataSource } from '../../data/IWorldDataSource'

export interface AnimalModeConfig {
  enabled: boolean
  citizenIds: string[]
  l2IntervalMs: number       // default 180_000 (3 min)
  l2IntervalJitterMs: number // default 60_000 (1 min)
}

export class AnimalModeManager {
  private enabled = false
  private indoorTracker = new IndoorTracker()
  private rulesEngine = new RulesEngine()
  private needsEngine = new NeedsEngine()
  private moodEngine = new MoodEngine()
  private needActionMapper = new NeedActionMapper()
  private moodAnimator = new MoodAnimator()
  private memoryStore = new MemoryStore()
  private autonomyEngine: AutonomyEngine | null = null
  private relationshipEngine = new RelationshipEngine()
  private festivalEngine = new FestivalEngine()
  private moveEngine = new MoveEngine()
  private economyEngine = new EconomyEngine()
  private dailySettlementEngine = new DailySettlementEngine()
  private tradeSystem: CitizenTradeSystem | null = null
  private eventEngine = new EconomyEventEngine()
  private inventoryEngine = new InventoryEngine()
  private gameClock: GameClock | null = null
  private dataSource: IWorldDataSource | null = null
  private lastTickHour = -1
  private lastSettlementDay = -1
  private economyReportTimer: number | null = null
  private inventoryReportTimer: number | null = null
  private eventCheckTimer: number | null = null
  private pruneTimer: number | null = null
  private clockReportTimer: number | null = null
  private snapshotReportTimer: number | null = null
  private l2DecisionTimer: number | null = null
  /** Issue 7: when true, L2 autonomous LLM decisions are suspended (steward task in progress). */
  private l2Paused = false

  // Injected deps for AutonomyEngine (set via setExternalDeps)
  private externalDeps: Partial<AutonomyDeps> = {}
  private homeBuildings: Map<string, string> = new Map() // npcId -> buildingKey
  private executingActions: Set<string> = new Set() // npcIds currently executing an action
  /** Citizens whose needs/economy should freeze (e.g. gathered for an active
   *  topic). Set each frame by MainScene.update via the update() arg. */
  private frozenCitizens: Set<string> = new Set()
  /** Callback when a citizen falls into trouble (worry event) — MainScene wires it to the trouble minigame. */
  onTrouble: ((npcId: string, severity: 'low' | 'high') => void) | null = null

  /** Whether Animal Mode is currently active. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Inject the dataSource for WS reporting to plugin layer. */
  setDataSource(dataSource: IWorldDataSource | null): void {
    this.dataSource = dataSource
    // Wire MemoryStore reporter → dataSource.sendAction → WS → plugin
    const reporter: MemoryEventReporter | null = dataSource
      ? (npcId, entry) => {
          dataSource.sendAction({ type: 'animal_memory_event', npcId, entry } as any)
        }
      : null
    this.memoryStore.setReporter(reporter)
  }

  /** Inject external deps needed by AutonomyEngine (LLM, nearby NPCs, weather, etc.). */
  setExternalDeps(deps: Partial<AutonomyDeps>): void {
    this.externalDeps = { ...this.externalDeps, ...deps }
    console.log(`[AnimalMode] setExternalDeps: keys=[${Object.keys(deps).join(',')}]`)
    // If autonomyEngine already exists, rebuild it with new deps
    if (this.autonomyEngine && this.gameClock) {
      this.buildAutonomyEngine()
    }
  }

  /** Set a citizen's home building key (for NeedActionMapper). */
  setHomeBuilding(npcId: string, buildingKey: string): void {
    this.homeBuildings.set(npcId, buildingKey)
  }

  /** Get a citizen's home building key. */
  getHomeBuilding(npcId: string): string | null {
    return this.homeBuildings.get(npcId) ?? null
  }

  /**
   * Reverse lookup: given a building key, return the npcId whose home it is.
   * Returns the first match (each residential building hosts one citizen in
   * the default allocation). Used by MainScene to determine which resident NPC
   * to show when the mayor visits a house scene.
   */
  getResidentOfBuilding(buildingKey: string): string | null {
    for (const [npcId, key] of this.homeBuildings) {
      if (key === buildingKey) return npcId
    }
    return null
  }

  /** Build the AutonomyEngine with current deps + gameClock. */
  private buildAutonomyEngine(): void {
    if (!this.gameClock) return
    const deps: AutonomyDeps = {
      needsEngine: this.needsEngine,
      moodEngine: this.moodEngine,
      rulesEngine: this.rulesEngine,
      needActionMapper: this.needActionMapper,
      moodAnimator: this.moodAnimator,
      indoorTracker: this.indoorTracker,
      gameClock: this.gameClock,
      implicitChat: this.externalDeps.implicitChat ?? (async () => ({ text: '', fallback: true })),
      getNearbyNpcs: this.externalDeps.getNearbyNpcs ?? (() => []),
      getWeather: this.externalDeps.getWeather ?? (() => 'clear'),
      getCurrentLocation: this.externalDeps.getCurrentLocation ?? ((npcId) => {
        const indoor = this.indoorTracker.getIndoorLocation(npcId)
        return indoor ?? '户外'
      }),
      getPersona: this.externalDeps.getPersona ?? (() => '普通居民'),
      getHomeBuilding: (npcId) => this.homeBuildings.get(npcId) ?? null,
      getCurrentPlan: this.externalDeps.getCurrentPlan ?? (() => null),
      onAction: (npcId, action) => this.executeAction(npcId, action),
      // Inject memory + relationship accessors for context-aware decisions
      getRecentMemories: (npcId, limit = 5) => {
        const dialogues = this.memoryStore.getDialogues(npcId, undefined, limit)
          .map((d) => `和${d.partnerName}聊过：${d.summary}`)
        const activities = this.memoryStore.getActivities(npcId, limit)
          .map((a) => `${a.action}（${a.location}${a.detail ? `·${a.detail}` : ''}）`)
        return [...dialogues, ...activities].slice(-limit)
      },
      getRelationships: (npcId, limit = 3) => {
        return this.relationshipEngine.getTopRelationships(npcId, limit)
      },
      // P0-2: inject economy state for context-aware L2 decisions
      getEconomyState: (npcId) => {
        const c = this.economyEngine.getCitizen(npcId)
        return c
          ? { coins: c.coins, frugal: c.frugal, savingsGoal: c.savingsGoal, todayWorkReward: c.todayWorkReward }
          : null
      },
      // N-1: inject inventory access for L2 decisions (e.g. eat from backpack)
      getInventory: (npcId) => this.inventoryEngine.getInventory(npcId),
    }
    this.autonomyEngine = new AutonomyEngine(deps)
    console.log('[AnimalMode] AutonomyEngine built with deps (memories + relationships injected)')
  }

  /** Execute an AutonomyAction (called by AutonomyEngine via onAction callback). */
  private executeAction(npcId: string, action: AutonomyAction): void {
    if (this.executingActions.has(npcId)) {
      console.log(`[AnimalMode] executeAction: ${npcId} busy, skip ${action.type}`)
      return
    }
    console.log(`[AnimalMode] executeAction: ${npcId} → ${action.type} ${JSON.stringify(action)}`)
    // The actual execution (walk, talk, go indoor) is handled by MainScene
    // via the onAction callback injected through externalDeps.
    if (this.externalDeps.onAction) {
      this.externalDeps.onAction(npcId, action)
    }
  }

  /** Mark a citizen as busy executing an action (prevents new decisions). */
  setExecuting(npcId: string, busy: boolean): void {
    if (busy) this.executingActions.add(npcId)
    else this.executingActions.delete(npcId)
  }

  /** Is a citizen currently executing an action? */
  isExecuting(npcId: string): boolean {
    return this.executingActions.has(npcId)
  }

  /** Enable Animal Mode and register citizens. */
  async enable(citizenIds: string[], gameClock?: GameClock): Promise<void> {
    if (this.enabled) return
    this.enabled = true
    this.gameClock = gameClock ?? null
    console.log(`[AnimalMode] enable: citizens=[${citizenIds.join(',')}] clock=${gameClock ? 'yes' : 'no'}`)
    // Load rules handbook (async, non-blocking)
    void this.rulesEngine.load().then(() => {
      console.log(`[AnimalMode] rules loaded (${this.rulesEngine.getRules().length} chars)`)
    }).catch((e) => console.warn(`[AnimalMode] rules load failed:`, e))
    // Register citizens in needs engine
    for (const id of citizenIds) {
      this.needsEngine.registerCitizen(id)
      this.economyEngine.registerCitizen(id)
      this.eventEngine.registerCitizen(id)
      this.inventoryEngine.registerCitizen(id)
    }
    console.log(`[AnimalMode] registered ${citizenIds.length} citizens in NeedsEngine + EconomyEngine + InventoryEngine`)
    // Build AutonomyEngine with current deps + gameClock
    this.buildAutonomyEngine()
    // Wire FestivalEngine with IndoorTracker
    this.festivalEngine.setIndoorTracker(this.indoorTracker)
    this.festivalEngine.setCallbacks(
      (type) => console.log(`[AnimalMode] Festival started: ${type}`),
      () => console.log('[AnimalMode] Festival ended'),
    )
    // Wire MoveEngine with all engines
    this.moveEngine.setEngines(this.needsEngine, this.moodEngine, this.relationshipEngine, this.indoorTracker)
    // Wire DailySettlementEngine with all engines
    this.dailySettlementEngine.setEngines(this.needsEngine, this.moodEngine, this.economyEngine, this.indoorTracker)
    // Wire CitizenTradeSystem with economy + needs + relationships
    this.tradeSystem = new CitizenTradeSystem(this.economyEngine, this.needsEngine, this.relationshipEngine)
    // N-1: inject inventory engine so gifts are pushed to the receiver's backpack
    this.tradeSystem.setInventoryEngine(this.inventoryEngine)
    // Wire EconomyEventEngine with all engines
    this.eventEngine.setDeps({
      economy: this.economyEngine,
      needs: this.needsEngine,
      mood: this.moodEngine,
      relationships: this.relationshipEngine,
    })
    // Request persisted state from plugin (snapshots + clock)
    this.dataSource?.sendAction({ type: 'animal_state_load' } as any)
    // Start periodic mood event pruning (every 30s)
    this.pruneTimer = window.setInterval(() => {
      this.moodEngine.pruneExpired()
    }, 30_000)
    // Start periodic GameClock state reporting (every 30s)
    this.clockReportTimer = window.setInterval(() => this.reportClockState(), 30_000)
    // Start periodic ActivityJournal snapshot reporting (every 60s)
    this.snapshotReportTimer = window.setInterval(() => {
      // MainScene calls reportSnapshots() externally; this is a fallback
    }, 60_000)
    // Start L2 tactical decision loop (every 30s check which citizens are due)
    this.l2DecisionTimer = window.setInterval(() => this.runL2Decisions(), 30_000)
    console.log('[AnimalMode] L2 decision loop started (30s interval)')
    // Start periodic economy state reporting (every 60s)
    this.economyReportTimer = window.setInterval(() => this.reportEconomyState(), 60_000)
    // N-1: Start periodic inventory state reporting (every 60s)
    this.inventoryReportTimer = window.setInterval(() => this.reportInventoryState(), 60_000)
    // Start periodic economy event checking (every 60s)
    this.eventCheckTimer = window.setInterval(() => this.checkEconomyEvents(), 60_000)
    console.log('[AnimalMode] economy reporting + event checking started')
  }

  /** Run L2 tactical decisions for all citizens that are due. */
  private async runL2Decisions(): Promise<void> {
    if (!this.enabled || !this.autonomyEngine) return
    // Issue 7: when the steward has summoned citizens for a task, suspend L2
    // autonomous LLM decisions until the workflow completes. This stops
    // citizens from making autonomous decisions (and calling the LLM) while
    // they are supposed to be working on the steward's task.
    if (this.l2Paused) return
    const now = Date.now()
    // Collect all due citizens first, then run decisions in parallel
    const dueCitizens: string[] = []
    for (const npcId of this.needsEngine.getCitizens()) {
      if (this.executingActions.has(npcId)) continue
      if (!this.autonomyEngine.isDueForDecision(npcId, now)) continue
      dueCitizens.push(npcId)
    }
    if (dueCitizens.length === 0) return

    // Run all L2 decisions in parallel (each calls LLM independently)
    await Promise.all(dueCitizens.map(async (npcId) => {
      try {
        const action = await this.autonomyEngine!.decide(npcId, npcId)
        console.log(`[AnimalMode] L2 decision for ${npcId}: ${action.type}`)
        this.executeAction(npcId, action)
      } catch (err) {
        console.warn(`[AnimalMode] L2 decision failed for ${npcId}:`, err)
      }
    }))
  }

  /** Disable Animal Mode and clear all state. */
  disable(): void {
    console.log(`[AnimalMode] disable: clearing all state`)
    this.enabled = false
    this.indoorTracker.clear()
    this.needsEngine.clear()
    this.moodEngine.clear()
    this.memoryStore.clear()
    this.gameClock = null
    this.lastTickHour = -1
    this.autonomyEngine?.clear()
    this.autonomyEngine = null
    this.festivalEngine.endFestival()
    this.executingActions.clear()
    this.homeBuildings.clear()
    this.economyEngine.clear()
    this.dailySettlementEngine.clear()
    this.tradeSystem?.clear()
    this.tradeSystem = null
    this.eventEngine.clear()
    this.inventoryEngine.clear()
    this.lastSettlementDay = -1
    if (this.pruneTimer !== null) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    if (this.clockReportTimer !== null) {
      clearInterval(this.clockReportTimer)
      this.clockReportTimer = null
    }
    if (this.snapshotReportTimer !== null) {
      clearInterval(this.snapshotReportTimer)
      this.snapshotReportTimer = null
    }
    if (this.l2DecisionTimer !== null) {
      clearInterval(this.l2DecisionTimer)
      this.l2DecisionTimer = null
    }
    if (this.economyReportTimer !== null) {
      clearInterval(this.economyReportTimer)
      this.economyReportTimer = null
    }
    if (this.inventoryReportTimer !== null) {
      clearInterval(this.inventoryReportTimer)
      this.inventoryReportTimer = null
    }
    if (this.eventCheckTimer !== null) {
      clearInterval(this.eventCheckTimer)
      this.eventCheckTimer = null
    }
    // Issue 7: reset L2 pause flag so a fresh enable() starts unpaused.
    this.l2Paused = false
    // Clear plugin-side memories
    this.dataSource?.sendAction({ type: 'animal_memory_clear_all' } as any)
  }

  /** Toggle Animal Mode on/off. */
  async setEnabled(enabled: boolean, citizenIds: string[], gameClock?: GameClock): Promise<void> {
    if (enabled) await this.enable(citizenIds, gameClock)
    else this.disable()
  }

  /**
   * Issue 7: Pause L2 autonomous LLM decisions (called when the steward
   * summons citizens for a task). Needs/mood engines keep running so citizens
   * still have live state, but no new LLM autonomy_decide calls are made.
   */
  pauseL2Decisions(): void {
    if (!this.enabled || this.l2Paused) return
    this.l2Paused = true
    console.log('[AnimalMode] L2 decisions paused (steward task in progress)')
  }

  /**
   * Issue 7: Resume L2 autonomous LLM decisions (called when the workflow
   * returns to idle). Resets decision timers so citizens don't immediately
   * fire a burst of decisions after a long pause.
   */
  resumeL2Decisions(): void {
    if (!this.enabled || !this.l2Paused) return
    this.l2Paused = false
    // Reset decision timers so citizens don't all fire at once after resuming.
    this.autonomyEngine?.clear()
    console.log('[AnimalMode] L2 decisions resumed')
  }

  /** Issue 7: is L2 currently paused? */
  isL2Paused(): boolean {
    return this.l2Paused
  }

  /**
   * Issue 2: Register a single citizen in the NeedsEngine (for late-arriving
   * NPCs that spawn after Animal Mode was enabled). Safe to call multiple times.
   */
  registerCitizen(npcId: string): void {
    if (!this.enabled) return
    if (this.needsEngine.getCitizens().includes(npcId)) return
    this.needsEngine.registerCitizen(npcId)
    this.economyEngine.registerCitizen(npcId)
    this.eventEngine.registerCitizen(npcId)
    this.inventoryEngine.registerCitizen(npcId)
    console.log(`[AnimalMode] late-registered citizen ${npcId} in NeedsEngine + EconomyEngine + InventoryEngine`)
  }

  /** Called every frame from MainScene.update(). Advances needs by game-time.
   *  `frozenCitizens` — citizens whose needs/economy should freeze (e.g.
   *  gathered for an active topic). */
  update(deltaTimeMs: number, frozenCitizens?: Set<string>): void {
    if (!this.enabled || !this.gameClock) return
    // Track frozen citizens for checkEconomyEvents() (independent timer).
    this.frozenCitizens = frozenCitizens ?? new Set()
    // Update FestivalEngine (auto-end festival after duration)
    this.festivalEngine.update(deltaTimeMs)
    // Convert real ms to game-hours using GameClock's day duration
    // GameClock exposes getGameHour() returning the current game hour (0-24).
    // We approximate decay by the change in game-hours since last tick.
    const currentHour = this.gameClock.getGameHour()
    if (this.lastTickHour < 0) {
      this.lastTickHour = currentHour
      return
    }
    let deltaHours = currentHour - this.lastTickHour
    if (deltaHours < 0) deltaHours += 24 // day wrap
    // Only tick when accumulated at least 0.1 game-hours (6 game-minutes)
    // to avoid floating-point noise causing every-frame ticks.
    if (deltaHours >= 0.1) {
      this.needsEngine.tick(deltaHours, frozenCitizens)
      this.lastTickHour = currentHour
      // Issue 6: citizens at home slowly recover fatigue/hygiene/safety (rest,
      // clean, shelter). Being home is a restorative state.
      // P1-1: hunger recovery removed from indoor logic — breakfast is now
      // the single hunger restore path (DailySettlementEngine at 06:00, +40
      // only when at home). Cafe purchases go into the backpack and restore
      // hunger when the item is used (see InventoryEngine.useItem).
      // Issue 2: citizens in commercial buildings (cafe/market) also recover
      // social/fun while inside (but NOT hunger — that requires buying food).
      for (const npcId of this.needsEngine.getCitizens()) {
        if (frozenCitizens?.has(npcId)) continue
        if (this.indoorTracker.isIndoor(npcId)) {
          const indoorLoc = this.indoorTracker.getIndoorLocation(npcId)
          const homeKey = this.homeBuildings.get(npcId)
          // At own home: full recovery (rest, clean, safety) — no hunger
          if (indoorLoc && indoorLoc === homeKey) {
            this.needsEngine.satisfy(npcId, 'fatigue', deltaHours * 12)
            this.needsEngine.satisfy(npcId, 'hygiene', deltaHours * 10)
            this.needsEngine.satisfy(npcId, 'safety', deltaHours * 8)
          } else {
            // Check if inside a commercial building (cafe/market)
            const indoorBuilding = BUILDING_REGISTRY.find((b) => b.key === indoorLoc)
            if (indoorBuilding && indoorBuilding.category === 'commercial') {
              // Issue 2: cafe/market recovery — social, fun (hunger via backpack items only)
              if (indoorBuilding.tag === 'cafe') {
                this.needsEngine.satisfy(npcId, 'social', deltaHours * 4)
                this.needsEngine.satisfy(npcId, 'fun', deltaHours * 3)
              } else if (indoorBuilding.tag === 'market') {
                this.needsEngine.satisfy(npcId, 'fun', deltaHours * 3)
              }
            } else {
              // Visiting another citizen's home: partial recovery (rest, safety)
              this.needsEngine.satisfy(npcId, 'fatigue', deltaHours * 5)
              this.needsEngine.satisfy(npcId, 'safety', deltaHours * 5)
            }
          }
        }
      }
      // Log every game-hour change (sample first citizen)
      const firstId = this.needsEngine ? (this as any).needsEngine.needs.keys().next().value : null
      if (firstId) {
        const snap = this.needsEngine.getSnapshot(firstId)
        if (snap) {
          console.log(`[AnimalMode] tick: +${deltaHours.toFixed(2)}h → ${firstId} lowest=${snap.lowest}(${snap.needs[snap.lowest].toFixed(0)}) avg=${snap.average.toFixed(0)} urgent=[${snap.urgent.join(',')}]`)
        }
      }
    }
  }

  /** Called when GameClock changes time period (dawn/morning/.../night). */
  onPeriodChange(_period: TimePeriod): void {
    console.log(`[AnimalMode] onPeriodChange: ${_period} (enabled=${this.enabled})`)
    if (!this.enabled) return
    // At dawn: check festival trigger + move-out eligibility
    if (_period === 'dawn' && this.gameClock) {
      const dayCount = this.gameClock.getState().dayCount
      // Run daily settlement (salary + work reward + reputation bonus + need restores)
      // Only once per game-day (guard against multiple dawn ticks)
      if (this.lastSettlementDay !== dayCount) {
        this.lastSettlementDay = dayCount
        this.eventEngine.setCurrentDay(dayCount)
        const settlement = this.dailySettlementEngine.runDailySettlement(dayCount)
        // Check overdue loans
        this.tradeSystem?.checkOverdueLoans(dayCount)
        console.log(`[AnimalMode] Daily settlement for day ${dayCount}: ${settlement.citizens.length} citizens`)
      }
      if (this.festivalEngine.shouldTriggerFestival(dayCount)) {
        this.festivalEngine.startFestival(null, dayCount)
        console.log(`[AnimalMode] Festival auto-triggered on day ${dayCount}`)
      }
      // Check move-out eligibility for all citizens
      for (const npcId of this.needsEngine.getCitizens()) {
        const candidate = this.moveEngine.checkMoveOutEligibility(npcId, dayCount)
        if (candidate && this.moveEngine.shouldMoveOut(candidate)) {
          console.log(`[AnimalMode] Move-out candidate: ${npcId} (${candidate.reason})`)
          // MainScene handles actual move-out via externalDeps callback
          if (this.externalDeps.onAction) {
            this.externalDeps.onAction(npcId, { type: 'go_home', reason: candidate.reason })
          }
        }
      }
    }
  }

  // ── Subsystem accessors ──
  getIndoorTracker(): IndoorTracker { return this.indoorTracker }
  getRulesEngine(): RulesEngine { return this.rulesEngine }
  getNeedsEngine(): NeedsEngine { return this.needsEngine }
  getMoodEngine(): MoodEngine { return this.moodEngine }
  getNeedActionMapper(): NeedActionMapper { return this.needActionMapper }
  getMoodAnimator(): MoodAnimator { return this.moodAnimator }
  getMemoryStore(): MemoryStore { return this.memoryStore }
  getAutonomyEngine(): AutonomyEngine | null { return this.autonomyEngine }
  getRelationshipEngine(): RelationshipEngine { return this.relationshipEngine }
  getFestivalEngine(): FestivalEngine { return this.festivalEngine }
  getEconomyEngine(): EconomyEngine { return this.economyEngine }
  getDailySettlementEngine(): DailySettlementEngine { return this.dailySettlementEngine }
  getTradeSystem(): CitizenTradeSystem | null { return this.tradeSystem }
  getEventEngine(): EconomyEventEngine { return this.eventEngine }
  getInventoryEngine(): InventoryEngine { return this.inventoryEngine }
  getMoveEngine(): MoveEngine { return this.moveEngine }

  // ── Plugin persistence reporting ──

  /** Report current GameClock state to plugin (called periodically + on disable). */
  reportClockState(): void {
    if (!this.gameClock || !this.dataSource) return
    this.dataSource.sendAction({
      type: 'animal_clock_save',
      state: { dayCount: this.gameClock.getState().dayCount, gameSeconds: this.gameClock.getGameSeconds(), savedAt: Date.now() },
    } as any)
  }

  /** Report all ActivityJournal snapshots to plugin (called by MainScene periodically). */
  reportSnapshots(journals: Array<{ npcId: string; snapshot: unknown }>): void {
    if (!this.dataSource) return
    for (const { npcId, snapshot } of journals) {
      this.dataSource.sendAction({ type: 'animal_snapshot_save', npcId, snapshot } as any)
    }
  }

  /** Restore state received from plugin (snapshots + clock). Called by MainScene. */
  restoreAnimalState(snapshots: Array<{ npcId: string; snapshot: any }>, clock: { dayCount: number; gameSeconds: number } | null): void {
    // MainScene handles the actual restore (it owns ActivityJournals + GameClock)
    // This is a hook for any MemoryStore-specific restore
    if (clock && this.gameClock) {
      // GameClock restore is handled by MainScene directly
    }
    // Reset the needs-tick baseline so the clock jump from restoreFromPlugin
    // does not produce a huge deltaHours that decays all needs to zero.
    this.lastTickHour = this.gameClock?.getGameHour() ?? -1
    console.log(`[AnimalMode] restoreAnimalState: ${snapshots.length} snapshots, clock=${clock ? 'yes' : 'no'}, lastTickHour reset to ${this.lastTickHour?.toFixed(2)}`)
  }

  /** Restore economy state received from plugin. Called by MainScene on reconnect. */
  restoreEconomyState(economy: { citizens: Record<string, any>; savedAt: number } | null): void {
    if (!economy) {
      console.log('[AnimalMode] restoreEconomyState: no saved economy, using defaults')
      return
    }
    this.economyEngine.restoreSnapshot(economy as any)
    console.log(`[AnimalMode] restoreEconomyState: ${Object.keys(economy.citizens ?? {}).length} citizens restored`)
  }

  /** Report current economy state to plugin (called periodically). */
  reportEconomyState(): void {
    if (!this.dataSource) return
    const snapshot = this.economyEngine.getSnapshot()
    this.dataSource.sendAction({ type: 'economy_state_save', state: snapshot })
  }
  /** N-1: Report current inventory state to plugin (called periodically). */
  reportInventoryState(): void {
    if (!this.dataSource) return
    const snapshot = this.inventoryEngine.getSnapshot()
    this.dataSource.sendAction({ type: 'inventory_state_save', state: snapshot } as any)
  }

  /**
   * N-1: Buy a café item and put it into the citizen's backpack.
   * Combines EconomyEngine.buyCafeItem (deduct coins + cooldown) with
   * InventoryEngine.addItem (push to backpack). The citizen can later
   * consume the item via InventoryEngine.useItem to restore hunger/energy/mood.
   * Returns the purchased item, or null if the purchase failed.
   */
  buyCafeItemToBackpack(npcId: string, itemId: string): import('./InventoryEngine').InventoryItem | null {
    const item = this.economyEngine.buyCafeItem(npcId, itemId)
    if (!item) return null
    const invItem = this.inventoryEngine.addItem(npcId, {
      itemId: item.id,
      name: item.name,
      icon: 'coffee',
      count: 1,
      category: 'food',
      effects: item.effects,
      source: 'cafe_purchase',
    })
    console.log(`[AnimalMode] ${npcId} bought ${item.name} → backpack (coins=${this.economyEngine.getCoins(npcId)})`)
    return invItem
  }

  /**
   * N-1: Consume a food item from the citizen's backpack to restore hunger.
   * Called by AutonomyEngine when a citizen decides to eat from their backpack
   * (e.g. hunger urgent and they own food). Returns the consumed item or null.
   */
  consumeFoodFromBackpack(npcId: string): import('./InventoryEngine').InventoryItem | null {
    const inv = this.inventoryEngine.getInventory(npcId)
    const food = inv.find((i) => i.category === 'food' && i.count > 0)
    if (!food) return null
    return this.inventoryEngine.useItem(npcId, food.itemId, this.needsEngine)
  }

  /** N-1: Restore inventory state received from plugin. Called by MainScene on reconnect. */
  restoreInventoryState(inventory: InventorySnapshot | null): void {
    if (!inventory) {
      console.log('[AnimalMode] restoreInventoryState: no saved inventory, using defaults')
      return
    }
    this.inventoryEngine.restoreSnapshot(inventory)
    console.log(`[AnimalMode] restoreInventoryState: ${Object.keys(inventory.citizens ?? {}).length} citizens restored`)
  }
  /** Check all citizens for economy-triggered events and dispatch them. */
  private checkEconomyEvents(): void {
    if (!this.enabled) return
    // P1-4: when L2 is paused (topic mode / steward task), skip all economy
    // events. The frozenCitizens set from update() may lag behind the actual
    // pause state because checkEconomyEvents runs on an independent 60s timer.
    // Checking l2Paused directly ensures we freeze immediately when the topic
    // starts, even before the next update() call populates frozenCitizens.
    if (this.l2Paused) return
    const events = this.eventEngine.checkAll()
    for (const evt of events) {
      // Skip citizens frozen by an active topic (their economy should pause).
      if (this.frozenCitizens.has(evt.npcId)) continue
      console.log(`[AnimalMode] economy event: ${evt.type} for ${evt.npcId} — ${evt.message}`)
      // Dispatch via externalDeps.onAction or handle welfare/mayor_care directly
      this.handleEconomyEvent(evt)
    }
  }

  /** Handle a single economy event (welfare relief, force home, notify mayor, etc.). */
  private handleEconomyEvent(evt: EconomyEvent): void {
    switch (evt.type) {
      case 'welfare_relief': {
        // Free food from town welfare (no coin cost)
        this.needsEngine.satisfy(evt.npcId, 'hunger', evt.amount ?? 30)
        console.log(`[AnimalMode] welfare relief: ${evt.npcId} hunger +${evt.amount ?? 30}`)
        break
      }
      case 'force_go_home': {
        if (this.externalDeps.onAction) {
          this.externalDeps.onAction(evt.npcId, { type: 'go_home', reason: 'exhausted' })
        }
        break
      }
      case 'mayor_care': {
        // Mayor care: mood boost (via fun need) + belonging boost
        this.needsEngine.satisfy(evt.npcId, 'fun', evt.amount ?? 20)
        this.needsEngine.satisfy(evt.npcId, 'belonging', 10)
        this.moodEngine.applyEvent(evt.npcId, 20, 120_000)
        console.log(`[AnimalMode] mayor care: ${evt.npcId} mood +20`)
        break
      }
      case 'help_request': {
        // Try to find a friend to help; if none, town welfare kicks in
        const rels = this.relationshipEngine.getTopRelationships(evt.npcId, 3)
        // getTopRelationships returns { name, sentiment } — we need the npcId.
        // Look up via getAllRelationships to get the npcId.
        const allRels = this.relationshipEngine.getAllRelationships(evt.npcId)
        const friendEntry = allRels.find((r) => r.sentiment > 60)
        if (friendEntry && this.tradeSystem) {
          const result = this.tradeSystem.giftCoins(friendEntry.npcId, evt.npcId, friendEntry.name, evt.npcId)
          console.log(`[AnimalMode] help_request: ${result.message}`)
        } else {
          // No friend: town welfare gives 10 coins
          this.economyEngine.earn(evt.npcId, 10, 'welfare')
          console.log(`[AnimalMode] help_request: no friend, welfare gives 10 coins to ${evt.npcId}`)
        }
        // Trigger trouble minigame — citizen is in distress
        if (this.onTrouble) this.onTrouble(evt.npcId, 'high')
        break
      }
      case 'celebration': {
        // Host a gathering — gather friends at plaza
        if (this.externalDeps.onAction) {
          this.externalDeps.onAction(evt.npcId, { type: 'explore', target: 'plaza', reason: 'celebration' } as any)
        }
        break
      }
      case 'leave_warning':
      case 'move_out': {
        // Notify mayor (could trigger a dialog or UI notification)
        console.warn(`[AnimalMode] ${evt.type}: ${evt.message}`)
        break
      }
      case 'conflict': {
        // Conflict event — trigger trouble minigame for the initiator
        if (this.onTrouble) this.onTrouble(evt.npcId, 'high')
        break
      }
      default:
        // gratitude handled by EncounterManager directly
        break
    }
  }
}

// Singleton instance (created once, referenced by MainScene)
let _instance: AnimalModeManager | null = null
export function getAnimalModeManager(): AnimalModeManager {
  if (!_instance) _instance = new AnimalModeManager()
  return _instance
}
