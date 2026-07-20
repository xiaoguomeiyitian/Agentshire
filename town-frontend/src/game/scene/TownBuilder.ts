import * as THREE from 'three'
import { AssetLoader } from '../visual/AssetLoader'
import type {
  TownMapConfig, BuildingPlacement, PropPlacement, RoadPlacement,
  TerrainType, PlacedItem,
} from '../../editor/TownMapConfig'
import { TERRAIN_COLORS_HEX } from '../../editor/TownMapConfig'
import { MODEL_KEY_TO_ROLE } from '../../types'
import { getLocale } from '../../i18n'

interface WindowDef {
  pos: [number, number, number]
}

interface BuildingDef {
  id: string
  modelKey: string
  pos: [number, number, number]
  scale: number
  rotationY: number
  doorOffset: [number, number, number]
  size: [number, number, number]
  color: number
  roofColor?: number
  windows?: WindowDef[]
}

const BUILDINGS: BuildingDef[] = [
  {
    id: 'office', modelKey: 'building_A', pos: [17, 0, 3], scale: 3.0, rotationY: 0,
    doorOffset: [0, 0.05, 5], size: [8, 12, 6], color: 0x6688aa,
    windows: [
      { pos: [0, 0.95, 1.01] },
    ],
  },
  {
    id: 'house_a', modelKey: 'building_B', pos: [3, 0, 5], scale: 1.8, rotationY: 0,
    doorOffset: [0, 0.05, 7], size: [3, 4, 3], color: 0xf5f0e8, roofColor: 0x44aa44,
    windows: [
      { pos: [0, 0.7, 1.01] },
    ],
  },
  {
    id: 'house_b', modelKey: 'building_C', pos: [3, 0, 10], scale: 1.8, rotationY: 0,
    doorOffset: [0, 0.05, 12], size: [3, 4, 3], color: 0xf5f0e8, roofColor: 0x4488cc,
    windows: [
      { pos: [0, 0.95, 1.01] },
    ],
  },
  {
    id: 'house_c', modelKey: 'building_D', pos: [3, 0, 15], scale: 1.8, rotationY: 0,
    doorOffset: [0, 0.05, 17], size: [3, 4, 3], color: 0xf5f0e8, roofColor: 0xcc8844,
    windows: [
      { pos: [0, 0.95, 1.01] },
    ],
  },
  {
    id: 'market', modelKey: 'building_E', pos: [32, 0, 3], scale: 2.5, rotationY: 0,
    doorOffset: [0, 0.05, 6], size: [8, 4, 5], color: 0xf0f0f0,
    windows: [
      { pos: [0, 1.1, 1.01] },
    ],
  },
  {
    id: 'cafe', modelKey: 'building_F', pos: [32, 0, 9], scale: 2.0, rotationY: 0,
    doorOffset: [0, 0.05, 12], size: [5, 3, 4], color: 0xd4a574,
    windows: [
      { pos: [0, 1.1, 1.01] },
    ],
  },
  {
    id: 'user_home', modelKey: 'building_G', pos: [3, 0, 20], scale: 1.8, rotationY: 0,
    doorOffset: [0, 0.05, 22], size: [3, 4, 3], color: 0xf5f0e8, roofColor: 0xddaa44,
    windows: [
      { pos: [0, 0.95, 1.01] },
    ],
  },
  {
    id: 'museum', modelKey: 'building_H', pos: [32, 0, 15], scale: 2.5, rotationY: 0,
    doorOffset: [0, 0.05, 18], size: [6, 4, 5], color: 0xe8e8e8,
    windows: [
      { pos: [0, 1.4, 1.01] },
    ],
  },
]

const GRASS_COLOR    = 0x7ec850
const SIDEWALK_COLOR = 0xc4b8a8
const PLAZA_COLOR    = 0xe8dcc8
const ROAD_COLOR     = 0x505050
const SKY_COLOR      = 0x87ceeb

export interface TownLightingRefs {
  ambient: THREE.AmbientLight
  directional: THREE.DirectionalLight
  hemisphere: THREE.HemisphereLight
  streetLightPoints: THREE.PointLight[]
  windowLights: THREE.PointLight[]
}

export class TownBuilder {
  private scene: THREE.Scene
  private doorMarkers: Map<string, THREE.Mesh> = new Map()
  private labelSprites: Map<string, THREE.Sprite> = new Map()
  private townGroup = new THREE.Group()
  private lightingRefs: TownLightingRefs | null = null
  private static labelCanvasCache: Map<string, THREE.CanvasTexture> = new Map()
  /** Per-modelKey sequential counter for building numbering (e.g. 住宅1, 住宅2). */
  private buildingNumberCounters: Map<string, number> = new Map()

  // ── Config-driven scene editing state ──
  private mapConfig: TownMapConfig | null = null
  private modelMap = new Map<string, THREE.Group>()
  private terrainGroup = new THREE.Group()
  private terrainMeshes: THREE.Mesh[][] = []
  private gridHelper: THREE.GridHelper | null = null
  private static readonly DOOR_GEO = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8)
  private static readonly DOOR_MAT = new THREE.MeshLambertMaterial({
    color: 0x00ffaa, transparent: true, opacity: 0.4,
    emissive: 0x00ffaa, emissiveIntensity: 0.5,
  })

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  getLightingRefs(): TownLightingRefs | null {
    return this.lightingRefs
  }

  build(assets: AssetLoader): void {
    // Clear label texture cache so font size / color changes take effect
    for (const tex of TownBuilder.labelCanvasCache.values()) tex.dispose()
    TownBuilder.labelCanvasCache.clear()

    this.townGroup.name = 'town'
    this.scene.add(this.townGroup)

    this.buildSkyAndFog()
    this.buildLighting()
    this.buildGround()
    this.buildBuildings(assets)
    this.buildStreetLights(assets)
    this.buildTrees(assets)
    this.buildBenches(assets)
    this.buildFountain(assets)
    this.buildFlowerBeds()
    this.buildFireHydrants(assets)
  }

  getDoorMarker(buildingId: string): THREE.Mesh | undefined {
    return this.doorMarkers.get(buildingId)
  }

  getDoorMarkers(): Map<string, THREE.Mesh> {
    return this.doorMarkers
  }

  /** Issue 3: get building label sprites for click detection. */
  getLabelSprites(): Map<string, THREE.Sprite> {
    return this.labelSprites
  }

  /**
   * Issue 6: update a building's label text (e.g. rename "住宅1" to "岩家"
   * once a citizen is allocated to live there). Rebuilds the sprite texture
   * and preserves its position. No-op if the building has no label sprite.
   */
  setBuildingLabel(buildingId: string, text: string): void {
    const existing = this.labelSprites.get(buildingId)
    if (!existing) return
    // Remove old sprite
    this.townGroup.remove(existing)
    // Reuse makeTextSprite to create a new sprite with the new text
    const sprite = this.makeTextSprite(text)
    sprite.position.copy(existing.position)
    sprite.name = existing.name
    sprite.userData = existing.userData
    this.townGroup.add(sprite)
    this.labelSprites.set(buildingId, sprite)
    // Dispose old material/texture to avoid leak
    const oldMat = existing.material as THREE.SpriteMaterial
    if (oldMat.map) oldMat.map.dispose()
    oldMat.dispose()
  }

  /** Issue 3: get building model groups for click detection. */
  getBuildingModels(): Map<string, THREE.Group> {
    return this.modelMap
  }

  // ═══════════════════════════════════════════════════════
  //  Config-driven scene editing (AI steward tools)
  // ═══════════════════════════════════════════════════════

  getMapConfig(): TownMapConfig | null {
    return this.mapConfig
  }

  /**
   * Initialize config-driven editing state from an existing (already built) scene.
   * Unlike buildFromConfig, this does NOT rebuild the scene — it just sets the mapConfig
   * so that subsequent incremental operations (addBuilding, removeObject, etc.) work.
   * Used when the town was built from hardcoded BUILDINGS and AI starts editing.
   */
  initFromConfig(config: TownMapConfig, _assets: AssetLoader): void {
    this.mapConfig = config
    // Build terrain mesh grid for updateTerrainCell to work
    this.buildGroundFromConfig(config)
  }

  /**
   * Build the entire town from a TownMapConfig (replaces hardcoded build).
   * Falls back to the legacy hardcoded build() if no config is provided.
   */
  buildFromConfig(config: TownMapConfig, assets: AssetLoader): void {
    this.mapConfig = config
    this.townGroup.name = 'town'
    this.scene.add(this.townGroup)
    this.townGroup.add(this.terrainGroup)

    // Reset building number counters so labels stay stable across rebuilds
    this.buildingNumberCounters.clear()

    this.buildSkyAndFog()
    this.buildLighting()
    this.buildGroundFromConfig(config)
    for (const b of config.buildings) this.addBuilding(b, assets)
    for (const p of config.props) this.addProp(p, assets)
    for (const r of config.roads) this.addRoad(r, assets)
  }

  private buildGroundFromConfig(config: TownMapConfig): void {
    this.terrainGroup.clear()
    this.terrainMeshes = []
    const { cols, rows } = config.grid
    const geo = new THREE.PlaneGeometry(1, 1)
    for (let r = 0; r < rows; r++) {
      const row: THREE.Mesh[] = []
      for (let c = 0; c < cols; c++) {
        const t = config.terrain[r]?.[c]?.type ?? 'grass'
        const mat = new THREE.MeshLambertMaterial({ color: TERRAIN_COLORS_HEX[t] })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(c + 0.5, 0, r + 0.5)
        mesh.receiveShadow = true
        mesh.userData = { terrain: true, col: c, row: r }
        this.terrainGroup.add(mesh)
        row.push(mesh)
      }
      this.terrainMeshes.push(row)
    }
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper = null }
    const gridSize = Math.max(cols, rows)
    this.gridHelper = new THREE.GridHelper(gridSize, gridSize, 0x444444, 0x444444)
    this.gridHelper.position.set(cols / 2, 0.01, rows / 2)
    const mat = this.gridHelper.material as THREE.LineBasicMaterial
    mat.transparent = true; mat.opacity = 0.15
    this.scene.add(this.gridHelper)
  }

  /** Add a single building to the scene (incremental). */
  addBuilding(b: BuildingPlacement, assets: AssetLoader): void {
    const model = assets.getBuildingModel(b.modelKey)
    if (model) {
      this.placeModel(model, b.gridX + b.widthCells / 2, 0, b.gridZ + b.depthCells / 2, b.scale ?? 1, (b.rotationY * Math.PI) / 180)
      this.applyFixRotation(model, b)
      model.userData = { itemId: b.id, kind: 'building' }
      this.modelMap.set(b.id, model)
    } else if (b.modelUrl) {
      // Cache miss — async load by URL (megapack assets not preloaded)
      assets.loadModelByUrl(b.modelUrl).then(m => {
        if (!m) { console.warn('[TownBuilder] addBuilding: failed to load', b.modelUrl); return }
        this.placeModel(m, b.gridX + b.widthCells / 2, 0, b.gridZ + b.depthCells / 2, b.scale ?? 1, (b.rotationY * Math.PI) / 180)
        this.applyFixRotation(m, b)
        m.userData = { itemId: b.id, kind: 'building' }
        this.modelMap.set(b.id, m)
      }).catch(e => console.warn('[TownBuilder] addBuilding async load failed:', e))
    }
    // Door marker — 保留位置用于门检测(getWorldPosition),但不可见
    // (用户要求删除建筑门口前的绿色圆点)。
    const door = new THREE.Mesh(TownBuilder.DOOR_GEO, TownBuilder.DOOR_MAT)
    door.position.set(b.gridX + b.widthCells / 2, 0.05, b.gridZ + b.depthCells + 0.5)
    door.name = `door_${b.id}`
    door.visible = false
    this.townGroup.add(door)
    this.doorMarkers.set(b.id, door)

    // Building name label (Issue 3)
    this.addBuildingLabel(b)
  }

  /** Create a floating text label above a building showing its name. */
  private addBuildingLabel(b: BuildingPlacement): void {
    // Determine display name: explicit displayName > MODEL_KEY_TO_ROLE lookup > id
    let label = b.displayName || ''
    if (!label) {
      const role = MODEL_KEY_TO_ROLE[b.modelKey]
      if (role) {
        label = getLocale() === 'en' ? role.nameEn : role.name
      }
    }
    if (!label) label = b.id

    // Append a sequential number per display name (e.g. 住宅1, 住宅2, 住宅3, 咖啡店1)
    // so each building is uniquely identifiable, like real-world street numbers.
    // Group by role.name (not modelKey) so that building_B/C/D all share the "住宅" counter.
    if (!b.displayName) {
      const role = MODEL_KEY_TO_ROLE[b.modelKey]
      const groupKey = role ? role.name : b.modelKey
      const idx = (this.buildingNumberCounters.get(groupKey) ?? 0) + 1
      this.buildingNumberCounters.set(groupKey, idx)
      label = `${label}${idx}`
    }

    const sprite = this.makeTextSprite(label)
    // Position above the building center, at a height proportional to building scale
    const cx = b.gridX + b.widthCells / 2
    const cz = b.gridZ + b.depthCells / 2
    const height = (b.scale ?? 1) * 2.5 + 2
    sprite.position.set(cx, height, cz)
    sprite.name = `label_${b.id}`
    sprite.userData = { itemId: b.id, kind: 'building-label' }
    this.townGroup.add(sprite)
    this.labelSprites.set(b.id, sprite)
  }

  /** Create (or reuse a cached) text sprite with a semi-transparent rounded background. */
  private makeTextSprite(text: string): THREE.Sprite {
    const cacheKey = text
    let tex = TownBuilder.labelCanvasCache.get(cacheKey)
    if (!tex) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const fontSize = 36
      ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
      const metrics = ctx.measureText(text)
      const padX = 20, padY = 12
      const w = Math.ceil(metrics.width) + padX * 2
      const h = fontSize + padY * 2
      canvas.width = w
      canvas.height = h
      // Re-set font after canvas resize (canvas resize resets context state)
      ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      // Rounded background
      const r = 10
      ctx.fillStyle = 'rgba(20, 22, 30, 0.72)'
      ctx.beginPath()
      ctx.moveTo(r, 0)
      ctx.lineTo(w - r, 0)
      ctx.quadraticCurveTo(w, 0, w, r)
      ctx.lineTo(w, h - r)
      ctx.quadraticCurveTo(w, h, w - r, h)
      ctx.lineTo(r, h)
      ctx.quadraticCurveTo(0, h, 0, h - r)
      ctx.lineTo(0, r)
      ctx.quadraticCurveTo(0, 0, r, 0)
      ctx.closePath()
      ctx.fill()
      // Text — dimmer to reduce glare
      ctx.fillStyle = '#b8bcc4'
      ctx.fillText(text, w / 2, h / 2)
      tex = new THREE.CanvasTexture(canvas)
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      TownBuilder.labelCanvasCache.set(cacheKey, tex)
    }
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    // Scale so the label is readable but not huge; aspect ratio from texture
    const aspect = tex.image.width / tex.image.height
    const baseH = 0.85
    sprite.scale.set(baseH * aspect, baseH, 1)
    return sprite
  }

  /** Add a single prop to the scene (incremental). */
  addProp(p: PropPlacement, assets: AssetLoader): void {
    const model = assets.getPropModel(p.modelKey)
    if (model) {
      this.placeModel(model, p.gridX + 0.5, 0, p.gridZ + 0.5, p.scale ?? 1, (p.rotationY * Math.PI) / 180)
      this.applyFixRotation(model, p)
      model.userData = { itemId: p.id, kind: 'prop' }
      this.modelMap.set(p.id, model)
    } else if (p.modelUrl) {
      assets.loadModelByUrl(p.modelUrl).then(m => {
        if (!m) { console.warn('[TownBuilder] addProp: failed to load', p.modelUrl); return }
        this.placeModel(m, p.gridX + 0.5, 0, p.gridZ + 0.5, p.scale ?? 1, (p.rotationY * Math.PI) / 180)
        this.applyFixRotation(m, p)
        m.userData = { itemId: p.id, kind: 'prop' }
        this.modelMap.set(p.id, m)
      }).catch(e => console.warn('[TownBuilder] addProp async load failed:', e))
    }
  }

  /** Add a single road to the scene (incremental). */
  addRoad(r: RoadPlacement, assets: AssetLoader): void {
    const model = assets.getBuildingModel(r.modelKey) ?? assets.getPropModel(r.modelKey)
    if (model) {
      this.placeModel(model, r.gridX + 1, 0, r.gridZ + 1, 1, (r.rotationY * Math.PI) / 180)
      this.applyFixRotation(model, r)
      model.userData = { itemId: r.id, kind: 'road' }
      this.modelMap.set(r.id, model)
    } else if (r.modelUrl) {
      assets.loadModelByUrl(r.modelUrl).then(m => {
        if (!m) { console.warn('[TownBuilder] addRoad: failed to load', r.modelUrl); return }
        this.placeModel(m, r.gridX + 1, 0, r.gridZ + 1, 1, (r.rotationY * Math.PI) / 180)
        this.applyFixRotation(m, r)
        m.userData = { itemId: r.id, kind: 'road' }
        this.modelMap.set(r.id, m)
      }).catch(e => console.warn('[TownBuilder] addRoad async load failed:', e))
    }
  }

  /** Apply fixRotationX/Y/Z from catalog (megapack models need X=90 rotation). */
  private applyFixRotation(model: THREE.Group, item: { fixRotationX?: number; fixRotationY?: number; fixRotationZ?: number }): void {
    if (item.fixRotationX) model.rotation.x = (item.fixRotationX * Math.PI) / 180
    if (item.fixRotationY) model.rotation.y += (item.fixRotationY * Math.PI) / 180
    if (item.fixRotationZ) model.rotation.z = (item.fixRotationZ * Math.PI) / 180
  }

  /** Remove a single object by ID (incremental). */
  removeObject(objectId: string): void {
    const m = this.modelMap.get(objectId)
    if (m) { this.townGroup.remove(m); this.modelMap.delete(objectId) }
    const dm = this.doorMarkers.get(objectId)
    if (dm) { this.townGroup.remove(dm); this.doorMarkers.delete(objectId) }
    const ls = this.labelSprites.get(objectId)
    if (ls) { this.townGroup.remove(ls); this.labelSprites.delete(objectId) }
  }

  /** Update an existing object's transform (move / rotate / scale / flip). */
  updateObjectTransform(item: PlacedItem): void {
    const m = this.modelMap.get(item.data.id)
    if (!m) return
    const d = item.data as { flipX?: boolean; flipZ?: boolean }
    const fx = d.flipX ? -1 : 1
    const fz = d.flipZ ? -1 : 1
    if (item.kind === 'building') {
      const b = item.data as BuildingPlacement
      const s = b.scale ?? 1
      m.position.set(b.gridX + b.widthCells / 2, 0, b.gridZ + b.depthCells / 2)
      m.rotation.y = (b.rotationY * Math.PI) / 180
      m.scale.set(s * fx, s, s * fz)
      // Move door marker
      const dm = this.doorMarkers.get(b.id)
      if (dm) dm.position.set(b.gridX + b.widthCells / 2, 0.05, b.gridZ + b.depthCells + 0.5)
      // Move label sprite
      const ls = this.labelSprites.get(b.id)
      if (ls) {
        const height = (b.scale ?? 1) * 2.5 + 2
        ls.position.set(b.gridX + b.widthCells / 2, height, b.gridZ + b.depthCells / 2)
      }
    } else if (item.kind === 'prop') {
      const p = item.data as PropPlacement
      const s = p.scale ?? 1
      m.position.set(p.gridX + 0.5, 0, p.gridZ + 0.5)
      m.rotation.y = (p.rotationY * Math.PI) / 180
      m.scale.set(s * fx, s, s * fz)
    } else {
      const r = item.data as RoadPlacement
      m.position.set(r.gridX + 1, 0, r.gridZ + 1)
      m.rotation.y = (r.rotationY * Math.PI) / 180
      m.scale.set(fx, 1, fz)
    }
  }

  /** Update a single terrain cell's color (incremental). */
  updateTerrainCell(col: number, row: number, type: TerrainType): void {
    const mesh = this.terrainMeshes[row]?.[col]
    if (!mesh) return
    ;(mesh.material as THREE.MeshLambertMaterial).color.setHex(TERRAIN_COLORS_HEX[type])
  }

  /**
   * Resize the map grid to new dimensions.
   * Expanding: new cells default to grass.
   * Shrinking: terrain rows/cols beyond the new boundary are truncated, and
   *   buildings/props/roads that fall completely outside the new boundary are
   *   removed from the config and their 3D meshes disposed.
   */
  expandGrid(newCols: number, newRows: number): void {
    if (!this.mapConfig) return
    const { cols: oldCols, rows: oldRows } = this.mapConfig.grid
    if (newCols === oldCols && newRows === oldRows) return

    const terrain = this.mapConfig.terrain

    // ── Shrinking: remove objects that fall completely outside the new boundary ──
    if (newCols < oldCols || newRows < oldRows) {
      const isOutside = (gx: number, gz: number, w: number, d: number) =>
        gx >= newCols || gz >= newRows || gx + w <= 0 || gz + d <= 0

      // Buildings
      this.mapConfig.buildings = this.mapConfig.buildings.filter(b => {
        if (isOutside(b.gridX, b.gridZ, b.widthCells, b.depthCells)) {
          this.removeObjectMesh(b.id)
          return false
        }
        return true
      })
      // Props
      this.mapConfig.props = this.mapConfig.props.filter(p => {
        if (isOutside(p.gridX, p.gridZ, 1, 1)) {
          this.removeObjectMesh(p.id)
          return false
        }
        return true
      })
      // Roads
      this.mapConfig.roads = this.mapConfig.roads.filter(r => {
        if (isOutside(r.gridX, r.gridZ, 1, 1)) {
          this.removeObjectMesh(r.id)
          return false
        }
        return true
      })
    }

    // ── Resize terrain array ──
    if (newRows < oldRows) {
      terrain.length = newRows // truncate rows
    }
    for (let r = 0; r < newRows; r++) {
      if (!terrain[r]) terrain[r] = []
      if (newCols < oldCols && terrain[r].length > newCols) {
        terrain[r].length = newCols // truncate cols in this row
      }
      for (let c = 0; c < newCols; c++) {
        if (!terrain[r][c]) terrain[r][c] = { type: 'grass' }
      }
    }

    this.mapConfig.grid.cols = newCols
    this.mapConfig.grid.rows = newRows

    // Rebuild ground (full rebuild of terrain layer — only the ground, not buildings)
    this.buildGroundFromConfig(this.mapConfig)
  }

  /** Dispose and remove a 3D mesh (building/prop/road) by itemId from the scene. */
  private removeObjectMesh(itemId: string): void {
    const model = this.modelMap.get(itemId)
    if (model) {
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose()
          const mat = obj.material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else mat?.dispose()
        }
      })
      this.townGroup.remove(model)
      this.modelMap.delete(itemId)
    }
    const door = this.doorMarkers.get(itemId)
    if (door) {
      this.townGroup.remove(door)
      this.doorMarkers.delete(itemId)
    }
    const label = this.labelSprites.get(itemId)
    if (label) {
      this.townGroup.remove(label)
      this.labelSprites.delete(itemId)
    }
  }

  /** Find a placed item by objectId. */
  findObjectById(objectId: string): PlacedItem | null {
    if (!this.mapConfig) return null
    const b = this.mapConfig.buildings.find(x => x.id === objectId)
    if (b) return { kind: 'building', data: b }
    const p = this.mapConfig.props.find(x => x.id === objectId)
    if (p) return { kind: 'prop', data: p }
    const r = this.mapConfig.roads.find(x => x.id === objectId)
    if (r) return { kind: 'road', data: r }
    return null
  }

  /** List all objects in the current map config. */
  listObjects(category?: 'building' | 'prop' | 'road' | 'all'): PlacedItem[] {
    if (!this.mapConfig) return []
    const all: PlacedItem[] = [
      ...this.mapConfig.buildings.map(b => ({ kind: 'building' as const, data: b })),
      ...this.mapConfig.props.map(p => ({ kind: 'prop' as const, data: p })),
      ...this.mapConfig.roads.map(r => ({ kind: 'road' as const, data: r })),
    ]
    if (!category || category === 'all') return all
    return all.filter(item => item.kind === category)
  }

  clear(): void {
    this.townGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat.dispose()
      }
    })
    this.scene.remove(this.townGroup)
    if (this.gridHelper) { this.scene.remove(this.gridHelper); this.gridHelper = null }
    this.townGroup = new THREE.Group()
    this.terrainGroup = new THREE.Group()
    this.terrainMeshes = []
    this.modelMap.clear()
    this.doorMarkers.clear()
    this.labelSprites.clear()
    this.mapConfig = null
  }

  /* ───── Helpers ───── */

  private enableShadows(obj: THREE.Object3D): void {
    obj.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  private placeModel(
    model: THREE.Group,
    x: number, y: number, z: number,
    scale: number,
    rotationY = 0,
  ): void {
    model.position.set(x, y, z)
    model.scale.setScalar(scale)
    model.rotation.y = rotationY
    this.enableShadows(model)
    this.townGroup.add(model)
  }

  /* ───────── Sky & Fog ───────── */

  private buildSkyAndFog(): void {
    this.scene.background = new THREE.Color(SKY_COLOR)
    this.scene.fog = new THREE.Fog(SKY_COLOR, 40, 80)
  }

  /* ───────── Lighting ───────── */

  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(0xc8d8f0, 0.6)
    this.townGroup.add(ambient)

    const dir = new THREE.DirectionalLight(0xfff8e8, 1.0)
    dir.position.set(30, 30, -10)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.left = -30
    dir.shadow.camera.right = 30
    dir.shadow.camera.top = 30
    dir.shadow.camera.bottom = -30
    dir.shadow.camera.near = 1
    dir.shadow.camera.far = 80
    dir.shadow.bias = -0.001
    this.townGroup.add(dir)

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a6020, 0.35)
    this.townGroup.add(hemi)

    this.lightingRefs = {
      ambient,
      directional: dir,
      hemisphere: hemi,
      streetLightPoints: [],
      windowLights: [],
    }
  }

  /* ───────── Ground ───────── */

  private buildGround(): void {
    const grassMat = new THREE.MeshLambertMaterial({ color: GRASS_COLOR })
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: SIDEWALK_COLOR })
    const plazaMat = new THREE.MeshLambertMaterial({ color: PLAZA_COLOR })
    const roadMat = new THREE.MeshLambertMaterial({ color: ROAD_COLOR })
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff })

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), grassMat)
    grass.rotation.x = -Math.PI / 2
    grass.position.set(20, 0, 12)
    grass.receiveShadow = true
    this.townGroup.add(grass)

    const sidewalkPositions: [number, number, number, number, number][] = [
      [6, 0.05, 12, 1.5, 24],
      [10, 0.05, 12, 1, 24],
      [28, 0.05, 12, 1.5, 24],
      [19.375, 0.05, 21, 18.75, 1],
    ]
    const swGeo = new THREE.PlaneGeometry(1, 1)
    for (const [x, y, z, w, d] of sidewalkPositions) {
      const sw = new THREE.Mesh(swGeo, sidewalkMat)
      sw.rotation.x = -Math.PI / 2
      sw.scale.set(w, d, 1)
      sw.position.set(x, y, z)
      sw.receiveShadow = true
      this.townGroup.add(sw)
    }

    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), plazaMat)
    plaza.rotation.x = -Math.PI / 2
    plaza.position.set(18, 0.05, 13)
    plaza.receiveShadow = true
    this.townGroup.add(plaza)

    const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 2), roadMat)
    road.rotation.x = -Math.PI / 2
    road.position.set(20, 0.06, 22.5)
    road.receiveShadow = true
    this.townGroup.add(road)

    const lineGeo = new THREE.PlaneGeometry(2, 0.15)
    for (let i = 0; i < 5; i++) {
      const line = new THREE.Mesh(lineGeo, whiteMat)
      line.rotation.x = -Math.PI / 2
      line.position.set(16 + i * 2, 0.065, 22.5)
      this.townGroup.add(line)
    }

    const crossGeo = new THREE.PlaneGeometry(0.3, 2)
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(crossGeo, whiteMat)
      stripe.rotation.x = -Math.PI / 2
      stripe.position.set(18 + i * 0.6 - 1.5, 0.065, 22.5)
      this.townGroup.add(stripe)
    }
  }

  /* ───────── Buildings ───────── */

  private buildBuildings(assets: AssetLoader): void {
    const doorGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8)
    const doorMat = new THREE.MeshLambertMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.4,
      emissive: 0x00ffaa,
      emissiveIntensity: 0.5,
    })

    for (const def of BUILDINGS) {
      const [bx, , bz] = def.pos

      const model = assets.getBuildingModel(def.modelKey)
      if (model) {
        this.placeModel(model, bx, 0, bz, def.scale, def.rotationY)

        if (def.windows && this.lightingRefs) {
          for (const win of def.windows) {
            const pl = new THREE.PointLight(0xffe0a0, 0, 4, 2)
            pl.position.set(...win.pos)
            model.add(pl)
            this.lightingRefs.windowLights.push(pl)
          }
        }
      } else {
        const [w, h, d] = def.size
        const bodyMat = new THREE.MeshLambertMaterial({ color: def.color })
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat)
        body.position.set(bx, h / 2, bz)
        body.castShadow = true
        body.receiveShadow = true
        this.townGroup.add(body)

        if (def.roofColor !== undefined) {
          const roofMat = new THREE.MeshLambertMaterial({ color: def.roofColor })
          const roofW = w + 0.4
          const roofD = d + 0.4
          const roofH = 1.2
          const roof = new THREE.Mesh(new THREE.BoxGeometry(roofW, roofH, roofD), roofMat)
          roof.position.set(bx, h + roofH / 2 - 0.1, bz)
          roof.castShadow = true
          this.townGroup.add(roof)

          const ridgeMat = new THREE.MeshLambertMaterial({ color: def.roofColor })
          const ridge = new THREE.Mesh(new THREE.BoxGeometry(roofW * 0.3, 0.5, roofD + 0.2), ridgeMat)
          ridge.position.set(bx, h + roofH + 0.15, bz)
          ridge.castShadow = true
          this.townGroup.add(ridge)
        }
      }

      const [dx, dy, dz] = def.doorOffset
      const door = new THREE.Mesh(doorGeo, doorMat)
      door.position.set(dx === 0 ? bx : dx, dy, dz)
      door.name = `door_${def.id}`
      this.townGroup.add(door)
      this.doorMarkers.set(def.id, door)
    }
  }

  /* ───────── Street Lights ───────── */

  private buildStreetLights(assets: AssetLoader): void {
    const DEG = Math.PI / 180

    const lightDefs: Array<{ x: number; z: number; rotY: number }> = [
      // 左侧人行道 (x=7.5)
      { x: 7.5, z: 2,  rotY: 0 },
      { x: 7.5, z: 8,  rotY: 0 },
      { x: 7.5, z: 14, rotY: 0 },
      { x: 7.5, z: 20, rotY: 0 },
      // 右侧人行道 (x=26.5)
      { x: 26.5, z: 2,  rotY: -180 * DEG },
      { x: 26.5, z: 8,  rotY: -180 * DEG },
      { x: 26.5, z: 14, rotY: -180 * DEG },
      { x: 26.5, z: 20, rotY: -180 * DEG },
      // 广场区域
      { x: 13, z: 9.5,  rotY: 135 * DEG },
      { x: 13, z: 16.5, rotY: -135 * DEG },
      { x: 18, z: 9.5,  rotY: 90 * DEG },
      { x: 18, z: 16.5, rotY: -90 * DEG },
      { x: 23, z: 9.5,  rotY: 45 * DEG },
      { x: 23, z: 16.5, rotY: -45 * DEG },
    ]

    const poleMat = new THREE.MeshLambertMaterial({ color: 0x555555 })
    const bulbMat = new THREE.MeshLambertMaterial({
      color: 0xffee88,
      emissive: 0xffdd44,
      emissiveIntensity: 0.6,
    })
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3, 6)
    const bulbGeo = new THREE.SphereGeometry(0.15, 6, 6)

    for (const def of lightDefs) {
      const rotY = def.rotY

      const model = assets.getPropModel('streetlight')
      if (model) {
        this.placeModel(model, def.x, 0, def.z, 3.5, rotY)

        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe4b0, 0, 12, 2)
          pl.position.set(-0.22, 0.82, 0)
          model.add(pl)
          this.lightingRefs.streetLightPoints.push(pl)
        }
      } else {
        const pole = new THREE.Mesh(poleGeo, poleMat)
        pole.position.set(def.x, 1.5, def.z)
        pole.castShadow = true
        this.townGroup.add(pole)

        const bulb = new THREE.Mesh(bulbGeo, bulbMat)
        bulb.position.set(def.x, 3.15, def.z)
        this.townGroup.add(bulb)

        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe4b0, 0, 8, 2)
          pl.position.set(def.x, 3.15, def.z)
          this.townGroup.add(pl)
          this.lightingRefs.streetLightPoints.push(pl)
        }
      }
    }
  }

  /* ───────── Trees ───────── */

  private buildTrees(assets: AssetLoader): void {
    const treePositions: [number, number, boolean][] = [
      [8, 3, false], [8, 7, true], [8, 11, false], [8, 15, true],
      // [9, 18, false], [11, 17, true], [14, 18, false], [14, 20, true],
      // [10, 20, false], [12, 21, true],
      [13, 10, true], [23, 10, true], [13, 16, true], [23, 16, true],
      [25, 4, false], [25, 8, true], [25, 12, false], [25, 16, true],
      [12, 1, true], [22, 1, true],
    ]

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 })
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x55aa33 })
    const darkCrownMat = new THREE.MeshLambertMaterial({ color: 0x338822 })
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 6)
    const crownGeo = new THREE.SphereGeometry(0.8, 6, 5)
    const smallCrownGeo = new THREE.SphereGeometry(0.5, 6, 5)

    for (const [x, z, small] of treePositions) {
      const model = assets.getPropModel('bush')
      if (model) {
        this.placeModel(model, x, 0, z, small ? 5.0 : 7.0)
      } else {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat)
        trunk.position.set(x, 0.75, z)
        trunk.castShadow = true
        this.townGroup.add(trunk)

        const geo = small ? smallCrownGeo : crownGeo
        const mat = small ? darkCrownMat : crownMat
        const crown = new THREE.Mesh(geo, mat)
        crown.position.set(x, small ? 1.9 : 2.2, z)
        crown.castShadow = true
        this.townGroup.add(crown)
      }
    }
  }

  /* ───────── Benches ───────── */

  private buildBenches(assets: AssetLoader): void {
    const plazaBenches: [number, number, number][] = [
      [15, 0, 11], [21, 0, 11], [15, 0, 15], [21, 0, 15], // [17, 0, 10], [19, 0, 16],
    ]
    const parkBenches: [number, number, number][] = [
      // [10, 0, 19], [15, 0, 19], [10, 0, 21], [14, 0, 21],
    ]

    const seatMat = new THREE.MeshLambertMaterial({ color: 0x8b6c42 })
    const legMat = new THREE.MeshLambertMaterial({ color: 0x444444 })
    const seatGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4)
    const legGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06)
    const backGeo = new THREE.BoxGeometry(1.2, 0.5, 0.06)

    for (const [x, , z] of [...plazaBenches, ...parkBenches]) {
      const model = assets.getPropModel('bench')
      if (model) {
        this.placeModel(model, x, 0, z, 6.0)
      } else {
        const seat = new THREE.Mesh(seatGeo, seatMat)
        seat.position.set(x, 0.4, z)
        seat.castShadow = true
        this.townGroup.add(seat)

        const back = new THREE.Mesh(backGeo, seatMat)
        back.position.set(x, 0.65, z - 0.17)
        back.castShadow = true
        this.townGroup.add(back)

        for (const ox of [-0.5, 0.5]) {
          for (const oz of [-0.12, 0.12]) {
            const leg = new THREE.Mesh(legGeo, legMat)
            leg.position.set(x + ox, 0.175, z + oz)
            this.townGroup.add(leg)
          }
        }
      }
    }
  }

  /* ───────── Fountain ───────── */

  private buildFountain(assets: AssetLoader): void {
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb })

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 12), stoneMat)
    base.position.set(18, 0.15, 13)
    base.castShadow = true
    base.receiveShadow = true
    this.townGroup.add(base)

    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 12), stoneMat)
    wall.position.set(18, 0.55, 13)
    this.townGroup.add(wall)

    const capybara = assets.getPropModel('capybara')
    if (capybara) {
      capybara.traverse(child => {
        if (!(child as THREE.Mesh).isMesh) return
        const mats = Array.isArray((child as THREE.Mesh).material)
          ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
          : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
        for (const mat of mats) {
          if (mat.color) {
            const hsl = { h: 0, s: 0, l: 0 }
            mat.color.getHSL(hsl)
            mat.color.setHSL(hsl.h, Math.min(hsl.s * 1.6, 1.0), hsl.l)
          }
          if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace
          mat.roughness = Math.max((mat.roughness ?? 1) * 0.75, 0.35)
        }
      })
      const box = new THREE.Box3().setFromObject(capybara)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const targetSize = 4.0
      const scale = maxDim > 0 ? targetSize / maxDim : 8.0
      const yOffset = -box.min.y * scale
      this.placeModel(capybara, 18, 0.8 + yOffset, 13, scale)
    }
  }

  private buildFlowerBeds(): void {
    const flowerColors = [0xff6688, 0xffaa33, 0xff44aa, 0xaa44ff, 0xffff44]
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x44882c })
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4)
    const petalGeo = new THREE.SphereGeometry(0.08, 5, 4)

    const bedCenters: [number, number][] = [
      [5, 4], [5, 8], [5, 13], [30, 5], [30, 11], [9, 17], [35, 14],
    ]

    for (const [cx, cz] of bedCenters) {
      for (let i = 0; i < 5; i++) {
        const fx = cx + (Math.random() - 0.5) * 1.2
        const fz = cz + (Math.random() - 0.5) * 1.2
        const colorIdx = (cx * 7 + cz * 3 + i) % flowerColors.length

        const stem = new THREE.Mesh(stemGeo, stemMat)
        stem.position.set(fx, 0.125, fz)
        this.townGroup.add(stem)

        const petalMat = new THREE.MeshLambertMaterial({
          color: flowerColors[colorIdx],
          emissive: flowerColors[colorIdx],
          emissiveIntensity: 0.15,
        })
        const petal = new THREE.Mesh(petalGeo, petalMat)
        petal.position.set(fx, 0.28, fz)
        this.townGroup.add(petal)
      }
    }
  }

  /* ───────── Fire Hydrants ───────── */

  private buildFireHydrants(assets: AssetLoader): void {
    const positions: [number, number][] = [
      [7, 21],
      [27, 21],
      [18, 21],
    ]

    for (const [x, z] of positions) {
      const model = assets.getPropModel('firehydrant')
      if (model) {
        this.placeModel(model, x, 0, z, 3.5)
      }
    }
  }
}
