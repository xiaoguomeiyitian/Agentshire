import * as THREE from 'three'
import type { GameClock } from './GameClock'
import type { TimeOfDayLighting } from './visual/TimeOfDayLighting'
import type { PostProcessManager } from './visual/PostProcessing'
import type { WeatherType, TimePeriod } from '../types'
import { WeatherEffects, type WeatherVisualState } from './visual/WeatherEffects'
import type { PerformanceProfile } from '../engine/Performance'

// ═════════════════════════════════════════════════════════════
// 12-state weather profiles (based on procedural-weather skill)
// ═════════════════════════════════════════════════════════════

interface WeatherStateProfile {
  rain: number; snow: number; dust: number; lightning: number; aurora: number
  fogDensityAdd: number; groundFog: number; snowGround: number
  skyDarkness: number; windMul: number
  sunMul: number; ambMul: number
  ambTint: [number, number, number]; skyTint: [number, number, number]
  fogNearOff: number; fogFarOff: number; bloomAdd: number
}

const STATES: Record<WeatherType, WeatherStateProfile> = {
  clear: {
    rain: 0, snow: 0, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0, windMul: 0.5,
    sunMul: 1.0, ambMul: 1.0,
    ambTint: [1, 1, 1], skyTint: [1, 1, 1],
    fogNearOff: 0, fogFarOff: 0, bloomAdd: 0,
  },
  cloudy: {
    rain: 0, snow: 0, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.2, windMul: 0.8,
    sunMul: 0.5, ambMul: 0.85,
    ambTint: [0.82, 0.84, 0.9], skyTint: [0.72, 0.74, 0.78],
    fogNearOff: -8, fogFarOff: -15, bloomAdd: 0,
  },
  drizzle: {
    rain: 0.3, snow: 0, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.3, windMul: 0.7,
    sunMul: 0.45, ambMul: 0.8,
    ambTint: [0.78, 0.8, 0.88], skyTint: [0.65, 0.68, 0.74],
    fogNearOff: -10, fogFarOff: -18, bloomAdd: 0.02,
  },
  rain: {
    rain: 0.7, snow: 0, dust: 0, lightning: 0.1, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.5, windMul: 1.2,
    sunMul: 0.3, ambMul: 0.7,
    ambTint: [0.7, 0.72, 0.8], skyTint: [0.5, 0.53, 0.6],
    fogNearOff: -12, fogFarOff: -25, bloomAdd: 0.1,
  },
  heavyRain: {
    rain: 1.0, snow: 0, dust: 0, lightning: 0.3, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.7, windMul: 1.8,
    sunMul: 0.15, ambMul: 0.6,
    ambTint: [0.6, 0.62, 0.72], skyTint: [0.4, 0.42, 0.5],
    fogNearOff: -16, fogFarOff: -32, bloomAdd: 0.15,
  },
  storm: {
    rain: 1.0, snow: 0, dust: 0, lightning: 0.6, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.85, windMul: 2.5,
    sunMul: 0.05, ambMul: 0.45,
    ambTint: [0.5, 0.5, 0.6], skyTint: [0.25, 0.25, 0.32],
    fogNearOff: -25, fogFarOff: -32, bloomAdd: 0.2,
  },
  lightSnow: {
    rain: 0, snow: 0.3, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0.2,
    skyDarkness: 0.15, windMul: 0.6,
    sunMul: 0.5, ambMul: 0.9,
    ambTint: [0.88, 0.9, 0.96], skyTint: [0.82, 0.86, 0.92],
    fogNearOff: -6, fogFarOff: -12, bloomAdd: 0.03,
  },
  snow: {
    rain: 0, snow: 0.85, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0.6,
    skyDarkness: 0.25, windMul: 1.0,
    sunMul: 0.35, ambMul: 0.88,
    ambTint: [0.88, 0.9, 0.96], skyTint: [0.82, 0.85, 0.9],
    fogNearOff: -10, fogFarOff: -20, bloomAdd: 0.05,
  },
  blizzard: {
    rain: 0, snow: 1.0, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0.9,
    skyDarkness: 0.4, windMul: 4.0,
    sunMul: 0.12, ambMul: 0.7,
    ambTint: [0.88, 0.9, 0.95], skyTint: [0.85, 0.87, 0.92],
    fogNearOff: -18, fogFarOff: -38, bloomAdd: 0.08,
  },
  fog: {
    rain: 0, snow: 0, dust: 0, lightning: 0, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.2, windMul: 0.2,
    sunMul: 0.25, ambMul: 0.8,
    ambTint: [0.88, 0.88, 0.9], skyTint: [0.78, 0.78, 0.8],
    fogNearOff: -18, fogFarOff: -35, bloomAdd: 0.02,
  },
  sandstorm: {
    rain: 0, snow: 0, dust: 1.0, lightning: 0.1, aurora: 0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0.5, windMul: 3.0,
    sunMul: 0.25, ambMul: 0.55,
    ambTint: [0.9, 0.65, 0.35], skyTint: [0.7, 0.5, 0.25],
    fogNearOff: -20, fogFarOff: -38, bloomAdd: 0.08,
  },
  aurora: {
    rain: 0, snow: 0, dust: 0, lightning: 0, aurora: 1.0,
    fogDensityAdd: 0, groundFog: 0, snowGround: 0,
    skyDarkness: 0, windMul: 0.3,
    sunMul: 1.0, ambMul: 1.5,
    ambTint: [0.7, 1.0, 0.9], skyTint: [0.6, 0.85, 0.8],
    fogNearOff: 0, fogFarOff: 0, bloomAdd: 0.4,
  },
}

// ═════════════════════════════════════════════════════════════
// Transition routing — invalid jumps go through intermediaries
// ═════════════════════════════════════════════════════════════

const TRANSITION_ROUTES: Record<string, WeatherType[]> = {
  'storm→clear':     ['rain', 'cloudy', 'clear'],
  'blizzard→clear':  ['snow', 'lightSnow', 'clear'],
  'clear→storm':     ['cloudy', 'rain', 'heavyRain', 'storm'],
  'clear→blizzard':  ['lightSnow', 'snow', 'blizzard'],
  'heavyRain→clear': ['rain', 'cloudy', 'clear'],
  'storm→cloudy':    ['rain', 'cloudy'],
  'blizzard→cloudy': ['snow', 'lightSnow', 'cloudy'],
}

function findRoute(from: WeatherType, to: WeatherType): WeatherType[] {
  const key = `${from}→${to}`
  return TRANSITION_ROUTES[key] ?? [to]
}

// ═════════════════════════════════════════════════════════════
// Day theme system — roll a theme per day, resolve weather per period
// ═════════════════════════════════════════════════════════════

type DayTheme =
  | 'sunny' | 'overcast' | 'drizzleDay' | 'rainy' | 'stormy'
  | 'snowy' | 'blizzardDay' | 'foggy' | 'sandstormDay' | 'auroraDay'

const THEME_WEIGHTS: Array<{ theme: DayTheme; weight: number }> = [
  { theme: 'sunny',        weight: 30 },
  { theme: 'overcast',     weight: 18 },
  { theme: 'drizzleDay',   weight: 15 },
  { theme: 'rainy',        weight: 14 },
  { theme: 'stormy',       weight: 4 },
  { theme: 'snowy',        weight: 6 },
  { theme: 'blizzardDay',  weight: 3 },
  { theme: 'foggy',        weight: 4 },
  { theme: 'sandstormDay', weight: 3 },
  { theme: 'auroraDay',    weight: 3 },
]
const THEME_TOTAL = THEME_WEIGHTS.reduce((s, w) => s + w.weight, 0)

const DAY_CURVES: Record<DayTheme, Record<TimePeriod, WeatherType>> = {
  sunny:        { dawn: 'clear',     morning: 'clear',     noon: 'clear',     afternoon: 'clear',     dusk: 'clear',     night: 'clear' },
  overcast:     { dawn: 'clear',     morning: 'cloudy',    noon: 'cloudy',    afternoon: 'cloudy',    dusk: 'cloudy',    night: 'clear' },
  drizzleDay:   { dawn: 'cloudy',    morning: 'drizzle',   noon: 'drizzle',   afternoon: 'drizzle',   dusk: 'cloudy',    night: 'clear' },
  rainy:        { dawn: 'cloudy',    morning: 'drizzle',   noon: 'rain',      afternoon: 'rain',      dusk: 'drizzle',   night: 'cloudy' },
  stormy:       { dawn: 'cloudy',    morning: 'rain',      noon: 'heavyRain', afternoon: 'storm',     dusk: 'heavyRain', night: 'rain' },
  snowy:        { dawn: 'cloudy',    morning: 'lightSnow', noon: 'snow',      afternoon: 'snow',      dusk: 'lightSnow', night: 'cloudy' },
  blizzardDay:  { dawn: 'lightSnow', morning: 'snow',      noon: 'blizzard',  afternoon: 'blizzard',  dusk: 'snow',      night: 'lightSnow' },
  foggy:        { dawn: 'fog',       morning: 'fog',       noon: 'cloudy',    afternoon: 'cloudy',    dusk: 'fog',       night: 'fog' },
  sandstormDay: { dawn: 'cloudy',    morning: 'sandstorm', noon: 'sandstorm', afternoon: 'sandstorm', dusk: 'cloudy',    night: 'clear' },
  auroraDay:    { dawn: 'clear',     morning: 'clear',     noon: 'clear',     afternoon: 'clear',     dusk: 'clear',     night: 'aurora' },
}

function pickDayTheme(): DayTheme {
  const roll = Math.random() * THEME_TOTAL
  let acc = 0
  for (const w of THEME_WEIGHTS) { acc += w.weight; if (roll < acc) return w.theme }
  return 'sunny'
}

// ═════════════════════════════════════════════════════════════
// WeatherSystem — main controller
// ═════════════════════════════════════════════════════════════

export class WeatherSystem {
  private lighting: TimeOfDayLighting
  private postProcess: PostProcessManager | null
  private camera: THREE.Camera
  private effects: WeatherEffects

  private currentWeather: WeatherType = 'clear'
  private targetWeather: WeatherType = 'clear'
  private transitionProgress = 1
  private transitionSpeed = 0.4 // 0→1 in ~2.5s real time

  private transitionQueue: WeatherType[] = []

  private enabled = true
  private updateCounter = 0
  private lastDayCount = -1
  private lastPeriod: TimePeriod | null = null
  private currentTheme: DayTheme = 'sunny'

  // Lightning
  private thunderTimer = 0
  private lightningFlashTimer = 0
  private baseBloomAdd = 0
  private _onThunderCb: ((intensity: number) => void) | null = null

  private _tint = new THREE.Color()
  private _sky = new THREE.Color()
  private _elapsed = 0

  constructor(
    scene: THREE.Scene, camera: THREE.Camera,
    lighting: TimeOfDayLighting, postProcess: PostProcessManager | null,
    profile: PerformanceProfile,
  ) {
    this.camera = camera
    this.lighting = lighting
    this.postProcess = postProcess
    this.effects = new WeatherEffects(scene, camera, profile)
  }

  getWeather(): WeatherType { return this.currentWeather }
  getDisplayWeather(): WeatherType { return this.transitionQueue.length > 0 ? this.transitionQueue[this.transitionQueue.length - 1] : this.targetWeather }
  getDayTheme(): string { return this.currentTheme }

  onThunder(cb: (intensity: number) => void): void { this._onThunderCb = cb }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.effects.setEnabled(enabled)
  }

  forceWeather(type: WeatherType): void {
    if (!STATES[type]) return
    this.transitionQueue = []
    this.currentWeather = type
    this.targetWeather = type
    this.transitionProgress = 1
  }

  forceTheme(theme: string): void {
    const t = theme as DayTheme
    if (!DAY_CURVES[t]) return
    this.currentTheme = t
    this.lastPeriod = null
  }

  resetToAutomatic(): void {
    this.lastPeriod = null
    this.transitionQueue = []
  }

  private startTransitionTo(type: WeatherType): void {
    if (type === this.targetWeather && this.transitionQueue.length === 0) return
    const route = findRoute(this.getDisplayWeather(), type)
    this.transitionQueue = route
    this.advanceQueue()
  }

  private advanceQueue(): void {
    if (this.transitionQueue.length === 0) return
    const next = this.transitionQueue.shift()!
    this.currentWeather = this.targetWeather
    this.targetWeather = next
    this.transitionProgress = 0
  }

  update(dt: number, gameClock: GameClock): void {
    if (!this.enabled) return

    this._elapsed += dt

    const state = gameClock.getState()

    // Roll day theme at new day, resolve weather at period change
    if (state.dayCount !== this.lastDayCount) {
      this.lastDayCount = state.dayCount
      this.currentTheme = pickDayTheme()
      this.lastPeriod = null
    }

    if (state.period !== this.lastPeriod) {
      this.lastPeriod = state.period
      const newW = DAY_CURVES[this.currentTheme]?.[state.period] ?? 'clear'
      if (newW !== this.getDisplayWeather()) this.startTransitionTo(newW)
    }

    // Advance transition
    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + dt * this.transitionSpeed)
      if (this.transitionProgress >= 1) {
        this.currentWeather = this.targetWeather
        if (this.transitionQueue.length > 0) this.advanceQueue()
      }
    }

    // Compute interpolated visual state
    const t = smoothstep(this.transitionProgress)
    const from = STATES[this.currentWeather] ?? STATES.clear
    const to = STATES[this.targetWeather] ?? STATES.clear
    const windBase = lerp(from.windMul, to.windMul, t) * 5
    const vs: WeatherVisualState = {
      rain: lerp(from.rain, to.rain, t),
      snow: lerp(from.snow, to.snow, t),
      dust: lerp(from.dust, to.dust, t),
      lightning: lerp(from.lightning, to.lightning, t),
      aurora: lerp(from.aurora, to.aurora, t),
      windX: windBase, windZ: windBase * 0.4,
      fogDensityAdd: lerp(from.fogDensityAdd, to.fogDensityAdd, t),
      groundFog: lerp(from.groundFog, to.groundFog, t),
      snowGround: lerp(from.snowGround, to.snowGround, t),
    }

    this.effects.updateVisuals(dt, this.camera, vs)

    // Lighting + thunder every 10 frames
    this.updateCounter++
    if (this.updateCounter % 10 !== 0) return
    this.applyLighting(t, from, to)
    this.updateThunder(dt * 10, vs.lightning)
  }

  private applyLighting(t: number, from: WeatherStateProfile, to: WeatherStateProfile): void {
    const sunMul = lerp(from.sunMul, to.sunMul, t)
    const ambMul = lerp(from.ambMul, to.ambMul, t)
    const fogNear = lerp(from.fogNearOff, to.fogNearOff, t)
    const fogFar = lerp(from.fogFarOff, to.fogFarOff, t)
    const bloomAdd = lerp(from.bloomAdd, to.bloomAdd, t)
    this.baseBloomAdd = bloomAdd

    this._tint.setRGB(
      lerp(from.ambTint[0], to.ambTint[0], t),
      lerp(from.ambTint[1], to.ambTint[1], t),
      lerp(from.ambTint[2], to.ambTint[2], t),
    )
    this._sky.setRGB(
      lerp(from.skyTint[0], to.skyTint[0], t),
      lerp(from.skyTint[1], to.skyTint[1], t),
      lerp(from.skyTint[2], to.skyTint[2], t),
    )

    const auroraBlend = lerp(from.aurora, to.aurora, t)
    if (auroraBlend > 0.01) {
      const cycle = this._elapsed * 0.2
      const gr = (Math.sin(cycle) * 0.5 + 0.5)
      const bl = (Math.sin(cycle + 2.1) * 0.5 + 0.5)
      const aR = lerp(0.15, 0.5, bl)
      const aG = lerp(0.6, 1.0, gr)
      const aB = lerp(0.5, 1.0, bl)
      const strength = auroraBlend * 0.8
      this._tint.r = lerp(this._tint.r, aR, strength)
      this._tint.g = lerp(this._tint.g, aG, strength)
      this._tint.b = lerp(this._tint.b, aB, strength)
      this._sky.r = lerp(this._sky.r, aR * 0.4, strength * 0.6)
      this._sky.g = lerp(this._sky.g, aG * 0.4, strength * 0.6)
      this._sky.b = lerp(this._sky.b, aB * 0.4, strength * 0.6)
    }

    this.lighting.applyWeatherOverride(sunMul, ambMul, this._tint, fogNear, fogFar, this._sky)

    if (this.lightningFlashTimer <= 0 && this.postProcess) {
      this.postProcess.setBloomStrength(this.lighting.getCurrentBloom() + bloomAdd)
    }
  }

  private updateThunder(accDt: number, lightningIntensity: number): void {
    if (lightningIntensity < 0.05) { this.lightningFlashTimer = 0; return }

    if (this.lightningFlashTimer > 0) {
      this.lightningFlashTimer -= accDt
      if (this.lightningFlashTimer <= 0) {
        this.lightningFlashTimer = 0
        if (this.postProcess) this.postProcess.setBloomStrength(this.lighting.getCurrentBloom() + this.baseBloomAdd)
        this.lighting.clearFlashOverride()
      }
    }

    this.thunderTimer -= accDt
    if (this.thunderTimer <= 0) {
      const hasFlash = Math.random() < 0.7
      if (hasFlash) this.triggerLightning()
      const thunderIntensity = lightningIntensity >= 0.6 ? 0.9 : 0.65
      this._onThunderCb?.(thunderIntensity)
      this.thunderTimer = (1 / lightningIntensity) * (1.5 + Math.random() * 3.5)
    }
  }

  private triggerLightning(): void {
    if (this.postProcess) this.postProcess.setBloomStrength(3.0)
    this.lighting.applyFlashOverride(5.0)
    this.lightningFlashTimer = 0.25
    this.effects.triggerLightningFlash()
  }

  setScene(scene: THREE.Scene): void { this.effects.setScene(scene) }
  clear(): void { this.effects.clear() }
  destroy(): void { this.effects.destroy() }
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
