import * as THREE from 'three'
import type { TownMapConfig } from './TownMapConfig'
import { EditorAssetLoader } from './EditorAssetLoader'

interface ActiveVehicle {
  model: THREE.Group
  waypoints: Array<{ x: number; z: number }>
  speed: number
  progress: number
  segmentIndex: number
  forward: boolean
  loop: boolean
  forwardAngle: number
  headlight: THREE.PointLight | null
  taillightMat: THREE.MeshBasicMaterial | null
}

export class PreviewVehicleManager {
  private scene: THREE.Scene
  private group = new THREE.Group()
  private vehicles: ActiveVehicle[] = []
  private assets: EditorAssetLoader

  constructor(scene: THREE.Scene, assets: EditorAssetLoader) {
    this.scene = scene
    this.assets = assets
    this.group.name = 'preview-vehicles'
    this.scene.add(this.group)
  }

  async buildFromConfig(config: TownMapConfig): Promise<void> {
    const vehicleProps = config.props.filter(p =>
      p.animated && p.vehicleRoute && p.vehicleRoute.waypoints.length >= 2
    )

    for (const prop of vehicleProps) {
      const url = prop.modelUrl
      if (!url) continue
      const rawModel = await this.assets.loadModel(url)
      if (!rawModel) continue

      const fixRX = (prop.fixRotationX ?? 0) * Math.PI / 180
      const fixRY = (prop.fixRotationY ?? 0) * Math.PI / 180
      const fixRZ = (prop.fixRotationZ ?? 0) * Math.PI / 180

      const model = new THREE.Group()
      if (fixRX || fixRY || fixRZ) {
        const pivot = new THREE.Group()
        pivot.rotation.set(fixRX, fixRY, fixRZ)
        while (rawModel.children.length > 0) pivot.add(rawModel.children[0])
        model.add(pivot)
      } else {
        while (rawModel.children.length > 0) model.add(rawModel.children[0])
      }

      const scale = prop.scale ?? 1
      model.scale.setScalar(scale)
      model.traverse(c => {
        if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true }
      })
      this.group.add(model)

      let headlight: THREE.PointLight | null = null
      let taillightMat: THREE.MeshBasicMaterial | null = null

      if (prop.lights) {
        for (const lp of prop.lights) {
          if (lp.type === 'vehicle_head') {
            headlight = new THREE.PointLight(lp.color, 0, lp.distance)
            headlight.position.set(lp.offsetX, lp.offsetY, lp.offsetZ)
            model.add(headlight)
          } else if (lp.type === 'vehicle_tail') {
            const geo = new THREE.PlaneGeometry(0.3, 0.15)
            taillightMat = new THREE.MeshBasicMaterial({ color: lp.color, transparent: true, opacity: 0 })
            const mesh = new THREE.Mesh(geo, taillightMat)
            mesh.position.set(lp.offsetX, lp.offsetY, lp.offsetZ)
            mesh.rotation.y = Math.PI
            model.add(mesh)
          }
        }
      }

      const route = prop.vehicleRoute!
      const speed = route.speedMin + Math.random() * (route.speedMax - route.speedMin)
      const wp = route.waypoints.map(w => ({
        x: w.x + (Math.random() - 0.5) * route.laneOffset * 2,
        z: w.z + (Math.random() - 0.5) * route.laneOffset * 2,
      }))

      model.position.set(wp[0].x, 0.06, wp[0].z)

      this.vehicles.push({
        model,
        waypoints: wp,
        speed,
        progress: 0,
        segmentIndex: 0,
        forward: true,
        loop: !!route.loop,
        forwardAngle: route.forwardAngle ?? 0,
        headlight,
        taillightMat,
      })
    }
  }

  update(hour: number, dt: number): void {
    const needLights = hour < 6 || hour > 17.5

    for (const v of this.vehicles) {
      if (v.waypoints.length < 2) continue

      const from = v.waypoints[v.segmentIndex]
      const nextIdx = v.loop
        ? (v.segmentIndex + 1) % v.waypoints.length
        : (v.forward ? v.segmentIndex + 1 : v.segmentIndex - 1)
      if (!v.loop && (nextIdx < 0 || nextIdx >= v.waypoints.length)) {
        v.forward = !v.forward
        continue
      }
      const to = v.waypoints[nextIdx]

      const dx = to.x - from.x
      const dz = to.z - from.z
      const segLen = Math.sqrt(dx * dx + dz * dz)
      if (segLen < 0.01) { v.segmentIndex = nextIdx; continue }

      v.progress += (v.speed * dt) / segLen
      if (v.progress >= 1) {
        v.progress = 0
        v.segmentIndex = nextIdx
        if (v.loop) {
          // loop: segmentIndex wraps around automatically via modulo above
        } else if ((v.forward && v.segmentIndex >= v.waypoints.length - 1) ||
            (!v.forward && v.segmentIndex <= 0)) {
          v.forward = !v.forward
        }
      }

      const x = from.x + dx * v.progress
      const z = from.z + dz * v.progress
      v.model.position.x = x
      v.model.position.z = z
      v.model.position.y = 0.06 + Math.sin(performance.now() / 1000 * 12) * 0.015
      v.model.rotation.y = Math.atan2(dx, dz) - v.forwardAngle

      if (v.headlight) v.headlight.intensity = needLights ? 1.5 : 0
      if (v.taillightMat) v.taillightMat.opacity = needLights ? 0.9 : 0
    }
  }

  dispose(): void {
    for (const v of this.vehicles) {
      v.model.traverse(c => {
        if ((c as THREE.Mesh).isMesh) {
          (c as THREE.Mesh).geometry.dispose()
          const mat = (c as THREE.Mesh).material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else (mat as THREE.Material).dispose()
        }
      })
    }
    this.vehicles = []
    this.scene.remove(this.group)
  }
}
