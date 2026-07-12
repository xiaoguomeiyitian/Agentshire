export type StepType = 'camera_move' | 'npc_move' | 'npc_walk' | 'dialog' | 'wait'
  | 'scene_switch' | 'npc_state' | 'parallel' | 'fx' | 'callback' | 'progress' | 'npc_glow'
  | 'npc_anim' | 'npc_emoji'

export interface NarrativeStep {
  type: StepType
  params: Record<string, any>
  durationMs?: number
}

export class NarrativeEngine {
  private steps: NarrativeStep[] = []
  private currentIndex = 0
  private running = false
  private paused = false
  
  private handlers: Map<string, (params: Record<string, any>) => Promise<void>> = new Map()
  
  on(type: string, handler: (params: Record<string, any>) => Promise<void>): void {
    this.handlers.set(type, handler)
  }
  
  load(steps: NarrativeStep[]): void {
    this.steps = steps
    this.currentIndex = 0
  }
  
  async play(): Promise<void> {
    this.running = true
    this.paused = false
    
    while (this.currentIndex < this.steps.length && this.running) {
      if (this.paused) {
        await new Promise<void>(r => { 
          const check = setInterval(() => { if (!this.paused) { clearInterval(check); r() } }, 100)
        })
      }
      
      const step = this.steps[this.currentIndex]
      await this.executeStep(step)
      this.currentIndex++
    }
    
    this.running = false
  }
  
  private async executeStep(step: NarrativeStep): Promise<void> {
    if (step.type === 'parallel') {
      const subSteps = step.params.steps as NarrativeStep[]
      await Promise.all(subSteps.map(s => this.executeStep(s)))
      return
    }
    
    if (step.type === 'wait') {
      await new Promise(r => setTimeout(r, step.durationMs || 1000))
      return
    }
    
    const handler = this.handlers.get(step.type)
    if (handler) {
      await handler(step.params)
    }
    
    if (step.durationMs) {
      await new Promise(r => setTimeout(r, step.durationMs))
    }
  }
  
  stop(): void { this.running = false }
  pause(): void { this.paused = true }
  resume(): void { this.paused = false }
  isRunning(): boolean { return this.running }
  getCurrentIndex(): number { return this.currentIndex }
}
