/**
 * Platform Bridge - Communication with parent platform
 */

export interface GameState {
  status: 'running' | 'paused' | 'stopped'
  tick?: number
  fps?: number
  objectCount?: number
}

export interface PlatformMessage {
  type: 'play' | 'pause' | 'reset' | 'debug' | 'setSpeed'
  enabled?: boolean
  speed?: number
}

/** Bubble content forwarded from Town iframe to parent React App. */
export interface TownBubbleData {
  npcId: string
  npcName: string
  text: string
  timestamp: number
  townHour?: number
  townMinute?: number
  townPeriod?: string
  townWeather?: string
}

/** Town status info forwarded from Town iframe to parent React App. */
export interface TownStatusData {
  hour: number
  minute: number
  period: string
  dayCount: number
  weather: string
  residentCount: number
  timestamp: number
}

type MessageHandler = (msg: PlatformMessage) => void

export class PlatformBridge {
  private handlers: MessageHandler[] = []
  private isEmbedded: boolean

  constructor() {
    this.isEmbedded = window.parent !== window
    if (this.isEmbedded) {
      window.addEventListener('message', this.handleMessage.bind(this))
    }
  }

  sendReady(): void { this.sendToParent({ type: 'ready' }) }

  sendStateChange(state: Partial<GameState>): void {
    this.sendToParent({ type: 'stateChange', state })
  }

  sendError(message: string): void { this.sendToParent({ type: 'error', message }) }

  sendLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.sendToParent({ type: 'log', level, message })
  }

  /** Forward a resident bubble to the parent React App (for "Town Feed" panel). */
  sendBubble(data: TownBubbleData): void {
    this.sendToParent({ type: 'town_bubble', ...data })
  }

  /** Forward town status (time / weather / resident count) to the parent React App. */
  sendTownStatus(data: TownStatusData): void {
    this.sendToParent({ type: 'town_status', ...data })
  }

  onMessage(handler: MessageHandler): void { this.handlers.push(handler) }

  private handleMessage(event: MessageEvent): void {
    const data = event.data
    if (!data || typeof data.type !== 'string') return
    for (const handler of this.handlers) handler(data as PlatformMessage)
  }

  private sendToParent(data: Record<string, unknown>): void {
    if (this.isEmbedded) window.parent.postMessage(data, '*')
  }
}
