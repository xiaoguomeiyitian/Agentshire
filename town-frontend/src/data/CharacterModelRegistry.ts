import builtinCatalogZh from './character-catalog.json'
import builtinCatalogEn from './character-catalog.en.json'
import { getLocale } from '../i18n'
import type { CustomAsset } from '../editor/CustomAssetStore'
import { apiUrl } from '@/utils/api-base'

function getBuiltinCatalog() { return getLocale() === 'en' ? builtinCatalogEn : builtinCatalogZh }

export type CharacterModelSource = 'builtin' | 'library' | 'custom'

export interface CharacterGroup {
  id: string
  displayName: string
  source: CharacterModelSource
  thumbnailUrl?: string
  variants: number[]
  colors: number[]
  meshUrlPattern: string
  animMapping?: import('../data/CitizenWorkshopConfig').AnimMapping
  detectedClips?: string[]
  animFileUrls?: string[]
  assetId?: string
  modelTransform?: import('../data/CitizenWorkshopConfig').ModelTransform
}

export interface CharacterModelEntry {
  id: string
  displayName: string
  gender: 'male' | 'female' | 'neutral'
  tags: string[]
  description: string
  thumbnailUrl?: string
  source: CharacterModelSource
  meshUrl: string
  animUrl?: string
  hasEmbeddedAnimations: boolean
}

const BASE = apiUrl(import.meta.env.BASE_URL + 'assets/models')
const EXT_BASE = '/ext-assets'
const SHARED_ANIM_URL = `${EXT_BASE}/Characters_1/gLTF/Animations/Animations.glb`

let _builtinModels: CharacterModelEntry[] | null = null
let _builtinGroups: CharacterGroup[] | null = null
let _cachedLocale: string | null = null

function ensureBuiltinCache(): void {
  const locale = getLocale()
  if (_builtinModels && _cachedLocale === locale) return
  _cachedLocale = locale
  const catalog = getBuiltinCatalog()
  _builtinModels = (catalog.models ?? []).map((m: any) => ({
    id: m.id,
    displayName: m.description?.slice(0, 12) ?? m.id,
    gender: m.gender as 'male' | 'female',
    tags: m.tags ?? [],
    description: m.description ?? '',
    source: 'builtin' as const,
    meshUrl: `${BASE}/characters/character-${m.id.replace('char-', '')}.glb`,
    hasEmbeddedAnimations: true,
  }))
  _builtinGroups = _builtinModels.map(m => ({
    id: m.id,
    displayName: m.id.replace('char-', '').replace('-', ' '),
    source: 'builtin' as const,
    thumbnailUrl: apiUrl(`${import.meta.env.BASE_URL}assets/avatars/${m.id}.webp`),
    variants: [],
    colors: [],
    meshUrlPattern: m.meshUrl,
  }))
}

const PET_NAMES = [
  'beaver', 'bee', 'bunny', 'cat', 'caterpillar', 'chick',
  'cow', 'crab', 'deer', 'dog', 'elephant', 'fish',
  'fox', 'giraffe', 'hog', 'koala', 'lion', 'monkey',
  'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
] as const

const PET_GROUPS: CharacterGroup[] = PET_NAMES.map(name => ({
  id: `char-pet-${name}`,
  displayName: name,
  source: 'builtin' as const,
  thumbnailUrl: apiUrl(`${import.meta.env.BASE_URL}assets/avatars/char-pet-${name}.webp`),
  variants: [],
  colors: [],
  meshUrlPattern: `${BASE}/characters/character-pet-${name}.glb`,
}))

const LIBRARY_TYPES: { id: string; displayName: string; maxVariant: number; maxColor: number }[] = [
  { id: '1', displayName: 'Character 1', maxVariant: 3, maxColor: 16 },
  { id: '2', displayName: 'Character 2', maxVariant: 6, maxColor: 12 },
  { id: '3', displayName: 'Character 3', maxVariant: 3, maxColor: 8 },
  { id: '4', displayName: 'Character 4', maxVariant: 1, maxColor: 8 },
  { id: '5', displayName: 'Character 5', maxVariant: 4, maxColor: 8 },
  { id: '6', displayName: 'Character 6', maxVariant: 4, maxColor: 8 },
  { id: '7', displayName: 'Character 7', maxVariant: 2, maxColor: 10 },
  { id: '8', displayName: 'Character 8', maxVariant: 5, maxColor: 6 },
  { id: '9', displayName: 'Character 9', maxVariant: 6, maxColor: 10 },
  { id: '10', displayName: 'Character 10', maxVariant: 5, maxColor: 14 },
  { id: '11', displayName: 'Character 11', maxVariant: 4, maxColor: 11 },
]

const LIBRARY_GROUPS: CharacterGroup[] = LIBRARY_TYPES.map(t => ({
  id: `lib-${t.id}`,
  displayName: t.displayName,
  source: 'library' as const,
  thumbnailUrl: `${EXT_BASE}/Characters_1/thumbnails/lib-${t.id}.webp`,
  variants: Array.from({ length: t.maxVariant }, (_, i) => i + 1),
  colors: Array.from({ length: t.maxColor }, (_, i) => i + 1),
  meshUrlPattern: `${EXT_BASE}/Characters_1/gLTF/Characters/Character_${t.id}_{variant}_{color}.glb`,
}))

export function getBuiltinGroups(): CharacterGroup[] {
  ensureBuiltinCache()
  return [..._builtinGroups!, ...PET_GROUPS]
}

export function getLibraryGroups(): CharacterGroup[] {
  return LIBRARY_GROUPS
}

export function getAllGroups(customAssets: CustomAsset[] = []): CharacterGroup[] {
  ensureBuiltinCache()
  const customs: CharacterGroup[] = customAssets
    .filter(a => a.kind === 'character')
    .map(a => ({
      id: `custom-${a.id}`,
      displayName: a.name,
      source: 'custom' as const,
      thumbnailUrl: apiUrl(a.thumbnail || ''),
      variants: [],
      colors: [],
      meshUrlPattern: `custom-assets/characters/${a.fileName}`,
    }))
  return [..._builtinGroups!, ...PET_GROUPS, ...LIBRARY_GROUPS, ...customs]
}

export function resolveGroupMeshUrl(group: CharacterGroup, variant?: number, color?: number): string {
  if (group.source === 'builtin' || group.source === 'custom') {
    return group.meshUrlPattern
  }
  let url = group.meshUrlPattern
  url = url.replace('{variant}', String(variant ?? group.variants[0] ?? 1))
  url = url.replace('{color}', String(color ?? group.colors[0] ?? 1))
  return url
}

export { SHARED_ANIM_URL }
