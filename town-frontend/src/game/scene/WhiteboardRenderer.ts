import * as THREE from 'three'
import idleImageUrl from '../../assets/office-whiteboard-idle.webp'

export interface WhiteboardPlanData {
  name: string
  type: string
  steps: Array<{
    id: string
    description: string
    agents: Array<{ name: string; status: string }>
  }>
}

type RenderMode = 'idle' | 'single' | 'multi' | 'celebrating'

const W = 1024
const H = 640

const POLL_INTERVAL_MS = 3000
const CELEBRATION_DURATION = 8.0
const CELEBRATION_TEXT = '[ Mission COMPLETED ! ]'
const TYPE_SPEED = 0.08
const FIREWORK_COLORS = ['#D4A574', '#E7DDCC', '#10b981', '#cda77b', '#f59e0b', '#ec4899']
const FONT_FAM = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

interface FireworkParticle {
  x: number; y: number
  vx: number; vy: number
  life: number; decay: number; size: number
  color: string
  history: Array<{ x: number; y: number }>
}

export class WhiteboardRenderer {
  private canvas: OffscreenCanvas | HTMLCanvasElement
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  private texture: THREE.CanvasTexture

  private mode: RenderMode = 'idle'
  private plans: WhiteboardPlanData[] = []
  private lastPlans: WhiteboardPlanData[] = []
  private celebrationTime = 0
  private elapsed = 0

  private idleImage: HTMLImageElement | null = null
  private idleImageLoaded = false

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private baseUrl = ''

  onStepProgress: ((current: number, total: number) => void) | null = null

  private fireworks: FireworkParticle[] = []
  private _lastFireworkT = 0

  constructor() {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(W, H)
      this.ctx = this.canvas.getContext('2d')! as OffscreenCanvasRenderingContext2D
    } else {
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      this.canvas = c
      this.ctx = c.getContext('2d')!
    }
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement)
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.colorSpace = THREE.SRGBColorSpace

    this.loadIdleImage()
    this.renderIdle()
  }

  getTexture(): THREE.CanvasTexture { return this.texture }
  getCanvas(): HTMLCanvasElement | OffscreenCanvas { return this.canvas }

  startPolling(baseUrl: string): void {
    if (this.pollTimer) return
    this.baseUrl = baseUrl
    this.pollTimer = setInterval(() => this.fetchPlans(), POLL_INTERVAL_MS)
    this.fetchPlans()
  }

  stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  update(dt: number): void {
    this.elapsed += dt

    if (this.mode === 'celebrating') {
      this.celebrationTime += dt
      this.updateFireworks(dt)
      this.renderCelebration()
      if (this.celebrationTime >= CELEBRATION_DURATION) {
        this.mode = 'idle'
        this.celebrationTime = 0
        this.lastPlans = []
        this.fireworks = []
        this._lastFireworkT = 0
        this.renderIdle()
      }
    } else if (this.mode === 'single') {
      this.renderSinglePlan(this.plans[0])
    } else if (this.mode === 'multi') {
      this.renderMultiPlan(this.plans)
    }
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.stopPolling()
    this.texture.dispose()
  }

  private async fetchPlans(): Promise<void> {
    if (this.polling || this.mode === 'celebrating') return
    this.polling = true
    try {
      const res = await fetch(`${this.baseUrl}/board/plans`)
      if (!res.ok) return
      const data = await res.json()
      if (!data.success || !Array.isArray(data.plans)) return
      this.onPlansUpdated(data.plans)
    } catch { /* silent */ } finally {
      this.polling = false
    }
  }

  private onPlansUpdated(plans: WhiteboardPlanData[]): void {
    const hadPlans = this.lastPlans.length > 0
    const hasPlans = plans.length > 0

    if (hadPlans && !hasPlans && this.mode !== 'celebrating') {
      this.mode = 'celebrating'
      this.celebrationTime = 0
      this.fireworks = []
      this._lastFireworkT = 0
      this.plans = []
      this.emitStepProgress([])
      return
    }

    this.plans = plans
    this.lastPlans = plans

    if (plans.length === 0) {
      if (this.mode !== 'celebrating') {
        this.mode = 'idle'
        this.renderIdle()
        this.texture.needsUpdate = true
      }
      this.emitStepProgress([])
    } else if (plans.length === 1) {
      this.mode = 'single'
      this.emitStepProgress(plans[0].steps)
    } else {
      this.mode = 'multi'
      const allSteps = plans.flatMap(p => p.steps)
      this.emitStepProgress(allSteps)
    }
  }

  private emitStepProgress(steps: WhiteboardPlanData['steps']): void {
    if (!this.onStepProgress) return
    if (steps.length === 0) {
      this.onStepProgress(0, 0)
      return
    }
    const startedCount = steps.filter(s => this.stepStatus(s) !== 'pending').length
    this.onStepProgress(startedCount, steps.length)
  }

  private loadIdleImage(): void {
    if (typeof Image === 'undefined') return
    const img = new Image()
    img.onload = () => {
      this.idleImageLoaded = true
      this.idleImage = img
      if (this.mode === 'idle') { this.renderIdle(); this.texture.needsUpdate = true }
    }
    img.src = idleImageUrl
  }

  // ── Render: Idle ──

  private renderIdle(): void {
    const ctx = this.ctx
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    if (this.idleImageLoaded && this.idleImage) {
      const img = this.idleImage
      const scale = Math.min(W / img.width, H / img.height) * 0.95
      const dw = img.width * scale
      const dh = img.height * scale
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
    }
  }

  // ── Render: Single Plan (step detail) ──

  private renderSinglePlan(plan: WhiteboardPlanData): void {
    const ctx = this.ctx
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const pad = 30
    const titleY = 64
    const nameColW = 120
    const gap = 20

    ctx.fillStyle = '#0f172a'
    ctx.font = `600 34px ${FONT_FAM}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const titleMaxW = W - pad * 2 - 40
    let title = plan.name
    if (ctx.measureText(title).width > titleMaxW) {
      while (title.length > 0 && ctx.measureText(title + '...').width > titleMaxW) title = title.slice(0, -1)
      title += '...'
    }
    ctx.fillText(title, W / 2, titleY)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    const lineH = 68
    const startY = titleY + 72
    const maxVisible = Math.floor((H - startY - 20) / lineH)

    const nameX = W - pad
    const iconX = pad
    const textX = pad + 40
    const descMaxW = nameX - textX - nameColW - gap

    for (let i = 0; i < Math.min(plan.steps.length, maxVisible); i++) {
      const step = plan.steps[i]
      const y = startY + i * lineH
      const overallStatus = this.stepStatus(step)

      if (overallStatus === 'running') {
        ctx.fillStyle = '#f8fafc'
        if ((ctx as any).roundRect) {
          ctx.beginPath()
          ;(ctx as any).roundRect(pad - 16, y - 36, W - pad * 2 + 32, lineH - 8, 12)
          ctx.fill()
        } else {
          ctx.fillRect(pad - 16, y - 36, W - pad * 2 + 32, lineH - 8)
        }
      }

      ctx.font = `500 24px ${FONT_FAM}`
      if (overallStatus === 'completed') {
        ctx.fillStyle = '#10b981'
        ctx.fillText('✔', iconX, y + 6)
      } else if (overallStatus === 'failed') {
        ctx.fillStyle = '#ef4444'
        ctx.fillText('✘', iconX, y + 6)
      } else if (overallStatus === 'running') {
        const blink = Math.sin(this.elapsed * 4) > 0
        ctx.fillStyle = blink ? '#3b82f6' : '#cbd5e1'
        ctx.fillText('▶', iconX, y + 6)
      } else {
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText('○', iconX, y + 6)
      }

      ctx.font = `500 22px ${FONT_FAM}`
      ctx.fillStyle = overallStatus === 'completed' ? '#64748b' : '#1e293b'
      let desc = step.description
      if (ctx.measureText(desc).width > descMaxW) {
        while (desc.length > 0 && ctx.measureText(desc + '...').width > descMaxW) desc = desc.slice(0, -1)
        desc += '...'
      }
      ctx.fillText(desc, textX, y + 4)

      ctx.font = `500 16px ${FONT_FAM}`
      ctx.fillStyle = overallStatus === 'completed' ? '#94a3b8' : '#475569'
      const names = step.agents.map(a => a.name).join(', ')
      let namesStr = names
      if (ctx.measureText(namesStr).width > nameColW) {
        while (namesStr.length > 0 && ctx.measureText(namesStr + '..').width > nameColW) namesStr = namesStr.slice(0, -1)
        namesStr += '..'
      }
      ctx.textAlign = 'right'
      ctx.fillText(namesStr, nameX, y + 4)
      ctx.textAlign = 'left'
    }

    if (plan.steps.length > maxVisible) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = `400 16px ${FONT_FAM}`
      ctx.fillText(`+${plan.steps.length - maxVisible} more...`, pad, H - 20)
    }
  }

  // ── Render: Multi Plan (project-level dashboard) ──

  private renderMultiPlan(plans: WhiteboardPlanData[]): void {
    const ctx = this.ctx
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const pad = 30
    const titleY = 64
    const nameColW = 120
    const gap = 20

    ctx.fillStyle = '#0f172a'
    ctx.font = `600 34px ${FONT_FAM}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('All Missions', W / 2, titleY)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    const contentStartY = titleY + 72
    const line1H = 34
    const line2H = 30
    const blockGap = 36
    const blockH = line1H + line2H + blockGap
    const maxVisible = Math.floor((H - contentStartY - 20) / blockH)
    const visible = Math.min(plans.length, maxVisible)

    for (let i = 0; i < visible; i++) {
      const plan = plans[i]
      const blockY = contentStartY + i * blockH

      const y1 = blockY
      const doneCount = plan.steps.filter(s => {
        const st = this.stepStatus(s)
        return st === 'completed' || st === 'failed'
      }).length
      const totalCount = plan.steps.length

      ctx.fillStyle = '#94a3b8'
      ctx.font = `600 22px ${FONT_FAM}`
      const numLabel = `#${i + 1}`
      ctx.fillText(numLabel, pad, y1)
      const numW = ctx.measureText(numLabel).width

      ctx.fillStyle = '#0f172a'
      ctx.font = `600 22px ${FONT_FAM}`
      const nameStartX = pad + numW + 14
      const nameMaxW = W - nameStartX - pad - 80 - gap
      let name = plan.name
      if (ctx.measureText(name).width > nameMaxW) {
        while (name.length > 0 && ctx.measureText(name + '...').width > nameMaxW) name = name.slice(0, -1)
        name += '...'
      }
      ctx.fillText(name, nameStartX, y1)

      ctx.font = `500 16px ${FONT_FAM}`
      const currentStep = doneCount + 1 > totalCount ? totalCount : doneCount + 1
      const progressText = `${currentStep}/${totalCount}`
      const slashIdx = progressText.indexOf('/')
      const rightX = W - pad
      const fullW = ctx.measureText(progressText).width
      const currentNum = progressText.substring(0, slashIdx)
      const rest = progressText.substring(slashIdx)
      const currentW = ctx.measureText(currentNum).width
      ctx.fillStyle = '#3b82f6'
      ctx.textAlign = 'left'
      ctx.fillText(currentNum, rightX - fullW, y1)
      ctx.fillStyle = '#64748b'
      ctx.fillText(rest, rightX - fullW + currentW, y1)
      ctx.textAlign = 'left'

      const y2 = blockY + line1H + 8
      const activeStep = this.findActiveStep(plan)
      if (activeStep) {
        const blink = Math.sin(this.elapsed * 4) > 0

        ctx.fillStyle = blink ? '#3b82f6' : '#cbd5e1'
        ctx.font = `500 22px ${FONT_FAM}`
        ctx.fillText('▶', pad + 10, y2)

        ctx.fillStyle = '#475569'
        ctx.font = `500 20px ${FONT_FAM}`
        const descX = pad + 40
        const descMaxW = W - descX - pad - nameColW - gap
        let desc = activeStep.description
        if (ctx.measureText(desc).width > descMaxW) {
          while (desc.length > 0 && ctx.measureText(desc + '...').width > descMaxW) desc = desc.slice(0, -1)
          desc += '...'
        }
        ctx.fillText(desc, descX, y2)

        const agentNames = activeStep.agents.map(a => a.name).join(', ')
        ctx.fillStyle = '#94a3b8'
        ctx.font = `500 16px ${FONT_FAM}`
        let namesStr = agentNames
        if (ctx.measureText(namesStr).width > nameColW) {
          while (namesStr.length > 0 && ctx.measureText(namesStr + '..').width > nameColW) namesStr = namesStr.slice(0, -1)
          namesStr += '..'
        }
        ctx.textAlign = 'right'
        ctx.fillText(namesStr, W - pad, y2)
        ctx.textAlign = 'left'
      }
    }

    if (plans.length > maxVisible) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = `400 14px ${FONT_FAM}`
      ctx.fillText(`+${plans.length - maxVisible} more...`, pad, H - 16)
    }
  }

  // ── Firework particle system ──

  private spawnFirework(): void {
    const cx = W * 0.1 + Math.random() * W * 0.8
    const cy = H * 0.1 + Math.random() * H * 0.6
    const baseColor = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]
    const count = 60 + Math.floor(Math.random() * 60)

    for (let j = 0; j < count; j++) {
      const angle = Math.random() * Math.PI * 2
      const speed = Math.random() * Math.random() * 400 + 50
      const isSparkle = Math.random() > 0.85
      const color = isSparkle ? '#ffffff' : baseColor

      this.fireworks.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.4 + Math.random() * 0.8,
        size: 1.5 + Math.random() * 2.5,
        color,
        history: [],
      })
    }
  }

  private updateFireworks(dt: number): void {
    for (let i = this.fireworks.length - 1; i >= 0; i--) {
      const p = this.fireworks[i]
      p.history.push({ x: p.x, y: p.y })
      if (p.history.length > 6) p.history.shift()

      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 120 * dt
      const drag = Math.pow(0.95, dt * 60)
      p.vx *= drag
      p.vy *= drag

      p.life -= p.decay * dt
      if (p.life <= 0) this.fireworks.splice(i, 1)
    }
  }

  private drawFireworks(): void {
    const ctx = this.ctx
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = 'lighter' as GlobalCompositeOperation

    for (const p of this.fireworks) {
      ctx.globalAlpha = Math.max(0, p.life)

      if (p.history.length > 1) {
        ctx.beginPath()
        ctx.moveTo(p.history[0].x, p.history[0].y)
        for (let i = 1; i < p.history.length; i++) {
          ctx.lineTo(p.history[i].x, p.history[i].y)
        }
        ctx.lineTo(p.x, p.y)
        ctx.strokeStyle = p.color
        ctx.lineWidth = p.size * Math.max(0.2, p.life)
        ctx.stroke()
      } else {
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1.0
    ctx.globalCompositeOperation = 'source-over'
  }

  // ── Render: Celebration (4-phase animation) ──

  private renderCelebration(): void {
    const ctx = this.ctx
    const t = this.celebrationTime

    // Phase 1: 0-1s — Fade to black
    if (t < 1.0) {
      if (this.lastPlans.length === 1) {
        this.renderSinglePlan(this.lastPlans[0])
      } else if (this.lastPlans.length > 1) {
        this.renderMultiPlan(this.lastPlans)
      } else {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, W, H)
      }
      const dimAlpha = Math.min(1.0, t / 1.0)
      ctx.fillStyle = `rgba(10, 10, 10, ${dimAlpha})`
      ctx.fillRect(0, 0, W, H)
      return
    }

    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    // Phase 2: 1-4s — Typewriter + fireworks
    if (t >= 1.0 && t < 4.0) {
      const typeT = t - 1.0
      const charCount = Math.min(Math.floor(typeT / TYPE_SPEED), CELEBRATION_TEXT.length)
      const visibleText = CELEBRATION_TEXT.substring(0, charCount)
      const cursor = charCount < CELEBRATION_TEXT.length && Math.sin(this.elapsed * 10) > 0 ? '_' : ''

      ctx.fillStyle = '#cda77b'
      ctx.font = `bold 44px ${FONT_FAM}`
      ctx.textAlign = 'center'
      ctx.fillText(visibleText + cursor, W / 2, H / 2 + 12)
      ctx.textAlign = 'left'

      if (!this._lastFireworkT || (typeT - this._lastFireworkT) > 0.6) {
        this._lastFireworkT = typeT
        this.spawnFirework()
        if (Math.random() > 0.4) this.spawnFirework()
      }
    }

    // Phase 3: 4-7s — Text stays, fireworks fade
    if (t >= 4.0 && t < 7.0) {
      ctx.fillStyle = '#cda77b'
      ctx.font = `bold 44px ${FONT_FAM}`
      ctx.textAlign = 'center'
      ctx.fillText(CELEBRATION_TEXT, W / 2, H / 2 + 12)
      ctx.textAlign = 'left'
    }

    if (t >= 1.0 && t < 7.0) {
      this.drawFireworks()
    }

    // Phase 4: 7-8s — Fade to white + logo emerges
    if (t >= 7.0) {
      const fadeT = (t - 7.0) / 1.0

      const textAlpha = Math.max(0, 1.0 - fadeT)
      if (textAlpha > 0) {
        ctx.globalAlpha = textAlpha
        ctx.fillStyle = '#cda77b'
        ctx.font = `bold 44px ${FONT_FAM}`
        ctx.textAlign = 'center'
        ctx.fillText(CELEBRATION_TEXT, W / 2, H / 2 + 12)
        ctx.textAlign = 'left'
        ctx.globalAlpha = 1.0
      }

      const whiteAlpha = Math.min(1.0, fadeT)
      ctx.fillStyle = `rgba(255, 255, 255, ${whiteAlpha})`
      ctx.fillRect(0, 0, W, H)

      if (this.idleImageLoaded && this.idleImage && whiteAlpha > 0.3) {
        const logoAlpha = Math.min(1.0, (whiteAlpha - 0.3) / 0.7)
        ctx.globalAlpha = logoAlpha
        const img = this.idleImage
        const scale = Math.min(W / img.width, H / img.height) * 0.95
        const dw = img.width * scale
        const dh = img.height * scale
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
        ctx.globalAlpha = 1.0
      }
    }
  }

  // ── Helpers ──

  private stepStatus(step: WhiteboardPlanData['steps'][0]): string {
    if (step.agents.length === 0) return 'pending'
    const allDone = step.agents.every(a => a.status === 'completed' || a.status === 'failed')
    if (allDone) {
      return step.agents.some(a => a.status === 'failed') ? 'failed' : 'completed'
    }
    const anyStarted = step.agents.some(a => a.status !== 'pending')
    return anyStarted ? 'running' : 'pending'
  }

  private findActiveStep(plan: WhiteboardPlanData): WhiteboardPlanData['steps'][0] | null {
    for (const step of plan.steps) {
      const status = this.stepStatus(step)
      if (status === 'running') return step
    }
    for (const step of plan.steps) {
      if (this.stepStatus(step) === 'pending') return step
    }
    return null
  }
}
