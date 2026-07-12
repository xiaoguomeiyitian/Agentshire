import type { WeatherType, TimePeriod } from '../types'

// ═══════════════════════════════════════════════════════════
// Procedural ambient sound synthesizer — zero audio files needed.
// Uses Web Audio API noise generators + oscillators + filters.
// ═══════════════════════════════════════════════════════════

interface AmbientLayer {
  source: AudioBufferSourceNode | OscillatorNode | null
  gain: GainNode
  targetVolume: number
  currentVolume: number
}

function createNoiseBuffer(ctx: AudioContext, durationSec: number, type: 'white' | 'pink' | 'brown'): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = sampleRate * durationSec
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    if (type === 'white') {
      data[i] = white
    } else if (type === 'pink') {
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.96900 * b2 + white * 0.1538520
      b3 = 0.86650 * b3 + white * 0.3104856
      b4 = 0.55000 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.0168980
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
      b6 = white * 0.115926
    } else {
      b0 = (b0 + (0.02 * white)) / 1.02
      data[i] = b0 * 3.5
    }
  }
  return buffer
}

export class AmbientSoundManager {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private outputGain: GainNode | null = null

  private rainLayer: AmbientLayer | null = null
  private windLayer: AmbientLayer | null = null
  private birdsLayer: AmbientLayer | null = null
  private nightLayer: AmbientLayer | null = null
  private trafficLayer: AmbientLayer | null = null

  private noiseBuffers: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } | null = null

  private currentWeather: WeatherType = 'clear'
  private currentPeriod: TimePeriod = 'morning'
  private enabled = true
  private _volume = 0.5
  private _pendingInit = false
  private _destination: GainNode | null = null
  private _windPhase = 0

  init(audioContext: AudioContext, destination: GainNode): void {
    this.ctx = audioContext
    this._destination = destination
    this._pendingInit = true
  }

  private startLayers(): void {
    if (!this.ctx || !this._destination) return
    this._pendingInit = false

    this.outputGain = this.ctx.createGain()
    this.outputGain.gain.value = this._volume
    this.outputGain.connect(this._destination)
    this.masterGain = this.outputGain

    this.noiseBuffers = {
      white: createNoiseBuffer(this.ctx, 4, 'white'),
      pink: createNoiseBuffer(this.ctx, 4, 'pink'),
      brown: createNoiseBuffer(this.ctx, 4, 'brown'),
    }

    this.rainLayer = this.createNoiseLayer('pink', 200, 3000, 0)
    this.windLayer = this.createNoiseLayer('brown', 50, 800, 0)
    this.birdsLayer = this.createBirdsLayer()
    this.nightLayer = this.createNightLayer()
    this.trafficLayer = this.createTrafficLayer()
  }

  private createNoiseLayer(
    type: 'white' | 'pink' | 'brown',
    filterLow: number, filterHigh: number,
    volume: number,
  ): AmbientLayer {
    if (!this.ctx || !this.masterGain || !this.noiseBuffers) throw new Error('Not initialized')

    const source = this.ctx.createBufferSource()
    source.buffer = this.noiseBuffers[type]
    source.loop = true

    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = filterHigh

    const highpass = this.ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = filterLow

    const gain = this.ctx.createGain()
    gain.gain.value = volume

    source.connect(highpass)
    highpass.connect(lowpass)
    lowpass.connect(gain)
    gain.connect(this.masterGain)
    source.start(0)

    return { source, gain, targetVolume: volume, currentVolume: volume }
  }

  private createBirdsLayer(): AmbientLayer {
    if (!this.ctx || !this.masterGain) throw new Error('Not initialized')
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    gain.connect(this.masterGain)
    this.scheduleBirdChirps(gain)
    return { source: null, gain, targetVolume: 0, currentVolume: 0 }
  }

  private scheduleBirdChirps(output: GainNode): void {
    if (!this.ctx) return
    const chirp = () => {
      if (!this.ctx || !this.enabled) return
      if (this.birdsLayer && this.birdsLayer.targetVolume < 0.01) {
        setTimeout(chirp, 2000 + Math.random() * 4000)
        return
      }
      const osc = this.ctx.createOscillator()
      const chirpGain = this.ctx.createGain()
      const baseFreq = 2000 + Math.random() * 2000

      osc.type = 'sine'
      osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.3, this.ctx.currentTime + 0.05)
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, this.ctx.currentTime + 0.12)

      chirpGain.gain.setValueAtTime(0, this.ctx.currentTime)
      chirpGain.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 0.02)
      chirpGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.15)

      osc.connect(chirpGain)
      chirpGain.connect(output)
      osc.start(this.ctx.currentTime)
      osc.stop(this.ctx.currentTime + 0.2)

      setTimeout(chirp, 800 + Math.random() * 3000)
    }
    setTimeout(chirp, 1000)
  }

  private createNightLayer(): AmbientLayer {
    if (!this.ctx || !this.masterGain) throw new Error('Not initialized')
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    gain.connect(this.masterGain)
    this.scheduleCrickets(gain)
    return { source: null, gain, targetVolume: 0, currentVolume: 0 }
  }

  private scheduleCrickets(output: GainNode): void {
    if (!this.ctx) return
    const chirp = () => {
      if (!this.ctx || !this.enabled) return
      if (this.nightLayer && this.nightLayer.targetVolume < 0.01) {
        setTimeout(chirp, 1000 + Math.random() * 2000)
        return
      }
      const osc = this.ctx.createOscillator()
      const env = this.ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 4200 + Math.random() * 800

      const now = this.ctx.currentTime
      const burstCount = 3 + Math.floor(Math.random() * 4)
      for (let i = 0; i < burstCount; i++) {
        const t = now + i * 0.06
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(0.04, t + 0.015)
        env.gain.linearRampToValueAtTime(0, t + 0.04)
      }

      osc.connect(env)
      env.connect(output)
      osc.start(now)
      osc.stop(now + burstCount * 0.06 + 0.05)

      setTimeout(chirp, 500 + Math.random() * 1500)
    }
    setTimeout(chirp, 500)
  }

  private createTrafficLayer(): AmbientLayer {
    if (!this.ctx || !this.masterGain || !this.noiseBuffers) throw new Error('Not initialized')
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    gain.connect(this.masterGain)

    // continuous road rumble: filtered pink noise simulating distant traffic
    const roadSrc = this.ctx.createBufferSource()
    roadSrc.buffer = this.noiseBuffers.pink
    roadSrc.loop = true
    const roadLP = this.ctx.createBiquadFilter()
    roadLP.type = 'lowpass'
    roadLP.frequency.value = 400
    const roadHP = this.ctx.createBiquadFilter()
    roadHP.type = 'highpass'
    roadHP.frequency.value = 80
    const roadGain = this.ctx.createGain()
    roadGain.gain.value = 0.15
    roadSrc.connect(roadHP)
    roadHP.connect(roadLP)
    roadLP.connect(roadGain)
    roadGain.connect(gain)
    roadSrc.start(0)

    this.scheduleHonks(gain)
    return { source: roadSrc, gain, targetVolume: 0, currentVolume: 0 }
  }

  private getTrafficProfile(): { interval: number; volume: number; burstChance: number } {
    switch (this.currentPeriod) {
      case 'morning':   return { interval: 4000 + Math.random() * 4000,   volume: 0.5,  burstChance: 0.3  }
      case 'noon':      return { interval: 10000 + Math.random() * 10000, volume: 0.25, burstChance: 0.05 }
      case 'afternoon': return { interval: 6000 + Math.random() * 6000,   volume: 0.4,  burstChance: 0.15 }
      case 'dusk':      return { interval: 5000 + Math.random() * 5000,   volume: 0.45, burstChance: 0.25 }
      case 'dawn':      return { interval: 15000 + Math.random() * 15000, volume: 0.15, burstChance: 0    }
      default:          return { interval: 8000, volume: 0, burstChance: 0 }
    }
  }

  private scheduleHonks(output: GainNode): void {
    if (!this.ctx) return
    const honk = () => {
      if (!this.ctx || !this.enabled) return
      if (this.trafficLayer && this.trafficLayer.targetVolume < 0.01) {
        setTimeout(honk, 3000 + Math.random() * 6000)
        return
      }

      const profile = this.getTrafficProfile()
      const now = this.ctx.currentTime
      const duration = 0.25 + Math.random() * 0.5

      const isBus = (this.currentPeriod === 'morning' || this.currentPeriod === 'dusk') && Math.random() < 0.2
      const freqs = isBus ? [220, 310] : [280, 370]
      const useSecond = Math.random() > 0.3

      const honkGain = this.ctx.createGain()
      const peak = 0.5 * profile.volume
      honkGain.gain.setValueAtTime(0, now)
      honkGain.gain.linearRampToValueAtTime(peak, now + 0.01)
      honkGain.gain.setValueAtTime(peak, now + duration - 0.02)
      honkGain.gain.linearRampToValueAtTime(0, now + duration)
      honkGain.connect(output)

      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1400
      lp.connect(honkGain)

      for (const freq of useSecond ? freqs : [freqs[0]]) {
        const osc = this.ctx.createOscillator()
        osc.type = 'triangle'
        osc.frequency.value = freq * (0.97 + Math.random() * 0.06)
        osc.connect(lp)
        osc.start(now)
        osc.stop(now + duration + 0.01)
      }

      if (Math.random() < profile.burstChance) {
        setTimeout(honk, 250 + Math.random() * 400)
      } else {
        setTimeout(honk, profile.interval)
      }
    }
    setTimeout(honk, 2000 + Math.random() * 5000)
  }

  update(dt: number, weather: WeatherType, period: TimePeriod): void {
    if (!this.enabled || !this.ctx) return

    if (this.ctx.state === 'suspended') return

    dt = Math.min(dt, 0.1)

    if (this._pendingInit) {
      try { this.startLayers() } catch { return }
    }

    if (!this.masterGain) return

    this.currentWeather = weather
    this.currentPeriod = period

    const isDay = period === 'morning' || period === 'noon' || period === 'afternoon'
    const isDusk = period === 'dusk' || period === 'dawn'
    const isNight = period === 'night'

    const rainStates: Partial<Record<WeatherType, number>> = {
      drizzle: 0.05, rain: 0.15, heavyRain: 0.20, storm: 0.25,
    }
    const windStates: Partial<Record<WeatherType, number>> = {
      cloudy: 0.015, drizzle: 0.02, rain: 0.04, heavyRain: 0.08,
      storm: 0.12, blizzard: 0.25, sandstorm: 0.35, snow: 0.02, lightSnow: 0.01,
    }
    const baseWind = windStates[weather] ?? 0

    this._windPhase += dt * 0.12
    const cycle = this._windPhase
    const breath = Math.max(0, Math.sin(cycle) * Math.sin(cycle * 0.37 + 0.5))
    const gustEnvelope = breath * breath
    const windFloor = baseWind > 0.1 ? 0.4 : 0.0
    const windTarget = baseWind * (windFloor + (1 - windFloor) * gustEnvelope)
    const birdVolume = (isDay ? 0.7 : isDusk ? 0.3 : 0)
      * (weather === 'clear' || weather === 'cloudy' ? 1 : weather === 'drizzle' ? 0.3 : 0)
    const nightVolume = isNight ? 0.6 : isDusk ? 0.25 : 0
    const weatherDamp = (weather === 'clear' || weather === 'cloudy' || weather === 'drizzle') ? 1 : 0.3
    const trafficVolume = (isDay ? 0.5 : isDusk ? 0.15 : (period as string) === 'dawn' ? 0.1 : 0) * weatherDamp

    this.setLayerTarget(this.rainLayer, rainStates[weather] ?? 0)
    this.setLayerTarget(this.windLayer, windTarget)
    this.setLayerTarget(this.birdsLayer, birdVolume)
    this.setLayerTarget(this.nightLayer, nightVolume)
    this.setLayerTarget(this.trafficLayer, trafficVolume)

    this.smoothVolumes(dt)
  }

  private setLayerTarget(layer: AmbientLayer | null, vol: number): void {
    if (layer) layer.targetVolume = vol
  }

  private smoothVolumes(dt: number): void {
    const fastRate = dt * 0.8
    const windRate = dt * 0.3
    const smooth = (layer: AmbientLayer | null, rate: number) => {
      if (!layer) return
      layer.currentVolume += (layer.targetVolume - layer.currentVolume) * rate
      if (layer.currentVolume < 0.001) layer.currentVolume = 0
      layer.gain.gain.value = layer.currentVolume
    }
    smooth(this.rainLayer, fastRate)
    smooth(this.windLayer, windRate)
    smooth(this.birdsLayer, fastRate)
    smooth(this.nightLayer, fastRate)
    smooth(this.trafficLayer, fastRate)
  }

  playThunder(intensity: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffers) return
    const now = this.ctx.currentTime
    const lightDelay = 0.3 + Math.random() * 1.2

    const segments = 1 + Math.floor(Math.random() * 3)
    let offset = lightDelay

    for (let i = 0; i < segments; i++) {
      const segDuration = 1.2 + Math.random() * 3.5
      const segPeak = (0.6 + Math.random() * 0.4) * intensity * (1 - i * 0.15)
      const segSustain = segPeak * (0.3 + Math.random() * 0.3)

      const rumble = this.ctx.createBufferSource()
      rumble.buffer = this.noiseBuffers.brown
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 300 + intensity * 500

      const env = this.ctx.createGain()
      env.gain.setValueAtTime(0, now)
      env.gain.linearRampToValueAtTime(0, now + offset)
      env.gain.linearRampToValueAtTime(segPeak, now + offset + 0.06)
      env.gain.setValueAtTime(segSustain, now + offset + 0.35)
      env.gain.exponentialRampToValueAtTime(0.01, now + offset + segDuration)

      rumble.connect(lp)
      lp.connect(env)
      env.connect(this.masterGain)
      rumble.start(now)
      rumble.stop(now + offset + segDuration + 0.5)

      offset += segDuration * 0.35 + Math.random() * 0.6
    }
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v))
    if (this.outputGain) this.outputGain.gain.value = this._volume
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && this.outputGain) this.outputGain.gain.value = 0
    else if (enabled && this.outputGain) this.outputGain.gain.value = this._volume
  }

  destroy(): void {
    this.enabled = false
    const stopLayer = (layer: AmbientLayer | null) => {
      if (!layer) return
      try { if (layer.source) layer.source.stop() } catch {}
    }
    stopLayer(this.rainLayer)
    stopLayer(this.windLayer)
    this.rainLayer = null
    this.windLayer = null
    this.birdsLayer = null
    this.nightLayer = null
    this.trafficLayer = null
  }
}
