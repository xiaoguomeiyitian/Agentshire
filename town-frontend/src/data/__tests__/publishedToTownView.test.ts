import { describe, it, expect } from 'vitest'
import { publishedToTownView } from '../TownConfig'
import type { PublishedCitizenConfig, PublishedCharacterEntry } from '../CitizenWorkshopConfig'
import { createDefaultModelTransform } from '../CitizenWorkshopConfig'

function makeEntry(overrides: Partial<PublishedCharacterEntry> & { id: string; role: 'user' | 'steward' | 'citizen' }): PublishedCharacterEntry {
  return {
    name: '',
    avatarUrl: '',
    modelUrl: '',
    avatarId: '',
    modelSource: 'builtin',
    bio: '',
    specialty: '',
    persona: '',
    personaFile: '',
    homeId: '',
    agentEnabled: false,
    animMapping: {},
    animFileUrls: [],
    modelTransform: createDefaultModelTransform(),
    ...overrides,
  }
}

function makePublished(characters: PublishedCharacterEntry[]): PublishedCitizenConfig {
  return { version: 1, publishedAt: new Date().toISOString(), characters }
}

describe('publishedToTownView', () => {
  it('correctly groups steward/user/citizens from characters[]', () => {
    const published = makePublished([
      makeEntry({ id: 'user', role: 'user', name: '镇长', avatarId: 'char-male-c' }),
      makeEntry({ id: 'steward', role: 'steward', name: '管家', avatarId: 'char-female-b', persona: 'SOUL' }),
      makeEntry({ id: 'c1', role: 'citizen', name: '岩', avatarId: 'char-male-b', specialty: '木工与搭建', homeId: 'house_a' }),
      makeEntry({ id: 'c2', role: 'citizen', name: '橙子', avatarId: 'lib-5', specialty: '出点子', homeId: 'house_b' }),
    ])
    const result = publishedToTownView(published)

    expect(result.steward.name).toBe('管家')
    expect(result.steward.avatarId).toBe('char-female-b')
    expect(result.steward.persona).toBe('SOUL')
    expect(result.user.name).toBe('镇长')
    expect(result.user.avatarId).toBe('char-male-c')
    expect(result.citizens).toHaveLength(2)
    expect(result.citizens[0].id).toBe('c1')
    expect(result.citizens[0].name).toBe('岩')
    expect(result.citizens[1].id).toBe('c2')
    expect(result.citizens[1].name).toBe('橙子')
  })

  it('preserves all model fields on citizens without modification', () => {
    const transform = { scale: 1.6, rotationX: 0, rotationY: 180, rotationZ: 0, offsetX: 0, offsetY: 0.1, offsetZ: 0 }
    const mapping = { idle: 'Idle_A', walk: 'Walk_A', typing: 'Zombie_Atack_B' }
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({
        id: 'c1', role: 'citizen', name: '橙子',
        avatarId: 'lib-5',
        modelUrl: '/ext-assets/Characters_1/gLTF/Characters/Character_5_1_1.glb',
        modelTransform: transform,
        animMapping: mapping,
        animFileUrls: ['/anims/a.glb', '/anims/b.glb'],
        specialty: '出点子',
        persona: 'CHENGZI',
        homeId: 'house_b',
      }),
    ])
    const result = publishedToTownView(published)
    const c = result.citizens[0]

    expect(c.modelUrl).toBe('/ext-assets/Characters_1/gLTF/Characters/Character_5_1_1.glb')
    expect(c.modelTransform).toEqual(transform)
    expect(c.animMapping).toEqual(mapping)
    expect(c.animFileUrls).toEqual(['/anims/a.glb', '/anims/b.glb'])
    expect(c.specialty).toBe('出点子')
    expect(c.persona).toBe('CHENGZI')
    expect(c.homeId).toBe('house_b')
  })

  it('preserves model fields on steward and user', () => {
    const transform = { scale: 2.0, rotationX: 5, rotationY: 90, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 }
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S', modelUrl: '/m/s.glb', modelTransform: transform, animMapping: { idle: 'X' }, animFileUrls: ['/a.glb'] }),
      makeEntry({ id: 'user', role: 'user', name: 'U', modelUrl: '/m/u.glb', modelTransform: transform }),
    ])
    const result = publishedToTownView(published)

    expect(result.steward.modelUrl).toBe('/m/s.glb')
    expect(result.steward.modelTransform).toEqual(transform)
    expect(result.steward.animMapping).toEqual({ idle: 'X' })
    expect(result.steward.animFileUrls).toEqual(['/a.glb'])
    expect(result.user.modelUrl).toBe('/m/u.glb')
    expect(result.user.modelTransform).toEqual(transform)
  })

  it('preserves citizen order from input', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({ id: 'c3', role: 'citizen', name: 'Third' }),
      makeEntry({ id: 'c1', role: 'citizen', name: 'First' }),
      makeEntry({ id: 'c2', role: 'citizen', name: 'Second' }),
    ])
    const result = publishedToTownView(published)
    expect(result.citizens.map(c => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('uses defaults when steward is missing', () => {
    const published = makePublished([
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({ id: 'c1', role: 'citizen', name: 'A' }),
    ])
    const result = publishedToTownView(published)
    expect(result.steward.name).toBe('OpenClaw')
    expect(result.steward.avatarId).toBe('char-female-b')
  })

  it('uses defaults when user is missing', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
    ])
    const result = publishedToTownView(published)
    expect(result.user.name).toBe('镇长')
    expect(result.user.avatarId).toBe('char-male-c')
  })

  it('handles empty characters array', () => {
    const published = makePublished([])
    const result = publishedToTownView(published)
    expect(result.steward.name).toBe('OpenClaw')
    expect(result.user.name).toBe('镇长')
    expect(result.citizens).toEqual([])
  })

  it('takes first steward/user if duplicates exist', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'First' }),
      makeEntry({ id: 'steward2', role: 'steward', name: 'Second' }),
      makeEntry({ id: 'user', role: 'user', name: 'U1' }),
      makeEntry({ id: 'user2', role: 'user', name: 'U2' }),
    ])
    const result = publishedToTownView(published)
    expect(result.steward.name).toBe('First')
    expect(result.user.name).toBe('U1')
  })

  it('passes through empty string specialty and homeId without dropping', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({ id: 'c1', role: 'citizen', name: 'Test', specialty: '', homeId: '' }),
    ])
    const result = publishedToTownView(published)
    expect(result.citizens[0].specialty).toBe('')
    expect(result.citizens[0].homeId).toBe('')
  })

  it('handles all avatarId prefixes correctly (char-*, lib-*, custom-*)', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({ id: 'c1', role: 'citizen', name: 'A', avatarId: 'char-male-a' }),
      makeEntry({ id: 'c2', role: 'citizen', name: 'B', avatarId: 'lib-5' }),
      makeEntry({ id: 'c3', role: 'citizen', name: 'C', avatarId: 'custom-abc123' }),
    ])
    const result = publishedToTownView(published)
    expect(result.citizens[0].avatarId).toBe('char-male-a')
    expect(result.citizens[1].avatarId).toBe('lib-5')
    expect(result.citizens[2].avatarId).toBe('custom-abc123')
  })

  it('precisely preserves non-default modelTransform values', () => {
    const transform = { scale: 1.605, rotationX: 5, rotationY: 180, rotationZ: 3, offsetX: -0.5, offsetY: 0.3, offsetZ: 1.2 }
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
      makeEntry({ id: 'c1', role: 'citizen', name: 'A', modelTransform: transform }),
    ])
    const result = publishedToTownView(published)
    expect(result.citizens[0].modelTransform).toStrictEqual(transform)
  })

  it('output has version 4 for TownConfigStore compatibility', () => {
    const published = makePublished([])
    const result = publishedToTownView(published)
    expect(result.version).toBe(4)
  })

  it('only citizens without steward/user produces correct structure', () => {
    const published = makePublished([
      makeEntry({ id: 'steward', role: 'steward', name: 'S' }),
      makeEntry({ id: 'user', role: 'user', name: 'U' }),
    ])
    const result = publishedToTownView(published)
    expect(result.citizens).toEqual([])
  })
})
