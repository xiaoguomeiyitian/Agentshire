/**
 * animal-mode — Animal Mode subsystem (借鉴动森的自治小镇模式)
 */

export { AnimalModeManager, getAnimalModeManager } from './AnimalModeManager'

export { IndoorTracker } from './IndoorTracker'

export { RulesEngine } from './RulesEngine'

export { NeedsEngine, NEED_LABELS_ZH } from './NeedsEngine'
export type { NeedKey, NeedState, NeedsSnapshot } from './NeedsEngine'

export { MoodEngine, MOOD_LABELS_ZH } from './MoodEngine'
export type { MoodLevel, MoodState } from './MoodEngine'

export { NeedActionMapper } from './NeedActionMapper'
export type { NeedAction } from './NeedActionMapper'

export { MoodAnimator } from './MoodAnimator'
export type { MoodAnimation } from './MoodAnimator'

export { AutonomyEngine } from './AutonomyEngine'
export type { AutonomyAction, AutonomyContext, AutonomyDeps } from './AutonomyEngine'

export { RelationshipEngine, RELATIONSHIP_LABELS_ZH } from './RelationshipEngine'
export type { RelationshipLevel, RelationshipSummary } from './RelationshipEngine'

export { MemoryStore } from './MemoryStore'
export type { DialogueSummary, ActivitySummary, CitizenMemory, MemoryMap } from './MemoryStore'

export { FestivalEngine, FESTIVAL_LABELS_ZH, FESTIVAL_LABELS_EN } from './FestivalEngine'
export type { FestivalType, FestivalState, FestivalConfig } from './FestivalEngine'

export { MoveEngine } from './MoveEngine'
export type { MoveCandidate, MoveConfig, MoveEvent } from './MoveEngine'

export { EconomyEngine, CAFE_MENU, DAILY_SETTLEMENT } from './EconomyEngine'
export type { CitizenEconomy, EconomySnapshot, SpendResult, CafeMenuItem } from './EconomyEngine'

export { DailySettlementEngine } from './DailySettlementEngine'
export type { DailySettlementResult } from './DailySettlementEngine'

export { CitizenTradeSystem } from './CitizenTradeSystem'
export type { TradeResult, LoanRecord } from './CitizenTradeSystem'

export { EconomyEventEngine } from './EconomyEventEngine'
export type { EconomyEvent, EconomyEventType, EconomyEventEngineDeps } from './EconomyEventEngine'
