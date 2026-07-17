/**
 * animal-mode — Animal Mode subsystem (借鉴动森的自治小镇模式)
 *
 * Phase 1 exports: skeleton + config + toggle
 * Phase 2 exports: NeedsEngine + MoodEngine (already here)
 * Phase 3 exports: AutonomyEngine (TODO)
 * Phase 4 exports: RelationshipEngine (TODO)
 * Phase 5 exports: FestivalEngine (TODO)
 * Phase 6 exports: MoveEngine (TODO)
 */

export { AnimalModeManager, getAnimalModeManager, ANIMAL_MODE_DEFAULTS } from './AnimalModeManager'
export type { AnimalModeConfig } from './AnimalModeManager'

export { IndoorTracker } from './IndoorTracker'

export { RulesEngine } from './RulesEngine'

export { NeedsEngine, NEED_LABELS_ZH, NEED_LABELS_EN } from './NeedsEngine'
export type { NeedKey, NeedState, NeedsSnapshot } from './NeedsEngine'

export { MoodEngine, MOOD_LABELS_ZH, MOOD_LABELS_EN } from './MoodEngine'
export type { MoodLevel, MoodState } from './MoodEngine'

export { NeedActionMapper, NEED_ACTION_LABELS } from './NeedActionMapper'
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
