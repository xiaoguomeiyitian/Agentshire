import * as THREE from 'three'
import { AssetLoader } from '../visual/AssetLoader'
import { ScreenRenderer } from './ScreenRenderer'
import { WhiteboardRenderer } from './WhiteboardRenderer'
import type { ScreenState } from '../../data/GameProtocol'

export interface Workstation {
  id: string
  position: THREE.Vector3
  deskMesh: THREE.Mesh
  monitorMesh: THREE.Mesh
  chairMesh: THREE.Mesh
  screenMaterial: THREE.MeshBasicMaterial
  screenRenderer: ScreenRenderer
}

export class OfficeBuilder {
  private scene: THREE.Scene
  private objects: THREE.Object3D[] = []
  public workstations: Workstation[] = []
  public visitorChairPos = new THREE.Vector3(5, 0, 21)
  public whiteboardPos = new THREE.Vector3(15, 1.5, 2)
  public doorPos = new THREE.Vector3(15, 0, 25)
  public whiteboard = new WhiteboardRenderer()
  public whiteboardMesh: THREE.Mesh | null = null

  constructor(scene: THREE.Scene) { this.scene = scene }

  /**
   * Return obstacle rectangles for office furniture (desks + visitor couch/table).
   * Each rectangle is in world coords with a small margin so NPCs slide around
   * furniture instead of walking through it. Used by MainScene to install a
   * scene-specific obstacle query when the office scene is active.
   */
  getObstacles(): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
    const obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = []
    // Issue 2: desk model is 2×1 scaled 1.2 → ~2.4×1.2 footprint. The chair
    // sits at z+1. We cover the desk + chair area with a small margin so
    // NPCs don't clip the desk edge. Previous margin 0.4 was too large and
    // caused NPCs to detour too far from desks.
    const deskW = 2.4, deskD = 2.2, margin = 0.2
    for (const ws of this.workstations) {
      const cx = ws.position.x
      // Desk center is at (x, z); chair at (x, z+1). Cover both.
      const cz = ws.position.z + 0.3
      obstacles.push({
        minX: cx - deskW / 2 - margin,
        maxX: cx + deskW / 2 + margin,
        minZ: cz - deskD / 2 - margin,
        maxZ: cz + deskD / 2 + margin,
      })
    }
    // Visitor area couch + low table (around x=3, z=21..23)
    obstacles.push({ minX: 1.9, maxX: 4.1, minZ: 20.4, maxZ: 23.6 })
    return obstacles
  }

  build(assets: AssetLoader): void {
    this.buildFloor()
    this.buildWalls()
    this.buildEquipment(assets)
    this.buildWorkstations(assets)
    this.buildVisitorArea(assets)
    this.buildStorage(assets)
    this.buildDecorations(assets)
    this.addLighting()
  }

  private add(obj: THREE.Object3D): void {
    this.scene.add(obj)
    this.objects.push(obj)
  }

  private box(
    w: number, h: number, d: number,
    color: number,
    x: number, y: number, z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color }),
    )
    mesh.position.set(x, y, z)
    this.add(mesh)
    return mesh
  }

  private placeModel(
    assets: AssetLoader,
    key: string,
    x: number, y: number, z: number,
    scale = 1.0,
    rotationY = 0,
  ): THREE.Group | null {
    const model = assets.getFurnitureModel(key)
    if (!model) return null
    model.position.set(x, y, z)
    model.scale.setScalar(scale)
    if (rotationY !== 0) model.rotation.y = rotationY
    this.add(model)
    return model
  }

  private buildFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 25),
      new THREE.MeshStandardMaterial({ color: 0xc4a882 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(15, 0, 12.5)
    this.add(floor)
  }

  private buildWalls(): void {
    const c = 0xf0ebe0
    const h = 3
    const t = 0.2

    this.box(30, h, t, c, 15, h / 2, 0)

    this.box(13.5, h, t, c, 6.75, h / 2, 25)
    this.box(13.5, h, t, c, 23.25, h / 2, 25)

    this.box(t, h, 25, c, 0, h / 2, 12.5)
    this.box(t, h, 25, c, 30, h / 2, 12.5)

    for (const wx of [5, 15, 25]) {
      this.box(2, 1.2, 0.05, 0x87ceeb, wx, 1.8, 0.15)
    }

    this.box(0.15, h, t, 0xb89068, 13.5, h / 2, 25)
    this.box(0.15, h, t, 0xb89068, 16.5, h / 2, 25)
    this.box(3, 0.15, t, 0xb89068, 15, h, 25)
  }

  private buildEquipment(assets: AssetLoader): void {
    if (!this.placeModel(assets, 'cabinet_medium', 25, 0, 1.5)) {
      this.box(1.2, 0.6, 0.8, 0x888888, 25, 0.3, 1.5)
      this.box(1.0, 0.1, 0.6, 0x444444, 25, 0.65, 1.5)
    }
    this.placeModel(assets, 'book_set', 25, 0.65, 1.5)
    this.placeModel(assets, 'book_single', 25.4, 0.65, 1.5)

    const wbMesh = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, 2.5, 0.1),
      new THREE.MeshBasicMaterial({ 
        map: this.whiteboard.getTexture(),
        color: 0xd0d0d0 // Multiply texture by 0.81 to stay strictly below bloom threshold (0.85)
      }),
    )
    wbMesh.position.set(15, 1.6, 0.25)
    this.add(wbMesh)
    this.whiteboardMesh = wbMesh
    // Top frame
    this.box(4.16, 0.08, 0.12, 0x444444, 15, 2.89, 0.25)
    // Bottom frame
    this.box(4.16, 0.08, 0.12, 0x444444, 15, 0.31, 0.25)
    // Left frame
    this.box(0.08, 2.5, 0.12, 0x444444, 12.96, 1.6, 0.25)
    // Right frame
    this.box(0.08, 2.5, 0.12, 0x444444, 17.04, 1.6, 0.25)

    if (!this.placeModel(assets, 'cactus_medium_A', 2, 0, 1.5, 2)) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 }),
      )
      pot.position.set(2, 0.2, 1.5)
      this.add(pot)
      const leaves = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x228b22 }),
      )
      leaves.position.set(2, 0.8, 1.5)
      this.add(leaves)
    }

    if (!this.placeModel(assets, 'cabinet_small', 28, 0, 1.5)) {
      this.box(1.2, 0.75, 0.6, 0xd4a56a, 28, 0.375, 1.5)
      this.box(0.5, 0.6, 0.4, 0x333333, 28, 1.05, 1.5)
      this.box(0.15, 0.08, 0.15, 0xcc3333, 28.15, 1.38, 1.35)
    }
  }

  static readonly CHAIR_SEAT_HEIGHT = 0.5

  private buildWorkstations(assets: AssetLoader): void {
    // Issue 3: reduced from 10 desks (2 rows × 5, 5-unit spacing) to 6 desks
    // (2 rows × 3, 8-unit spacing) so citizens have more room to navigate
    // without getting stuck between desks. 6 slots are enough for the default
    // 7-8 citizens (not all are working at once).
    const ids = ['A', 'B', 'C', 'D', 'E', 'F']
    const positions: [number, number][] = [
      [6, 8], [15, 8], [24, 8],
      [6, 17], [15, 17], [24, 17],
    ]

    for (let i = 0; i < ids.length; i++) {
      const [x, z] = positions[i]

      const deskModel = this.placeModel(assets, 'table_medium', x, 0, z, 1.2)
      let deskMesh: THREE.Mesh
      if (deskModel) {
        deskMesh = deskModel as unknown as THREE.Mesh
      } else {
        deskMesh = this.box(2, 0.8, 1, 0xd4a56a, x, 0.4, z)
      }

      this.box(0.4, 0.04, 0.25, 0x333333, x, 1.4, z - 0.3)
      this.box(0.08, 0.25, 0.08, 0x444444, x, 1.55, z - 0.3)

      const sr = new ScreenRenderer()
      const screenMaterial = new THREE.MeshBasicMaterial({ map: sr.getTexture() })
      const monitorMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.5, 0.05),
        screenMaterial,
      )
      monitorMesh.position.set(x, 1.8, z - 0.3)
      this.add(monitorMesh)

      this.box(0.84, 0.54, 0.04, 0x222222, x, 1.8, z - 0.32)

      const chairModel = this.placeModel(assets, 'chair_A', x, 0, z + 1)
      let chairMesh: THREE.Mesh
      if (chairModel) {
        chairMesh = chairModel as unknown as THREE.Mesh
      } else {
        chairMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12),
          new THREE.MeshStandardMaterial({ color: 0x333333 }),
        )
        chairMesh.position.set(x, 0.45, z + 1)
        this.add(chairMesh)
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 0.42, 6),
          new THREE.MeshStandardMaterial({ color: 0x555555 }),
        )
        leg.position.set(x, 0.21, z + 1)
        this.add(leg)
        this.box(0.5, 0.5, 0.06, 0x333333, x, 0.75, z + 1.28)
      }

      this.workstations.push({
        id: ids[i],
        position: new THREE.Vector3(x, 0, z + 1),
        deskMesh,
        monitorMesh,
        chairMesh,
        screenMaterial,
        screenRenderer: sr,
      })
    }
  }

  private buildVisitorArea(assets: AssetLoader): void {
    if (!this.placeModel(assets, 'couch_pillows', 3, 0, 23, 1.2, Math.PI)) {
      this.box(3, 0.45, 1, 0x4a6fa5, 3, 0.225, 23)
      this.box(3, 0.5, 0.2, 0x3a5f95, 3, 0.6, 22.5)
      this.box(0.2, 0.35, 1, 0x3a5f95, 1.6, 0.45, 23)
      this.box(0.2, 0.35, 1, 0x3a5f95, 4.4, 0.45, 23)
    }

    if (!this.placeModel(assets, 'table_low', 3, 0, 21)) {
      this.box(1.5, 0.05, 0.8, 0xd4a56a, 3, 0.38, 21)
      for (const dx of [-0.55, 0.55]) {
        for (const dz of [-0.25, 0.25]) {
          this.box(0.06, 0.35, 0.06, 0xb89068, 3 + dx, 0.175, 21 + dz)
        }
      }
    }

    if (!this.placeModel(assets, 'armchair_pillows', 5.5, 0, 21, 1, -Math.PI / 2)) {
      const seat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12),
        new THREE.MeshStandardMaterial({ color: 0x555555 }),
      )
      seat.position.set(5.5, 0.45, 21)
      this.add(seat)
    }
  }

  private buildStorage(_assets: AssetLoader): void {
  }

  private buildDecorations(assets: AssetLoader): void {
    this.placeModel(assets, 'lamp_standing', 1, 0, 24)
    this.placeModel(assets, 'lamp_standing', 29, 0, 24)

    this.placeModel(assets, 'rug_rectangle_A', 4, 0.01, 22, 2)

    this.placeModel(assets, 'pictureframe_large_A', 7, 1.5, 0.15, 1, 0)
    this.placeModel(assets, 'pictureframe_large_A', 22, 1.5, 0.15, 1, 0)

    this.placeModel(assets, 'shelf_A_big', 0.6, 0, 5, 1, Math.PI / 2)
    this.placeModel(assets, 'cabinet_medium_decorated', 0.6, 0, 8, 1, Math.PI / 2)
    this.placeModel(assets, 'cactus_small_A', 0.8, 0, 11, 1.5)
    this.placeModel(assets, 'lamp_standing', 0.8, 0, 14)
    this.placeModel(assets, 'pictureframe_medium', 0.15, 1.5, 6, 1, Math.PI / 2)
    this.placeModel(assets, 'pictureframe_medium', 0.15, 1.5, 13, 1, Math.PI / 2)

    this.placeModel(assets, 'cabinet_medium_decorated', 29.4, 0, 5, 1, -Math.PI / 2)
    this.placeModel(assets, 'book_set', 29.2, 0.65, 5.3)
    this.placeModel(assets, 'armchair', 29, 0, 12, 1, -Math.PI / 2)
    this.placeModel(assets, 'cactus_small_A', 29.2, 0, 15, 1.5)
    this.placeModel(assets, 'book_set', 29.3, 0.55, 5)
    this.placeModel(assets, 'pictureframe_large_B', 29.85, 1.5, 10, 1, -Math.PI / 2)
    this.placeModel(assets, 'pictureframe_medium', 29.85, 1.5, 15, 1, -Math.PI / 2)
  }

  private addLighting(): void {
    const ambient = new THREE.AmbientLight(0xfff5e8, 0.7)
    this.add(ambient)

    const light1 = new THREE.PointLight(0xfff5e8, 1.2, 30)
    light1.position.set(8, 2.8, 8)
    this.add(light1)

    const light2 = new THREE.PointLight(0xfff5e8, 1.2, 30)
    light2.position.set(20, 2.8, 8)
    this.add(light2)

    const light3 = new THREE.PointLight(0xfff5e8, 1.0, 30)
    light3.position.set(14, 2.8, 18)
    this.add(light3)
  }

  getWorkstation(id: string): Workstation | undefined {
    return this.workstations.find(w => w.id === id)
  }

  setScreenState(id: string, state: ScreenState | string): void {
    const ws = this.getWorkstation(id)
    if (!ws) return
    if (typeof state === 'string') {
      ws.screenRenderer.setState({ mode: state as ScreenState['mode'] } as ScreenState)
    } else {
      ws.screenRenderer.setState(state)
    }
  }

  updateScreens(dt: number): void {
    for (const ws of this.workstations) {
      ws.screenRenderer.update(dt)
    }
    this.whiteboard.update(dt)
  }

  clear(): void {
    this.whiteboard.dispose()
    for (const obj of this.objects) this.scene.remove(obj)
    this.objects = []
    this.workstations = []
  }
}
