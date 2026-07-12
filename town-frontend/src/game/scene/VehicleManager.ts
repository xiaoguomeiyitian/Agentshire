import * as THREE from 'three'
import { AssetLoader } from '../visual/AssetLoader'
import { GameClock } from '../GameClock'
import type { TownMapConfig } from '../../editor/TownMapConfig'

const CAR_MODELS = ['car_sedan', 'car_hatchback', 'car_taxi'] as const

const ROAD_Y = 0.06
const LANE_OFFSET = 0.45
const Z_JITTER = 0.1

// ── Legacy fallback constants (used when no map config is loaded) ──
const LEGACY_ROAD_Z_CENTER = 22.5
const LEGACY_SPAWN_LEFT = -12
const LEGACY_SPAWN_RIGHT = 52

interface TrafficDensity {
  startHour: number
  endHour: number
  intervalMin: number
  intervalMax: number
}

const TRAFFIC_TABLE: TrafficDensity[] = [
  { startHour: 0,  endHour: 5,  intervalMin: 25, intervalMax: 40 },
  { startHour: 5,  endHour: 7,  intervalMin: 5,  intervalMax: 9  },
  { startHour: 7,  endHour: 9,  intervalMin: 2,  intervalMax: 4  },
  { startHour: 9,  endHour: 12, intervalMin: 3,  intervalMax: 6  },
  { startHour: 12, endHour: 14, intervalMin: 2,  intervalMax: 5  },
  { startHour: 14, endHour: 17, intervalMin: 3,  intervalMax: 6  },
  { startHour: 17, endHour: 19, intervalMin: 2,  intervalMax: 4  },
  { startHour: 19, endHour: 22, intervalMin: 6,  intervalMax: 12 },
  { startHour: 22, endHour: 24, intervalMin: 15, intervalMax: 30 },
]

function getSpawnInterval(hour: number): number {
  for (const row of TRAFFIC_TABLE) {
    const inRange = row.endHour > row.startHour
      ? hour >= row.startHour && hour < row.endHour
      : hour >= row.startHour || hour < row.endHour
    if (inRange) {
      return row.intervalMin + Math.random() * (row.intervalMax - row.intervalMin)
    }
  }
  return 20
}

interface PooledVehicle {
  wrapper: THREE.Group
  active: boolean
  progress: number
  /** Current path the vehicle is traveling along */
  path: Array<{ x: number; z: number }>
  pathIndex: number
  /** Total length of the current path segment chain */
  totalLength: number
  /** Traveled distance along the path */
  traveled: number
  /** Speed in world units per second */
  speed: number
  headlight: THREE.PointLight
  taillightMat: THREE.MeshBasicMaterial
}

// ── Road network extracted from TownMapConfig ──
interface RoadSegment {
  cx: number  // center x in world coords
  cz: number  // center z in world coords
  gridX: number
  gridZ: number
  neighbors: RoadSegment[]
}

interface RoadPath {
  points: Array<{ x: number; z: number }>
}

export class VehicleManager {
  private scene: THREE.Scene
  private group = new THREE.Group()
  private pool: PooledVehicle[] = []
  private templates: THREE.Group[] = []
  private spawnTimer = 2 // first car appears after 2 seconds
  private yOffsets: number[] = [] // per-template Y offset to fix wheel sinking

  // Road network state
  private roadSegments: RoadSegment[] = []
  private roadGrid = new Map<string, RoadSegment>() // key: "gridX,gridZ"
  private roadPaths: RoadPath[] = [] // pre-computed long paths for spawning
  private hasRoadNetwork = false
  // Map boundary (in grid coords) — used to find edge road segments
  private mapCols = 0
  private mapRows = 0

  private static readonly POOL_SIZE = 6

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.group.name = 'vehicles'
    this.scene.add(this.group)
  }

  build(assets: AssetLoader) {
    this.buildTemplates(assets)
    this.buildPool()
  }

  /** Load road network from TownMapConfig. Called after map is loaded. */
  loadRoadNetwork(config: TownMapConfig): void {
    this.roadSegments = []
    this.roadGrid.clear()
    this.roadPaths = []
    this.hasRoadNetwork = false
    this.mapCols = config.grid?.cols ?? 0
    this.mapRows = config.grid?.rows ?? 0

    if (!config.roads || config.roads.length === 0) return

    // Build road segment grid. Each road is a 2x2 cell placed at (gridX, gridZ).
    // World center = (gridX + 1, gridZ + 1).
    for (const r of config.roads) {
      const key = `${r.gridX},${r.gridZ}`
      if (this.roadGrid.has(key)) continue
      const seg: RoadSegment = {
        cx: r.gridX + 1,
        cz: r.gridZ + 1,
        gridX: r.gridX,
        gridZ: r.gridZ,
        neighbors: [],
      }
      this.roadSegments.push(seg)
      this.roadGrid.set(key, seg)
    }

    // Connect neighbors: roads that are adjacent (2 cells apart in grid coords,
    // since each road segment is 2x2)
    for (const seg of this.roadSegments) {
      const offsets = [
        { dx: 2, dz: 0 },   // east
        { dx: -2, dz: 0 },  // west
        { dx: 0, dz: 2 },   // south
        { dx: 0, dz: -2 },  // north
      ]
      for (const off of offsets) {
        const nkey = `${seg.gridX + off.dx},${seg.gridZ + off.dz}`
        const neighbor = this.roadGrid.get(nkey)
        if (neighbor) {
          seg.neighbors.push(neighbor)
        }
      }
    }

    // Pre-compute long paths by random walking the road network
    this.roadPaths = this.computeRoadPaths()
    this.hasRoadNetwork = this.roadPaths.length > 0
    if (this.hasRoadNetwork) {
      console.log(`[VehicleManager] Road network loaded: ${this.roadSegments.length} segments, ${this.roadPaths.length} paths`)
    }
  }

  /** Compute traversable paths by walking the road network from each endpoint */
  private computeRoadPaths(): RoadPath[] {
    const paths: RoadPath[] = []
    const visited = new Set<string>()

    // Find edge segments — road segments near the map boundary.
    // These are where vehicles should appear and disappear.
    const edgeSegments = this.roadSegments.filter(s => this.isEdgeSegment(s))

    // Find endpoint segments (segments with only 1 neighbor) and junctions (3+ neighbors)
    const endpoints = this.roadSegments.filter(s => s.neighbors.length <= 1)
    const junctions = this.roadSegments.filter(s => s.neighbors.length >= 3)

    // Start paths from edge segments first (preferred — cars enter from map edge),
    // then endpoints and junctions as fallback
    const startNodes = [...edgeSegments, ...endpoints, ...junctions]
    if (startNodes.length === 0 && this.roadSegments.length > 0) {
      // Circular road — start from any segment
      startNodes.push(this.roadSegments[0])
    }

    for (const start of startNodes) {
      // Generate a few random walks from each start node
      for (let walk = 0; walk < 3; walk++) {
        const path = this.randomWalk(start, 8 + Math.floor(Math.random() * 12))
        if (path.points.length >= 3) {
          const key = path.points.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('|')
          if (!visited.has(key)) {
            visited.add(key)
            paths.push(path)
          }
        }
      }
    }

    // If we still don't have enough paths, generate from all segments
    if (paths.length < 4) {
      for (const seg of this.roadSegments) {
        const path = this.randomWalk(seg, 6 + Math.floor(Math.random() * 8))
        if (path.points.length >= 3) {
          paths.push(path)
        }
        if (paths.length >= 10) break
      }
    }

    return paths
  }

  /** Check if a road segment is near the map boundary (where vehicles appear/disappear) */
  private isEdgeSegment(seg: RoadSegment): boolean {
    if (this.mapCols === 0 || this.mapRows === 0) return false
    // A road segment is 2x2 cells, centered at (gridX+1, gridZ+1).
    // It's at the edge if gridX or gridZ is within 2 cells of the boundary.
    const margin = 2
    return seg.gridX <= margin
      || seg.gridZ <= margin
      || seg.gridX >= this.mapCols - margin - 2
      || seg.gridZ >= this.mapRows - margin - 2
  }

  /** Check if a world-space point is near the map boundary */
  private isEdgePoint(p: { x: number; z: number }): boolean {
    if (this.mapCols === 0 || this.mapRows === 0) return false
    // World coords: center = gridX+1, gridZ+1. Map spans 0..mapCols, 0..mapRows.
    const margin = 3 // world units from edge
    return p.x <= margin
      || p.z <= margin
      || p.x >= this.mapCols - margin
      || p.z >= this.mapRows - margin
  }

  /** Random walk along the road network to create a path.
   *  Prefers walking toward edge segments so the path ends at the map boundary. */
  private randomWalk(start: RoadSegment, maxSteps: number): RoadPath {
    const points: Array<{ x: number; z: number }> = []
    let current: RoadSegment | null = start
    const visited = new Set<string>()
    const laneOffset = LANE_OFFSET

    while (current && visited.size < maxSteps) {
      const key = `${current.gridX},${current.gridZ}`
      if (visited.has(key)) break
      visited.add(key)

      // Add lane offset based on direction of travel
      points.push({ x: current.cx, z: current.cz })

      // Pick a random neighbor (prefer unvisited, then prefer edge segments)
      const unvisited: RoadSegment[] = current.neighbors.filter(n => !visited.has(`${n.gridX},${n.gridZ}`))
      const candidates: RoadSegment[] = unvisited.length > 0 ? unvisited : current.neighbors
      if (candidates.length === 0) break

      // 50% chance to prefer edge segments (so paths tend to end at map boundary)
      if (Math.random() < 0.5) {
        const edgeCandidates = candidates.filter(c => this.isEdgeSegment(c))
        if (edgeCandidates.length > 0) {
          current = edgeCandidates[Math.floor(Math.random() * edgeCandidates.length)]
          continue
        }
      }
      current = candidates[Math.floor(Math.random() * candidates.length)]
    }

    // Apply lane offset to the path (shift to the right side of the road)
    if (points.length >= 2) {
      for (let i = 0; i < points.length; i++) {
        const prev = points[Math.max(0, i - 1)]
        const next = points[Math.min(points.length - 1, i + 1)]
        const dx = next.x - prev.x
        const dz = next.z - prev.z
        const len = Math.sqrt(dx * dx + dz * dz) || 1
        // Perpendicular to direction, shifted to the right side
        const perpX = -dz / len * laneOffset
        const perpZ = dx / len * laneOffset
        points[i] = {
          x: points[i].x + perpX + (Math.random() - 0.5) * Z_JITTER,
          z: points[i].z + perpZ + (Math.random() - 0.5) * Z_JITTER,
        }
      }
    }

    return { points }
  }

  /** Compute total length of a path */
  private pathLength(points: Array<{ x: number; z: number }>): number {
    let len = 0
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dz = points[i].z - points[i - 1].z
      len += Math.sqrt(dx * dx + dz * dz)
    }
    return len
  }

  /** Get position and heading along a path at a given distance.
   *  The car model template has rotation.y = Math.PI/2 baked in (so the model's
   *  front points toward +X by default). We subtract that offset so that
   *  wrapper.rotation.y = angle makes the car face the travel direction. */
  private pointAtDistance(points: Array<{ x: number; z: number }>, dist: number): { pos: THREE.Vector3; angle: number } {
    const MODEL_Y_OFFSET = -Math.PI / 2
    if (points.length === 0) return { pos: new THREE.Vector3(), angle: MODEL_Y_OFFSET }
    if (points.length === 1) return { pos: new THREE.Vector3(points[0].x, ROAD_Y, points[0].z), angle: MODEL_Y_OFFSET }

    let remaining = dist
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x
      const dz = points[i].z - points[i - 1].z
      const segLen = Math.sqrt(dx * dx + dz * dz)
      if (remaining <= segLen) {
        const t = remaining / segLen
        const x = THREE.MathUtils.lerp(points[i - 1].x, points[i].x, t)
        const z = THREE.MathUtils.lerp(points[i - 1].z, points[i].z, t)
        return { pos: new THREE.Vector3(x, ROAD_Y, z), angle: Math.atan2(dx, dz) + MODEL_Y_OFFSET }
      }
      remaining -= segLen
    }
    // Past the end
    const last = points[points.length - 1]
    const prev = points[points.length - 2]
    return {
      pos: new THREE.Vector3(last.x, ROAD_Y, last.z),
      angle: Math.atan2(last.x - prev.x, last.z - prev.z) + MODEL_Y_OFFSET,
    }
  }

  private buildTemplates(assets: AssetLoader) {
    const windowMat = new THREE.MeshLambertMaterial({ color: 0x88bbdd })
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 })
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.5, 0.7)
    const cabinGeo = new THREE.BoxGeometry(0.8, 0.35, 0.6)
    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8)

    const fallbackColors = [0xcc3333, 0x3366cc, 0x44aa44]

    for (let i = 0; i < CAR_MODELS.length; i++) {
      const key = CAR_MODELS[i]
      const assetModel = assets.getPropModel(key)
      const template = new THREE.Group()
      let yOffset = 0

      if (assetModel) {
        assetModel.scale.setScalar(2.0)
        assetModel.rotation.y = Math.PI / 2
        assetModel.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        // Measure bounding box AFTER scaling to fix wheel sinking
        const box = new THREE.Box3().setFromObject(assetModel)
        yOffset = -box.min.y
        assetModel.position.y = yOffset

        template.add(assetModel)
      } else {
        const carMat = new THREE.MeshLambertMaterial({ color: fallbackColors[i] })
        const body = new THREE.Mesh(bodyGeo, carMat)
        body.position.set(0, 0.35, 0)
        body.castShadow = true
        template.add(body)

        const cabin = new THREE.Mesh(cabinGeo, windowMat)
        cabin.position.set(0, 0.72, 0)
        cabin.castShadow = true
        template.add(cabin)

        for (const ox of [-0.5, 0.5]) {
          for (const oz of [-0.3, 0.3]) {
            const wheel = new THREE.Mesh(wheelGeo, wheelMat)
            wheel.rotation.x = Math.PI / 2
            wheel.position.set(ox, 0.12, oz)
            template.add(wheel)
          }
        }
      }

      this.templates.push(template)
      this.yOffsets.push(yOffset)
    }
  }

  private buildPool() {
    for (let i = 0; i < VehicleManager.POOL_SIZE; i++) {
      const templateIdx = i % this.templates.length
      const wrapper = this.templates[templateIdx].clone()
      wrapper.visible = false
      this.group.add(wrapper)

      // Headlight (cheap PointLight instead of SpotLight)
      const headlight = new THREE.PointLight(0xffeeba, 0, 8)
      headlight.position.set(1.2, 0.6, 0)
      wrapper.add(headlight)

      // Taillight
      const tailGeo = new THREE.PlaneGeometry(0.3, 0.15)
      const taillightMat = new THREE.MeshBasicMaterial({
        color: 0xff2200, transparent: true, opacity: 0,
      })
      const tailMesh = new THREE.Mesh(tailGeo, taillightMat)
      tailMesh.position.set(-1.0, 0.5, 0)
      tailMesh.rotation.y = Math.PI
      wrapper.add(tailMesh)

      this.pool.push({
        wrapper,
        active: false,
        progress: 0,
        path: [],
        pathIndex: 0,
        totalLength: 0,
        traveled: 0,
        speed: 0,
        headlight,
        taillightMat,
      })
    }
  }

  private getInactive(): PooledVehicle | null {
    return this.pool.find(v => !v.active) ?? null
  }

  private spawn(isNight: boolean) {
    const vehicle = this.getInactive()
    if (!vehicle) return

    if (this.hasRoadNetwork && this.roadPaths.length > 0) {
      // Config-driven: spawn along a random road path
      // Prefer paths whose start point is near the map edge (vehicles enter from edge)
      const edgePaths = this.roadPaths.filter(p => this.isEdgePoint(p.points[0]))
      const candidatePaths = edgePaths.length > 0 ? edgePaths : this.roadPaths
      const path = candidatePaths[Math.floor(Math.random() * candidatePaths.length)]
      const goForward = Math.random() > 0.5
      const points = goForward ? path.points : [...path.points].reverse()
      const totalLength = this.pathLength(points)
      if (totalLength < 2) return

      vehicle.path = points
      vehicle.pathIndex = 0
      vehicle.totalLength = totalLength
      vehicle.traveled = 0
      vehicle.speed = 3 + Math.random() * 2 // world units per second
      vehicle.progress = 0
      vehicle.active = true

      const { pos, angle } = this.pointAtDistance(points, 0)
      vehicle.wrapper.visible = true
      vehicle.wrapper.position.copy(pos)
      vehicle.wrapper.rotation.y = angle
    } else {
      // Legacy fallback: straight road at z=22.5
      const goRight = Math.random() > 0.5
      const startX = goRight ? LEGACY_SPAWN_LEFT : LEGACY_SPAWN_RIGHT
      const endX = goRight ? LEGACY_SPAWN_RIGHT : LEGACY_SPAWN_LEFT
      const laneZ = goRight
        ? LEGACY_ROAD_Z_CENTER - LANE_OFFSET
        : LEGACY_ROAD_Z_CENTER + LANE_OFFSET

      vehicle.path = [
        { x: startX, z: laneZ + (Math.random() - 0.5) * Z_JITTER },
        { x: endX, z: laneZ + (Math.random() - 0.5) * Z_JITTER },
      ]
      vehicle.pathIndex = 0
      vehicle.totalLength = Math.abs(endX - startX)
      vehicle.traveled = 0
      vehicle.speed = (endX - startX) / (6 + Math.random() * 4)
      vehicle.progress = 0
      vehicle.active = true

      vehicle.wrapper.visible = true
      vehicle.wrapper.position.set(startX, ROAD_Y, vehicle.path[0].z)
      vehicle.wrapper.rotation.y = goRight ? 0 : Math.PI
    }

    vehicle.headlight.intensity = isNight ? 1.5 : 0
    vehicle.taillightMat.opacity = isNight ? 0.9 : 0
  }

  private recycle(vehicle: PooledVehicle) {
    vehicle.active = false
    vehicle.wrapper.visible = false
  }

  update(gameClock: GameClock, delta: number) {
    const hour = gameClock.getGameHour()
    const period = gameClock.getPeriod()
    const needLights = period === 'night' || period === 'dusk' || period === 'dawn'
    const time = performance.now() / 1000

    // Spawn timer
    this.spawnTimer -= delta
    if (this.spawnTimer <= 0) {
      this.spawn(needLights)
      this.spawnTimer = getSpawnInterval(hour)
    }

    // Update active vehicles
    for (const v of this.pool) {
      if (!v.active) continue

      v.traveled += v.speed * delta
      if (v.traveled >= v.totalLength) {
        this.recycle(v)
        continue
      }

      const { pos, angle } = this.pointAtDistance(v.path, v.traveled)
      const bump = Math.sin(time * 12 + v.traveled) * 0.015
      v.wrapper.position.x = pos.x
      v.wrapper.position.y = ROAD_Y + bump
      v.wrapper.position.z = pos.z
      // Smoothly rotate towards heading
      v.wrapper.rotation.y = angle

      v.headlight.intensity = needLights ? 1.5 : 0
      v.taillightMat.opacity = needLights ? 0.9 : 0
    }
  }

  clear() {
    this.pool = []
    this.templates = []
    this.yOffsets = []
    this.roadSegments = []
    this.roadGrid.clear()
    this.roadPaths = []
    this.hasRoadNetwork = false
    this.mapCols = 0
    this.mapRows = 0
    this.group.clear()
    this.scene.remove(this.group)
  }
}
