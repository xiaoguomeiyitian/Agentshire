/**
 * NavMeshService — 运行时 NavMesh 生成与生命周期管理。
 *
 * 职责:
 *  - 异步初始化 recast-navigation WASM(`init()`,幂等)
 *  - 从 TownMapConfig 合成 town 场景 NavMesh(terrain grid + buildings 障碍)
 *  - 从 Three.js 场景 Mesh 合成 office/home/museum NavMesh(`threeToSoloNavMesh`)
 *  - 持有 NavMesh + NavMeshQuery,提供 destroy()
 *
 * Crowd 实例由 CrowdService 管理,不在此。
 *
 * 坐标系:y=0 地面,x/z 平面,与 recast 的 (x,y,z) 一致(无需翻转)。
 * terrain cell (c, r) 的世界坐标为 (c+0.5, 0, r+0.5)。
 */
import { init as recastInit, NavMesh, NavMeshQuery, statusSucceed } from 'recast-navigation'
import { generateSoloNavMesh } from 'recast-navigation/generators'
import * as THREE from 'three'
import type { TownMapConfig, BuildingPlacement, PropPlacement } from '../../editor/TownMapConfig'

/** NavMesh 生成结果 */
export interface NavMeshBuildResult {
  success: boolean
  navMesh?: NavMesh
  navMeshQuery?: NavMeshQuery
  error?: string
}

/** WASM 是否已初始化 */
let wasmReady = false
let wasmInitPromise: Promise<void> | null = null

/** 异步初始化 WASM,幂等。多次调用返回同一 Promise。 */
export async function initRecast(): Promise<void> {
  if (wasmReady) return
  if (wasmInitPromise) return wasmInitPromise
  wasmInitPromise = recastInit().then(() => {
    wasmReady = true
    console.log('[NavMesh] recast-navigation WASM initialized')
  })
  return wasmInitPromise
}

/** 判断 terrain cell 是否可走(water 不可走)。 */
function isWalkableTerrain(type: string | undefined): boolean {
  return type !== 'water'
}

/**
 * 判断 cell 是否被建筑的视觉包围盒占用。
 *
 * 关键:建筑模型原始包围盒为 2×2(X/Z),scale 后视觉占地为
 *   (2×scale) × (2×scale),居中于 cell 区域中心
 *   (gridX + widthCells/2, gridZ + depthCells/2)。
 * 之前用整个 widthCells×depthCells(6×6)挖洞,但视觉只占 3×3(scale=1.5),
 * 多出 1.5 单位/边的"空气"被当作障碍,导致 NPC 离建筑墙边很远就绕行。
 *
 * 现在按视觉包围盒 + 小 margin(0.3)挖洞,NPC 可以贴近建筑墙边行走。
 * rotationY 90/270 时宽深互换,但模型是 2×2 正方形,旋转后占地不变,
 * 因此无需特殊处理。
 */
function isCellOccupiedByBuilding(
  c: number,
  r: number,
  buildings: BuildingPlacement[],
): boolean {
  const MARGIN = 0.3 // 墙边缓冲,让 NPC 不贴墙但也不绕远
  // cell 中心点(世界坐标)
  const cx = c + 0.5
  const cz = r + 0.5
  for (const b of buildings) {
    const scale = b.scale ?? 1
    // 模型原始 2×2,scale 后视觉占地 2×scale
    const visualSize = 2 * scale
    // 居中于 cell 区域中心
    const centerX = b.gridX + b.widthCells / 2
    const centerZ = b.gridZ + b.depthCells / 2
    const half = visualSize / 2 + MARGIN
    if (
      cx >= centerX - half &&
      cx <= centerX + half &&
      cz >= centerZ - half &&
      cz <= centerZ + half
    ) {
      return true
    }
  }
  return false
}

/**
 * Props 模型原始包围盒尺寸表(X×Z,来自 gltf/glb accessor min/max 测量)。
 * 只收录视觉占地较大的 props(小型 props 如 firehydrant/trash/trafficlight
 * 太细,NPC 不会真的穿过,不加障碍以免浪费 NavMesh)。
 *
 * 注意:capybara 雕塑原始 0.031×0.034 但 scale=80,视觉占地 2.5×2.7,
 * 是大型障碍,必须加。bench/bush 也是中型障碍。
 */
const PROP_FOOTPRINT: Record<string, { w: number; d: number }> = {
  // 原始 0.4×0.15
  bench: { w: 0.4, d: 0.15 },
  // 原始 0.19×0.2
  bush: { w: 0.19, d: 0.2 },
  // 原始 0.031×0.034(但 scale 通常 80,视觉 2.5×2.7)
  capybara: { w: 0.031, d: 0.034 },
  // 原始 0.4×0.45
  plaza_flower: { w: 0.4, d: 0.45 },
  // 原始 0.36×0.37
  plaza_grass: { w: 0.36, d: 0.37 },
  // 原始 0.56×0.35
  dumpster: { w: 0.56, d: 0.35 },
}

/** props 障碍的最小视觉占地阈值(任一边超过此值才加障碍)。 */
const PROP_MIN_SIZE = 0.5

/**
 * 判断 cell 是否被大型 props(水豚雕塑/长椅/灌木等)的视觉包围盒占用。
 *
 * props 放置在 (gridX + 0.5, gridZ + 0.5),scale 后视觉占地 =
 * 原始尺寸 × scale。只对视觉占地 > 0.5 单位的大型 props 加障碍,
 * 小型 props(firehydrant/trash/trafficlight 等)忽略。
 * rotationY 90/270 时宽深互换。
 */
function isCellOccupiedByProp(
  c: number,
  r: number,
  props: PropPlacement[],
): boolean {
  const MARGIN = 0.2 // props 边缘缓冲(比建筑小,props 本身较矮)
  const cx = c + 0.5
  const cz = r + 0.5
  for (const p of props) {
    const footprint = PROP_FOOTPRINT[p.modelKey]
    if (!footprint) continue // 不在表里的小型 props,不加障碍
    const scale = p.scale ?? 1
    let w = footprint.w * scale
    let d = footprint.d * scale
    // 视觉占地太小则跳过(避免给微小 props 加障碍)
    if (w < PROP_MIN_SIZE && d < PROP_MIN_SIZE) continue
    // rotationY 90/270 时宽深互换
    const rot = ((p.rotationY % 360) + 360) % 360
    if (rot === 90 || rot === 270) {
      const tmp = w; w = d; d = tmp
    }
    const centerX = p.gridX + 0.5
    const centerZ = p.gridZ + 0.5
    const halfW = w / 2 + MARGIN
    const halfD = d / 2 + MARGIN
    if (
      cx >= centerX - halfW &&
      cx <= centerX + halfW &&
      cz >= centerZ - halfD &&
      cz <= centerZ + halfD
    ) {
      return true
    }
  }
  return false
}

/**
 * 从 TownMapConfig 合成 town 场景 NavMesh。
 *
 * 策略:遍历 terrain grid,对每个非 water 且非建筑占用的 cell 生成 2 个三角形
 * (构成一个 quad)。buildings 区域跳过,自然在 NavMesh 上形成孔洞(障碍)。
 * positions 用 (c+0.5, 0, r+0.5) 顶点,与 TownBuilder.buildGroundFromConfig 一致。
 *
 * 生成参数针对 Agentshire 地图尺度调优:
 *  - cs=0.2(与 grid cellSize=1 配合,每 cell 5 个采样点,精度足够)
 *  - walkableRadius=4(NPC radius 0.8;cs=0.2 时 4 voxel = 0.8 米,
 *    建筑挖洞已含 margin,避免 NPC 离墙过近)
 *  - walkableClimb=0.5(无台阶,小值即可)
 *  - walkableHeight=1(NPC height 1.0)
 */
export function buildTownNavMesh(config: TownMapConfig): NavMeshBuildResult {
  if (!wasmReady) {
    return { success: false, error: 'recast-navigation WASM not initialized' }
  }

  const { cols, rows } = config.grid
  const positions: number[] = []
  const indices: number[] = []

  // 为每个可走 cell 生成一个 quad(2 个三角形,4 个顶点)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const terrainType = config.terrain[r]?.[c]?.type
      if (!isWalkableTerrain(terrainType)) continue
      if (isCellOccupiedByBuilding(c, r, config.buildings)) continue
      if (isCellOccupiedByProp(c, r, config.props)) continue

      // quad 4 顶点(逆时针,OpenGL 约定)
      const x0 = c
      const x1 = c + 1
      const z0 = r
      const z1 = r + 1
      const baseIdx = positions.length / 3
      // 顶点顺序:(x0,0,z0) (x1,0,z0) (x1,0,z1) (x0,0,z1)
      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1)
      // 两个三角形:(0,2,1) (0,3,2) — OpenGL CCW(逆时针,法线朝 +y)
      // recast-navigation 0.36+ 不再内部反转 indices,必须用 OpenGL 右手系 CCW
      indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2)
    }
  }

  if (positions.length === 0) {
    return { success: false, error: 'no walkable terrain cells found' }
  }

  const result = generateSoloNavMesh(positions, indices, {
    cs: 0.2,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 1,
    walkableClimb: 0.5,
    walkableRadius: 1,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 2,
    mergeRegionArea: 8,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  })

  if (!result.success || !result.navMesh) {
    return { success: false, error: result.error ?? 'generateSoloNavMesh failed' }
  }

  const navMesh = result.navMesh
  const navMeshQuery = new NavMeshQuery(navMesh)
  return { success: true, navMesh, navMeshQuery }
}

/**
 * 从 Three.js 场景 Mesh 合成 NavMesh(office/home/museum)。
 *
 * 策略:从场景中提取地板 Mesh(法线朝上的 PlaneGeometry),获取其世界坐标
 * 包围盒,然后用 obstacles 矩形(家具)在地板上挖洞——与 town 的 grid 挖洞
 * 方式一致。这样家具区域在 NavMesh 上形成孔洞,NPC 无法穿过。
 *
 * museum 无 obstacles 则 NavMesh 为整块地板。
 *
 * @param scene Three.js 场景(用于提取地板范围)
 * @param obstacles 障碍矩形数组(世界坐标,来自 OfficeBuilder/HomeBuilder.getObstacles)
 */
export function buildSceneNavMesh(
  scene: THREE.Scene,
  obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [],
): NavMeshBuildResult {
  if (!wasmReady) {
    return { success: false, error: 'recast-navigation WASM not initialized' }
  }

  // 从场景中提取地板 Mesh(法线朝上、面积最大的 PlaneGeometry)
  let floorMesh: THREE.Mesh | null = null
  let floorArea = 0
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (!child.geometry || !child.visible) return
    if (child instanceof THREE.LineSegments) return
    // 检测是否为朝上的平面(法线近似 +y)
    child.updateMatrixWorld(true)
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(child.quaternion)
    if (normal.y < 0.9) return // 非地板
    // 计算世界包围盒面积
    const box = new THREE.Box3().setFromObject(child)
    const size = new THREE.Vector3()
    box.getSize(size)
    const area = size.x * size.z
    if (area > floorArea) {
      floorArea = area
      floorMesh = child
    }
  })

  if (!floorMesh) {
    return { success: false, error: 'no floor mesh found in scene' }
  }

  // 获取地板世界坐标范围
  const box = new THREE.Box3().setFromObject(floorMesh)
  const minX = box.min.x
  const maxX = box.max.x
  const minZ = box.min.z
  const maxZ = box.max.z

  // 用 grid 细分地板,跳过被 obstacles 覆盖的 cell(挖洞)
  // CELL=0.5: finer than town(1.0) so furniture obstacles are carved precisely;
  // with CELL=1.0 the cell center may be outside the obstacle but the cell
  // still overlaps furniture, letting NPCs walk through table edges.
  const CELL = 0.5
  const positions: number[] = []
  const indices: number[] = []

  for (let z = Math.floor(minZ); z < maxZ; z += CELL) {
    for (let x = Math.floor(minX); x < maxX; x += CELL) {
      // 检查该 cell 中心是否落在任何 obstacle 内
      const cx = x + CELL / 2
      const cz = z + CELL / 2
      let blocked = false
      for (const o of obstacles) {
        if (cx >= o.minX && cx <= o.maxX && cz >= o.minZ && cz <= o.maxZ) {
          blocked = true
          break
        }
      }
      if (blocked) continue

      const x0 = x
      const x1 = x + CELL
      const z0 = z
      const z1 = z + CELL
      const baseIdx = positions.length / 3
      positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1)
      // OpenGL CCW(逆时针,法线朝 +y)— recast-navigation 0.36+ 不再内部反转 indices
      indices.push(baseIdx, baseIdx + 2, baseIdx + 1, baseIdx, baseIdx + 3, baseIdx + 2)
    }
  }

  if (positions.length === 0) {
    return { success: false, error: 'no walkable floor cells after obstacle subtraction' }
  }

  // 室内场景参数:walkableRadius=4(=agent_radius/cs = 0.8/0.2),让 NavMesh 从
  // obstacle 边缘收缩 agent radius,这样 agent 中心无法靠近家具 0.8 内,agent 身体不穿透家具。
  // walkableRadius 单位是 voxel(cs),所以 4 voxel * 0.2 = 0.8 米 = agent radius。
  // 之前 walkableRadius=0 导致 agent 中心可到 obstacle 边缘,agent 身体(radius 0.8)穿透家具。
  // minRegionArea=0(不丢弃小区域)
  // 注意:detailSampleDist/detailSampleMaxError 不能为 0,否则 compat WASM 在 buildPolyMeshDetail 时内存越界
  const result = generateSoloNavMesh(positions, indices, {
    cs: 0.2,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 1,
    walkableClimb: 0.5,
    walkableRadius: 4,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 0,
    mergeRegionArea: 0,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
  })

  if (!result.success || !result.navMesh) {
    console.warn('[NavMesh] generateSoloNavMesh failed:', result.error, 'positions=', positions.length, 'indices=', indices.length)
    return { success: false, error: result.error ?? 'threeToSoloNavMesh failed' }
  }

  const navMesh = result.navMesh
  const navMeshQuery = new NavMeshQuery(navMesh)
  return { success: true, navMesh, navMeshQuery }
}

/** 销毁 NavMesh + NavMeshQuery,释放 WASM 内存。 */
export function destroyNavMesh(navMesh: NavMesh, navMeshQuery?: NavMeshQuery): void {
  try {
    navMeshQuery?.destroy()
  } catch { /* ignore */ }
  try {
    navMesh.destroy()
  } catch { /* ignore */ }
}

/** 在 NavMesh 上查找最近点(用于将目标点投影到 NavMesh)。 */
export function findClosestPointOnNavMesh(
  navMeshQuery: NavMeshQuery,
  pos: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | null {
  const result = navMeshQuery.findClosestPoint(pos)
  if (!statusSucceed(result.status) || !result.point) return null
  return { x: result.point.x, y: result.point.y, z: result.point.z }
}
