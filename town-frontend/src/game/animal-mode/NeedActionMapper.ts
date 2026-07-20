/**
 * NeedActionMapper — maps a citizen's most urgent need to a concrete action.
 *
 * This is the bridge between the NeedsEngine (abstract need levels) and the
 * actual NPC behavior (where to walk, what animation to play, whether to
 * become invisible indoors).
 *
 * Each need maps to:
 *   - targetPlace: which building/waypoint to walk to
 *   - anim: animation to play on arrival
 *   - goIndoor: whether to become invisible (residential) or stay visible (public)
 *   - satisfyAmount: how much to restore the need when the action completes
 *   - satisfyDurationMs: how long the action takes to complete
 */

import type { NeedKey } from './NeedsEngine'
import { BUILDING_REGISTRY } from '../../types'

export interface NeedAction {
  need: NeedKey
  targetPlace: string          // building key (e.g. 'house_a_door', 'cafe_door')
  anim: string                 // animation name (e.g. 'idle', 'sitting', 'sleeping')
  goIndoor: boolean            // true = become invisible (residential), false = stay visible
  satisfyAmount: number        // how much to restore the need
  satisfyDurationMs: number    // how long the action takes
  label: string                // human-readable label for journal
}

// Map each need to a building category preference.
// The actual building is resolved per-citizen (e.g., their own home).
const NEED_TO_BUILDING_TAG: Record<NeedKey, string> = {
  hunger: 'cafe',        // eat at cafe
  fatigue: 'home',       // sleep at own home
  social: 'plaza',       // socialize at plaza (outdoor)
  fun: 'museum',        // have fun at museum
  hygiene: 'home',      // clean at home
  safety: 'home',       // shelter at home (bad weather)
  esteem: 'office',     // work at office (self-actualization)
  belonging: 'plaza',   // community at plaza
}

const NEED_ANIM: Record<NeedKey, string> = {
  hunger: 'sitting',
  fatigue: 'idle',      // sleeping pose (no dedicated anim yet)
  social: 'wave',
  fun: 'thinking',
  hygiene: 'idle',
  safety: 'idle',
  esteem: 'typing',
  belonging: 'cheer',
}

const NEED_SATISFY_AMOUNT: Record<NeedKey, number> = {
  hunger: 70,
  fatigue: 90,
  social: 50,
  fun: 60,
  hygiene: 80,
  safety: 70,
  esteem: 65,
  belonging: 75,
}

const NEED_DURATION_MS: Record<NeedKey, number> = {
  hunger: 15_000,    // 15s eating
  fatigue: 60_000,   // 60s sleeping
  social: 20_000,    // 20s socializing
  fun: 25_000,       // 25s museum visit
  hygiene: 10_000,   // 10s cleaning
  safety: 30_000,    // 30s sheltering
  esteem: 30_000,    // 30s working
  belonging: 20_000, // 20s community
}

const NEED_LABEL_ZH: Record<NeedKey, string> = {
  hunger: '用餐', fatigue: '睡觉', social: '社交', fun: '娱乐',
  hygiene: '清洁', safety: '躲避', esteem: '工作', belonging: '社区活动',
}

export class NeedActionMapper {
  /**
   * Resolve a need to a concrete action for a citizen.
   * @param need The urgent need to satisfy
   * @param homeBuildingKey The citizen's home building key (e.g. 'house_a_door')
   * @param economy Optional economy state (P2-3: hunger+coins<5 → go home)
   * @returns The action to perform, or null if no suitable building found
   */
  resolveAction(
    need: NeedKey,
    homeBuildingKey: string | null,
    economy?: { coins: number } | null,
  ): NeedAction | null {
    const tag = NEED_TO_BUILDING_TAG[need]

    // P2-3: hunger + broke (coins < 5) → redirect to home (eat breakfast)
    // instead of going to the cafe where they can't afford food.
    if (need === 'hunger' && economy && economy.coins < 5 && homeBuildingKey) {
      const home = BUILDING_REGISTRY.find((b) => b.key === homeBuildingKey)
      if (home) {
        return {
          need,
          targetPlace: homeBuildingKey,
          anim: 'sitting',
          goIndoor: true,
          satisfyAmount: 30, // breakfast at home (smaller than cafe)
          satisfyDurationMs: 15_000,
          label: '回家用餐',
        }
      }
    }

    // For home-based needs, use the citizen's own home
    if (tag === 'home') {
      if (!homeBuildingKey) return null
      const home = BUILDING_REGISTRY.find((b) => b.key === homeBuildingKey)
      if (!home) return null
      return {
        need,
        targetPlace: homeBuildingKey,
        anim: NEED_ANIM[need],
        goIndoor: true, // residential -> become invisible
        satisfyAmount: NEED_SATISFY_AMOUNT[need],
        satisfyDurationMs: NEED_DURATION_MS[need],
        label: NEED_LABEL_ZH[need],
      }
    }

    // For plaza (outdoor social/community), use plaza_center waypoint
    if (tag === 'plaza') {
      return {
        need,
        targetPlace: 'plaza_center',
        anim: NEED_ANIM[need],
        goIndoor: false, // outdoor, stay visible
        satisfyAmount: NEED_SATISFY_AMOUNT[need],
        satisfyDurationMs: NEED_DURATION_MS[need],
        label: NEED_LABEL_ZH[need],
      }
    }

    // For other tags (cafe/museum/office), find a building with that tag
    const building = BUILDING_REGISTRY.find((b) => b.tag === tag)
    if (!building) return null
    // Issue 2: cafe/market also use IndoorTracker so citizens recover needs
    // while inside (hunger at cafe, fun at museum, esteem at office).
    const isCommercial = building.category === 'commercial'
    return {
      need,
      targetPlace: building.key,
      anim: NEED_ANIM[need],
      goIndoor: isCommercial, // commercial buildings -> become invisible + recover
      satisfyAmount: NEED_SATISFY_AMOUNT[need],
      satisfyDurationMs: NEED_DURATION_MS[need],
      label: NEED_LABEL_ZH[need],
    }
  }

  /** Check if a building is residential (citizen becomes invisible on entry). */
  isResidential(buildingKey: string): boolean {
    const b = BUILDING_REGISTRY.find((bd) => bd.key === buildingKey)
    return b?.category === 'residential'
  }
}

