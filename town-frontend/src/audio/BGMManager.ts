import type { WeatherType, TimePeriod, SceneType } from '../types'
import { apiUrl } from '@/utils/api-base'

type BGMTrack = 'day' | 'dusk' | 'night' | 'work'

const TRACK_FILES: Record<BGMTrack, string> = {
  day:   'bgm_day.mp3',
  dusk:  'bgm_dusk.mp3',
  night: 'bgm_night.mp3',
  work:  'bgm_work.mp3',
}

const CROSSFADE_SEC = 3.5
const MIN_PLAY_SEC = 30
const DEBOUNCE_SEC = 3
const BGM_VOLUME = 0.22

function resolveTrack(_weather: WeatherType, period: TimePeriod, scene: SceneType): BGMTrack {
  if (scene === 'office') return 'work'
  if (period === 'night') return 'night'
  if (period === 'dusk' || period === 'dawn') return 'dusk'
  return 'day'
}

interface ActiveSource {
  source: AudioBufferSourceNode
  gain: GainNode
  track: BGMTrack
  startedAt: number
}

export class BGMManager {
  private ctx: AudioContext | null = null
  private output: GainNode | null = null
  private buffers = new Map<BGMTrack, AudioBuffer>()
  private current: ActiveSource | null = null
  private fading: ActiveSource | null = null

  private pendingTrack: BGMTrack | null = null
  private debounceTimer = 0
  private loading = false
  private enabled = true
  private _volume = BGM_VOLUME
  private basePath = '/assets/music/'

  async init(audioContext: AudioContext, destination: GainNode): Promise<void> {
    this.ctx = audioContext
    this.output = audioContext.createGain()
    this.output.gain.value = this._volume
    this.output.connect(destination)

    await this.preloadAll()
  }

  private async preloadAll(): Promise<void> {
    if (!this.ctx) return
    this.loading = true
    const entries = Object.entries(TRACK_FILES) as Array<[BGMTrack, string]>
    await Promise.all(entries.map(async ([track, file]) => {
      try {
        const resp = await fetch(apiUrl(this.basePath + file))
        if (!resp.ok) return
        const buf = await this.ctx!.decodeAudioData(await resp.arrayBuffer())
        this.buffers.set(track, buf)
      } catch { /* ignore missing files */ }
    }))
    this.loading = false
  }

  update(dt: number, weather: WeatherType, period: TimePeriod, scene: SceneType): void {
    if (!this.enabled || !this.ctx || this.loading) return
    if (this.ctx.state === 'suspended') return

    const desired = resolveTrack(weather, period, scene)

    if (this.current && this.current.track === desired) {
      this.pendingTrack = null
      this.debounceTimer = 0
      this.updateFade(dt)
      return
    }

    const isSceneSwitch = (desired as string) === 'work' || ((this.current?.track as string) === 'work' && (desired as string) !== 'work')
    if (isSceneSwitch) {
      this.switchTo(desired)
      return
    }

    if (this.pendingTrack !== desired) {
      this.pendingTrack = desired
      this.debounceTimer = DEBOUNCE_SEC
    }

    this.debounceTimer -= dt
    if (this.debounceTimer <= 0 && this.pendingTrack) {
      const elapsed = this.current ? (this.ctx.currentTime - this.current.startedAt) : MIN_PLAY_SEC
      if (elapsed >= MIN_PLAY_SEC) {
        this.switchTo(this.pendingTrack)
        this.pendingTrack = null
      }
    }

    this.updateFade(dt)
  }

  private switchTo(track: BGMTrack): void {
    if (!this.ctx || !this.output) return
    const buffer = this.buffers.get(track)
    if (!buffer) return

    if (this.fading) {
      this.stopSource(this.fading)
      this.fading = null
    }

    if (this.current) {
      this.fading = this.current
      this.current = null
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopStart = 0.05
    source.loopEnd = buffer.duration - 0.05

    const gain = this.ctx.createGain()
    gain.gain.value = this.fading ? 0 : 1
    source.connect(gain)
    gain.connect(this.output)
    source.start(0)

    this.current = { source, gain, track, startedAt: this.ctx.currentTime }
  }

  private updateFade(_dt: number): void {
    if (!this.fading || !this.current || !this.ctx) return

    const elapsed = this.ctx.currentTime - this.current.startedAt
    const t = Math.min(elapsed / CROSSFADE_SEC, 1)

    // Equal-power crossfade
    this.current.gain.gain.value = Math.sin(t * Math.PI / 2)
    this.fading.gain.gain.value = Math.cos(t * Math.PI / 2)

    if (t >= 1) {
      this.stopSource(this.fading)
      this.fading = null
    }
  }

  private stopSource(s: ActiveSource): void {
    try { s.source.stop() } catch {}
    try { s.source.disconnect() } catch {}
    try { s.gain.disconnect() } catch {}
  }

  forceTrack(track: BGMTrack): void {
    this.switchTo(track)
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v))
    if (this.output) this.output.gain.value = this._volume
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      if (this.current) { this.stopSource(this.current); this.current = null }
      if (this.fading) { this.stopSource(this.fading); this.fading = null }
    }
  }

  destroy(): void {
    this.setEnabled(false)
    this.buffers.clear()
  }
}
