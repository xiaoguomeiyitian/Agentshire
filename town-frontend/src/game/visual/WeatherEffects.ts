import * as THREE from 'three'
import type { PerformanceProfile } from '../../engine/Performance'

// ── Interpolated state passed from WeatherSystem ──

export interface WeatherVisualState {
  rain: number        // 0–1
  snow: number        // 0–1
  dust: number        // 0–1
  lightning: number   // 0–1 (frequency)
  aurora: number      // 0–1
  windX: number
  windZ: number
  fogDensityAdd: number
  groundFog: number   // 0–1
  snowGround: number  // 0–1
}

// ── Particle budget per profile ──

const RAIN_COUNT:  Record<PerformanceProfile, number> = { low: 8000, medium: 8000, high: 25000 }
const SNOW_COUNT:  Record<PerformanceProfile, number> = { low: 4000, medium: 4000, high: 12000 }
const DUST_COUNT:  Record<PerformanceProfile, number> = { low: 3000, medium: 3000, high: 10000 }
const SPLASH_COUNT: Record<PerformanceProfile, number> = { low: 80, medium: 80, high: 200 }

// ── Rain: LineSegments + vertex shader animation (zero CPU per-particle loop) ──

const RAIN_VERT = /* glsl */ `
attribute vec2 aRandom;
uniform float time;
uniform float intensity;
uniform vec3  windForce;
uniform float spawnHeight;
uniform float spawnRadius;
uniform float dropLength;
varying float vAlpha;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float seed = aRandom.x;
  float phase = aRandom.y;
  float vertIdx = mod(float(gl_VertexID), 2.0);
  vec3 pos = position;
  float fallSpeed = -15.0 * (0.8 + seed * 0.4);
  float t = time + phase * 10.0;
  pos.y = mod(pos.y + fallSpeed * t, spawnHeight);
  float fallProgress = 1.0 - pos.y / spawnHeight;
  pos.x += windForce.x * fallProgress * 0.5;
  pos.z += windForce.z * fallProgress * 0.5;
  pos.x = mod(pos.x + spawnRadius, spawnRadius * 2.0) - spawnRadius;
  pos.z = mod(pos.z + spawnRadius, spawnRadius * 2.0) - spawnRadius;
  if (vertIdx > 0.5) {
    float stretch = dropLength * (1.0 + length(windForce) * 0.05);
    pos.y -= stretch;
    pos.x += windForce.x * 0.01;
  }
  vAlpha = step(seed, intensity) * 0.35;
  float dist = length(pos.xz);
  vAlpha *= smoothstep(spawnRadius, spawnRadius * 0.6, dist);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const RAIN_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(0.7, 0.75, 0.9, vAlpha);
}
`

// ── Snow: Points + flutter + sparkle ──

const SNOW_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float time;
uniform float intensity;
uniform vec3  windForce;
uniform float spawnHeight;
uniform float spawnRadius;
uniform float flutterAmp;
uniform float pointSize;
varying float vAlpha;
varying float vSize;
varying float vSeed;

void main() {
  float seed = aSeed.x;
  float phase = aSeed.y;
  float sizeVar = aSeed.z;
  vec3 pos = position;
  float fallSpeed = -1.5 * (0.6 + seed * 0.8);
  float t = time + phase * 8.0;
  pos.y = mod(pos.y + fallSpeed * t, spawnHeight);
  float flutter = sin(t * (1.5 + seed * 2.0) + phase) * flutterAmp;
  float flutter2 = cos(t * (1.0 + seed * 1.5) + phase * 2.0) * flutterAmp * 0.7;
  pos.x += flutter + windForce.x * (1.0 - pos.y / spawnHeight) * 0.8;
  pos.z += flutter2 + windForce.z * (1.0 - pos.y / spawnHeight) * 0.8;
  pos.x = mod(pos.x + spawnRadius, spawnRadius * 2.0) - spawnRadius;
  pos.z = mod(pos.z + spawnRadius, spawnRadius * 2.0) - spawnRadius;
  vAlpha = step(seed, intensity) * 0.8;
  float dist = length(pos.xz);
  vAlpha *= smoothstep(spawnRadius, spawnRadius * 0.5, dist);
  vSize = sizeVar;
  vSeed = seed;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = clamp(pointSize * sizeVar * (160.0 / -mvPos.z), 1.5, 24.0);
}
`

const SNOW_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
varying float vSize;
varying float vSeed;

void main() {
  if (vAlpha < 0.01) discard;
  vec2 center = gl_PointCoord - 0.5;
  float d = length(center);
  float circle = smoothstep(0.5, 0.15, d);

  float shape = circle;
  // ~10% of flakes become ❄️ six-pointed stars
  if (vSeed > 0.7) {
    float angle = atan(center.y, center.x);
    float arms = abs(sin(angle * 3.0));
    float star = smoothstep(0.48, 0.12, d - arms * 0.2);
    shape = star;
  }

  if (shape < 0.05) discard;
  float sparkle = max(sin(d * 30.0 + vSize * 12.0) * 0.1, 0.0);
  gl_FragColor = vec4(0.95 + sparkle, 0.97 + sparkle, 1.0, shape * vAlpha);
}
`

// ── Dust / Sandstorm: Points + swirl ──

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float time;
uniform vec3  windForce;
uniform float pointSize;
uniform float intensity;
varying float vAlpha;

void main() {
  vec3 pos = position;
  float t = time + aSeed * 20.0;
  pos.x += windForce.x * t * 0.3 + sin(t * 2.0 + aSeed * 6.28) * 2.0;
  pos.z += windForce.z * t * 0.3 + cos(t * 1.5 + aSeed * 6.28) * 2.0;
  pos.y += sin(t * 3.0 + aSeed * 10.0) * 1.5;
  float r = 40.0;
  pos.x = mod(pos.x + r, r * 2.0) - r;
  pos.z = mod(pos.z + r, r * 2.0) - r;
  pos.y = mod(pos.y, 15.0);
  vAlpha = step(aSeed, intensity) * (0.2 + aSeed * 0.2);
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPos;
  gl_PointSize = clamp(pointSize * (80.0 / -mvPos.z), 1.0, 8.0);
}
`

const DUST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 dustColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float alpha = smoothstep(0.5, 0.2, d);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(dustColor, alpha * vAlpha);
}
`

// ── Splash (reused from before) ──

const SPLASH_VERT = /* glsl */ `
attribute float size;
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * (80.0 / -mvPos.z), 1.0, 14.0);
  gl_Position = projectionMatrix * mvPos;
}
`

const SPLASH_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float ring = 1.0 - smoothstep(0.3, 0.5, d);
  ring *= smoothstep(0.1, 0.25, d);
  if (ring < 0.05) discard;
  gl_FragColor = vec4(0.8, 0.85, 0.9, vAlpha * ring * 0.5);
}
`

// ── Splash particle data ──

// ── Aurora: displaced curtain plane ──

const AURORA_VERT = /* glsl */ `
uniform float time;
uniform float intensity;
varying vec2 vUv;
varying float vIntensity;

void main() {
  vUv = uv;
  vec3 pos = position;

  float wave1 = sin(pos.x * 0.02 + time * 0.3) * 8.0;
  float wave2 = sin(pos.x * 0.05 + time * 0.7) * 3.0;
  float wave3 = cos(pos.x * 0.03 + time * 0.15) * 5.0;
  pos.y += wave1 + wave2;
  pos.z += wave3;

  float ruffle = sin(pos.x * 0.1 + time * 1.5) * 2.0 * uv.y;
  pos.z += ruffle;

  vIntensity = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.6, uv.y);
  vIntensity *= (0.5 + 0.5 * sin(pos.x * 0.03 + time * 0.2)) * intensity;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const AURORA_FRAG = /* glsl */ `
precision highp float;
uniform vec3 color1;
uniform vec3 color2;
uniform vec3 color3;
varying vec2 vUv;
varying float vIntensity;

void main() {
  vec3 col;
  if (vUv.y < 0.4) {
    col = mix(color2, color1, vUv.y / 0.4);
  } else if (vUv.y < 0.7) {
    col = mix(color1, color3, (vUv.y - 0.4) / 0.3);
  } else {
    col = mix(color3, color2, (vUv.y - 0.7) / 0.3);
  }

  float hVar = sin(vUv.x * 20.0) * 0.1 + 0.9;
  float alpha = vIntensity * hVar;
  alpha *= smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * 1.5, alpha * 0.6);
}
`

interface SplashParticle { life: number; maxLife: number; x: number; z: number }

export class WeatherEffects {
  private scene: THREE.Scene
  private enabled = true
  private time = 0

  // Rain (LineSegments, GPU-animated)
  private rainMesh: THREE.LineSegments | null = null
  private rainMaterial: THREE.ShaderMaterial | null = null

  // Snow (Points, GPU-animated)
  private snowMesh: THREE.Points | null = null
  private snowMaterial: THREE.ShaderMaterial | null = null

  // Dust (Points, GPU-animated)
  private dustMesh: THREE.Points | null = null
  private dustMaterial: THREE.ShaderMaterial | null = null

  // Splash (CPU ring-buffer)
  private splashMesh: THREE.Points | null = null
  private splashPositions: Float32Array | null = null
  private splashSizes: Float32Array | null = null
  private splashAlphas: Float32Array | null = null
  private splashParticles: SplashParticle[] = []
  private splashCount: number

  // Snow ground cover
  private snowGround: THREE.Mesh | null = null
  private snowGroundOpacity = 0

  // Ground fog plane
  private fogPlane: THREE.Mesh | null = null

  // Aurora curtain
  private auroraMesh: THREE.Mesh | null = null
  private auroraMaterial: THREE.ShaderMaterial | null = null

  private readonly RADIUS = 40
  private readonly SPAWN_HEIGHT = 30

  constructor(scene: THREE.Scene, _camera: THREE.Camera, profile: PerformanceProfile) {
    this.scene = scene
    this.splashCount = SPLASH_COUNT[profile]

    if (RAIN_COUNT[profile] > 0) this.initRain(RAIN_COUNT[profile])
    if (SNOW_COUNT[profile] > 0) this.initSnow(SNOW_COUNT[profile])
    if (DUST_COUNT[profile] > 0) this.initDust(DUST_COUNT[profile])
    if (this.splashCount > 0) this.initSplash()
    this.initSnowGround()
    this.initFogPlane()
    this.initAurora()
  }

  // ── Init methods ──

  private initRain(count: number): void {
    const R = this.RADIUS, H = this.SPAWN_HEIGHT
    const vertexCount = count * 2
    const positions = new Float32Array(vertexCount * 3)
    const randoms = new Float32Array(vertexCount * 2)
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * R * 2
      const y = Math.random() * H
      const z = (Math.random() - 0.5) * R * 2
      const seed = Math.random(), phase = Math.random()
      // Top vertex
      positions[i * 6] = x;     positions[i * 6 + 1] = y;       positions[i * 6 + 2] = z
      // Bottom vertex
      positions[i * 6 + 3] = x; positions[i * 6 + 4] = y - 0.3; positions[i * 6 + 5] = z
      // Same random for both vertices of the same drop
      randoms[i * 4]     = seed; randoms[i * 4 + 1] = phase
      randoms[i * 4 + 2] = seed; randoms[i * 4 + 3] = phase
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 2))

    this.rainMaterial = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 }, intensity: { value: 0 },
        windForce: { value: new THREE.Vector3(5, 0, 2) },
        spawnHeight: { value: H }, spawnRadius: { value: R }, dropLength: { value: 0.3 },
      },
    })
    this.rainMesh = new THREE.LineSegments(geo, this.rainMaterial)
    this.rainMesh.frustumCulled = false
    this.rainMesh.visible = false
    this.scene.add(this.rainMesh)
  }

  private initSnow(count: number): void {
    const R = this.RADIUS, H = 25
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * R * 2
      positions[i * 3 + 1] = Math.random() * H
      positions[i * 3 + 2] = (Math.random() - 0.5) * R * 2
      seeds[i * 3] = Math.random()
      seeds[i * 3 + 1] = Math.random() * Math.PI * 2
      seeds[i * 3 + 2] = 0.4 + Math.random() * 1.0
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))

    this.snowMaterial = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        time: { value: 0 }, intensity: { value: 0 },
        windForce: { value: new THREE.Vector3(1, 0, 0.5) },
        spawnHeight: { value: H }, spawnRadius: { value: R },
        flutterAmp: { value: 2.0 }, pointSize: { value: 3.0 },
      },
    })
    this.snowMesh = new THREE.Points(geo, this.snowMaterial)
    this.snowMesh.frustumCulled = false
    this.snowMesh.visible = false
    this.scene.add(this.snowMesh)
  }

  private initDust(count: number): void {
    const positions = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80
      positions[i * 3 + 1] = Math.random() * 15
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80
      seeds[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        time: { value: 0 }, intensity: { value: 0 },
        dustColor: { value: new THREE.Color(0xc4a060) },
        windForce: { value: new THREE.Vector3(8, 0, 2) },
        pointSize: { value: 3.0 },
      },
    })
    this.dustMesh = new THREE.Points(geo, this.dustMaterial)
    this.dustMesh.frustumCulled = false
    this.dustMesh.visible = false
    this.scene.add(this.dustMesh)
  }

  private initSplash(): void {
    const count = this.splashCount
    this.splashPositions = new Float32Array(count * 3)
    this.splashSizes = new Float32Array(count)
    this.splashAlphas = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.splashParticles.push({ life: 0, maxLife: 0, x: 0, z: 0 })
      this.splashPositions[i * 3 + 1] = -1000
      this.splashAlphas[i] = 0; this.splashSizes[i] = 2.0
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(this.splashSizes, 1))
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.splashAlphas, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
      transparent: true, depthWrite: false,
    })
    this.splashMesh = new THREE.Points(geo, mat)
    this.splashMesh.frustumCulled = false
    this.splashMesh.visible = false
    this.scene.add(this.splashMesh)
  }

  private initSnowGround(): void {
    const geo = new THREE.PlaneGeometry(60, 40)
    const mat = new THREE.MeshBasicMaterial({ color: 0xf0f4fa, transparent: true, opacity: 0, depthWrite: false })
    this.snowGround = new THREE.Mesh(geo, mat)
    this.snowGround.rotation.x = -Math.PI / 2
    this.snowGround.position.set(18, 0.03, 12)
    this.snowGround.visible = false
    this.scene.add(this.snowGround)
  }

  private initFogPlane(): void {
    const geo = new THREE.PlaneGeometry(100, 60, 1, 1)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcccccc, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    })
    this.fogPlane = new THREE.Mesh(geo, mat)
    this.fogPlane.rotation.x = -Math.PI / 2
    this.fogPlane.position.set(18, 1.5, 12)
    this.fogPlane.visible = false
    this.scene.add(this.fogPlane)
  }

  private initAurora(): void {
    const geo = new THREE.PlaneGeometry(200, 25, 96, 12)
    this.auroraMaterial = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 },
        intensity: { value: 0 },
        color1: { value: new THREE.Color(0x00ff88) },
        color2: { value: new THREE.Color(0x4400ff) },
        color3: { value: new THREE.Color(0xff0066) },
      },
    })
    this.auroraMesh = new THREE.Mesh(geo, this.auroraMaterial)
    this.auroraMesh.position.set(18, 12, -15)
    this.auroraMesh.rotation.x = -0.15
    this.auroraMesh.visible = false
    this.scene.add(this.auroraMesh)
  }

  // ── Public API ──

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.hideAll()
  }

  updateVisuals(dt: number, camera: THREE.Camera, state: WeatherVisualState): void {
    if (!this.enabled) return
    this.time += dt
    const cx = camera.position.x, cz = camera.position.z

    // Rain
    if (this.rainMesh && this.rainMaterial) {
      const visible = state.rain > 0.01
      this.rainMesh.visible = visible
      if (visible) {
        this.rainMesh.position.set(cx, 0, cz)
        const u = this.rainMaterial.uniforms
        u.time.value = this.time
        u.intensity.value = state.rain
        u.windForce.value.set(state.windX, 0, state.windZ)
        u.dropLength.value = 0.15 + state.rain * 0.35
      }
    }

    // Snow
    if (this.snowMesh && this.snowMaterial) {
      const visible = state.snow > 0.01
      this.snowMesh.visible = visible
      if (visible) {
        this.snowMesh.position.set(cx, 0, cz)
        const u = this.snowMaterial.uniforms
        u.time.value = this.time
        u.intensity.value = state.snow
        u.windForce.value.set(state.windX * 2, 0, state.windZ * 1)
        u.flutterAmp.value = 2.0 - state.snow * 1.5
        u.pointSize.value = 1.5 + state.snow * 3.5
      }
    }

    // Dust
    if (this.dustMesh && this.dustMaterial) {
      const visible = state.dust > 0.01
      this.dustMesh.visible = visible
      if (visible) {
        this.dustMesh.position.set(cx, 0, cz)
        const u = this.dustMaterial.uniforms
        u.time.value = this.time
        u.intensity.value = state.dust
        u.windForce.value.set(state.windX, 0, state.windZ)
      }
    }

    // Splash
    this.updateSplash(dt, cx, cz, state.rain)

    // Snow ground
    this.updateSnowGround(dt, state.snowGround)

    // Ground fog
    this.updateFogPlane(state.groundFog)

    // Aurora
    if (this.auroraMesh && this.auroraMaterial) {
      const visible = state.aurora > 0.01
      this.auroraMesh.visible = visible
      if (visible) {
        this.auroraMaterial.uniforms.time.value = this.time
        this.auroraMaterial.uniforms.intensity.value = state.aurora
      }
    }
  }

  triggerLightningFlash(): void {
    // handled by WeatherSystem bloom + lighting flash
  }

  // ── Internal updates ──

  private updateSplash(dt: number, cx: number, cz: number, rain: number): void {
    if (!this.splashMesh || !this.splashPositions || !this.splashAlphas || !this.splashSizes) return
    const visible = rain > 0.1
    this.splashMesh.visible = visible
    if (!visible) return

    const activeCount = Math.floor(this.splashCount * rain)
    const lifeScale = 1.0 - rain * 0.6
    const sizeBase = 1.0 + rain * 2.5
    const sizeGrow = 2.0 + rain * 6.0
    const spread = this.RADIUS * (0.6 + rain * 0.9)

    for (let i = 0; i < this.splashCount; i++) {
      if (i >= activeCount) {
        this.splashPositions[i * 3 + 1] = -1000
        this.splashAlphas[i] = 0
        continue
      }
      const p = this.splashParticles[i]
      p.life += dt
      if (p.life >= p.maxLife) {
        p.life = 0
        p.maxLife = (0.1 + Math.random() * 0.15) * lifeScale
        p.x = cx + (Math.random() - 0.5) * spread * 2
        p.z = cz + (Math.random() - 0.5) * spread * 2
      }
      const prog = p.life / p.maxLife
      this.splashPositions[i * 3] = p.x
      this.splashPositions[i * 3 + 1] = 0.05
      this.splashPositions[i * 3 + 2] = p.z
      this.splashAlphas[i] = Math.min(rain * 1.2, 1.0) * (1 - prog)
      this.splashSizes[i] = sizeBase + prog * sizeGrow
    }
    const geo = this.splashMesh.geometry
    ;(geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true
    ;(geo.attributes.size as THREE.BufferAttribute).needsUpdate = true
  }

  private updateSnowGround(dt: number, target: number): void {
    if (!this.snowGround) return
    const mat = this.snowGround.material as THREE.MeshBasicMaterial
    const tgt = target > 0.05 ? target * 0.5 : 0
    this.snowGroundOpacity = THREE.MathUtils.lerp(this.snowGroundOpacity, tgt, dt * 0.5)
    mat.opacity = this.snowGroundOpacity
    this.snowGround.visible = this.snowGroundOpacity > 0.01
  }

  private updateFogPlane(groundFog: number): void {
    if (!this.fogPlane) return
    const mat = this.fogPlane.material as THREE.MeshBasicMaterial
    mat.opacity = groundFog * 0.2
    this.fogPlane.visible = groundFog > 0.02
  }

  private hideAll(): void {
    if (this.rainMesh) this.rainMesh.visible = false
    if (this.snowMesh) this.snowMesh.visible = false
    if (this.dustMesh) this.dustMesh.visible = false
    if (this.splashMesh) this.splashMesh.visible = false
    if (this.snowGround) this.snowGround.visible = false
    if (this.fogPlane) this.fogPlane.visible = false
    if (this.auroraMesh) this.auroraMesh.visible = false
  }

  // ── Scene management ──

  setScene(scene: THREE.Scene): void {
    const move = (m: THREE.Object3D | null) => { if (m) { m.parent?.remove(m); scene.add(m) } }
    move(this.rainMesh); move(this.snowMesh); move(this.dustMesh)
    move(this.splashMesh); move(this.snowGround); move(this.fogPlane); move(this.auroraMesh)
    this.scene = scene
  }

  clear(): void { this.hideAll() }

  destroy(): void {
    const dispose = (m: THREE.Object3D | null) => {
      if (!m) return
      if ('geometry' in m && (m as any).geometry) (m as any).geometry.dispose()
      if ('material' in m) {
        const mat = (m as any).material
        if (Array.isArray(mat)) mat.forEach((x: THREE.Material) => x.dispose())
        else if (mat?.dispose) mat.dispose()
      }
      m.parent?.remove(m)
    }
    dispose(this.rainMesh); dispose(this.snowMesh); dispose(this.dustMesh)
    dispose(this.splashMesh); dispose(this.snowGround); dispose(this.fogPlane); dispose(this.auroraMesh)
  }
}
