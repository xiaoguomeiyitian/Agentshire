export type ModelSource = 'builtin' | 'library' | 'custom'

import { getLocale } from '../i18n'

export interface ModelTransform {
  scale: number
  rotationX: number
  rotationY: number
  rotationZ: number
  offsetX: number
  offsetY: number
  offsetZ: number
}

export function createDefaultModelTransform(): ModelTransform {
  return { scale: 2.8, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 }
}

/**
 * Compute a recommended default ModelTransform based on model geometry and source.
 * `rawHeight` is the model's bounding-box height at scale=1.
 * Builtin models are already standardised at scale 2.8.
 * Library (Characters_1) models face -Z, so rotationY defaults to 180.
 */
export function computeDefaultTransform(rawHeight: number, source: ModelSource): ModelTransform {
  const base = createDefaultModelTransform()
  if (source === 'builtin') return base

  if (source === 'library') {
    const BUILTIN_RENDERED_HEIGHT = 2.8
    base.scale = rawHeight > 0.01 ? BUILTIN_RENDERED_HEIGHT / rawHeight : 2.8
    base.rotationY = 180
    return base
  }

  const BUILTIN_RENDERED_HEIGHT = 2.8
  base.scale = rawHeight > 0.01 ? BUILTIN_RENDERED_HEIGHT / rawHeight : 2.8
  return base
}

/**
 * Standard animation slot names used across the town.
 * Each slot maps to a specific animation clip name in the model's animation set.
 */
export const ANIM_SLOTS = ['idle', 'walk', 'typing', 'wave', 'cheer', 'reading', 'frustrated', 'dancing'] as const
export type AnimSlot = typeof ANIM_SLOTS[number]
export type AnimMapping = Partial<Record<AnimSlot, string>>

export const CHARACTERS1_DEFAULT_ANIM_MAPPING: AnimMapping = {
  idle: 'Idle_A',
  walk: 'Walk_A',
  typing: 'Zombie_Atack_B',
  wave: 'Pistol_Shoot',
  cheer: 'Jump_B_Full',
  reading: 'Pistol_Idle',
  frustrated: 'Death_A',
  dancing: 'Jump_C_Full',
}

export interface WorkshopUserConfig {
  name: string
  avatarUrl?: string
  avatarId: string
  modelSource: ModelSource
  modelTransform?: ModelTransform
  animMapping?: AnimMapping
  animFileUrl?: string
}

export interface WorkshopStewardConfig {
  name: string
  avatarUrl?: string
  avatarId: string
  modelSource: ModelSource
  modelTransform?: ModelTransform
  bio: string
  persona: string
  animMapping?: AnimMapping
  detectedClips?: string[]
  animFileUrls?: string[]
  animFileUrl?: string             // deprecated, migrated to animFileUrls
  /** LLM model ref in "providerId/modelId" form; empty/undefined = inherit global default */
  modelRef?: string
}

export interface WorkshopCitizenConfig {
  id: string
  name: string
  avatarUrl?: string
  avatarId: string
  modelSource: ModelSource
  modelTransform?: ModelTransform
  bio: string
  customSoul?: string
  industry: string
  specialty: string
  persona: string
  homeId: string
  agentEnabled?: boolean
  useCustomPersona?: boolean
  animMapping?: AnimMapping
  detectedClips?: string[]
  animFileUrls?: string[]
  animFileUrl?: string             // deprecated, migrated to animFileUrls
  /** LLM model ref in "providerId/modelId" form; empty/undefined = inherit global default */
  modelRef?: string
}

export interface CitizenWorkshopConfig {
  version: 1
  user: WorkshopUserConfig
  steward: WorkshopStewardConfig
  citizens: WorkshopCitizenConfig[]
  /** @deprecated migrated to per-entry modelTransform; kept for backward compat loading */
  modelTransforms?: Record<string, ModelTransform>
}

/**
 * Published (resolved) config — all URLs baked in, Soul loaded from files.
 * Chat / town frontend reads this directly without further resolution.
 */
export interface PublishedCharacterEntry {
  id: string
  role: 'user' | 'steward' | 'citizen'
  name: string
  avatarUrl: string
  modelUrl: string
  avatarId: string
  modelSource: ModelSource
  bio: string
  specialty: string
  persona: string
  personaFile: string
  homeId: string
  agentEnabled: boolean
  agentId?: string
  agentStatus?: 'active' | 'stopped' | 'error'
  animMapping: AnimMapping
  animFileUrls: string[]
  detectedClips?: string[]
  modelTransform: ModelTransform
  /** LLM model ref in "providerId/modelId" form; empty/undefined = inherit global default */
  modelRef?: string
}

export interface PublishedCitizenConfig {
  version: 1
  publishedAt: string
  characters: PublishedCharacterEntry[]
}

export const INDUSTRY_SPECIALTY_MAP: Record<string, string[]> = {
  '建造': ['木工与搭建', '修缮与维护', '园林营造'],
  '创意': ['出点子', '绘画与布置', '手工修补'],
  '修理': ['修理与种植', '器具修缮', '种植与园艺'],
  '记录': ['写日记与拍照', '记账与观察', '故事记录'],
  '通用': ['通用助手'],
}

export function createDefaultWorkshopConfig(): CitizenWorkshopConfig {
  const isEn = getLocale() === 'en'
  return {
    version: 1,
    user: {
      name: isEn ? 'Mayor' : '镇长',
      avatarId: 'char-male-c',
      modelSource: 'builtin',
    },
    steward: {
      name: 'shire',
      avatarId: 'char-female-b',
      modelSource: 'builtin',
      bio: isEn ? 'Sharp and decisive, the town guide who introduces citizens and reshapes scenes' : '干练御姐，做事利落，善于引导对话，是小镇的向导与管家',
      persona: 'SOUL',
    },
    citizens: [
      { id: 'citizen_1', name: isEn ? 'Yan' : '岩', avatarId: 'char-male-b', modelSource: 'builtin', bio: isEn ? 'Quiet, logical, structure purist, woodwork believer, physically uncomfortable with crooked beams' : '沉稳寡言，逻辑至上，对结构有偏执的洁癖，全局视野，木工信仰者，看到歪的梁会物理不适', industry: '建造', specialty: isEn ? 'Woodwork' : '木工与搭建', persona: 'YAN', homeId: 'house_a' },
      { id: 'citizen_2', name: isEn ? 'Chengzi' : '橙子', avatarId: 'char-female-c', modelSource: 'builtin', bio: isEn ? 'Fast thinker, ideas overflow, obsessed with neighbors living comfortably' : '脑子转速极快，想法多到溢出来，开朗到有点吵，对邻居过得舒不舒服有偏执的共情力', industry: '创意', specialty: isEn ? 'Ideas' : '出点子', persona: 'CHENGZI', homeId: 'house_b' },
      { id: 'citizen_3', name: isEn ? 'Haitang' : '海棠', avatarId: 'char-female-e', modelSource: 'builtin', bio: isEn ? 'Elegant, few words, extraordinary color perception' : '安静优雅，审美洁癖，话少但每句都跟视觉有关，色彩感知力异常', industry: '创意', specialty: isEn ? 'Painting' : '绘画与布置', persona: 'HAITANG', homeId: 'house_c' },
      { id: 'citizen_4', name: isEn ? 'Diandian' : '点点', avatarId: 'char-female-f', modelSource: 'builtin', bio: isEn ? 'Warm and sunny, crafty and careful, loves mending and handmade, never shows off' : '温暖阳光，邻家妹妹型，手巧心细，爱修补东西做手工，从不炫耀', industry: '创意', specialty: isEn ? 'Mending' : '手工修补', persona: 'DIANDIAN', homeId: 'house_a' },
      { id: 'citizen_5', name: isEn ? 'Xiaolie' : '小烈', avatarId: 'char-male-e', modelSource: 'builtin', bio: isEn ? 'Action-first, blazing energy, thrives on hard problems like a boss fight' : '热血冲劲，行动派，先干再说，精力惊人，遇到难题像打BOSS一样兴奋', industry: '修理', specialty: isEn ? 'Repair & Plant' : '修理与种植', persona: 'XIAOLIE', homeId: 'house_b' },
      { id: 'citizen_6', name: isEn ? 'Qiqi' : '柒柒', avatarId: 'char-female-d', modelSource: 'builtin', bio: isEn ? 'Creative fountain, town storyteller, knows what moves people but values substance more' : '灵感涌泉，表达欲旺盛，小镇故事记录者，知道什么故事动人但更在意故事有没有价值', industry: '记录', specialty: isEn ? 'Diary & Photo' : '写日记与拍照', persona: 'QIQI', homeId: 'house_c' },
      { id: 'citizen_7', name: isEn ? 'Chen' : '辰', avatarId: 'char-male-d', modelSource: 'builtin', bio: isEn ? 'Cold logic, speaks only in conclusions, data is religion not habit' : '冷静理性，数据洁癖，沉默但一开口就是结论，用数据说话是信仰不是习惯', industry: '记录', specialty: isEn ? 'Bookkeeping' : '记账与观察', persona: 'CHEN', homeId: 'house_a' },
    ],
  }
}

let _nextId = 100
export function generateCitizenId(): string {
  return `citizen_${Date.now()}_${_nextId++}`
}

const SLOT_MATCH_KEYWORDS: Record<AnimSlot, string[]> = {
  idle: ['idle', 'standby', 'rest'],
  walk: ['walk', 'move', 'locomotion'],
  typing: ['type', 'typing', 'work', 'attack'],
  wave: ['wave', 'greet', 'hello', 'shoot'],
  cheer: ['cheer', 'celebrate', 'jump', 'victory'],
  reading: ['read', 'reading', 'book', 'pistol_idle'],
  frustrated: ['frustrat', 'angry', 'death', 'sad'],
  dancing: ['danc', 'dance'],
}

export const SLOT_LABELS: Record<string, string> = {
  idle: '待机', walk: '行走', typing: '工作', wave: '打招呼',
  cheer: '庆祝', reading: '阅读', frustrated: '沮丧', dancing: '跳舞',
}

export function autoMatchAnimSlots(clipNames: string[], existing?: AnimMapping): AnimMapping {
  const mapping: AnimMapping = existing ? { ...existing } : {}
  const lower = clipNames.map(n => ({ orig: n, lc: n.toLowerCase() }))
  for (const slot of ANIM_SLOTS) {
    if (mapping[slot]) continue
    const kws = SLOT_MATCH_KEYWORDS[slot]
    const match = lower.find(c => kws.some(k => c.lc.includes(k)))
    if (match) mapping[slot] = match.orig
  }
  return mapping
}
