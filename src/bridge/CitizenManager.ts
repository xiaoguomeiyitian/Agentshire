// @desc Citizen lifecycle: persona detection, spawn animation sequence, and name matching
import type { GameEvent } from '../../town-frontend/src/data/GameProtocol.js'
import type { RouteManager } from './RouteManager.js'
import { CITIZEN_SPAWN_ORIGIN } from './RouteManager.js'
import { getCharacterKeyForNpc } from '../../town-frontend/src/data/CharacterRoster.js'

export interface CitizenManagerDeps {
  emit: (events: GameEvent[]) => void
  routes: RouteManager
  getConfig: () => any
  getCharacterAssignments: () => Map<string, string>
  isStewardConfirmed: () => boolean
  getPersonaName: () => string | null
  getStewardName: () => string
  onPersonaChanged: (name: string) => void
  delayMs: (ms: number) => Promise<void>
  scheduleDelayedEmit: (delayMs: number, events: GameEvent[]) => void
  getLastToolInput: () => Record<string, unknown>
}

/** Detects new citizen persona files, manages the spawn queue, and orchestrates the citizen arrival animation (spawn -> greet steward -> walk to destination) */
export class CitizenManager {
  pendingCitizenNames: { npcId: string; citizenName: string }[] = []
  citizenSpawnQueue: { npcId: string; citizenName: string }[] = []
  citizenSpawning = false
  activeCitizenNpcs = new Set<string>()
  spawnedCitizenCount = 0
  spawnedCitizenIds = new Set<string>()
  citizenFlowStartMs = new Map<string, number>()
  pendingStewardRenameTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: CitizenManagerDeps) {}

  /** Handle switch_persona tool result: update steward name and trigger persona transform VFX */
  async detectPersonaSwitch(event: any): Promise<void> {
    if (event.name !== 'switch_persona') return
    const output = String(event.output ?? '')
    const m = output.match(/Persona switched to "(.+?)"/)
    if (!m) return

    const newName = m[1]

    this.deps.emit([
      { type: 'fx', effect: 'personaTransform', params: { npcId: this.deps.getStewardName() } },
    ])

    if (this.pendingStewardRenameTimer) {
      clearTimeout(this.pendingStewardRenameTimer)
      this.pendingStewardRenameTimer = null
    }
    this.pendingStewardRenameTimer = setTimeout(() => {
      this.pendingStewardRenameTimer = null
      this.deps.emit([
        { type: 'steward_rename', npcId: 'steward', newName },
      ])
    }, 1500)

    this.flushPendingCitizens()
    this.deps.onPersonaChanged(newName)
  }

  /** Handle write_file tool result: if the file is a persona, queue the citizen for spawning */
  detectCitizenCreated(event: any): void {
    if (event.name !== 'write_file') return
    const filePath = String(event.meta?.filePath ?? this.deps.getLastToolInput().path ?? '')
    console.log('[CitizenManager] detectCitizenCreated filePath:', filePath, 'isPersona:', this.isPersonaPath(filePath))
    if (!this.isPersonaPath(filePath)) return

    const fileName = filePath.split('/').pop() ?? ''
    const citizenName = fileName.replace(/\.md$/i, '').replace(/_/g, ' ').trim()
    if (!citizenName) return

    const npcId = `citizen_${citizenName.toLowerCase().replace(/\s+/g, '_')}`
    if (this.spawnedCitizenIds.has(npcId)) return
    if (this.pendingCitizenNames.some(p => p.npcId === npcId)) return
    if (this.citizenSpawnQueue.some(p => p.npcId === npcId)) return

    if (!this.deps.isStewardConfirmed()) {
      console.log(`[CitizenManager] steward not confirmed yet, queue persona file: ${citizenName} (${npcId})`)
      this.pendingCitizenNames.push({ npcId, citizenName })
      return
    }

    if (this.isStewardName(citizenName)) {
      console.log(`[CitizenManager] skipping recognized steward persona file: ${citizenName}`)
      this.spawnedCitizenIds.add(npcId)
      return
    }

    console.log(`[CitizenManager] citizen persona detected: ${citizenName} (${npcId}), spawn immediately`)
    this.spawnedCitizenIds.add(npcId)
    this.citizenSpawnQueue.push({ npcId, citizenName })
    this.drainCitizenSpawnQueue()
  }

  isStewardName(name: string): boolean {
    const lower = name.toLowerCase().replace(/\s+/g, '_')
    const personaName = this.deps.getPersonaName()
    if (personaName && lower === personaName.toLowerCase().replace(/\s+/g, '_')) return true
    const stewardName = this.deps.getStewardName()
    if (stewardName !== 'steward' && lower === stewardName.toLowerCase().replace(/\s+/g, '_')) return true
    return false
  }

  /** Move pending citizen names (held until steward persona is confirmed) into the spawn queue */
  flushPendingCitizens(): void {
    if (!this.deps.isStewardConfirmed()) {
      console.log('[CitizenManager] steward persona not confirmed yet, defer citizen spawning')
      return
    }

    const toSpawn = this.pendingCitizenNames.splice(0)
    for (const { npcId, citizenName } of toSpawn) {
      if (this.spawnedCitizenIds.has(npcId)) continue
      if (this.isStewardName(citizenName)) {
        console.log(`[CitizenManager] skipping steward persona: ${citizenName}`)
        this.spawnedCitizenIds.add(npcId)
        continue
      }
      this.spawnedCitizenIds.add(npcId)
      this.citizenSpawnQueue.push({ npcId, citizenName })
    }
    this.drainCitizenSpawnQueue()
  }

  drainCitizenSpawnQueue(): void {
    while (this.citizenSpawnQueue.length > 0) {
      if (this.citizenSpawning) return
      const next = this.citizenSpawnQueue[0]
      if (this.isStewardName(next.citizenName)) {
        console.log(`[CitizenManager] drainQueue: skipping steward persona: ${next.citizenName}`)
        this.citizenSpawnQueue.shift()
        continue
      }
      this.citizenSpawning = true
      this.citizenSpawnQueue.shift()
      this.spawnCitizenSequence(next.npcId, next.citizenName)
      return
    }
  }

  async spawnCitizenSequence(npcId: string, citizenName: string): Promise<void> {
    const idx = this.spawnedCitizenCount++

    const spawnX = CITIZEN_SPAWN_ORIGIN.x + (idx % 3 - 1) * 2.5
    const spawnZ = CITIZEN_SPAWN_ORIGIN.z
    const flowStart = Date.now()
    this.citizenFlowStartMs.set(npcId, flowStart)

    console.log(`[CitizenManager] spawning citizen: ${citizenName} (${npcId}) at (${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)})`)

    this.activeCitizenNpcs.add(npcId)
    let claimedDestinationId: string | null = null
    let destinationArrived = false
    const config = this.deps.getConfig()
    const configuredCitizen = config?.citizens?.find((c: any) => c.id === npcId)
    const citizenCharacterKey = configuredCitizen?.avatarId ?? getCharacterKeyForNpc(npcId)

    this.deps.emit([
      {
        type: 'npc_spawn', npcId, name: citizenName,
        role: 'general', category: 'citizen',
        spawn: { x: spawnX, y: 0, z: spawnZ },
        avatarId: citizenCharacterKey,
      },
    ])

    try {
      await this.deps.delayMs(300)

      const greetPoint = this.deps.routes.getGreetPoint(idx)
      const greetX = greetPoint.x
      const greetZ = greetPoint.z
      const walkSpeed = 5
      console.log(`[CitizenManager][CitizenFlow] ${npcId} -> greet target=(${greetX.toFixed(2)}, ${greetZ.toFixed(2)}) speed=${walkSpeed} mode=arrival-driven`)

      const greetStatus = await this.deps.routes.moveNpcAndWait(
        npcId,
        { x: greetX, y: 0, z: greetZ },
        walkSpeed,
      )
      if (greetStatus !== 'arrived') {
        console.warn(`[CitizenManager][CitizenFlow] ${npcId} greet move interrupted`)
        return
      }

      this.deps.emit([
        { type: 'npc_anim', npcId, anim: 'wave' },
        { type: 'fx', effect: 'exclamation', params: { npcId } },
        { type: 'dialog_message', npcId, text: `你好！我是${citizenName}，很高兴来到小镇！`, isStreaming: false },
      ])

      await this.deps.delayMs(2500)

      const destination = this.deps.routes.chooseCitizenDestination(npcId, { x: greetX, z: greetZ })
      const targetX = destination.x + (Math.random() - 0.5) * 1.3
      const targetZ = destination.z + (Math.random() - 0.5) * 1.3
      this.deps.routes.claimDestinationForNpc(npcId, destination.id)
      claimedDestinationId = destination.id
      console.log(`[CitizenManager][CitizenFlow] ${npcId} route destination=${destination.id} target=(${targetX.toFixed(2)}, ${targetZ.toFixed(2)}) score=${destination.score.toFixed(2)} mode=arrival-driven`)

      const destinationStatus = await this.deps.routes.moveNpcAndWait(
        npcId,
        { x: targetX, y: 0, z: targetZ },
        walkSpeed,
      )
      if (destinationStatus !== 'arrived') {
        console.warn(`[CitizenManager][CitizenFlow] ${npcId} destination move interrupted`)
        return
      }

      destinationArrived = true
      this.deps.emit([{ type: 'npc_daily_behavior_ready', npcId }])
      this.deps.routes.releaseDestinationClaimLater(npcId, destination.id, 30000)
      const flowEnd = Date.now()
      console.log(`[CitizenManager][CitizenFlow] ${npcId} done total=${flowEnd - flowStart}ms`)
    } finally {
      if (claimedDestinationId && !destinationArrived) {
        this.deps.routes.releaseDestinationClaim(npcId, claimedDestinationId)
      }
      this.activeCitizenNpcs.delete(npcId)
      this.citizenFlowStartMs.delete(npcId)
      this.citizenSpawning = false
      this.drainCitizenSpawnQueue()
    }
  }

  /** Find a citizen's NPC ID by exact name match against town config and spawned IDs */
  findCitizenNpcId(name: string): string | null {
    const normalized = name.toLowerCase().replace(/\s+/g, '_')
    const config = this.deps.getConfig()

    if (config?.citizens) {
      for (const c of config.citizens) {
        if (c.name === name || c.name.toLowerCase().replace(/\s+/g, '_') === normalized) {
          return c.id
        }
      }
    }

    const candidateId = `citizen_${normalized}`
    if (this.spawnedCitizenIds.has(candidateId)) return candidateId
    for (const id of this.spawnedCitizenIds) {
      if (id.endsWith(`_${normalized}`)) return id
    }
    return null
  }

  /** Find a citizen's NPC ID by fuzzy substring match */
  fuzzyMatchCitizen(name: string): string | null {
    const lower = name.toLowerCase().replace(/\s+/g, '')
    if (!lower) return null
    const config = this.deps.getConfig()

    if (config?.citizens) {
      for (const c of config.citizens) {
        const cName = c.name.toLowerCase().replace(/\s+/g, '')
        if (cName.includes(lower) || lower.includes(cName)) return c.id
      }
    }

    for (const id of this.spawnedCitizenIds) {
      const citizenName = id.replace(/^citizen_/, '').replace(/_/g, '')
      if (citizenName.includes(lower) || lower.includes(citizenName)) return id
    }
    return null
  }

  looksLikeIdFragment(name: string): boolean {
    return /^[a-z0-9_\- ]{1,12}$/i.test(name) && !/[\u4e00-\u9fa5]/.test(name)
  }

  isPersonaPath(filePath: string | null): boolean {
    if (!filePath) return false
    return /\bpersonas?\b/i.test(filePath)
  }
}
