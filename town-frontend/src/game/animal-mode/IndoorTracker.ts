/**
 * IndoorTracker — tracks which citizens are currently "inside" a building.
 *
 * In Animal Mode, residential buildings (house_a/b/c, user_home) have no
 * interior scene. When a citizen enters such a building, they become
 * invisible in the town scene (mesh.visible = false) but their NeedsEngine
 * and AutonomyEngine keep running. This tracker records the indoor state
 * so other systems can query it.
 *
 * Public buildings (cafe/market/museum) do NOT use this tracker — citizens
 * stay visible there (using the existing occupancy mechanism in DailyBehavior).
 */

export class IndoorTracker {
  /** npcId -> buildingKey (residential only) */
  private indoorMap: Map<string, string> = new Map()

  /** Record that a citizen entered a residential building. */
  enter(npcId: string, buildingKey: string): void {
    this.indoorMap.set(npcId, buildingKey)
  }

  /** Record that a citizen left their indoor location. */
  leave(npcId: string): void {
    this.indoorMap.delete(npcId)
  }

  /** Is this citizen currently indoors (invisible in town)? */
  isIndoor(npcId: string): boolean {
    return this.indoorMap.has(npcId)
  }

  /** Which building is this citizen inside? Returns null if outdoors. */
  getIndoorLocation(npcId: string): string | null {
    return this.indoorMap.get(npcId) ?? null
  }

  /** All citizens currently inside a specific building. */
  getIndoorAt(buildingKey: string): string[] {
    const result: string[] = []
    for (const [npcId, key] of this.indoorMap) {
      if (key === buildingKey) result.push(npcId)
    }
    return result
  }

  /** All citizens currently indoors, as [npcId, buildingKey] pairs. */
  getAllIndoor(): Array<{ npcId: string; buildingKey: string }> {
    const result: Array<{ npcId: string; buildingKey: string }> = []
    for (const [npcId, buildingKey] of this.indoorMap) {
      result.push({ npcId, buildingKey })
    }
    return result
  }

  /** Number of citizens currently indoors. */
  get indoorCount(): number {
    return this.indoorMap.size
  }

  /** Clear all indoor records (e.g., when Animal Mode is disabled). */
  clear(): void {
    this.indoorMap.clear()
  }
}
