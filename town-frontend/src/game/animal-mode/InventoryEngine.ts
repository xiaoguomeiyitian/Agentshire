/**
 * InventoryEngine — manages each citizen's backpack (owned items).
 *
 * Items enter the backpack via:
 *   - Cafe purchase (EconomyEngine.buyCafeItem → addItem)
 *   - Gift received (CitizenTradeSystem.giftItem → addItem)
 *   - Food shared by a friend (CitizenTradeSystem.shareFood → addItem)
 *   - Craft produced by work (AutonomyEngine work_on → addItem)
 *   - Random pickup events (EconomyEventEngine → addItem)
 *
 * Items leave the backpack via:
 *   - useItem: consume a food/gift to restore needs (hunger/mood/belonging)
 *   - transferItem: give an item to another citizen (trade/gift)
 *
 * Persistence: AnimalModeManager snapshots the full inventory via
 * getSnapshot() and restores via restoreSnapshot(). The plugin layer
 * persists it to stateDir()/agents/animal-inventory.json (see
 * inventory-state.ts).
 */

import type { NeedsEngine, NeedKey } from './NeedsEngine'

export type ItemCategory = 'food' | 'gift' | 'craft' | 'misc'

export interface InventoryItem {
  /** Unique item instance id. */
  id: string
  /** Item type id (e.g. 'coffee', 'sandwich', 'gift_box', 'wood_carving'). */
  itemId: string
  /** Display name (i18n-resolved at add time). */
  name: string
  /** Lucide icon name for UI rendering. */
  icon: string
  /** Stack count (food/craft stack; gifts are individual). */
  count: number
  /** Item category — controls stacking rules and UI grouping. */
  category: ItemCategory
  /** Need restoration effects applied on useItem(). */
  effects?: {
    hunger?: number
    energy?: number   // maps to fatigue need
    mood?: number     // maps to fun need
    belonging?: number
  }
  /** Timestamp when the item was obtained. */
  obtainedAt: number
  /** Source description for UI display. */
  source: ItemSource
}

export type ItemSource =
  | 'cafe_purchase'
  | 'gift_received'
  | 'trade'
  | 'craft'
  | 'pickup'
  | 'share_food'

export interface InventorySnapshot {
  citizens: Record<string, InventoryItem[]>
  savedAt: number
}

/** Source labels for UI display (zh-CN / en). */
export const ITEM_SOURCE_LABELS_ZH: Record<ItemSource, string> = {
  cafe_purchase: '咖啡店购买',
  gift_received: '收到礼物',
  trade: '交易',
  craft: '手艺产出',
  pickup: '拾取',
  share_food: '朋友分享',
}

export const ITEM_SOURCE_LABELS_EN: Record<ItemSource, string> = {
  cafe_purchase: 'Cafe',
  gift_received: 'Gift',
  trade: 'Trade',
  craft: 'Craft',
  pickup: 'Pickup',
  share_food: 'Shared',
}

export class InventoryEngine {
  private inventories: Map<string, InventoryItem[]> = new Map()
  private idCounter = 0

  /** Register a citizen with an empty backpack. */
  registerCitizen(npcId: string): void {
    if (!this.inventories.has(npcId)) {
      this.inventories.set(npcId, [])
    }
  }

  /** Remove a citizen (e.g., moved away). */
  unregisterCitizen(npcId: string): void {
    this.inventories.delete(npcId)
  }

  /** Get a citizen's inventory (live reference — mutate with care). */
  getInventory(npcId: string): InventoryItem[] {
    return this.inventories.get(npcId) ?? []
  }

  /** Get all registered citizen ids. */
  getCitizens(): string[] {
    return Array.from(this.inventories.keys())
  }

  /**
   * Add an item to a citizen's backpack.
   * Food/craft items stack by itemId; gifts are always individual entries.
   * Returns the resulting item (either the stacked existing or the new one).
   */
  addItem(npcId: string, item: Omit<InventoryItem, 'id' | 'obtainedAt'>): InventoryItem {
    let inv = this.inventories.get(npcId)
    if (!inv) {
      inv = []
      this.inventories.set(npcId, inv)
    }
    // Stack food/craft/misc by itemId; gifts are individual
    if (item.category !== 'gift') {
      const existing = inv.find((i) => i.itemId === item.itemId && i.category === item.category)
      if (existing) {
        existing.count += item.count
        return existing
      }
    }
    const newItem: InventoryItem = {
      ...item,
      id: `inv_${++this.idCounter}_${Date.now().toString(36)}`,
      obtainedAt: Date.now(),
    }
    inv.push(newItem)
    return newItem
  }

  /**
   * Use (consume) one unit of an item. Applies its effects to needs.
   * Returns the consumed item (with count decremented) or null if not found.
   */
  useItem(npcId: string, itemId: string, needsEngine: NeedsEngine): InventoryItem | null {
    const inv = this.inventories.get(npcId)
    if (!inv) return null
    const idx = inv.findIndex((i) => i.itemId === itemId && i.count > 0)
    if (idx < 0) return null
    const item = inv[idx]
    item.count -= 1
    if (item.count <= 0) inv.splice(idx, 1)
    // Apply effects to needs
    if (item.effects) {
      if (item.effects.hunger) needsEngine.satisfy(npcId, 'hunger', item.effects.hunger)
      if (item.effects.energy) needsEngine.satisfy(npcId, 'fatigue', item.effects.energy)
      if (item.effects.mood) needsEngine.satisfy(npcId, 'fun', item.effects.mood)
      if (item.effects.belonging) needsEngine.satisfy(npcId, 'belonging', item.effects.belonging)
    }
    return item
  }

  /**
   * Remove `count` units of an item from a citizen's backpack.
   * Returns true if successful, false if insufficient quantity.
   */
  removeItem(npcId: string, itemId: string, count = 1): boolean {
    const inv = this.inventories.get(npcId)
    if (!inv) return false
    const item = inv.find((i) => i.itemId === itemId)
    if (!item || item.count < count) return false
    item.count -= count
    if (item.count <= 0) {
      const idx = inv.indexOf(item)
      if (idx >= 0) inv.splice(idx, 1)
    }
    return true
  }

  /**
   * Transfer `count` units of an item from one citizen to another.
   * The item keeps its itemId/name/icon/effects but gets a new id and
   * source='trade'. Returns true on success.
   */
  transferItem(fromId: string, toId: string, itemId: string, count = 1): boolean {
    const fromInv = this.inventories.get(fromId)
    if (!fromInv) return false
    const item = fromInv.find((i) => i.itemId === itemId)
    if (!item || item.count < count) return false
    // Remove from giver
    item.count -= count
    if (item.count <= 0) {
      const idx = fromInv.indexOf(item)
      if (idx >= 0) fromInv.splice(idx, 1)
    }
    // Add to receiver (always as a new entry to preserve trade provenance)
    this.addItem(toId, {
      itemId: item.itemId,
      name: item.name,
      icon: item.icon,
      count,
      category: item.category,
      effects: item.effects,
      source: 'trade',
    })
    return true
  }

  /** Check if a citizen owns at least `count` of an item. */
  hasItem(npcId: string, itemId: string, count = 1): boolean {
    const inv = this.inventories.get(npcId)
    if (!inv) return false
    const item = inv.find((i) => i.itemId === itemId)
    return !!item && item.count >= count
  }

  /** Get a full snapshot for persistence. */
  getSnapshot(): InventorySnapshot {
    const citizens: Record<string, InventoryItem[]> = {}
    for (const [id, inv] of this.inventories) {
      // Deep-copy items so the snapshot is independent of live state
      citizens[id] = inv.map((i) => ({ ...i }))
    }
    return { citizens, savedAt: Date.now() }
  }

  /** Restore from a snapshot (called on reconnect). */
  restoreSnapshot(snapshot: InventorySnapshot): void {
    this.inventories.clear()
    if (!snapshot?.citizens) return
    for (const [id, inv] of Object.entries(snapshot.citizens)) {
      this.inventories.set(id, inv.map((i) => ({ ...i })))
    }
    console.log(`[InventoryEngine] restored ${this.inventories.size} citizens`)
  }

  /** Clear all state. */
  clear(): void {
    this.inventories.clear()
  }
}
