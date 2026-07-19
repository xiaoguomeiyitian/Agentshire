// @desc Bidirectional agentId ↔ npcId mapping and workstation allocation
export interface NPCState {
  npcId: string
  agentId: string
  phase: string
  stationId?: string
}

// Issue 3: reduced from 10 to 6 workstations to match OfficeBuilder.
// Order prioritizes desks near the door (z=17 row, closer to door at z=25)
// so sub-agents fill the front row first.
const WORKSTATION_IDS = ['D', 'E', 'F', 'A', 'B', 'C']

/** Maintains bidirectional agentId ↔ npcId mappings and allocates workstation slots for sub-agent NPCs */
export class StateTracker {
  private agentToNpc = new Map<string, string>()
  private npcToAgent = new Map<string, string>()
  private npcStates = new Map<string, NPCState>()
  private usedStations = new Set<string>()

  readonly stewardNpcId = 'steward'

  /** Resolve an agentId to its corresponding npcId */
  resolveNpcId(agentId: string): string | undefined {
    return this.agentToNpc.get(agentId)
  }

  resolveAgentId(npcId: string): string | undefined {
    return this.npcToAgent.get(npcId)
  }

  getStationForNpc(npcId: string): string | undefined {
    return this.npcStates.get(npcId)?.stationId
  }

  /** Register a bidirectional agentId ↔ npcId mapping */
  registerMapping(agentId: string, npcId: string): void {
    this.agentToNpc.set(agentId, npcId)
    this.npcToAgent.set(npcId, agentId)
  }

  /** Remove a mapping and associated NPC state by agentId */
  removeMapping(agentId: string): void {
    const npcId = this.agentToNpc.get(agentId)
    if (npcId) {
      const state = this.npcStates.get(npcId)
      if (state?.stationId) {
        this.usedStations.delete(state.stationId)
      }
      this.npcToAgent.delete(npcId)
      this.npcStates.delete(npcId)
    }
    this.agentToNpc.delete(agentId)
  }

  removeMappingByNpcId(npcId: string): void {
    const agentId = this.npcToAgent.get(npcId)
    if (agentId) {
      this.removeMapping(agentId)
    }
  }

  /** Allocate the next available workstation ID, or null if all are in use */
  allocateStation(): string | null {
    for (const id of WORKSTATION_IDS) {
      if (!this.usedStations.has(id)) {
        this.usedStations.add(id)
        return id
      }
    }
    return null
  }

  releaseStation(stationId: string): void {
    this.usedStations.delete(stationId)
  }

  updatePhase(npcId: string, phase: string): void {
    const state = this.npcStates.get(npcId)
    if (state) state.phase = phase
  }

  setStationForNpc(npcId: string, stationId: string): void {
    let state = this.npcStates.get(npcId)
    if (!state) {
      state = { npcId, agentId: this.npcToAgent.get(npcId) ?? '', phase: 'idle' }
      this.npcStates.set(npcId, state)
    }
    state.stationId = stationId
  }

  getAllNpcStates(): NPCState[] {
    return [...this.npcStates.values()]
  }

  /** Reset all mappings, NPC states, and station allocations */
  clear(): void {
    this.agentToNpc.clear()
    this.npcToAgent.clear()
    this.npcStates.clear()
    this.usedStations.clear()
  }
}
