/**
 * EconomyEngine — manages citizen economy: coins, reputation, savings goals.
 *
 * This engine complements NeedsEngine (which handles physiological/social needs)
 * by tracking the economic layer:
 *   - coins:       spendable currency (0-∞, never negative)
 *   - reputation:  town-wide standing (-100..100)
 *   - savingsGoal: personal savings target (random 50-200)
 *
 * Daily settlement (06:00) adds base salary + work rewards + reputation bonus.
 * Spending (cafe, gifts, trades) deducts coins. Earning (tasks, gifts received)
 * adds coins. All mutations go through this engine to keep state consistent
 * and persistable.
 *
 * Persistence: AnimalModeManager snapshots the full economy state via
 * getSnapshot() and restores via restoreSnapshot(). The plugin layer persists
 * it to stateDir()/agents/animal-economy.json (see economy-state.ts).
 */

export interface CitizenEconomy {
  /** Spendable coins (>= 0). */
  coins: number
  /** Town-wide reputation (-100..100). */
  reputation: number
  /** Personal savings target (50-200). When coins > goal * 1.5, frugal mode. */
  savingsGoal: number
  /** Today's accumulated work reward (reset at daily settlement). */
  todayWorkReward: number
  /** Whether citizen is in frugal/savings mode (coins > savingsGoal * 1.5). */
  frugal: boolean
}

export interface EconomySnapshot {
  citizens: Record<string, CitizenEconomy>
  savedAt: number
}

/** Result of a spend attempt. */
export interface SpendResult {
  success: boolean
  remaining: number
  reason?: string
}

/** Café menu items (see design doc §4.1). */
export interface CafeMenuItem {
  id: string
  name: string
  price: number
  effects: {
    hunger?: number
    energy?: number
    mood?: number
    belonging?: number
  }
  cooldownMs: number
}

/** Café menu (see design doc §4.1). */
export const CAFE_MENU: CafeMenuItem[] = [
  { id: 'coffee',    name: '咖啡',   price: 5,  effects: { energy: 15, mood: 5 },                         cooldownMs: 2 * 3600_000 },
  { id: 'sandwich',  name: '三明治', price: 8,  effects: { hunger: 30, mood: 3 },                         cooldownMs: 0 },
  { id: 'cake',      name: '蛋糕',   price: 12, effects: { hunger: 20, mood: 15, belonging: 3 },          cooldownMs: 4 * 3600_000 },
  { id: 'combo',     name: '套餐',   price: 20, effects: { hunger: 50, energy: 20, mood: 10 },            cooldownMs: 6 * 3600_000 },
]

/** Daily settlement parameters (see design doc §2.1). */
export const DAILY_SETTLEMENT = {
  baseSalary: 20,
  maxWorkReward: 50,
  reputationBonusRate: 0.5,
  maxReputationBonus: 25,
  /** Coins threshold above which daily salary is halved (anti-hoarding). */
  hoardingThreshold: 500,
}

/** Reputation adjustment bounds. */
const REP_MIN = -100
const REP_MAX = 100

export class EconomyEngine {
  private citizens: Map<string, CitizenEconomy> = new Map()
  /** Per-citizen cooldowns: npcId -> { itemId -> expiryTimestamp }. */
  private cooldowns: Map<string, Record<string, number>> = new Map()

  /** Register a citizen with default economy state. */
  registerCitizen(npcId: string): void {
    if (this.citizens.has(npcId)) return
    this.citizens.set(npcId, {
      coins: 30, // starting pocket money
      reputation: 0,
      savingsGoal: 50 + Math.floor(Math.random() * 151), // 50-200
      todayWorkReward: 0,
      frugal: false,
    })
  }

  /** Remove a citizen (e.g., moved away). */
  unregisterCitizen(npcId: string): void {
    this.citizens.delete(npcId)
    this.cooldowns.delete(npcId)
  }

  /** Get a citizen's economy state (or null if not registered). */
  getCitizen(npcId: string): CitizenEconomy | null {
    return this.citizens.get(npcId) ?? null
  }

  /** Get all registered citizen ids. */
  getCitizens(): string[] {
    return Array.from(this.citizens.keys())
  }

  /** Check if a citizen can afford a purchase. */
  canAfford(npcId: string, amount: number): boolean {
    const c = this.citizens.get(npcId)
    if (!c) return false
    // Frugal citizens are reluctant to spend unless it's a need.
    if (c.frugal) return c.coins >= amount * 1.5
    return c.coins >= amount
  }

  /**
   * Spend coins for a citizen. Returns success/failure.
   * Coins never go negative — check canAfford() first.
   */
  spend(npcId: string, amount: number, reason?: string): SpendResult {
    const c = this.citizens.get(npcId)
    if (!c) return { success: false, remaining: 0, reason: 'not_registered' }
    if (amount < 0) return { success: false, remaining: c.coins, reason: 'negative_amount' }
    if (c.coins < amount) return { success: false, remaining: c.coins, reason: 'insufficient' }
    c.coins -= amount
    this.updateFrugalFlag(npcId)
    return { success: true, remaining: c.coins, reason }
  }

  /** Add coins to a citizen (earning, gift received, etc.). */
  earn(npcId: string, amount: number, reason?: string): void {
    const c = this.citizens.get(npcId)
    if (!c || amount <= 0) return
    c.coins += amount
    this.updateFrugalFlag(npcId)
  }

  /**
   * Award work reward (accumulates into todayWorkReward, capped).
   * Actual payout happens at daily settlement.
   */
  awardWorkReward(npcId: string, amount: number): void {
    const c = this.citizens.get(npcId)
    if (!c || amount <= 0) return
    c.todayWorkReward = Math.min(DAILY_SETTLEMENT.maxWorkReward, c.todayWorkReward + amount)
  }

  /** Adjust reputation (clamped to -100..100). */
  adjustReputation(npcId: string, delta: number): void {
    const c = this.citizens.get(npcId)
    if (!c) return
    c.reputation = Math.max(REP_MIN, Math.min(REP_MAX, c.reputation + delta))
  }

  /** Get reputation (-100..100). */
  getReputation(npcId: string): number {
    return this.citizens.get(npcId)?.reputation ?? 0
  }

  /** Get coins. */
  getCoins(npcId: string): number {
    return this.citizens.get(npcId)?.coins ?? 0
  }

  /** Check if a café item is off cooldown for a citizen. */
  isCafeItemAvailable(npcId: string, itemId: string): boolean {
    const cds = this.cooldowns.get(npcId)
    if (!cds) return true
    const expiry = cds[itemId]
    if (!expiry) return true
    return Date.now() >= expiry
  }

  /**
   * Buy a café item. Deducts coins and sets cooldown.
   * Returns the item bought (with effects) or null if failed.
   */
  buyCafeItem(npcId: string, itemId: string): CafeMenuItem | null {
    const item = CAFE_MENU.find((m) => m.id === itemId)
    if (!item) return null
    if (!this.isCafeItemAvailable(npcId, itemId)) return null
    if (!this.canAfford(npcId, item.price)) return null
    const result = this.spend(npcId, item.price, `cafe:${itemId}`)
    if (!result.success) return null
    // Set cooldown
    if (item.cooldownMs > 0) {
      const cds = this.cooldowns.get(npcId) ?? {}
      cds[itemId] = Date.now() + item.cooldownMs
      this.cooldowns.set(npcId, cds)
    }
    return item
  }

  /**
   * Transfer coins from one citizen to another (gift, trade, loan).
   * Returns success/failure.
   */
  transfer(fromId: string, toId: string, amount: number, reason?: string): SpendResult {
    if (amount <= 0) return { success: false, remaining: 0, reason: 'non_positive' }
    const from = this.citizens.get(fromId)
    const to = this.citizens.get(toId)
    if (!from || !to) return { success: false, remaining: from?.coins ?? 0, reason: 'not_registered' }
    if (from.coins < amount) return { success: false, remaining: from.coins, reason: 'insufficient' }
    from.coins -= amount
    to.coins += amount
    this.updateFrugalFlag(fromId)
    this.updateFrugalFlag(toId)
    return { success: true, remaining: from.coins, reason }
  }

  /**
   * Daily settlement (06:00): pay out salary + work reward + reputation bonus.
   * Resets todayWorkReward. Applies anti-hoarding salary reduction.
   * Returns a summary per citizen.
   */
  runDailySettlement(): Array<{ npcId: string; salary: number; workReward: number; repBonus: number; total: number }> {
    const results: Array<{ npcId: string; salary: number; workReward: number; repBonus: number; total: number }> = []
    for (const [npcId, c] of this.citizens) {
      // Base salary (halved if hoarding)
      const salary = c.coins > DAILY_SETTLEMENT.hoardingThreshold
        ? Math.floor(DAILY_SETTLEMENT.baseSalary / 2)
        : DAILY_SETTLEMENT.baseSalary
      // Work reward (accumulated today)
      const workReward = c.todayWorkReward
      // Reputation bonus (reputation * 0.5, capped)
      const repBonus = Math.min(
        DAILY_SETTLEMENT.maxReputationBonus,
        Math.max(0, Math.floor(c.reputation * DAILY_SETTLEMENT.reputationBonusRate))
      )
      const total = salary + workReward + repBonus
      c.coins += total
      c.todayWorkReward = 0
      this.updateFrugalFlag(npcId)
      results.push({ npcId, salary, workReward, repBonus, total })
    }
    return results
  }

  /** Update the frugal flag based on savings goal. */
  private updateFrugalFlag(npcId: string): void {
    const c = this.citizens.get(npcId)
    if (!c) return
    c.frugal = c.coins > c.savingsGoal * 1.5
  }

  /** Get a full snapshot for persistence. */
  getSnapshot(): EconomySnapshot {
    const citizens: Record<string, CitizenEconomy> = {}
    for (const [id, c] of this.citizens) {
      citizens[id] = { ...c }
    }
    return { citizens, savedAt: Date.now() }
  }

  /** Restore from a snapshot (called on reconnect). */
  restoreSnapshot(snapshot: EconomySnapshot): void {
    this.citizens.clear()
    this.cooldowns.clear()
    if (!snapshot?.citizens) return
    for (const [id, c] of Object.entries(snapshot.citizens)) {
      this.citizens.set(id, { ...c })
    }
    console.log(`[EconomyEngine] restored ${this.citizens.size} citizens`)
  }

  /** Clear all state. */
  clear(): void {
    this.citizens.clear()
    this.cooldowns.clear()
  }
}
