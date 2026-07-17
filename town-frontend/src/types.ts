import type { TownMapConfig } from './editor/TownMapConfig'

export interface Vec3 { x: number; y: number; z: number }

export type TimePeriod = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night'

export type WeatherType =
  | 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'heavyRain' | 'storm'
  | 'lightSnow' | 'snow' | 'blizzard' | 'fog' | 'sandstorm' | 'aurora'

export interface GameClockConfig {
  startHour: number
  dayDurationRealMs: number
  nightSpeedMultiplier: number
  paused: boolean
}

export interface GameTimeState {
  hour: number
  minute: number
  normalizedTime: number
  period: TimePeriod
  dayCount: number
  isNight: boolean
}

export type NPCRole = 'producer' | 'worker' | 'user'

export interface NPCConfig {
  id: string
  name: string
  color: number
  spawn: Vec3
  role: NPCRole
  label?: string
  characterKey?: string
  avatarUrl?: string
  modelUrl?: string
  modelTransform?: { scale: number; rotationX: number; rotationY: number; rotationZ: number; offsetX: number; offsetY: number; offsetZ: number }
  animMapping?: Partial<Record<string, string>>
  animFileUrls?: string[]
  /** Issue 2: citizen occupation/specialty for display in dropdown + tas-name. */
  specialty?: string
}

export type NPCState =
  | 'idle' | 'walking' | 'running' | 'sitting' | 'typing'
  | 'thinking' | 'celebrate' | 'frustrated' | 'sleeping' | 'wave'

export type WorkPhase =
  | 'waiting' | 'coding' | 'thinking' | 'done' | 'error' | 'recovering'

export type GlowColor = 'none' | 'gold' | 'cyan' | 'yellow' | 'green' | 'red' | 'gray'

export interface Waypoint { x: number; z: number }

export const WAYPOINTS: Record<string, Waypoint> = {
  road_entrance: { x: 40, z: 34 },
  plaza_center: { x: 18, z: 13 },
  plaza_fountain: { x: 18, z: 13 },
  plaza_side: { x: 38, z: 34 },
  office_door: { x: 17, z: 8 },
  house_a_door: { x: 6, z: 7 },
  house_b_door: { x: 6, z: 12 },
  house_c_door: { x: 6, z: 17 },
  market_door: { x: 29, z: 6 },
  cafe_door: { x: 29, z: 12 },
  user_home_door: { x: 6, z: 22 },
  museum_door: { x: 29, z: 18 },
  park_bench_1: { x: 10, z: 19 },
  park_bench_2: { x: 15, z: 19 },
  park_center: { x: 12, z: 20 },
  gathering_point: { x: 24, z: 19 },
}

export const NPC_CONFIGS: NPCConfig[] = [
  { id: 'producer', name: 'Producer', color: 0x4488CC, spawn: { x: WAYPOINTS.plaza_side.x, y: 0, z: WAYPOINTS.plaza_side.z }, role: 'producer', label: '制作人·阿P' },
  { id: 'planner', name: 'Planner', color: 0xBB66CC, spawn: { x: WAYPOINTS.cafe_door.x, y: 0, z: WAYPOINTS.cafe_door.z }, role: 'worker', label: '策划·小策' },
  { id: 'explorer', name: 'Explorer', color: 0x44AA44, spawn: { x: WAYPOINTS.house_a_door.x, y: 0, z: WAYPOINTS.house_a_door.z }, role: 'worker', label: '美术·小画' },
  { id: 'coder', name: 'Coder', color: 0x6688AA, spawn: { x: WAYPOINTS.house_b_door.x, y: 0, z: WAYPOINTS.house_b_door.z }, role: 'worker', label: '开发·阿码' },
  { id: 'architect', name: 'Architect', color: 0xCC8844, spawn: { x: WAYPOINTS.house_c_door.x, y: 0, z: WAYPOINTS.house_c_door.z }, role: 'worker', label: '开发·阿构' },
  { id: 'user', name: 'Jin', color: 0xDDAA44, spawn: { x: WAYPOINTS.road_entrance.x, y: 0, z: WAYPOINTS.road_entrance.z }, role: 'user', label: 'Jin' },
]

export type SceneType = 'town' | 'office' | 'museum' | 'house_a' | 'house_b' | 'house_c' | 'user_home' | 'market' | 'cafe'

export type BuildingCategory = 'residential' | 'commercial' | 'public' | 'workspace'

export interface BuildingDef {
  key: string
  name: string
  scene: SceneType
  category: BuildingCategory
  /** Functional tag for behavior template matching (compatible with editor binding tags) */
  tag?: string
  stayRange: [number, number]
  capacity: number
}

export const BUILDING_REGISTRY: BuildingDef[] = [
  { key: 'office_door',    name: '办公室',  scene: 'office',    category: 'workspace',    tag: 'office',   stayRange: [5000, 12000],   capacity: 4 },
  { key: 'house_a_door',   name: '住宅A',   scene: 'house_a',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
  { key: 'house_b_door',   name: '住宅B',   scene: 'house_b',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
  { key: 'house_c_door',   name: '住宅C',   scene: 'house_c',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
  { key: 'market_door',    name: '市场',    scene: 'market',    category: 'commercial',   tag: 'market',   stayRange: [4000, 10000],   capacity: 6 },
  { key: 'cafe_door',      name: '咖啡店',  scene: 'cafe',      category: 'commercial',   tag: 'cafe',     stayRange: [5000, 12000],   capacity: 4 },
  { key: 'user_home_door', name: '玩家家',  scene: 'user_home', category: 'residential',  tag: 'userHome', stayRange: [3000, 8000],    capacity: 1 },
  { key: 'museum_door',    name: '博物馆',  scene: 'museum',    category: 'public',       tag: 'museum',   stayRange: [5000, 12000],   capacity: 5 },
]

const BUILDING_NAMES_EN: Record<string, string> = {
  office_door: 'Office', house_a_door: 'House A', house_b_door: 'House B',
  house_c_door: 'House C', market_door: 'Market', cafe_door: 'Café',
  user_home_door: 'Player Home', museum_door: 'Museum',
}

export function getBuildingName(key: string): string {
  if (getLocale() === 'en') return BUILDING_NAMES_EN[key] ?? key
  return BUILDING_REGISTRY.find(b => b.key === key)?.name ?? key
}

// ── Dynamic building registration from TownMapConfig ──
// Maps building modelKey to (category, tag, scene, name) for NPC behavior.
const MODEL_KEY_TO_ROLE: Record<string, {
  category: BuildingCategory
  tag: string
  scene: SceneType
  name: string
  nameEn: string
  stayRange: [number, number]
  capacity: number
}> = {
  building_A: { category: 'workspace',   tag: 'office',   scene: 'office',    name: '办公室',  nameEn: 'Office',      stayRange: [5000, 12000], capacity: 4 },
  building_B: { category: 'residential',  tag: 'home',     scene: 'house_a',  name: '住宅',    nameEn: 'House',      stayRange: [6000, 15000], capacity: 2 },
  building_C: { category: 'residential',  tag: 'home',     scene: 'house_b',  name: '住宅',    nameEn: 'House',      stayRange: [6000, 15000], capacity: 2 },
  building_D: { category: 'residential',  tag: 'home',     scene: 'house_c',  name: '住宅',    nameEn: 'House',      stayRange: [6000, 15000], capacity: 2 },
  building_E: { category: 'commercial',   tag: 'market',   scene: 'market',   name: '市场',    nameEn: 'Market',     stayRange: [4000, 10000], capacity: 6 },
  building_F: { category: 'commercial',   tag: 'cafe',     scene: 'cafe',     name: '咖啡店',  nameEn: 'Café',       stayRange: [5000, 12000], capacity: 4 },
  building_G: { category: 'residential',  tag: 'userHome', scene: 'user_home',name: '玩家家',  nameEn: 'Player Home',stayRange: [3000, 8000],  capacity: 1 },
  building_H: { category: 'public',       tag: 'museum',   scene: 'museum',   name: '博物馆',  nameEn: 'Museum',     stayRange: [5000, 12000], capacity: 5 },
}

/**
 * Update WAYPOINTS and BUILDING_REGISTRY from a loaded TownMapConfig.
 * This allows NPCs to roam across the entire map instead of being confined
 * to the hardcoded 40×24 region. Buildings are keyed by their placement id
 * (e.g. "bobj_xxx") so each building on the map becomes a unique destination.
 *
 * Called from MainScene.loadMapConfigAsync() after the map is loaded.
 */
export function updateWaypointsFromMapConfig(config: TownMapConfig): void {
  // Keep the original special waypoints (plaza, road_entrance, gathering_point, park)
  // but clear building-door waypoints that will be regenerated.
  const preservedKeys = new Set([
    'road_entrance', 'plaza_center', 'plaza_fountain', 'plaza_side',
    'park_bench_1', 'park_bench_2', 'park_center', 'gathering_point',
  ])
  // Remove old building-door waypoints (house_a_door, office_door, etc.)
  for (const key of Object.keys(WAYPOINTS)) {
    if (!preservedKeys.has(key)) delete WAYPOINTS[key]
  }

  // Clear BUILDING_REGISTRY and rebuild from config
  BUILDING_REGISTRY.length = 0

  // Track modelKey occurrence to generate unique names
  const modelKeyCount: Record<string, number> = {}
  // Map standard keys (office_door, house_a_door, etc.) to the first building of each type
  // for backward compatibility with workflow code.
  const standardKeyMap: Record<string, string> = {
    building_A: 'office_door',
    building_B: 'house_a_door',
    building_C: 'house_b_door',
    building_D: 'house_c_door',
    building_E: 'market_door',
    building_F: 'cafe_door',
    building_G: 'user_home_door',
    building_H: 'museum_door',
  }
  const standardKeyAssigned: Record<string, boolean> = {}

  for (const b of config.buildings) {
    const role = MODEL_KEY_TO_ROLE[b.modelKey]
    if (!role) continue // unknown model — skip

    // World position of the building's door (south side, center x, front of building)
    const doorX = b.gridX + b.widthCells / 2
    const doorZ = b.gridZ + b.depthCells + 0.5

    // Use the building placement id as the unique key
    const key = b.id
    WAYPOINTS[key] = { x: doorX, z: doorZ }

    // Also assign the standard key (office_door, house_a_door, etc.) to the first
    // building of each model type for backward compatibility with workflow code.
    const stdKey = standardKeyMap[b.modelKey]
    if (stdKey && !standardKeyAssigned[stdKey]) {
      WAYPOINTS[stdKey] = { x: doorX, z: doorZ }
      standardKeyAssigned[stdKey] = true
    }

    // Generate a unique display name based on modelKey
    modelKeyCount[b.modelKey] = (modelKeyCount[b.modelKey] ?? 0) + 1
    const idx = modelKeyCount[b.modelKey]
    const name = idx > 1 ? `${role.name}${idx}` : role.name
    const nameEn = idx > 1 ? `${role.nameEn} ${idx}` : role.nameEn

    BUILDING_REGISTRY.push({
      key,
      name,
      scene: role.scene,
      category: role.category,
      tag: role.tag,
      stayRange: role.stayRange,
      capacity: role.capacity,
    })
    BUILDING_NAMES_EN[key] = nameEn
    // Also map the standard key name for backward compatibility
    if (stdKey && !standardKeyAssigned[stdKey + '_name']) {
      BUILDING_NAMES_EN[stdKey] = role.nameEn
      standardKeyAssigned[stdKey + '_name'] = true
    }
  }

  // If no buildings were registered (empty map), keep the original registry
  // so NPCs still have somewhere to go.
  if (BUILDING_REGISTRY.length === 0) {
    // Restore original registry
    BUILDING_REGISTRY.push(
      { key: 'office_door',    name: '办公室',  scene: 'office',    category: 'workspace',    tag: 'office',   stayRange: [5000, 12000],   capacity: 4 },
      { key: 'house_a_door',   name: '住宅A',   scene: 'house_a',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
      { key: 'house_b_door',   name: '住宅B',   scene: 'house_b',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
      { key: 'house_c_door',   name: '住宅C',   scene: 'house_c',   category: 'residential',  tag: 'home',     stayRange: [6000, 15000],   capacity: 2 },
      { key: 'market_door',    name: '市场',    scene: 'market',    category: 'commercial',   tag: 'market',   stayRange: [4000, 10000],   capacity: 6 },
      { key: 'cafe_door',      name: '咖啡店',  scene: 'cafe',      category: 'commercial',   tag: 'cafe',     stayRange: [5000, 12000],   capacity: 4 },
      { key: 'user_home_door', name: '玩家家',  scene: 'user_home', category: 'residential',  tag: 'userHome', stayRange: [3000, 8000],    capacity: 1 },
      { key: 'museum_door',    name: '博物馆',  scene: 'museum',    category: 'public',       tag: 'museum',   stayRange: [5000, 12000],   capacity: 5 },
    )
  }

  console.log(`[types] Updated waypoints from map config: ${Object.keys(WAYPOINTS).length} waypoints, ${BUILDING_REGISTRY.length} buildings`)
}

export interface NPCRouteProfile {
  npcId: string
  homeBuilding: string
  affinities: Record<string, number>
  stayMultiplier: number
  wakeDelay: number
  homeDelay: number
  templateId?: string
  walkSpeed?: number
  socialLevel?: number
}

export type ActivityAction =
  | 'arrived' | 'departed' | 'staying' | 'walking'
  | 'chatted' | 'went_home' | 'woke_up'
  | 'summoned' | 'assigned_task' | 'started_working'
  | 'completed_task' | 'celebrating' | 'returned_from_work'
  | 'need_urgent' | 'need_satisfied' | 'mood_changed' | 'went_indoor' | 'left_indoor'

export interface ActivityEntry {
  time: string
  timestamp: number
  location: string
  locationName: string
  action: ActivityAction
  detail?: string
  relatedNpc?: string
}

export interface DialogueRecord {
  timestamp: number
  partnerNpcId: string
  partnerName: string
  location: string
  turns: { speaker: string; text: string }[]
  summary: string
}

// ── AI-Driven Memory Extensions (Module 13) ──

export interface Relationship {
  npcId: string
  name: string
  label: string
  sentiment: number
  lastInteraction: number
  interactionCount: number
  recentTopics: string[]
}

export interface DailyReflection {
  dayCount: number
  text: string
  timestamp: number
}

export interface DailyPlanItem {
  time: string
  place: string
  intent: string
}

export interface DailyPlan {
  dayCount: number
  items: DailyPlanItem[]
  currentIndex: number
  suspended: boolean
}

// ── Mode System (Module 8) ──

export type GlobalMode = 'life' | 'work'

export type WorkSubState =
  | 'summoning'
  | 'assigning'
  | 'going_to_office'
  | 'working'
  | 'publishing'
  | 'celebrating'
  | 'returning'

export interface ModeState {
  mode: GlobalMode
  workSubState?: WorkSubState
  taskDescription?: string
  summonedNpcIds: string[]
  startedAt: number
}

export const WORK_SUB_STATE_LABELS: Record<WorkSubState, string> = {
  summoning: '召唤中',
  assigning: '分工中',
  going_to_office: '前往办公室',
  working: '工作中',
  publishing: '发布中',
  celebrating: '庆祝中',
  returning: '返回小镇',
}

const WORK_SUB_STATE_LABELS_EN: Record<WorkSubState, string> = {
  summoning: 'Summoning',
  assigning: 'Briefing',
  going_to_office: 'To Office',
  working: 'Working',
  publishing: 'Publishing',
  celebrating: 'Celebrating',
  returning: 'Returning',
}

import { getLocale } from './i18n'

export function getWorkSubStateLabel(state: WorkSubState): string {
  return getLocale() === 'en' ? WORK_SUB_STATE_LABELS_EN[state] : WORK_SUB_STATE_LABELS[state]
}

export interface NarrativeStep {
  type: 'camera_move' | 'npc_move' | 'dialog' | 'wait'
    | 'scene_switch' | 'npc_state' | 'parallel' | 'fx'
    | 'callback' | 'progress'
  params: Record<string, unknown>
  durationMs?: number
}

export type NarrativeAct = NarrativeStep[]

export interface DialogMessage {
  from: string
  text: string
  timestamp: number
  /** Issue 4: target NPC id for user messages (so the NPC card can filter per-citizen). */
  targetNpcId?: string
  /** Issue 3: usage info for assistant messages (mirrors ChatView display). */
  usage?: { input: number; output: number; totalTokens?: number; reasoningTokens?: number; cacheRead?: number; cacheWrite?: number }
  /** Issue 3: model id used for this assistant response. */
  model?: string
  /** Issue 3: context info { used, limit, percent } for assistant messages. */
  contextInfo?: { used: number; limit: number; percent: number }
}

export const MOCK_REPLIES: Record<string, string[]> = {
  greeting: ['嗨！欢迎来到小镇！我是这里的制作人。告诉我你想做什么吧！'],
  game_request: ['好主意！让我召唤团队来帮你！', 'Roguelike！很酷。让我叫上大家一起干！'],
  progress: ['策划在写策划案，美术在画概念图，两个开发在实现核心系统…'],
  tour: ['好呀！走吧~', '跟我来，带你转转~'],
  return_office: ['走，回去看看他们干得怎么样'],
  completion: ['全部完成了！你的新作品已经上架博物馆了，去看看？'],
  fallback: ['嗯嗯，我明白了', '好的，让我想想', '有意思！', '没问题~', '交给我吧！'],
}

const MOCK_REPLIES_EN: Record<string, string[]> = {
  greeting: ['Hi! Welcome to town! I\'m the steward. What shall we build?'],
  game_request: ['Great idea! Let me summon the team!', 'Roguelike! Cool. Let me call everyone!'],
  progress: ['Planner is drafting, artist is sketching, devs are coding...'],
  tour: ['Sure! Follow me~', 'This way, let me show you around~'],
  return_office: ['Let\'s check on the team'],
  completion: ['All done! Your creation is in the museum, check it out?'],
  fallback: ['I see', 'Let me think', 'Interesting!', 'No problem~', 'On it!'],
}

export function getMockReplies(): Record<string, string[]> {
  return getLocale() === 'en' ? MOCK_REPLIES_EN : MOCK_REPLIES
}
