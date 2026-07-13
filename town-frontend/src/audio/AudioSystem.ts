/**
 * Audio System - 游戏音效系统
 */
import { apiUrl } from '@/utils/api-base'

interface SoundConfig {
  src: string
  volume?: number
  throttleMs?: number
  loop?: boolean
}

const SOUNDS: Record<string, SoundConfig> = {
  typing:       { src: 'typing.mp3',       volume: 0.15, throttleMs: 150 },
  footstep:     { src: 'footstep.mp3',     volume: 0.12, throttleMs: 250 },
  summon:       { src: 'summon.mp3',        volume: 0.4 },
  complete:     { src: 'complete.mp3',      volume: 0.35 },
  error:        { src: 'error.mp3',         volume: 0.25 },
  scene_switch: { src: 'whoosh.mp3',        volume: 0.3 },
  chat_pop:     { src: 'pop.mp3',           volume: 0.2, throttleMs: 300 },
  deploy:       { src: 'fanfare.mp3',       volume: 0.45 },
  click:        { src: 'click.mp3',         volume: 0.2, throttleMs: 100 },
}

const BGM_FILE = 'town_ambient.mp3'

interface LoadedSound {
  buffer: AudioBuffer
  config: SoundConfig
  lastPlayTime: number
}

export class AudioSystem {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private bgmGain: GainNode | null = null
  private sounds: Map<string, LoadedSound> = new Map()
  private bgmBuffer: AudioBuffer | null = null
  private currentBgmSource: AudioBufferSourceNode | null = null
  private _masterVolume = 0.7
  private _bgmVolume = 0.4
  private _muted = false
  private basePath: string
  private initialized = false

  constructor(basePath: string = '/assets/music/') { this.basePath = basePath }

  async init(): Promise<boolean> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.masterGain = this.audioContext.createGain()
      this.masterGain.connect(this.audioContext.destination)
      this.masterGain.gain.value = this._masterVolume
      this.sfxGain = this.audioContext.createGain()
      this.sfxGain.connect(this.masterGain)
      this.bgmGain = this.audioContext.createGain()
      this.bgmGain.connect(this.masterGain)
      this.bgmGain.gain.value = this._bgmVolume
      this.initialized = true
      return true
    } catch { return false }
  }

  async ensureResumed(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      try { await this.audioContext.resume() } catch { /* ignore */ }
    }
  }

  async preload(): Promise<void> {
    if (!this.audioContext) await this.init()
    for (const [key, config] of Object.entries(SOUNDS)) {
      try {
        const buffer = await this.loadAudioFile(config.src)
        this.sounds.set(key, { buffer, config, lastPlayTime: 0 })
      } catch { /* ignore */ }
    }
    if (BGM_FILE) { try { this.bgmBuffer = await this.loadAudioFile(BGM_FILE) } catch { /* ignore */ } }
  }

  private async loadAudioFile(filename: string): Promise<AudioBuffer> {
    if (!this.audioContext) throw new Error('AudioContext not initialized')
    const response = await fetch(apiUrl(this.basePath + filename))
    if (!response.ok) throw new Error(`Audio file not found: ${filename}`)
    return await this.audioContext.decodeAudioData(await response.arrayBuffer())
  }

  play(soundId: string, options?: { volume?: number }): void {
    if (!this.initialized || this._muted || !this.audioContext || !this.sfxGain) return
    const sound = this.sounds.get(soundId)
    if (!sound) return
    const now = performance.now()
    if (sound.config.throttleMs && now - sound.lastPlayTime < sound.config.throttleMs) return
    try {
      const source = this.audioContext.createBufferSource()
      source.buffer = sound.buffer
      if (sound.config.loop) source.loop = true
      const gainNode = this.audioContext.createGain()
      gainNode.gain.value = (options?.volume ?? 1) * (sound.config.volume ?? 1)
      source.connect(gainNode)
      gainNode.connect(this.sfxGain)
      source.start(0)
      sound.lastPlayTime = now
    } catch { /* ignore */ }
  }

  getAudioContext(): AudioContext | null { return this.audioContext }
  getSfxGain(): GainNode | null { return this.sfxGain }
  isReady(): boolean { return this.initialized }

  playBGM(): void {
    if (!this.initialized || !this.audioContext || !this.bgmGain || !this.bgmBuffer) return
    this.stopBGM()
    try {
      this.currentBgmSource = this.audioContext.createBufferSource()
      this.currentBgmSource.buffer = this.bgmBuffer
      this.currentBgmSource.loop = true
      this.currentBgmSource.connect(this.bgmGain)
      this.currentBgmSource.start(0)
    } catch { /* ignore */ }
  }

  stopBGM(): void {
    if (this.currentBgmSource) { try { this.currentBgmSource.stop() } catch { /* ignore */ }; this.currentBgmSource = null }
  }

  get masterVolume(): number { return this._masterVolume }
  set masterVolume(v: number) { this._masterVolume = Math.max(0, Math.min(1, v)); if (this.masterGain) this.masterGain.gain.value = this._masterVolume }
  get muted(): boolean { return this._muted }
  set muted(v: boolean) { this._muted = v; if (this.masterGain) this.masterGain.gain.value = v ? 0 : this._masterVolume }
  toggleMute(): void { this.muted = !this.muted }

  destroy(): void {
    this.stopBGM()
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null }
    this.sounds.clear(); this.bgmBuffer = null; this.initialized = false
  }
}

let audioSystem: AudioSystem | null = null
export function getAudioSystem(): AudioSystem { if (!audioSystem) audioSystem = new AudioSystem(); return audioSystem }
