import townDefaults from './town-defaults.json'
import refZh from './town-defaults.ref-zh.json'
import refEn from './town-defaults.en.json'
import type { ModelTransform, AnimMapping, PublishedCitizenConfig } from './CitizenWorkshopConfig'
import { getLocale } from '../i18n'

export interface StewardConfig {
  name: string
  persona: string
  avatarId: string
  avatarUrl?: string
  modelUrl?: string
  modelTransform?: ModelTransform
  animMapping?: AnimMapping
  animFileUrls?: string[]
}

export interface CitizenConfig {
  id: string
  name: string
  specialty: string
  persona: string
  avatarId: string
  avatarUrl?: string
  homeId: string
  modelUrl?: string
  modelTransform?: ModelTransform
  animMapping?: AnimMapping
  animFileUrls?: string[]
}

export interface UserConfig {
  name: string
  avatarId: string
  avatarUrl?: string
  modelUrl?: string
  modelTransform?: ModelTransform
  animMapping?: AnimMapping
  animFileUrls?: string[]
}

export interface TownConfig {
  townName: string
  steward: StewardConfig
  user: UserConfig
  citizens: CitizenConfig[]
  createdAt: number
  version: number
}

const SPECIALTY_LABELS_ZH: Record<string, string> = {
  architecture: '架构', planning: '策划', design: '设计', programming: '开发',
  writing: '内容创作', data: '数据分析', general: '通用',
}
const SPECIALTY_LABELS_EN: Record<string, string> = {
  architecture: 'Architect', planning: 'Planner', design: 'Design', programming: 'Dev',
  writing: 'Content', data: 'Data', general: 'General',
}

export const SPECIALTY_LABELS = SPECIALTY_LABELS_ZH

export function getSpecialtyLabel(specialty: string): string {
  const labels = getLocale() === 'en' ? SPECIALTY_LABELS_EN : SPECIALTY_LABELS_ZH
  return labels[specialty] ?? specialty
}

// ── Locale-aware field translation for default characters ──

interface CharRef { name: string; specialty: string; bio: string }

function buildRefMap(src: typeof refZh): Map<string, CharRef> {
  const m = new Map<string, CharRef>()
  const s = src.steward as any
  m.set(s.id, { name: s.name, specialty: s.specialty ?? '', bio: s.bio ?? '' })
  const u = src.user as any
  m.set(u.id, { name: u.name, specialty: u.specialty ?? '', bio: u.bio ?? '' })
  for (const c of src.citizens) {
    const ca = c as any
    m.set(c.id, { name: c.name, specialty: c.specialty, bio: ca.bio ?? '' })
  }
  return m
}

let _zhMap: Map<string, CharRef> | null = null
let _enMap: Map<string, CharRef> | null = null
function getZhRef() { return _zhMap ?? (_zhMap = buildRefMap(refZh)) }
function getEnRef() { return _enMap ?? (_enMap = buildRefMap(refEn)) }

/**
 * Translate a character field if it matches a default value.
 * - hasPublished=true: return value as-is (published data is final)
 * - hasPublished=false: if value matches zh or en default, return current locale's version
 */
export function translateDefaultField(charId: string, field: keyof CharRef, value: string, hasPublished: boolean): string {
  if (hasPublished) return value

  const zh = getZhRef().get(charId)
  const en = getEnRef().get(charId)
  if (!zh || !en) return value

  const zhVal = zh[field]
  const enVal = en[field]
  const isEn = getLocale() === 'en'

  if (value === zhVal) return isEn ? enVal : zhVal
  if (value === enVal) return isEn ? enVal : zhVal
  return value
}

// ── Published flag (set by SceneBootstrap) ──

let _hasPublished = false
export function setHasPublished(v: boolean): void { _hasPublished = v }
export function getHasPublished(): boolean { return _hasPublished }

// ── Config creation ──

export function createDefaultTownConfig(): TownConfig {
  const isEn = getLocale() === 'en'
  const src = isEn ? refEn : townDefaults
  return {
    townName: src.townName,
    steward: {
      name: src.steward.name,
      persona: extractSoulId(src.steward.personaFile),
      avatarId: src.steward.characterKey,
    },
    user: {
      name: src.user.name,
      avatarId: src.user.characterKey,
    },
    citizens: src.citizens.map(c => ({
      id: c.id,
      name: c.name,
      specialty: c.specialty,
      persona: extractSoulId(c.personaFile),
      avatarId: c.characterKey,
      homeId: c.homeId,
    })),
    createdAt: Date.now(),
    version: 4,
  }
}

export function publishedToTownView(published: PublishedCitizenConfig): TownConfig {
  const stewardEntry = published.characters.find(c => c.role === 'steward')
  const userEntry = published.characters.find(c => c.role === 'user')
  const citizenEntries = published.characters.filter(c => c.role === 'citizen')

  return {
    townName: townDefaults.townName,
    steward: {
      name: stewardEntry?.name ?? 'OpenClaw',
      persona: stewardEntry?.persona ?? '',
      avatarId: stewardEntry?.avatarId ?? 'char-female-b',
      avatarUrl: stewardEntry?.avatarUrl,
      modelUrl: stewardEntry?.modelUrl,
      modelTransform: stewardEntry?.modelTransform,
      animMapping: stewardEntry?.animMapping,
      animFileUrls: stewardEntry?.animFileUrls,
    },
    user: {
      name: userEntry?.name ?? '镇长',
      avatarId: userEntry?.avatarId ?? 'char-male-c',
      avatarUrl: userEntry?.avatarUrl,
      modelUrl: userEntry?.modelUrl,
      modelTransform: userEntry?.modelTransform,
      animMapping: userEntry?.animMapping,
      animFileUrls: userEntry?.animFileUrls,
    },
    citizens: citizenEntries.map(c => ({
      id: c.id,
      name: c.name,
      specialty: c.specialty,
      persona: c.persona,
      avatarId: c.avatarId,
      avatarUrl: c.avatarUrl,
      homeId: c.homeId,
      modelUrl: c.modelUrl,
      modelTransform: c.modelTransform,
      animMapping: c.animMapping,
      animFileUrls: c.animFileUrls,
    })),
    createdAt: Date.now(),
    version: 4,
  }
}

export interface NPCProfile {
  name: string
  specialty: string
  bio: string
}

export function getNpcProfiles(): Map<string, NPCProfile> {
  const hp = _hasPublished
  const map = new Map<string, NPCProfile>()
  const s = townDefaults.steward as any
  map.set(s.id, {
    name: translateDefaultField(s.id, 'name', s.name, hp),
    specialty: translateDefaultField(s.id, 'specialty', s.specialty ?? '', hp) || (getLocale() === 'en' ? 'Steward' : '管家'),
    bio: translateDefaultField(s.id, 'bio', s.bio ?? '', hp),
  })
  const u = townDefaults.user as any
  map.set(u.id, {
    name: translateDefaultField(u.id, 'name', u.name, hp),
    specialty: translateDefaultField(u.id, 'specialty', u.specialty ?? '', hp) || (getLocale() === 'en' ? 'Mayor' : '镇长'),
    bio: translateDefaultField(u.id, 'bio', u.bio ?? '', hp),
  })
  for (const c of townDefaults.citizens) {
    const ca = c as any
    map.set(c.id, {
      name: translateDefaultField(c.id, 'name', c.name, hp),
      specialty: translateDefaultField(c.id, 'specialty', c.specialty, hp),
      bio: translateDefaultField(c.id, 'bio', ca.bio ?? '', hp),
    })
  }
  return map
}

export function extractSoulId(personaFile: string): string {
  const base = personaFile.split('/').pop() ?? ''
  return base.replace(/\.md$/i, '')
}
