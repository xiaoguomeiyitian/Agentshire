import * as THREE from 'three'
import { AssetLoader } from '../visual/AssetLoader'

/**
 * HomeBuilder — a residential indoor scene variant.
 *
 * Issue 4: reuses the office scene's floor/wall structure but removes all
 * workstations (desks/monitors/chairs) and replaces them with home furniture
 * (bed, sofa, bookshelf, rug, lamp). This serves as the "inside a citizen's
 * home" scene when the mayor visits a residential building.
 *
 * The scene is intentionally simple (no per-house customization yet) — it's
 * a shared indoor template. Future work can vary decor per house key.
 */
export class HomeBuilder {
  private scene: THREE.Scene
  private objects: THREE.Object3D[] = []
  public doorPos = new THREE.Vector3(15, 0, 25)

  constructor(scene: THREE.Scene) { this.scene = scene }

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

  build(assets: AssetLoader): void {
    this.buildFloor()
    this.buildWalls()
    this.buildBedroom(assets)
    this.buildLivingArea(assets)
    this.buildDecorations(assets)
    this.addLighting()
  }

  /** Return obstacle rectangles for home furniture so NPCs avoid walking through them. */
  getObstacles(): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
    const obstacles: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = []
    const m = 0.2 // small margin; walkableRadius=0.8 in NavMesh handles agent body clearance
    // Bed (around x=5, z=6) — 2.5×3 scaled 1.2 → ~3×3.6
    obstacles.push({ minX: 3.5 - m, maxX: 6.5 + m, minZ: 4.5 - m, maxZ: 7.5 + m })
    // Nightstand (around x=8, z=5) — 0.8×0.6
    obstacles.push({ minX: 7.6 - m, maxX: 8.4 + m, minZ: 4.7 - m, maxZ: 5.3 + m })
    // Wardrobe (around x=2, z=10) — 1.2×0.6
    obstacles.push({ minX: 1.4 - m, maxX: 2.6 + m, minZ: 9.7 - m, maxZ: 10.3 + m })
    // Sofa (around x=15, z=18) — 4×1.2 scaled 1.2 → ~4.8×1.44
    obstacles.push({ minX: 12.6 - m, maxX: 17.4 + m, minZ: 17.3 - m, maxZ: 18.7 + m })
    // Coffee table (around x=15, z=15.5) — 1.8×0.9
    obstacles.push({ minX: 14.1 - m, maxX: 15.9 + m, minZ: 15.05 - m, maxZ: 15.95 + m })
    // TV stand (around x=22, z=20) — 1.5×0.5
    obstacles.push({ minX: 21.25 - m, maxX: 22.75 + m, minZ: 19.75 - m, maxZ: 20.25 + m })
    // Bookshelf (around x=25, z=2.5) — 2×0.4
    obstacles.push({ minX: 24 - m, maxX: 26 + m, minZ: 2.3 - m, maxZ: 2.7 + m })
    return obstacles
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
    const c = 0xf5ede0
    const h = 3
    const t = 0.2
    this.box(30, h, t, c, 15, h / 2, 0)
    this.box(30, h, t, c, 15, h / 2, 25)
    this.box(t, h, 25, c, 0, h / 2, 12.5)
    this.box(t, h, 25, c, 30, h / 2, 12.5)
    // Door gap on south wall (center)
    this.box(0.15, h, t, 0xb89068, 13.5, h / 2, 25)
    this.box(0.15, h, t, 0xb89068, 16.5, h / 2, 25)
    this.box(3, 0.15, t, 0xb89068, 15, h, 25)
    // Windows on north wall
    for (const wx of [5, 15, 25]) {
      this.box(2, 1.2, 0.05, 0x87ceeb, wx, 1.8, 0.15)
    }
  }

  private buildBedroom(assets: AssetLoader): void {
    // Bed (left side of the room)
    if (!this.placeModel(assets, 'bed_single', 5, 0, 6, 1.2)) {
      // Fallback: simple bed frame + mattress
      this.box(2.5, 0.4, 3, 0x8b6f47, 5, 0.2, 6)
      this.box(2.4, 0.2, 2.8, 0xf0f0f0, 5, 0.5, 6)
      this.box(0.8, 0.15, 0.5, 0xdddddd, 5, 0.65, 4.7)
    }
    // Nightstand
    if (!this.placeModel(assets, 'cabinet_small', 8, 0, 5)) {
      this.box(0.8, 0.6, 0.6, 0xd4a56a, 8, 0.3, 5)
    }
    // Wardrobe
    if (!this.placeModel(assets, 'cabinet_medium', 2, 0, 10, 1, Math.PI / 2)) {
      this.box(1.2, 2, 0.6, 0x8b6f47, 2, 1, 10)
    }
  }

  private buildLivingArea(assets: AssetLoader): void {
    // Sofa (center)
    if (!this.placeModel(assets, 'couch_pillows', 15, 0, 18, 1.2, 0)) {
      this.box(4, 0.45, 1.2, 0x4a6fa5, 15, 0.225, 18)
      this.box(4, 0.5, 0.2, 0x3a5f95, 15, 0.6, 17.5)
      this.box(0.2, 0.35, 1.2, 0x3a5f95, 13.2, 0.45, 18)
      this.box(0.2, 0.35, 1.2, 0x3a5f95, 16.8, 0.45, 18)
    }
    // Coffee table
    if (!this.placeModel(assets, 'table_low', 15, 0, 15.5)) {
      this.box(1.8, 0.05, 0.9, 0xd4a56a, 15, 0.38, 15.5)
      for (const dx of [-0.7, 0.7]) {
        for (const dz of [-0.3, 0.3]) {
          this.box(0.06, 0.35, 0.06, 0xb89068, 15 + dx, 0.175, 15.5 + dz)
        }
      }
    }
    // Rug
    this.placeModel(assets, 'rug_rectangle_A', 15, 0.01, 16, 2)
    // TV stand
    if (!this.placeModel(assets, 'cabinet_small', 22, 0, 20)) {
      this.box(1.5, 0.5, 0.5, 0x555555, 22, 0.25, 20)
    }
    // TV
    this.box(1.4, 0.8, 0.08, 0x222222, 22, 1.2, 19.9)
  }

  private buildDecorations(assets: AssetLoader): void {
    // Bookshelf (right side)
    if (!this.placeModel(assets, 'shelf_A_big', 25, 0, 2.5, 1, 0)) {
      this.box(2, 2.2, 0.4, 0x8b6f47, 25, 1.1, 2.5)
    }
    this.placeModel(assets, 'book_set', 25, 0.8, 2.5)
    this.placeModel(assets, 'book_single', 25, 1.3, 2.5)
    // Issue 1: removed lamp_standing near the door (x=1, z=24 and x=29, z=24)
    // — they blocked the entry path and caused NPCs to get stuck. The door
    // is at (15, 0, 25); lamps at z=24 were right in the walkway.
    // Cactus moved away from the central walk path (was at x=28, z=12)
    if (!this.placeModel(assets, 'cactus_small_A', 28, 0, 22, 1.5)) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.3, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 }),
      )
      pot.position.set(28, 0.2, 22)
      this.add(pot)
    }
    // Picture frames (on walls, no collision)
    this.placeModel(assets, 'pictureframe_large_A', 7, 1.5, 0.15, 1, 0)
    this.placeModel(assets, 'pictureframe_large_A', 22, 1.5, 0.15, 1, 0)
  }

  private addLighting(): void {
    const ambient = new THREE.AmbientLight(0xfff5e8, 0.8)
    this.add(ambient)
    const lamp = new THREE.PointLight(0xffe4b5, 0.6, 20)
    lamp.position.set(15, 2.8, 12.5)
    this.add(lamp)
  }

  /** Clear all objects (for scene rebuild). */
  clear(): void {
    for (const obj of this.objects) {
      this.scene.remove(obj)
    }
    this.objects = []
  }
}
