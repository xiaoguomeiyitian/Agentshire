import * as THREE from 'three'
import { EditorAssetLoader } from './EditorAssetLoader'
import {
  type TerrainType, type PlacedItem,
  type BuildingPlacement, type PropPlacement, type RoadPlacement,
  type Rotation, type GroupDef, TERRAIN_COLORS_HEX, genId,
  applyLightPresets,
} from './TownMapConfig'
import type { TownEditor } from './TownEditor'
import type { Command } from './UndoStack'
import type { AssetCatalogEntry } from './AssetPalette'
import type { CustomAssetStore } from './CustomAssetStore'
import { getLocale } from '../i18n'

const SKY_COLOR = 0x87ceeb
const SELECTION_COLOR = 0x00d4ff
const GHOST_OK_COLOR = 0x00d4ff
const DOOR_MARKER_COLOR = 0xffaa22
const GRID_COLOR = 0x444466

export class EditorScene {
  private container: HTMLElement
  private editor: TownEditor
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private orthoCamera!: THREE.OrthographicCamera
  private perspCamera!: THREE.PerspectiveCamera
  private activeCamera!: THREE.Camera
  private isPerspective = false
  private assets: EditorAssetLoader
  private customStore: CustomAssetStore | null = null

  // Perspective orbit state
  private orbitTarget = new THREE.Vector3()
  private orbitSpherical = new THREE.Spherical(30, Math.PI / 4, Math.PI / 4)
  private isOrbiting = false
  private orbitStart = new THREE.Vector2()

  private groundGroup = new THREE.Group()
  private modelGroup = new THREE.Group()
  private overlayGroup = new THREE.Group()
  private terrainMeshes: THREE.Mesh[][] = []
  private gridHelper: THREE.GridHelper | null = null

  private modelMap = new Map<string, THREE.Group>()
  private selectionBoxes: THREE.BoxHelper[] = []
  private lightHelpers: THREE.Mesh[] = []
  private doorMarkers = new Map<string, THREE.Mesh>()

  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  private isPanning = false
  private panStart = new THREE.Vector2()
  private cameraStart = new THREE.Vector3()

  private isDragging = false
  private dragItem: PlacedItem | null = null
  private dragStartGrid = { x: 0, z: 0 }
  private dragMouseStartGrid = { x: 0, z: 0 }
  private dragMouseStartPx = { x: 0, y: 0 }
  private dragActivated = false
  private static readonly DRAG_THRESHOLD_PX = 5

  private multiDragStarts: Map<string, { x: number; z: number }> = new Map()

  private isMarquee = false
  private marqueeStartPx = { x: 0, y: 0 }
  private marqueeDiv: HTMLDivElement | null = null

  isInsideGroup = false
  private activeGroupId: string | null = null

  private isBrushing = false
  private activeTerrain: TerrainType = 'grass'

  private ghostModel: THREE.Group | null = null
  private ghostEntry: AssetCatalogEntry | null = null
  private ghostRotation: Rotation = 0

  private isSpaceDown = false
  private zoom = 1

  constructor(container: HTMLElement, editor: TownEditor) {
    this.container = container
    this.editor = editor
    this.assets = new EditorAssetLoader()
    this.initRenderer()
    this.initScene()
    this.initCamera()
    this.initLighting()
    this.initMouse()
    this.animate()
  }

  async loadAssets(_onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // No bulk preload — models load on demand when placed or when page is viewed
  }

  /* ── Init ── */

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.container.appendChild(this.renderer.domElement)

    const ro = new ResizeObserver(() => {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      this.renderer.setSize(w, h)
      this.updateCameraFrustum()
    })
    ro.observe(this.container)
  }

  private initScene(): void {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(SKY_COLOR)
    this.scene.fog = new THREE.Fog(SKY_COLOR, 60, 120)
    this.scene.add(this.groundGroup)
    this.scene.add(this.modelGroup)
    this.scene.add(this.overlayGroup)
  }

  private initCamera(): void {
    const { cols, rows } = this.editor.config.grid

    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    this.orthoCamera.position.set(cols / 2, 40, rows / 2 + 15)
    this.orthoCamera.lookAt(cols / 2, 0, rows / 2)

    this.perspCamera = new THREE.PerspectiveCamera(42, this.container.clientWidth / this.container.clientHeight, 0.1, 300)
    this.orbitTarget.set(cols / 2, 0, rows / 2)
    this.orbitSpherical.set(35, Math.PI / 3.5, Math.PI / 4)
    this.updatePerspFromSpherical()

    this.activeCamera = this.orthoCamera
    this.updateCameraFrustum()
  }

  private updateCameraFrustum(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const aspect = w / h
    const halfH = 18 / this.zoom
    const halfW = halfH * aspect
    this.orthoCamera.left = -halfW
    this.orthoCamera.right = halfW
    this.orthoCamera.top = halfH
    this.orthoCamera.bottom = -halfH
    this.orthoCamera.updateProjectionMatrix()

    this.perspCamera.aspect = aspect
    this.perspCamera.updateProjectionMatrix()
  }

  private updatePerspFromSpherical(): void {
    const pos = new THREE.Vector3().setFromSpherical(this.orbitSpherical).add(this.orbitTarget)
    this.perspCamera.position.copy(pos)
    this.perspCamera.lookAt(this.orbitTarget)
  }

  toggleCamera(): boolean {
    this.isPerspective = !this.isPerspective
    if (this.isPerspective) {
      const { cols, rows } = this.editor.config.grid
      this.orbitTarget.set(cols / 2, 0, rows / 2)
      this.orbitSpherical.set(35, Math.PI / 3.5, Math.PI / 4)
      this.updatePerspFromSpherical()
      this.activeCamera = this.perspCamera
    } else {
      this.activeCamera = this.orthoCamera
    }
    return this.isPerspective
  }

  private initLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)

    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(20, 30, 20)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.left = -40
    dir.shadow.camera.right = 40
    dir.shadow.camera.top = 40
    dir.shadow.camera.bottom = -40
    this.scene.add(dir)

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556633, 0.4)
    this.scene.add(hemi)
  }

  /* ── Ground & Grid ── */

  buildGround(): void {
    this.groundGroup.clear()
    this.terrainMeshes = []
    const { cols, rows } = this.editor.config.grid
    const terrain = this.editor.config.terrain

    const geo = new THREE.PlaneGeometry(1, 1)
    for (let r = 0; r < rows; r++) {
      const row: THREE.Mesh[] = []
      for (let c = 0; c < cols; c++) {
        const t = terrain[r]?.[c]?.type ?? 'grass'
        const mat = new THREE.MeshStandardMaterial({ color: TERRAIN_COLORS_HEX[t] })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(c + 0.5, 0, r + 0.5)
        mesh.receiveShadow = true
        mesh.userData = { terrain: true, col: c, row: r }
        this.groundGroup.add(mesh)
        row.push(mesh)
      }
      this.terrainMeshes.push(row)
    }

    if (this.gridHelper) this.scene.remove(this.gridHelper)
    this.gridHelper = new THREE.GridHelper(Math.max(cols, rows), Math.max(cols, rows), GRID_COLOR, GRID_COLOR)
    this.gridHelper.position.set(cols / 2, 0.01, rows / 2)
    this.gridHelper.material = new THREE.LineBasicMaterial({ color: GRID_COLOR, transparent: true, opacity: 0.3 })
    this.scene.add(this.gridHelper)
  }

  updateTerrainCell(col: number, row: number, type: TerrainType): void {
    const mesh = this.terrainMeshes[row]?.[col]
    if (!mesh) return
    ;(mesh.material as THREE.MeshStandardMaterial).color.setHex(TERRAIN_COLORS_HEX[type])
  }

  /* ── Model management ── */

  rebuildModels(): void {
    this.modelGroup.clear()
    this.modelMap.clear()
    this.doorMarkers.clear()
    const config = this.editor.config
    for (const b of config.buildings) this.addModelForBuilding(b)
    for (const p of config.props) this.addModelForProp(p)
    for (const r of config.roads) this.addModelForRoad(r)
  }

  private async loadModelByUrl(url: string | undefined): Promise<THREE.Group | null> {
    if (!url) return null
    const resolved = this.customStore ? this.customStore.resolveModelUrl(url) : url
    return this.assets.loadModel(resolved)
  }

  private wrapWithFixRotation(model: THREE.Group, fixRotationX?: number, fixRotationY?: number, fixRotationZ?: number): THREE.Group {
    if (!fixRotationX && !fixRotationY && !fixRotationZ) return model
    const wrapper = new THREE.Group()
    const pivot = new THREE.Group()
    if (fixRotationX) pivot.rotation.x = (fixRotationX * Math.PI) / 180
    if (fixRotationY) pivot.rotation.y = (fixRotationY * Math.PI) / 180
    if (fixRotationZ) pivot.rotation.z = (fixRotationZ * Math.PI) / 180
    while (model.children.length > 0) {
      pivot.add(model.children[0])
    }
    wrapper.add(pivot)
    wrapper.userData = model.userData
    return wrapper
  }

  private groundModel(model: THREE.Group, elevation = 0): void {
    model.position.y = 0
    const box = new THREE.Box3().setFromObject(model)
    model.position.y = elevation - Math.min(box.min.y, 0)
  }

  private addModelForBuilding(b: BuildingPlacement): void {
    this.loadModelByUrl(b.modelUrl).then(rawModel => {
      if (!rawModel) return
      const model = this.wrapWithFixRotation(rawModel, b.fixRotationX, b.fixRotationY, b.fixRotationZ)
      model.scale.setScalar(b.scale ?? 1)
      model.rotation.y = (b.rotationY * Math.PI) / 180
      model.position.set(b.gridX + b.widthCells / 2, 0, b.gridZ + b.depthCells / 2)
      this.groundModel(model, b.elevation ?? 0)
      model.userData = { itemId: b.id, kind: 'building' }
      this.modelGroup.add(model)
      this.modelMap.set(b.id, model)
      this.updateDoorMarker(b)
    }).catch(e => console.warn('[EditorScene] loadModel building failed:', e))
  }

  private addModelForProp(p: PropPlacement): void {
    this.loadModelByUrl(p.modelUrl).then(rawModel => {
      if (!rawModel) return
      const model = this.wrapWithFixRotation(rawModel, p.fixRotationX, p.fixRotationY, p.fixRotationZ)
      model.scale.setScalar(p.scale ?? 1)
      model.rotation.y = (p.rotationY * Math.PI) / 180
      model.position.set(p.gridX + 0.5, 0, p.gridZ + 0.5)
      this.groundModel(model, (p as unknown as { elevation?: number }).elevation ?? 0)
      model.userData = { itemId: p.id, kind: 'prop' }
      this.modelGroup.add(model)
      this.modelMap.set(p.id, model)
    }).catch(e => console.warn('[EditorScene] loadModel prop failed:', e))
  }

  private addModelForRoad(r: RoadPlacement): void {
    this.loadModelByUrl(r.modelUrl).then(rawModel => {
      if (!rawModel) return
      const model = this.wrapWithFixRotation(rawModel, r.fixRotationX, r.fixRotationY, r.fixRotationZ)
      const s = (r as unknown as { scale?: number }).scale ?? 1
      model.scale.setScalar(s)
      model.rotation.y = (r.rotationY * Math.PI) / 180
      model.position.set(r.gridX + 1, 0, r.gridZ + 1)
      this.groundModel(model, (r as unknown as { elevation?: number }).elevation ?? 0)
      model.userData = { itemId: r.id, kind: 'road' }
      this.modelGroup.add(model)
      this.modelMap.set(r.id, model)
    }).catch(e => console.warn('[EditorScene] loadModel road failed:', e))
  }

  removeModel(id: string): void {
    const m = this.modelMap.get(id)
    if (m) { this.modelGroup.remove(m); this.modelMap.delete(id) }
    const dm = this.doorMarkers.get(id)
    if (dm) { this.overlayGroup.remove(dm); this.doorMarkers.delete(id) }
  }

  updateModelTransform(item: PlacedItem): void {
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
      this.groundModel(m, b.elevation ?? 0)
      this.updateDoorMarker(b)
    } else if (item.kind === 'prop') {
      const p = item.data as PropPlacement
      const s = p.scale ?? 1
      m.position.set(p.gridX + 0.5, 0, p.gridZ + 0.5)
      m.rotation.y = (p.rotationY * Math.PI) / 180
      m.scale.set(s * fx, s, s * fz)
      this.groundModel(m, (p as unknown as { elevation?: number }).elevation ?? 0)
    } else {
      const r = item.data as RoadPlacement
      const s = (r as unknown as { scale?: number }).scale ?? 1
      m.position.set(r.gridX + 1, 0, r.gridZ + 1)
      m.rotation.y = (r.rotationY * Math.PI) / 180
      m.scale.set(s * fx, s, s * fz)
      this.groundModel(m, (r as unknown as { elevation?: number }).elevation ?? 0)
    }
  }

  private updateDoorMarker(b: BuildingPlacement): void {
    let marker = this.doorMarkers.get(b.id)
    const isOffice = this.editor.config.bindings.office === b.id
    if (!isOffice) {
      if (marker) { this.overlayGroup.remove(marker); this.doorMarkers.delete(b.id) }
      return
    }
    if (!marker) {
      const geo = new THREE.ConeGeometry(0.3, 0.6, 8)
      const mat = new THREE.MeshStandardMaterial({ color: DOOR_MARKER_COLOR, emissive: DOOR_MARKER_COLOR, emissiveIntensity: 0.5 })
      marker = new THREE.Mesh(geo, mat)
      this.overlayGroup.add(marker)
      this.doorMarkers.set(b.id, marker)
    }
    const cx = b.gridX + b.widthCells / 2
    const cz = b.gridZ + b.depthCells / 2
    const offsets: Record<string, [number, number]> = {
      south: [0, b.depthCells / 2 + 0.5],
      north: [0, -(b.depthCells / 2 + 0.5)],
      east: [b.widthCells / 2 + 0.5, 0],
      west: [-(b.widthCells / 2 + 0.5), 0],
    }
    const [dx, dz] = offsets[b.doorSide] ?? [0, b.depthCells / 2 + 0.5]
    marker.position.set(cx + dx, 1.5, cz + dz)
    marker.rotation.x = Math.PI
  }

  /* ── Selection ── */

  setSelection(items: PlacedItem | PlacedItem[] | null): void {
    for (const box of this.selectionBoxes) this.overlayGroup.remove(box)
    this.selectionBoxes = []

    const arr = items === null ? [] : Array.isArray(items) ? items : [items]
    for (const item of arr) {
      const model = this.modelMap.get(item.data.id)
      if (!model) continue
      const box = new THREE.BoxHelper(model, SELECTION_COLOR)
      this.overlayGroup.add(box)
      this.selectionBoxes.push(box)
    }
    this.updateLightHelpers(arr)
  }

  private updateLightHelpers(items: PlacedItem[]): void {
    for (const h of this.lightHelpers) {
      h.parent?.remove(h)
      h.geometry.dispose()
      ;(h.material as THREE.Material).dispose()
    }
    this.lightHelpers = []

    const helperGeo = new THREE.SphereGeometry(0.15, 8, 8)
    const helperMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.7 })

    for (const item of items) {
      const lights = (item.data as any).lights as Array<{offsetX:number;offsetY:number;offsetZ:number}> | undefined
      if (!lights || lights.length === 0) continue
      const model = this.modelMap.get(item.data.id)
      if (!model) continue
      for (const lp of lights) {
        const sphere = new THREE.Mesh(helperGeo.clone(), helperMat.clone())
        sphere.position.set(lp.offsetX, lp.offsetY, lp.offsetZ)
        model.add(sphere)
        this.lightHelpers.push(sphere)
      }
    }
  }

  /* ── Ghost preview ── */

  setGhost(entry: AssetCatalogEntry | null): void {
    this.clearGhost()
    if (!entry) { this.ghostEntry = null; return }
    this.ghostEntry = entry
    this.ghostRotation = 0
    if (!entry.url) return
    const resolvedUrl = this.customStore ? this.customStore.resolveModelUrl(entry.url) : entry.url
    this.assets.loadModel(resolvedUrl).then(rawModel => {
      if (!rawModel || this.ghostEntry?.key !== entry.key) return
      const model = this.wrapWithFixRotation(rawModel, entry.fixRotationX, entry.fixRotationY, entry.fixRotationZ)
      this.ghostModel = model
      model.scale.setScalar(entry.defaultScale ?? 1)
      model.rotation.y = (this.ghostRotation * Math.PI) / 180
      try {
        let meshCount = 0
        model.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            meshCount++
            const m = child as THREE.Mesh
            if (Array.isArray(m.material)) {
              m.material = m.material.map(mat => {
                const c = (mat as THREE.MeshStandardMaterial).clone()
                c.transparent = true; c.opacity = 0.5; c.color.setHex(GHOST_OK_COLOR)
                return c
              })
            } else {
              const mat = (m.material as THREE.MeshStandardMaterial).clone()
              mat.transparent = true
              mat.opacity = 0.5
              mat.color.setHex(GHOST_OK_COLOR)
              m.material = mat
            }
          }
        })
        console.log('[ghost] 3. traverse done, meshes:', meshCount)
      } catch (err) {
        console.warn('[setGhost] traverse error:', err)
      }
      model.visible = false
      this.overlayGroup.add(model)
    }).catch(() => { /* ghost setup failed */ })
  }

  rotateGhost(): void {
    this.ghostRotation = ((this.ghostRotation + 90) % 360) as Rotation
    if (this.ghostModel) {
      this.ghostModel.rotation.y = (this.ghostRotation * Math.PI) / 180
    }
  }

  get currentGhostEntry(): AssetCatalogEntry | null { return this.ghostEntry }
  get currentGhostRotation(): Rotation { return this.ghostRotation }

  private clearGhost(): void {
    if (this.ghostModel) {
      this.overlayGroup.remove(this.ghostModel)
      this.ghostModel = null
    }
  }

  private updateGhostPosition(gx: number, gz: number): void {
    if (!this.ghostModel || !this.ghostEntry) return
    this.ghostModel.visible = true
    const e = this.ghostEntry
    const t = e.assetType
    const isBuilding = t === 'building' || t.includes('building') || e.category === 'buildings'
    const isRoad = t === 'road' || t.includes('road') || t.includes('parking') || e.category === 'roads'
    if (isBuilding) {
      this.ghostModel.position.set(gx + e.cells[0] / 2, 0, gz + e.cells[1] / 2)
    } else if (isRoad) {
      this.ghostModel.position.set(gx + 1, 0, gz + 1)
    } else {
      this.ghostModel.position.set(gx + 0.5, 0, gz + 0.5)
    }
  }

  /* ── Raycasting ── */

  private getGroundPoint(e: MouseEvent): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.activeCamera)
    const target = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(this.groundPlane, target) ? target : null
  }

  private hitTestModel(e: MouseEvent): PlacedItem | null {
    const groundPt = this.getGroundPoint(e)
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.activeCamera)

    const config = this.editor.config
    const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true)

    if (intersects.length > 0 && groundPt) {
      const gx = groundPt.x
      const gz = groundPt.z

      const candidates: { item: PlacedItem; dist: number }[] = []
      const seen = new Set<string>()

      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object
        while (obj && !obj.userData?.itemId) obj = obj.parent
        if (!obj?.userData?.itemId) continue
        const id = obj.userData.itemId as string
        if (seen.has(id)) continue
        seen.add(id)
        const kind = obj.userData.kind as string

        let item: PlacedItem | null = null
        if (kind === 'building') {
          const data = config.buildings.find(b => b.id === id)
          if (data) item = { kind: 'building', data }
        } else if (kind === 'prop') {
          const data = config.props.find(p => p.id === id)
          if (data) item = { kind: 'prop', data }
        } else if (kind === 'road') {
          const data = config.roads.find(r => r.id === id)
          if (data) item = { kind: 'road', data }
        }

        if (item) {
          const d = item.data
          let cx: number, cz: number
          if (item.kind === 'building') {
            const b = d as BuildingPlacement
            cx = b.gridX + b.widthCells / 2
            cz = b.gridZ + b.depthCells / 2
          } else if (item.kind === 'road') {
            cx = d.gridX + 1; cz = d.gridZ + 1
          } else {
            cx = d.gridX + 0.5; cz = d.gridZ + 0.5
          }
          const dist = (gx - cx) ** 2 + (gz - cz) ** 2
          candidates.push({ item, dist })
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.dist - b.dist)
        return candidates[0].item
      }
    }

    return null
  }

  /* ── Mouse events ── */

  private initMouse(): void {
    const el = this.renderer.domElement
    el.addEventListener('mousedown', e => this.onMouseDown(e))
    el.addEventListener('mousemove', e => this.onMouseMove(e))
    el.addEventListener('mouseup', e => this.onMouseUp(e))
    el.addEventListener('dblclick', e => this.onDoubleClick(e))
    el.addEventListener('wheel', e => this.onWheel(e), { passive: false })
    el.addEventListener('contextmenu', e => e.preventDefault())

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true
        el.style.cursor = 'grab'
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this.isSpaceDown = false
        if (!this.isPanning) el.style.cursor = ''
      }
    })
  }

  private startPan(e: MouseEvent): void {
    this.isPanning = true
    this.panStart.set(e.clientX, e.clientY)
    this.cameraStart.copy(this.isPerspective ? this.orbitTarget : this.orthoCamera.position)
    this.renderer.domElement.style.cursor = 'grabbing'
  }

  private onMouseDown(e: MouseEvent): void {
    // Space + left-click: pan (both modes)
    if (e.button === 0 && this.isSpaceDown) {
      this.startPan(e)
      return
    }

    // Right-click or Alt+click: orbit (perspective) / ignored (ortho — pan via scroll)
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      if (this.isPerspective) {
        this.isOrbiting = true
        this.orbitStart.set(e.clientX, e.clientY)
      }
      return
    }

    // Middle-click: pan (both modes)
    if (e.button === 1) {
      this.startPan(e)
      return
    }

    if (e.button !== 0) return

    const tool = this.editor.activeTool
    const pt = this.getGroundPoint(e)
    if (!pt) return
    const gx = Math.floor(pt.x)
    const gz = Math.floor(pt.z)

    if (tool === 'terrain') {
      this.isBrushing = true
      this.brushTerrain(gx, gz)
      return
    }

    if (tool === 'erase') {
      const item = this.hitTestModel(e)
      if (item) { this.editor.setSelection(item); this.editor.deleteSelected() }
      return
    }

    if (this.ghostEntry && this.ghostModel) {
      this.placeAsset(this.ghostEntry, gx, gz)
      return
    }

    const item = this.hitTestModel(e)
    if (item) {
      const groupForItem = this.findGroupForItem(item.data.id)
      if (groupForItem && !this.isInsideGroup) {
        const groupItems = this.getGroupItems(groupForItem)
        if (e.shiftKey) {
          const current = [...this.editor.selectedItems]
          const alreadySelected = current.some(c => groupForItem.memberIds.includes(c.data.id))
          if (alreadySelected) {
            this.editor.setSelection(current.filter(c => !groupForItem.memberIds.includes(c.data.id)))
          } else {
            this.editor.setSelection([...current, ...groupItems])
          }
        } else {
          this.editor.setSelection(groupItems)
        }
      } else if (e.shiftKey) {
        const current = [...this.editor.selectedItems]
        const idx = current.findIndex(c => c.data.id === item.data.id)
        if (idx >= 0) {
          current.splice(idx, 1)
          this.editor.setSelection(current)
        } else {
          this.editor.setSelection([...current, item])
        }
      } else {
        const alreadyInSelection = this.editor.selectedItems.some(c => c.data.id === item.data.id)
        if (!alreadyInSelection) {
          this.editor.setSelection(item)
        }
      }

      this.isDragging = true
      this.dragActivated = false
      this.dragItem = item
      this.dragStartGrid = { x: item.data.gridX, z: item.data.gridZ }
      this.dragMouseStartGrid = { x: gx, z: gz }
      this.dragMouseStartPx = { x: e.clientX, y: e.clientY }

      this.multiDragStarts.clear()
      for (const si of this.editor.selectedItems) {
        this.multiDragStarts.set(si.data.id, { x: si.data.gridX, z: si.data.gridZ })
      }
    } else {
      if (!e.shiftKey) this.editor.setSelection(null)
      this.isMarquee = true
      this.marqueeStartPx = { x: e.clientX, y: e.clientY }
      if (!this.marqueeDiv) {
        this.marqueeDiv = document.createElement('div')
        this.marqueeDiv.className = 'editor-marquee'
        this.container.appendChild(this.marqueeDiv)
      }
      this.marqueeDiv.style.display = 'none'
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0) return
    const item = this.hitTestModel(e)
    if (!item) {
      if (this.isInsideGroup) {
        this.exitGroup()
        const groupItems = this.editor.selectedItems
        if (groupItems.length > 0) {
          const group = this.findGroupForItem(groupItems[0].data.id)
          if (group) this.editor.setSelection(this.getGroupItems(group))
        }
      }
      return
    }
    const group = this.findGroupForItem(item.data.id)
    if (group && !this.isInsideGroup) {
      this.enterGroup(group.id)
      this.editor.setSelection(item)
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const pt = this.getGroundPoint(e)

    if (this.isOrbiting) {
      const dx = (e.clientX - this.orbitStart.x) * 0.005
      const dy = (e.clientY - this.orbitStart.y) * 0.005
      this.orbitSpherical.theta -= dx
      this.orbitSpherical.phi = Math.max(0.15, Math.min(Math.PI / 2.1, this.orbitSpherical.phi + dy))
      this.orbitStart.set(e.clientX, e.clientY)
      this.updatePerspFromSpherical()
      return
    }

    if (this.isPanning) {
      if (this.isPerspective) {
        const right = new THREE.Vector3().setFromMatrixColumn(this.perspCamera.matrixWorld, 0)
        const forward = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize()
        const dx = (e.clientX - this.panStart.x) * 0.05
        const dz = (e.clientY - this.panStart.y) * 0.05
        this.orbitTarget.copy(this.cameraStart)
          .addScaledVector(right, -dx)
          .addScaledVector(forward, -dz)
        this.orbitTarget.y = 0
        this.updatePerspFromSpherical()
      } else {
        const dx = (e.clientX - this.panStart.x) * 0.05 / this.zoom
        const dy = (e.clientY - this.panStart.y) * 0.05 / this.zoom
        this.orthoCamera.position.x = this.cameraStart.x - dx
        this.orthoCamera.position.z = this.cameraStart.z - dy
      }
      return
    }

    if (!pt) return
    const gx = Math.floor(pt.x)
    const gz = Math.floor(pt.z)

    const cursorEl = document.getElementById('status-cursor')
    if (cursorEl) cursorEl.textContent = `(${gx}, ${gz})`

    if (this.isBrushing) {
      this.brushTerrain(gx, gz)
      return
    }

    if (this.isDragging && this.dragItem) {
      if (!this.dragActivated) {
        const dx = e.clientX - this.dragMouseStartPx.x
        const dy = e.clientY - this.dragMouseStartPx.y
        if (dx * dx + dy * dy < EditorScene.DRAG_THRESHOLD_PX * EditorScene.DRAG_THRESHOLD_PX) return
        this.dragActivated = true
      }
      const deltaX = gx - this.dragMouseStartGrid.x
      const deltaZ = gz - this.dragMouseStartGrid.z
      if (deltaX === 0 && deltaZ === 0) return
      for (const si of this.editor.selectedItems) {
        const start = this.multiDragStarts.get(si.data.id)
        if (!start) continue
        const newX = start.x + deltaX
        const newZ = start.z + deltaZ
        if (si.data.gridX !== newX || si.data.gridZ !== newZ) {
          si.data.gridX = newX
          si.data.gridZ = newZ
          this.updateModelTransform(si)
        }
      }
      this.setSelection(this.editor.selectedItems)
      return
    }

    if (this.isMarquee && this.marqueeDiv) {
      const rect = this.container.getBoundingClientRect()
      const x1 = Math.min(this.marqueeStartPx.x, e.clientX) - rect.left
      const y1 = Math.min(this.marqueeStartPx.y, e.clientY) - rect.top
      const x2 = Math.max(this.marqueeStartPx.x, e.clientX) - rect.left
      const y2 = Math.max(this.marqueeStartPx.y, e.clientY) - rect.top
      const dx = e.clientX - this.marqueeStartPx.x
      const dy = e.clientY - this.marqueeStartPx.y
      if (dx * dx + dy * dy > EditorScene.DRAG_THRESHOLD_PX * EditorScene.DRAG_THRESHOLD_PX) {
        this.marqueeDiv.style.display = 'block'
        this.marqueeDiv.style.left = `${x1}px`
        this.marqueeDiv.style.top = `${y1}px`
        this.marqueeDiv.style.width = `${x2 - x1}px`
        this.marqueeDiv.style.height = `${y2 - y1}px`
      }
      return
    }

    if (this.ghostModel) {
      this.updateGhostPosition(gx, gz)
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.isDragging && this.dragItem && this.dragActivated) {
      const items = [...this.editor.selectedItems]
      const starts = new Map(this.multiDragStarts)
      const ends = new Map<string, { x: number; z: number }>()
      let anyMoved = false
      for (const si of items) {
        ends.set(si.data.id, { x: si.data.gridX, z: si.data.gridZ })
        const start = starts.get(si.data.id)
        if (start && (start.x !== si.data.gridX || start.z !== si.data.gridZ)) anyMoved = true
      }
      if (anyMoved) {
        const scene = this
        const cmd: Command = {
          execute: () => {
            for (const si of items) {
              const end = ends.get(si.data.id)
              if (end) { si.data.gridX = end.x; si.data.gridZ = end.z; scene.updateModelTransform(si) }
            }
            scene.setSelection(items)
          },
          undo: () => {
            for (const si of items) {
              const start = starts.get(si.data.id)
              if (start) { si.data.gridX = start.x; si.data.gridZ = start.z; scene.updateModelTransform(si) }
            }
            scene.setSelection(items)
          },
        }
        this.editor.undoStack.push(cmd)
      }
    }

    if (this.isMarquee && this.marqueeDiv) {
      const dx = (e?.clientX ?? 0) - this.marqueeStartPx.x
      const dy = (e?.clientY ?? 0) - this.marqueeStartPx.y
      if (dx * dx + dy * dy > EditorScene.DRAG_THRESHOLD_PX * EditorScene.DRAG_THRESHOLD_PX) {
        const selected = this.getItemsInMarquee(this.marqueeStartPx.x, this.marqueeStartPx.y, e.clientX, e.clientY)
        if (selected.length > 0) {
          this.editor.setSelection(selected)
        }
      }
      this.marqueeDiv.style.display = 'none'
      this.isMarquee = false
    }

    const wasPanning = this.isPanning
    this.isPanning = false
    this.isDragging = false
    this.dragActivated = false
    this.isBrushing = false
    this.isOrbiting = false
    this.dragItem = null
    this.multiDragStarts.clear()
    if (wasPanning) {
      this.renderer.domElement.style.cursor = this.isSpaceDown ? 'grab' : ''
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault()

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom (trackpad) / Ctrl+scroll (mouse) → Zoom
      if (this.isPerspective) {
        this.orbitSpherical.radius *= e.deltaY > 0 ? 1.08 : 0.92
        this.orbitSpherical.radius = Math.max(5, Math.min(120, this.orbitSpherical.radius))
        this.updatePerspFromSpherical()
      } else {
        this.zoom *= e.deltaY > 0 ? 0.92 : 1.08
        this.zoom = Math.max(0.3, Math.min(4, this.zoom))
        this.updateCameraFrustum()
      }
    } else {
      // Two-finger swipe (trackpad) / scroll wheel (mouse) → Pan
      if (this.isPerspective) {
        const right = new THREE.Vector3().setFromMatrixColumn(this.perspCamera.matrixWorld, 0)
        const forward = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize()
        this.orbitTarget.addScaledVector(right, e.deltaX * 0.02)
        this.orbitTarget.addScaledVector(forward, e.deltaY * 0.02)
        this.orbitTarget.y = 0
        this.updatePerspFromSpherical()
      } else {
        this.orthoCamera.position.x += e.deltaX * 0.02 / this.zoom
        this.orthoCamera.position.z += e.deltaY * 0.02 / this.zoom
      }
    }
  }

  /* ── Terrain brush ── */

  setActiveTerrain(t: TerrainType): void { this.activeTerrain = t }

  private brushTerrain(col: number, row: number): void {
    const { terrain, grid } = this.editor.config
    if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return
    if (terrain[row][col].type === this.activeTerrain) return
    const prev = terrain[row][col].type
    const next = this.activeTerrain
    const cmd: Command = {
      execute: () => { terrain[row][col] = { type: next }; this.updateTerrainCell(col, row, next) },
      undo: () => { terrain[row][col] = { type: prev }; this.updateTerrainCell(col, row, prev) },
    }
    this.editor.undoStack.push(cmd)
  }

  /* ── Place asset ── */

  placeAsset(entry: AssetCatalogEntry, gx: number, gz: number): void {
    const config = this.editor.config
    const t = entry.assetType
    const isBuilding = t === 'building' || t.includes('building') || entry.category === 'buildings'
    const isRoad = t === 'road' || t.includes('road') || t.includes('parking') || entry.category === 'roads'
    const id = genId(isBuilding ? 'bld' : isRoad ? 'rd' : 'prop')
    const rot = this.ghostRotation

    if (isBuilding) {
      const b: BuildingPlacement = {
        id, modelKey: entry.key, modelUrl: entry.url, displayName: entry.name, gridX: gx, gridZ: gz,
        widthCells: entry.cells[0], depthCells: entry.cells[1],
        rotationY: rot, scale: entry.defaultScale ?? 1, doorSide: 'south',
        fixRotationX: entry.fixRotationX, fixRotationY: entry.fixRotationY, fixRotationZ: entry.fixRotationZ,
      }
      const presetLights = applyLightPresets(entry.key)
      if (presetLights) {
        (b as any).lights = presetLights
      }
      const cmd: Command = {
        execute: () => { config.buildings.push(b); this.addModelForBuilding(b) },
        undo: () => { config.buildings = config.buildings.filter(x => x.id !== id); this.removeModel(id) },
      }
      this.editor.undoStack.push(cmd)
    } else if (isRoad) {
      const r: RoadPlacement = { id, modelKey: entry.key, modelUrl: entry.url, gridX: gx, gridZ: gz, rotationY: rot, fixRotationX: entry.fixRotationX, fixRotationY: entry.fixRotationY, fixRotationZ: entry.fixRotationZ }
      const presetLights = applyLightPresets(entry.key)
      if (presetLights) {
        (r as any).lights = presetLights
      }
      const cmd: Command = {
        execute: () => { config.roads.push(r); this.addModelForRoad(r) },
        undo: () => { config.roads = config.roads.filter(x => x.id !== id); this.removeModel(id) },
      }
      this.editor.undoStack.push(cmd)
    } else {
      const p: PropPlacement = {
        id, modelKey: entry.key, modelUrl: entry.url, gridX: gx, gridZ: gz,
        rotationY: rot, scale: entry.defaultScale ?? 1,
        fixRotationX: entry.fixRotationX, fixRotationY: entry.fixRotationY, fixRotationZ: entry.fixRotationZ,
      }
      const presetLights = applyLightPresets(entry.key)
      if (presetLights) {
        (p as any).lights = presetLights
      }
      const cmd: Command = {
        execute: () => { config.props.push(p); this.addModelForProp(p) },
        undo: () => { config.props = config.props.filter(x => x.id !== id); this.removeModel(id) },
      }
      this.editor.undoStack.push(cmd)
    }
  }

  /* ── Delete / Rotate ── */

  deleteItem(item: PlacedItem): void {
    const config = this.editor.config
    const id = item.data.id
    if (item.kind === 'building') {
      const b = item.data as BuildingPlacement
      const cmd: Command = {
        execute: () => { config.buildings = config.buildings.filter(x => x.id !== id); this.removeModel(id) },
        undo: () => { config.buildings.push(b); this.addModelForBuilding(b) },
      }
      this.editor.undoStack.push(cmd)
    } else if (item.kind === 'prop') {
      const p = item.data as PropPlacement
      const cmd: Command = {
        execute: () => { config.props = config.props.filter(x => x.id !== id); this.removeModel(id) },
        undo: () => { config.props.push(p); this.addModelForProp(p) },
      }
      this.editor.undoStack.push(cmd)
    } else {
      const r = item.data as RoadPlacement
      const cmd: Command = {
        execute: () => { config.roads = config.roads.filter(x => x.id !== id); this.removeModel(id) },
        undo: () => { config.roads.push(r); this.addModelForRoad(r) },
      }
      this.editor.undoStack.push(cmd)
    }
  }

  rotateItem(item: PlacedItem): void {
    const d = item.data as { rotationY: number }
    const prev = d.rotationY
    const next = ((prev + 90) % 360) as Rotation
    const cmd: Command = {
      execute: () => { d.rotationY = next; this.updateModelTransform(item); this.setSelection(item) },
      undo: () => { d.rotationY = prev; this.updateModelTransform(item); this.setSelection(item) },
    }
    this.editor.undoStack.push(cmd)
  }

  flipItemX(item: PlacedItem): void {
    const d = item.data as { flipX?: boolean }
    const prev = !!d.flipX
    const cmd: Command = {
      execute: () => { d.flipX = !prev; this.updateModelTransform(item); this.setSelection(item) },
      undo: () => { d.flipX = prev; this.updateModelTransform(item); this.setSelection(item) },
    }
    this.editor.undoStack.push(cmd)
  }

  flipItemZ(item: PlacedItem): void {
    const d = item.data as { flipZ?: boolean }
    const prev = !!d.flipZ
    const cmd: Command = {
      execute: () => { d.flipZ = !prev; this.updateModelTransform(item); this.setSelection(item) },
      undo: () => { d.flipZ = prev; this.updateModelTransform(item); this.setSelection(item) },
    }
    this.editor.undoStack.push(cmd)
  }

  /* ── Snap to target ── */

  private snapCallback: ((newX: number, newZ: number, newElev: number) => void) | null = null
  private snapHandler: ((e: MouseEvent) => void) | null = null

  enterSnapMode(sourceItem: PlacedItem, callback: (newX: number, newZ: number, newElev: number) => void): void {
    this.exitSnapMode()
    this.snapCallback = callback
    this.renderer.domElement.style.cursor = 'crosshair'

    const statusTool = document.getElementById('status-tool')
    if (statusTool) statusTool.textContent = getLocale() === 'en' ? 'Snap: click target' : '吸附模式：点击目标模型'

    this.snapHandler = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const rect = this.renderer.domElement.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)

      const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true)
      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object
        while (obj && !obj.userData?.itemId) obj = obj.parent
        if (!obj?.userData?.itemId) continue
        const targetId = obj.userData.itemId as string
        if (targetId === sourceItem.data.id) continue

        const targetModel = this.modelMap.get(targetId)
        if (!targetModel) continue

        const targetBox = new THREE.Box3().setFromObject(targetModel)
        const topY = targetBox.max.y

        const targetCenter = targetBox.getCenter(new THREE.Vector3())

        let srcOffX = 0.5, srcOffZ = 0.5
        if (sourceItem.kind === 'building') {
          const b = sourceItem.data as BuildingPlacement
          srcOffX = b.widthCells / 2
          srcOffZ = b.depthCells / 2
        } else if (sourceItem.kind === 'road') {
          srcOffX = 1; srcOffZ = 1
        }

        const newX = Math.round(targetCenter.x - srcOffX)
        const newZ = Math.round(targetCenter.z - srcOffZ)
        const newElev = Math.round(topY * 10) / 10

        this.snapCallback?.(newX, newZ, newElev)
        this.exitSnapMode()
        return
      }
    }

    this.renderer.domElement.addEventListener('click', this.snapHandler, { once: true, capture: true })
  }

  private exitSnapMode(): void {
    if (this.snapHandler) {
      this.renderer.domElement.removeEventListener('click', this.snapHandler, true)
      this.snapHandler = null
    }
    this.snapCallback = null
    this.renderer.domElement.style.cursor = ''
    const statusTool = document.getElementById('status-tool')
    if (statusTool) statusTool.textContent = getLocale() === 'en' ? 'Select mode' : '选择模式'
  }

  enterJoinMode(sourceItem: PlacedItem, callback: (newX: number, newZ: number) => void): void {
    this.exitSnapMode()
    this.renderer.domElement.style.cursor = 'crosshair'

    const statusTool = document.getElementById('status-tool')
    if (statusTool) statusTool.textContent = getLocale() === 'en' ? 'Join: click target side' : '拼接模式：点击目标模型的侧面'

    const handler = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      const rect = this.renderer.domElement.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)

      const intersects = this.raycaster.intersectObjects(this.modelGroup.children, true)
      for (const hit of intersects) {
        let obj: THREE.Object3D | null = hit.object
        while (obj && !obj.userData?.itemId) obj = obj.parent
        if (!obj?.userData?.itemId) continue
        const targetId = obj.userData.itemId as string
        if (targetId === sourceItem.data.id) continue

        const targetModel = this.modelMap.get(targetId)
        const sourceModel = this.modelMap.get(sourceItem.data.id)
        if (!targetModel || !sourceModel) continue

        const tBox = new THREE.Box3().setFromObject(targetModel)
        const sBox = new THREE.Box3().setFromObject(sourceModel)
        const sHalfW = (sBox.max.x - sBox.min.x) / 2
        const sHalfD = (sBox.max.z - sBox.min.z) / 2

        const hitPoint = hit.point
        const tCx = (tBox.min.x + tBox.max.x) / 2
        const tCz = (tBox.min.z + tBox.max.z) / 2
        const tHalfW = (tBox.max.x - tBox.min.x) / 2
        const tHalfD = (tBox.max.z - tBox.min.z) / 2

        const dx = hitPoint.x - tCx
        const dz = hitPoint.z - tCz

        let newCx: number, newCz: number
        if (Math.abs(dx) / (tHalfW || 1) > Math.abs(dz) / (tHalfD || 1)) {
          newCx = dx > 0 ? tBox.max.x + sHalfW : tBox.min.x - sHalfW
          newCz = tCz
        } else {
          newCx = tCx
          newCz = dz > 0 ? tBox.max.z + sHalfD : tBox.min.z - sHalfD
        }

        const srcD = sourceItem.data
        let sOffX = 0.5, sOffZ = 0.5
        if (sourceItem.kind === 'building') {
          sOffX = (srcD as BuildingPlacement).widthCells / 2
          sOffZ = (srcD as BuildingPlacement).depthCells / 2
        } else if (sourceItem.kind === 'road') {
          sOffX = 1; sOffZ = 1
        }

        const newX = Math.round(newCx - sOffX)
        const newZ = Math.round(newCz - sOffZ)

        callback(newX, newZ)
        this.renderer.domElement.style.cursor = ''
        if (statusTool) statusTool.textContent = getLocale() === 'en' ? 'Select mode' : '选择模式'
        return
      }

      this.renderer.domElement.style.cursor = ''
      if (statusTool) statusTool.textContent = getLocale() === 'en' ? 'Select mode' : '选择模式'
    }

    this.renderer.domElement.addEventListener('click', handler, { once: true, capture: true })
  }

  /* ── Custom asset store ── */

  setCustomStore(store: CustomAssetStore): void {
    this.customStore = store
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer
  }

  getAssets(): EditorAssetLoader {
    return this.assets
  }

  /* ── Rebuild all ── */

  fullRebuild(): void {
    this.buildGround()
    this.rebuildModels()
    const { cols, rows } = this.editor.config.grid
    this.orthoCamera.position.set(cols / 2, 40, rows / 2 + 15)
    this.orthoCamera.lookAt(cols / 2, 0, rows / 2)
    this.updateCameraFrustum()
  }

  /* ── Marquee selection ── */

  private getItemsInMarquee(x1: number, y1: number, x2: number, y2: number): PlacedItem[] {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const minSx = (Math.min(x1, x2) - rect.left) / rect.width * 2 - 1
    const maxSx = (Math.max(x1, x2) - rect.left) / rect.width * 2 - 1
    const minSy = -((Math.max(y1, y2) - rect.top) / rect.height * 2 - 1)
    const maxSy = -((Math.min(y1, y2) - rect.top) / rect.height * 2 - 1)

    const result: PlacedItem[] = []
    const config = this.editor.config

    const testItem = (item: PlacedItem) => {
      const model = this.modelMap.get(item.data.id)
      if (!model) return
      const pos = new THREE.Vector3()
      model.getWorldPosition(pos)
      pos.project(this.activeCamera)
      if (pos.x >= minSx && pos.x <= maxSx && pos.y >= minSy && pos.y <= maxSy) {
        result.push(item)
      }
    }

    for (const b of config.buildings) testItem({ kind: 'building', data: b })
    for (const p of config.props) testItem({ kind: 'prop', data: p })
    for (const r of config.roads) testItem({ kind: 'road', data: r })

    return result
  }

  /* ── Alignment & Distribution ── */

  private getItemBounds(item: PlacedItem): THREE.Box3 {
    const model = this.modelMap.get(item.data.id)
    if (model) return new THREE.Box3().setFromObject(model)
    return new THREE.Box3(
      new THREE.Vector3(item.data.gridX, 0, item.data.gridZ),
      new THREE.Vector3(item.data.gridX + 1, 1, item.data.gridZ + 1)
    )
  }

  alignItems(items: PlacedItem[], axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max'): void {
    if (items.length < 2) return
    const bounds = items.map(it => ({ item: it, box: this.getItemBounds(it) }))

    let target: number
    if (axis === 'x') {
      if (mode === 'min') target = Math.min(...bounds.map(b => b.box.min.x))
      else if (mode === 'max') target = Math.max(...bounds.map(b => b.box.max.x))
      else target = bounds.reduce((s, b) => s + (b.box.min.x + b.box.max.x) / 2, 0) / bounds.length
    } else if (axis === 'y') {
      if (mode === 'min') target = Math.min(...bounds.map(b => b.box.min.z))
      else if (mode === 'max') target = Math.max(...bounds.map(b => b.box.max.z))
      else target = bounds.reduce((s, b) => s + (b.box.min.z + b.box.max.z) / 2, 0) / bounds.length
    } else {
      const elevOf = (it: PlacedItem) => (it.data as { elevation?: number }).elevation ?? 0
      if (mode === 'min') target = Math.min(...items.map(elevOf))
      else if (mode === 'max') target = Math.max(...items.map(elevOf))
      else target = items.reduce((s, it) => s + elevOf(it), 0) / items.length
      const prevs = items.map(it => elevOf(it))
      const scene = this
      const cmd: Command = {
        execute: () => {
          for (const it of items) {
            (it.data as { elevation?: number }).elevation = Math.round(target * 10) / 10 || undefined
            scene.updateModelTransform(it)
          }
          scene.setSelection(items)
        },
        undo: () => {
          items.forEach((it, i) => {
            (it.data as { elevation?: number }).elevation = prevs[i] || undefined
            scene.updateModelTransform(it)
          })
          scene.setSelection(items)
        },
      }
      this.editor.undoStack.push(cmd)
      return
    }

    const prevPositions = items.map(it => ({ x: it.data.gridX, z: it.data.gridZ }))
    const scene = this

    const cmd: Command = {
      execute: () => {
        for (const b of bounds) {
          const it = b.item
          if (axis === 'x') {
            const center = (b.box.min.x + b.box.max.x) / 2
            const halfW = (b.box.max.x - b.box.min.x) / 2
            let newCenter: number
            if (mode === 'min') newCenter = target + halfW
            else if (mode === 'max') newCenter = target - halfW
            else newCenter = target
            it.data.gridX = Math.round(it.data.gridX + (newCenter - center))
          } else {
            const center = (b.box.min.z + b.box.max.z) / 2
            const halfD = (b.box.max.z - b.box.min.z) / 2
            let newCenter: number
            if (mode === 'min') newCenter = target + halfD
            else if (mode === 'max') newCenter = target - halfD
            else newCenter = target
            it.data.gridZ = Math.round(it.data.gridZ + (newCenter - center))
          }
          scene.updateModelTransform(it)
        }
        scene.setSelection(items)
      },
      undo: () => {
        items.forEach((it, i) => {
          it.data.gridX = prevPositions[i].x
          it.data.gridZ = prevPositions[i].z
          scene.updateModelTransform(it)
        })
        scene.setSelection(items)
      },
    }
    this.editor.undoStack.push(cmd)
  }

  distributeItems(items: PlacedItem[], axis: 'x' | 'y' | 'z'): void {
    if (items.length < 3) return
    const bounds = items.map(it => ({ item: it, box: this.getItemBounds(it) }))

    if (axis === 'z') {
      const elevOf = (it: PlacedItem) => (it.data as { elevation?: number }).elevation ?? 0
      const sorted = [...items].sort((a, b) => elevOf(a) - elevOf(b))
      const first = elevOf(sorted[0])
      const last = elevOf(sorted[sorted.length - 1])
      const step = (last - first) / (sorted.length - 1)
      const prevs = sorted.map(it => elevOf(it))
      const scene = this
      const cmd: Command = {
        execute: () => {
          sorted.forEach((it, i) => {
            (it.data as { elevation?: number }).elevation = Math.round((first + step * i) * 10) / 10 || undefined
            scene.updateModelTransform(it)
          })
          scene.setSelection(items)
        },
        undo: () => {
          sorted.forEach((it, i) => {
            (it.data as { elevation?: number }).elevation = prevs[i] || undefined
            scene.updateModelTransform(it)
          })
          scene.setSelection(items)
        },
      }
      this.editor.undoStack.push(cmd)
      return
    }

    const key = axis === 'x' ? 'x' : 'z'
    const sorted = [...bounds].sort((a, b) => a.box.min[key] - b.box.min[key])

    const totalSpan = sorted[sorted.length - 1].box.max[key] - sorted[0].box.min[key]
    const totalItemSize = sorted.reduce((sum, b) => sum + (b.box.max[key] - b.box.min[key]), 0)
    const gap = (totalSpan - totalItemSize) / (sorted.length - 1)

    const prevPositions = sorted.map(b => ({ x: b.item.data.gridX, z: b.item.data.gridZ }))
    const scene = this

    const cmd: Command = {
      execute: () => {
        let cursor = sorted[0].box.min[key]
        sorted.forEach((b, i) => {
          if (i === 0) {
            cursor += (b.box.max[key] - b.box.min[key]) + gap
            return
          }
          if (i === sorted.length - 1) return
          const itemSize = b.box.max[key] - b.box.min[key]
          const newMin = cursor
          const newCenter = newMin + itemSize / 2
          const currentCenter = (b.box.min[key] + b.box.max[key]) / 2
          const gridVal = axis === 'x' ? b.item.data.gridX : b.item.data.gridZ
          const offset = gridVal - currentCenter
          const newGridVal = Math.round(newCenter + offset)
          if (axis === 'x') b.item.data.gridX = newGridVal
          else b.item.data.gridZ = newGridVal
          scene.updateModelTransform(b.item)
          const actualCenter = newGridVal - offset
          cursor = (actualCenter - itemSize / 2) + itemSize + gap
        })
        scene.setSelection(items)
      },
      undo: () => {
        sorted.forEach((b, i) => {
          b.item.data.gridX = prevPositions[i].x
          b.item.data.gridZ = prevPositions[i].z
          scene.updateModelTransform(b.item)
        })
        scene.setSelection(items)
      },
    }
    this.editor.undoStack.push(cmd)
  }

  /* ── Groups ── */

  findGroupForItem(itemId: string): GroupDef | null {
    return this.editor.config.groups.find(g => g.memberIds.includes(itemId)) ?? null
  }

  getGroupItems(group: GroupDef): PlacedItem[] {
    const config = this.editor.config
    const result: PlacedItem[] = []
    for (const id of group.memberIds) {
      const b = config.buildings.find(x => x.id === id)
      if (b) { result.push({ kind: 'building', data: b }); continue }
      const p = config.props.find(x => x.id === id)
      if (p) { result.push({ kind: 'prop', data: p }); continue }
      const r = config.roads.find(x => x.id === id)
      if (r) { result.push({ kind: 'road', data: r }); continue }
    }
    return result
  }

  createGroup(items: PlacedItem[]): void {
    if (items.length < 2) return
    const config = this.editor.config
    const memberIds = items.map(it => it.data.id)

    let sumX = 0, sumZ = 0
    for (const it of items) { sumX += it.data.gridX; sumZ += it.data.gridZ }
    const anchorX = Math.round(sumX / items.length)
    const anchorZ = Math.round(sumZ / items.length)

    const group: GroupDef = { id: genId('grp'), memberIds, anchorX, anchorZ }

    const cmd: Command = {
      execute: () => { config.groups.push(group) },
      undo: () => { config.groups = config.groups.filter(g => g.id !== group.id) },
    }
    this.editor.undoStack.push(cmd)
  }

  dissolveGroup(groupId: string): void {
    const config = this.editor.config
    const group = config.groups.find(g => g.id === groupId)
    if (!group) return

    const snapshot = { ...group, memberIds: [...group.memberIds] }
    const cmd: Command = {
      execute: () => { config.groups = config.groups.filter(g => g.id !== groupId) },
      undo: () => { config.groups.push(snapshot) },
    }
    this.editor.undoStack.push(cmd)
    this.isInsideGroup = false
    this.activeGroupId = null
  }

  enterGroup(groupId: string): void {
    this.isInsideGroup = true
    this.activeGroupId = groupId
  }

  exitGroup(): void {
    this.isInsideGroup = false
    this.activeGroupId = null
  }

  getGroupBounds(group: GroupDef): THREE.Box3 {
    const items = this.getGroupItems(group)
    const merged = new THREE.Box3()
    for (const it of items) merged.union(this.getItemBounds(it))
    return merged
  }

  /* ── Rebuild helper for undo ── */

  rebuildSingleModel(item: PlacedItem): void {
    if (item.kind === 'building') this.addModelForBuilding(item.data as BuildingPlacement)
    else if (item.kind === 'prop') this.addModelForProp(item.data as PropPlacement)
    else this.addModelForRoad(item.data as RoadPlacement)
  }

  enterLightPlaceMode(item: PlacedItem, _lightType: import('./TownMapConfig').LightType, onPlaced: (offset: { x: number; y: number; z: number }) => void): void {
    const model = this.modelMap.get(item.data.id)
    if (!model) return

    const previewGeo = new THREE.SphereGeometry(0.15, 8, 8)
    const previewMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.7 })
    const previewSphere = new THREE.Mesh(previewGeo, previewMat)
    previewSphere.visible = false
    this.scene.add(previewSphere)

    this.container.style.cursor = 'crosshair'

    const onMove = (e: MouseEvent) => {
      e.stopPropagation()
      const rect = this.container.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)
      const intersects = this.raycaster.intersectObject(model, true)
      if (intersects.length > 0) {
        previewSphere.position.copy(intersects[0].point)
        previewSphere.visible = true
      } else {
        previewSphere.visible = false
      }
    }

    const onClick = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const rect = this.container.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)
      const intersects = this.raycaster.intersectObject(model, true)
      if (intersects.length > 0) {
        const localPos = model.worldToLocal(intersects[0].point.clone())
        onPlaced({ x: localPos.x, y: localPos.y, z: localPos.z })
        cleanup()
      }
    }

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup() }

    const cleanup = () => {
      this.scene.remove(previewSphere)
      previewGeo.dispose()
      previewMat.dispose()
      this.container.removeEventListener('mousemove', onMove)
      this.container.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      this.container.style.cursor = ''
    }

    this.container.addEventListener('mousemove', onMove)
    this.container.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
  }

  enterForwardMarkMode(item: PlacedItem, onMarked: (forwardAngle: number) => void): void {
    const model = this.modelMap.get(item.data.id)
    if (!model) return

    const previewGeo = new THREE.SphereGeometry(0.2, 8, 8)
    const previewMat = new THREE.MeshBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.7 })
    const previewSphere = new THREE.Mesh(previewGeo, previewMat)
    previewSphere.visible = false
    this.scene.add(previewSphere)

    const arrowGeo = new THREE.ConeGeometry(0.15, 0.5, 6)
    arrowGeo.rotateX(Math.PI / 2)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff4466, transparent: true, opacity: 0.6 })
    const arrow = new THREE.Mesh(arrowGeo, arrowMat)
    arrow.visible = false
    this.scene.add(arrow)

    this.container.style.cursor = 'crosshair'

    const statusEl = document.createElement('div')
    statusEl.style.cssText = 'position:absolute;bottom:110px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#ff4466;padding:8px 20px;border-radius:8px;font-size:13px;z-index:50;pointer-events:none;white-space:nowrap;border:1px solid rgba(255,68,102,0.3);backdrop-filter:blur(8px);'
    statusEl.textContent = getLocale() === 'en' ? 'Mark front · Click vehicle front · ESC cancel' : '标记前方 · 请点击模型的车头位置 · ESC 取消'
    this.container.appendChild(statusEl)

    const cx = model.position.x
    const cz = model.position.z

    const onMove = (e: MouseEvent) => {
      e.stopPropagation()
      const rect = this.container.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)
      const intersects = this.raycaster.intersectObject(model, true)
      if (intersects.length > 0) {
        const pt = intersects[0].point
        previewSphere.position.copy(pt)
        previewSphere.visible = true
        const midX = (cx + pt.x) / 2
        const midZ = (cz + pt.z) / 2
        arrow.position.set(midX, pt.y + 0.3, midZ)
        arrow.rotation.y = Math.atan2(pt.x - cx, pt.z - cz)
        arrow.visible = true
      } else {
        previewSphere.visible = false
        arrow.visible = false
      }
    }

    const onClick = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const rect = this.container.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)
      const intersects = this.raycaster.intersectObject(model, true)
      if (intersects.length > 0) {
        const pt = intersects[0].point
        const worldNoseAngle = Math.atan2(pt.x - cx, pt.z - cz)
        const fixRY = ((item.data as any).fixRotationY ?? 0) * Math.PI / 180
        const editorRotRad = ((item.data.rotationY ?? 0) * Math.PI) / 180 + fixRY
        const forwardAngle = worldNoseAngle - editorRotRad
        onMarked(forwardAngle)
        cleanup()
      }
    }

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup() }

    const cleanup = () => {
      this.scene.remove(previewSphere)
      this.scene.remove(arrow)
      previewGeo.dispose()
      previewMat.dispose()
      arrowGeo.dispose()
      arrowMat.dispose()
      statusEl.remove()
      this.container.removeEventListener('mousemove', onMove)
      this.container.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
      this.container.style.cursor = ''
    }

    this.container.addEventListener('mousemove', onMove)
    this.container.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
  }

  /* ── Route edit mode ── */

  enterRouteEditMode(item: PlacedItem, onComplete: (waypoints: Array<{x: number; z: number}>) => void): void {
    const d = item.data
    const existing: Array<{x: number; z: number}> = (d as any).vehicleRoute?.waypoints ?? []
    const waypoints: Array<{x: number; z: number}> = existing.length > 0 ? [...existing] : []

    const markerGeo = new THREE.SphereGeometry(0.25, 8, 8)
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.8 })
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00d4ff, linewidth: 2 })

    const markers: THREE.Mesh[] = []
    const lineGroup = new THREE.Group()
    lineGroup.name = 'route-edit-line'
    this.scene.add(lineGroup)

    const addMarker = (x: number, z: number) => {
      const m = new THREE.Mesh(markerGeo.clone(), markerMat.clone())
      m.position.set(x, 0.3, z)
      this.scene.add(m)
      markers.push(m)
    }

    const updateLine = () => {
      while (lineGroup.children.length > 0) {
        const c = lineGroup.children[0]
        lineGroup.remove(c)
        if ((c as THREE.Line).geometry) (c as THREE.Line).geometry.dispose()
      }
      if (waypoints.length < 2) return
      const pts = waypoints.map(w => new THREE.Vector3(w.x, 0.2, w.z))
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geo, lineMat)
      lineGroup.add(line)
    }

    for (const wp of waypoints) addMarker(wp.x, wp.z)
    updateLine()

    this.container.style.cursor = 'crosshair'

    const statusEl = document.createElement('div')
    statusEl.style.cssText = 'position:absolute;bottom:110px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#D4A574;padding:8px 20px;border-radius:8px;font-size:13px;z-index:50;pointer-events:none;white-space:nowrap;border:1px solid rgba(212,165,116,0.2);backdrop-filter:blur(8px);'
    statusEl.textContent = getLocale() === 'en' ? `Route edit · Click to add (${waypoints.length}) · Right/Enter done · ESC cancel` : `路线编辑 · 点击地面添加航点 (${waypoints.length} 个) · 右键/Enter 确认 · ESC 取消`
    this.container.appendChild(statusEl)

    const updateStatus = () => {
      statusEl.textContent = getLocale() === 'en' ? `Route edit · Click to add (${waypoints.length}) · Right/Enter done · ESC cancel` : `路线编辑 · 点击地面添加航点 (${waypoints.length} 个) · 右键/Enter 确认 · ESC 取消`
    }

    const previewMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.4 })
    )
    previewMarker.visible = false
    this.scene.add(previewMarker)

    const hitGround = (e: MouseEvent): THREE.Vector3 | null => {
      const rect = this.container.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.mouse, this.activeCamera)
      const hit = new THREE.Vector3()
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return hit
      return null
    }

    const onMove = (e: MouseEvent) => {
      e.stopPropagation()
      const hit = hitGround(e)
      if (hit) {
        previewMarker.position.set(hit.x, 0.3, hit.z)
        previewMarker.visible = true
      } else {
        previewMarker.visible = false
      }
    }

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      const hit = hitGround(e)
      if (hit) {
        const wp = { x: Math.round(hit.x * 10) / 10, z: Math.round(hit.z * 10) / 10 }
        waypoints.push(wp)
        addMarker(wp.x, wp.z)
        updateLine()
        updateStatus()
      }
    }

    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      confirm()
    }

    const confirm = () => {
      if (waypoints.length >= 2) {
        onComplete(waypoints)
      }
      cleanup()
    }

    const cancel = () => { cleanup() }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter') confirm()
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && waypoints.length > 0) {
        e.preventDefault()
        waypoints.pop()
        const lastMarker = markers.pop()
        if (lastMarker) {
          this.scene.remove(lastMarker)
          lastMarker.geometry.dispose()
          ;(lastMarker.material as THREE.Material).dispose()
        }
        updateLine()
        updateStatus()
      }
    }

    const cleanup = () => {
      for (const m of markers) {
        this.scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
      this.scene.remove(previewMarker)
      previewMarker.geometry.dispose()
      ;(previewMarker.material as THREE.Material).dispose()
      while (lineGroup.children.length > 0) {
        const c = lineGroup.children[0]
        lineGroup.remove(c)
        if ((c as THREE.Line).geometry) (c as THREE.Line).geometry.dispose()
      }
      this.scene.remove(lineGroup)
      lineMat.dispose()
      markerGeo.dispose()
      markerMat.dispose()
      statusEl.remove()
      this.container.removeEventListener('mousemove', onMove)
      this.container.removeEventListener('click', onClick)
      this.container.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey)
      this.container.style.cursor = ''
    }

    this.container.addEventListener('mousemove', onMove)
    this.container.addEventListener('click', onClick)
    this.container.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey)
  }

  /* ── Animation loop ── */

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    for (const box of this.selectionBoxes) box.update()
    this.renderer.render(this.scene, this.activeCamera)
  }
}
