/**
 * CitizenTradeSystem — peer-to-peer citizen transactions.
 *
 * Handles four trade types (see design doc §4.3):
 *   1. Gift coins    — friend (relationship > 60) gives coins to broke peer
 *   2. Share food    — well-fed citizen (hunger > 70) shares with hungry peer
 *   3. Loan          — broke citizen borrows from friend (3-day repayment)
 *   4. Gift item     — relationship > 80, holiday/birthday gifts
 *
 * All trades go through EconomyEngine.transfer() for coin movements and
 * RelationshipEngine.adjustSentiment() for relationship changes.
 * NeedsEngine.satisfy() handles food-sharing need restoration.
 *
 * This is a pure logic layer — the actual trigger (autonomy decision, event)
 * calls these methods. Results are returned for the caller to log/animate.
 */

import type { EconomyEngine } from './EconomyEngine'
import type { NeedsEngine } from './NeedsEngine'
import type { RelationshipEngine } from './RelationshipEngine'
import type { InventoryEngine } from './InventoryEngine'

export interface TradeResult {
  success: boolean
  type: 'gift_coins' | 'share_food' | 'loan' | 'gift_item'
  from: string
  to: string
  amount: number
  message: string
}

/** Loan record (tracked for 3-day repayment). */
export interface LoanRecord {
  /** P2-1: unique loan id (for multiple concurrent loans between same pair). */
  loanId: number
  fromId: string
  toId: string
  amount: number
  dayIssued: number
  dueDay: number
}

export class CitizenTradeSystem {
  private economy: EconomyEngine
  private needs: NeedsEngine
  private relationships: RelationshipEngine
  /** N-1: optional inventory engine — gifts are pushed to the receiver's backpack. */
  private inventory: InventoryEngine | null = null
  /** Active loans: loanId -> LoanRecord. */
  private loans: Map<number, LoanRecord> = new Map()
  /** P2-1: auto-incrementing loan id counter. */
  private nextLoanId = 1

  constructor(economy: EconomyEngine, needs: NeedsEngine, relationships: RelationshipEngine) {
    this.economy = economy
    this.needs = needs
    this.relationships = relationships
  }

  /** N-1: Inject the inventory engine so gifts can be pushed to backpacks. */
  setInventoryEngine(inventory: InventoryEngine): void {
    this.inventory = inventory
  }

  /**
   * Gift coins from one citizen to another.
   * Requires relationship > 60 (friend) and recipient coins < 10 (broke).
   * Amount: 5-20 based on giver's wealth.
   */
  giftCoins(fromId: string, toId: string, fromName: string, toName: string): TradeResult {
    const sentiment = this.relationships.getSentiment(fromId, toId)
    if (sentiment <= 60) {
      return { success: false, type: 'gift_coins', from: fromId, to: toId, amount: 0, message: '关系不够亲密' }
    }
    const toEcon = this.economy.getCitizen(toId)
    if (!toEcon || toEcon.coins >= 10) {
      return { success: false, type: 'gift_coins', from: fromId, to: toId, amount: 0, message: '对方不缺钱' }
    }
    const fromEcon = this.economy.getCitizen(fromId)
    if (!fromEcon || fromEcon.coins < 5) {
      return { success: false, type: 'gift_coins', from: fromId, to: toId, amount: 0, message: '自己钱不够' }
    }
    // Amount: 5-20, scaled by giver wealth (capped)
    const amount = Math.min(20, Math.max(5, Math.floor(fromEcon.coins * 0.1)))
    const result = this.economy.transfer(fromId, toId, amount, 'gift_coins')
    if (!result.success) {
      return { success: false, type: 'gift_coins', from: fromId, to: toId, amount: 0, message: result.reason ?? '转账失败' }
    }
    // Both gain belonging +2
    this.relationships.adjustSentiment(fromId, toId, toName, 2, '赠送金币')
    this.relationships.adjustSentiment(toId, fromId, fromName, 3, '收到金币')
    return { success: true, type: 'gift_coins', from: fromId, to: toId, amount, message: `${fromName}赠送${amount}金币给${toName}` }
  }

  /**
   * Share food: well-fed citizen (hunger > 70) shares with hungry peer (hunger < 30).
   * Giver loses 20 hunger, receiver gains 20 hunger. Both mood +5, social +10.
   */
  shareFood(fromId: string, toId: string, fromName: string, toName: string): TradeResult {
    const fromSnap = this.needs.getSnapshot(fromId)
    const toSnap = this.needs.getSnapshot(toId)
    if (!fromSnap || !toSnap) {
      return { success: false, type: 'share_food', from: fromId, to: toId, amount: 0, message: '居民未注册' }
    }
    if (fromSnap.needs.hunger <= 70) {
      return { success: false, type: 'share_food', from: fromId, to: toId, amount: 0, message: '自己不够饱' }
    }
    if (toSnap.needs.hunger >= 30) {
      return { success: false, type: 'share_food', from: fromId, to: toId, amount: 0, message: '对方不饿' }
    }
    // Transfer hunger: giver -20, receiver +20
    this.needs.satisfy(fromId, 'hunger', -20)
    this.needs.satisfy(toId, 'hunger', 20)
    // Both mood +5 (via fun need), social +10
    this.needs.satisfy(fromId, 'social', 10)
    this.needs.satisfy(toId, 'social', 10)
    this.needs.satisfy(fromId, 'fun', 5)
    this.needs.satisfy(toId, 'fun', 5)
    // Relationship boost
    this.relationships.adjustSentiment(fromId, toId, toName, 5, '分享食物')
    this.relationships.adjustSentiment(toId, fromId, fromName, 8, '收到食物')
    return { success: true, type: 'share_food', from: fromId, to: toId, amount: 20, message: `${fromName}分享食物给${toName}` }
  }

  /**
   * Loan coins: broke citizen borrows from a friend.
   * Must repay within 3 game-days, else relationship -20.
   * @param currentDayCount Current game day (for due date calculation).
   */
  loanCoins(
    fromId: string,
    toId: string,
    fromName: string,
    toName: string,
    amount: number,
    currentDayCount: number,
  ): TradeResult {
    const sentiment = this.relationships.getSentiment(fromId, toId)
    if (sentiment <= 50) {
      return { success: false, type: 'loan', from: fromId, to: toId, amount: 0, message: '关系不够' }
    }
    if (amount <= 0 || amount > 50) {
      return { success: false, type: 'loan', from: fromId, to: toId, amount: 0, message: '金额无效' }
    }
    const result = this.economy.transfer(fromId, toId, amount, 'loan')
    if (!result.success) {
      return { success: false, type: 'loan', from: fromId, to: toId, amount: 0, message: result.reason ?? '转账失败' }
    }
    // Record loan (due in 3 days)
    const loanId = this.nextLoanId++
    this.loans.set(loanId, {
      loanId,
      fromId,
      toId,
      amount,
      dayIssued: currentDayCount,
      dueDay: currentDayCount + 3,
    })
    // Relationship +10 (trust)
    this.relationships.adjustSentiment(fromId, toId, toName, 10, '借钱')
    this.relationships.adjustSentiment(toId, fromId, fromName, 5, '借到钱')
    return { success: true, type: 'loan', from: fromId, to: toId, amount, message: `${fromName}借给${toName} ${amount}金币` }
  }

  /**
   * Repay a loan. Called by the borrower when they have enough coins.
   * If overdue, relationship already penalized (checked in checkOverdueLoans).
   * P2-1: repays the earliest outstanding loan from toId→fromId (lender→borrower).
   */
  repayLoan(fromId: string, toId: string, currentDayCount: number): TradeResult {
    // Find the earliest outstanding loan where toId is lender, fromId is borrower
    let earliestLoan: LoanRecord | null = null
    for (const loan of this.loans.values()) {
      if (loan.fromId === toId && loan.toId === fromId) {
        if (!earliestLoan || loan.dayIssued < earliestLoan.dayIssued) {
          earliestLoan = loan
        }
      }
    }
    if (!earliestLoan) {
      return { success: false, type: 'loan', from: fromId, to: toId, amount: 0, message: '无借款记录' }
    }
    const result = this.economy.transfer(fromId, toId, earliestLoan.amount, 'repay_loan')
    if (!result.success) {
      return { success: false, type: 'loan', from: fromId, to: toId, amount: 0, message: result.reason ?? '还款失败' }
    }
    this.loans.delete(earliestLoan.loanId)
    // Relationship +5 (kept promise)
    this.relationships.adjustSentiment(fromId, toId, '', 5, '按时还款')
    return { success: true, type: 'loan', from: fromId, to: toId, amount: earliestLoan.amount, message: `${fromId}还款${earliestLoan.amount}金币` }
  }

  /**
   * Check overdue loans and penalize relationship.
   * Called at daily settlement.
   */
  checkOverdueLoans(currentDayCount: number): void {
    for (const [key, loan] of this.loans) {
      if (currentDayCount > loan.dueDay) {
        // Overdue: relationship -20
        this.relationships.adjustSentiment(loan.toId, loan.fromId, '', -20, '逾期未还')
        this.loans.delete(key)
        console.log(`[Trade] loan overdue: ${loan.toId} -> ${loan.fromId} (${loan.amount} coins)`)
      }
    }
  }

  /**
   * Gift an item (holiday/birthday/relationship > 80).
   * Cost: 10-30 coins. Receiver mood +15, belonging +5.
   */
  giftItem(fromId: string, toId: string, fromName: string, toName: string, occasion?: string): TradeResult {
    const sentiment = this.relationships.getSentiment(fromId, toId)
    if (sentiment <= 80) {
      return { success: false, type: 'gift_item', from: fromId, to: toId, amount: 0, message: '关系不够亲密' }
    }
    const fromEcon = this.economy.getCitizen(fromId)
    if (!fromEcon || fromEcon.coins < 10) {
      return { success: false, type: 'gift_item', from: fromId, to: toId, amount: 0, message: '钱不够' }
    }
    // Cost: 10-30 based on wealth
    const cost = Math.min(30, Math.max(10, Math.floor(fromEcon.coins * 0.15)))
    const result = this.economy.spend(fromId, cost, `gift_item:${occasion ?? 'general'}`)
    if (!result.success) {
      return { success: false, type: 'gift_item', from: fromId, to: toId, amount: 0, message: result.reason ?? '消费失败' }
    }
    // Receiver: mood +15 (fun), belonging +5
    this.needs.satisfy(toId, 'fun', 15)
    this.needs.satisfy(toId, 'belonging', 5)
    this.needs.satisfy(toId, 'social', 5)
    // N-1: push the gift item into the receiver's backpack (so it's "kept on them")
    if (this.inventory) {
      this.inventory.addItem(toId, {
        itemId: `gift_${occasion ?? 'general'}_${Date.now().toString(36)}`,
        name: occasion ? `${occasion}礼物` : '礼物',
        icon: 'gift',
        count: 1,
        category: 'gift',
        effects: { mood: 15, belonging: 5 },
        source: 'gift_received',
      })
    }
    // Relationship +10-20
    const relBoost = 10 + Math.floor(Math.random() * 11)
    this.relationships.adjustSentiment(fromId, toId, toName, relBoost, `赠送礼物${occasion ? `·${occasion}` : ''}`)
    this.relationships.adjustSentiment(toId, fromId, fromName, relBoost, `收到礼物${occasion ? `·${occasion}` : ''}`)
    return { success: true, type: 'gift_item', from: fromId, to: toId, amount: cost, message: `${fromName}赠送礼物给${toName}（${cost}金币）` }
  }

  /** Get all active loans (for persistence/debugging). */
  getLoans(): LoanRecord[] {
    return Array.from(this.loans.values())
  }

  /** Clear all state. */
  clear(): void {
    this.loans.clear()
    this.nextLoanId = 1
  }
}
