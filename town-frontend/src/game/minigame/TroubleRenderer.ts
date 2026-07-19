import * as THREE from 'three'
import type { NPC } from '../../npc/NPC'
import type { NPCConfig } from '../../types'
import { buildAvatarEl } from '../../ui/ui-utils'
import { getLocale } from '../../i18n'

function rand(a: number, b: number): number { return a + Math.random() * (b - a) }

interface OrbData {
  id: number
  npcId: string
  grade: string
  el: HTMLDivElement
  offsetX: number
  offsetY: number
}

interface BossData {
  id: number
  el: HTMLDivElement
  container: HTMLDivElement
  stage: number
  hp: number
  maxHp: number
  lastClickTime: number
  hitCount: number
  x: number
  y: number
  targetX: number
  targetY: number
  speed: number
  pauseTimer: number
  trailTimer: number
  dashCount: number
  maxDashes: number
  hpFill: HTMLElement
  hpBar: HTMLElement
}

interface SmokeData {
  container: HTMLDivElement
  puffs: HTMLSpanElement[]
}

type OrbClickHandler = (orb: OrbData) => void
type BossClickHandler = (boss: BossData, e: MouseEvent) => void

const _pos = new THREE.Vector3()
const _ndc = new THREE.Vector3()

export type { OrbData, BossData, SmokeData }

export class TroubleRenderer {
  private camera!: THREE.Camera
  private renderer!: THREE.WebGLRenderer
  private container!: HTMLElement
  private getNpc!: (id: string) => NPC | undefined

  private hudEl: HTMLDivElement | null = null
  private hudCombo: HTMLDivElement | null = null
  private hudVoice: HTMLDivElement | null = null
  private hudFadeTimer: ReturnType<typeof setTimeout> | null = null
  private smokeEls = new Map<string, SmokeData>()

  mount(camera: THREE.Camera, renderer: THREE.WebGLRenderer, container: HTMLElement, getNpc: (id: string) => NPC | undefined): void {
    this.camera = camera
    this.renderer = renderer
    this.container = container
    this.getNpc = getNpc
    this.createHud()
  }

  private createHud(): void {
    if (this.hudEl) return
    const hud = document.createElement('div')
    hud.className = 'bw-hud'
    hud.innerHTML = '<div class="bw-hud-combo"></div><div class="bw-hud-voice"></div>'
    this.container.appendChild(hud)
    this.hudEl = hud
    this.hudCombo = hud.querySelector('.bw-hud-combo')
    this.hudVoice = hud.querySelector('.bw-hud-voice')
  }

  // ── Orbs ──

  createOrb(id: number, npcId: string, grade: string, slotOffset: { ox: number; oy: number }, onClick: OrbClickHandler): OrbData {
    const el = document.createElement('div')
    el.className = `banwei banwei-${grade} clickable`
    el.style.cssText = `--bw-size:30px; position:fixed; z-index:15; pointer-events:auto; cursor:pointer;`
    el.style.animationDelay = `${rand(0, 2)}s`
    this.container.appendChild(el)

    const orb: OrbData = {
      id, npcId, grade, el,
      offsetX: slotOffset.ox + rand(-6, 6),
      offsetY: slotOffset.oy + rand(-6, 6),
    }

    const stopPointer = (e: Event) => e.stopPropagation()
    el.addEventListener('pointerdown', stopPointer)
    el.addEventListener('pointerup', stopPointer)
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick(orb)
    })
    return orb
  }

  popOrb(orb: OrbData): void {
    orb.el.classList.remove('clickable')
    orb.el.classList.add('popping')
  }

  removeOrbEl(orb: OrbData): void {
    orb.el.remove()
  }

  addPulseIndicator(el: HTMLDivElement): void {
    const pulse = document.createElement('div')
    pulse.style.cssText = `
      position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      width:100%; height:100%; border-radius:50%; pointer-events:none;
      border: 2px solid rgba(255,255,255,0.6);
      animation: pulse-ring 1s ease-out 3;
    `
    el.appendChild(pulse)
    pulse.addEventListener('animationend', () => pulse.remove())
    if (!document.getElementById('bw-pulse-ring-style')) {
      const s = document.createElement('style')
      s.id = 'bw-pulse-ring-style'
      s.textContent = '@keyframes pulse-ring { 0% { transform:translate(-50%,-50%) scale(1); opacity:1; } 100% { transform:translate(-50%,-50%) scale(2.2); opacity:0; } }'
      document.head.appendChild(s)
    }
  }

  updateOrbPositions(orbs: OrbData[]): void {
    const cam = this.camera
    const el = this.renderer.domElement
    const w = el.clientWidth
    const h = el.clientHeight

    for (const orb of orbs) {
      const npc = this.getNpc(orb.npcId)
      if (!npc) continue
      npc.mesh.getWorldPosition(_pos)
      _pos.y += 0.7
      _ndc.copy(_pos).project(cam)
      if (_ndc.z > 1) { orb.el.style.display = 'none'; continue }
      const sx = (_ndc.x * 0.5 + 0.5) * w + orb.offsetX
      const sy = (-_ndc.y * 0.5 + 0.5) * h + orb.offsetY
      orb.el.style.display = ''
      orb.el.style.left = sx + 'px'
      orb.el.style.top = sy + 'px'
    }
  }

  // ── Boss ──

  createBoss(id: number, stageIndex: number, bossHp: number, onClick: BossClickHandler): BossData {
    const stageClass = `boss-stage-${stageIndex + 1}`

    const bossContainer = document.createElement('div')
    bossContainer.className = 'boss-goo-container'
    bossContainer.style.cssText = `position:fixed; z-index:16; pointer-events:auto;`

    const el = document.createElement('div')
    el.className = `banwei-boss ${stageClass} clickable-boss`
    el.style.cssText = `--bw-boss-size:90px; cursor:pointer;`
    el.innerHTML = `
      <div class="boss-hp-bar"><div class="boss-hp-fill"></div></div>
      <span class="boss-eye boss-eye-left"></span>
      <span class="boss-eye boss-eye-right"></span>
      <span class="boss-mouth"></span>
    `
    bossContainer.appendChild(el)

    const x = rand(100, window.innerWidth - 100)
    const y = rand(100, window.innerHeight - 140)
    bossContainer.style.left = x + 'px'
    bossContainer.style.top = y + 'px'
    this.container.appendChild(bossContainer)

    const boss: BossData = {
      id, el, container: bossContainer,
      stage: stageIndex + 1,
      hp: bossHp, maxHp: bossHp,
      lastClickTime: 0, hitCount: 0,
      x, y, targetX: x, targetY: y,
      speed: stageIndex === 2 ? rand(80, 150) : rand(40, 100),
      pauseTimer: rand(0.5, 1.5),
      trailTimer: 0,
      dashCount: 0, maxDashes: 3,
      hpFill: el.querySelector('.boss-hp-fill')!,
      hpBar: el.querySelector('.boss-hp-bar')!,
    }

    this.updateBossBar(boss)
    const stopPointer = (e: Event) => e.stopPropagation()
    bossContainer.addEventListener('pointerdown', stopPointer)
    bossContainer.addEventListener('pointerup', stopPointer)
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick(boss, e)
    })

    return boss
  }

  updateBossBar(boss: BossData): void {
    const pct = boss.hp / boss.maxHp
    boss.hpFill.style.width = (pct * 100) + '%'
    if (pct > 0.6) {
      boss.hpFill.style.background = 'linear-gradient(90deg, #4ade80, #22c55e)'
      boss.hpFill.style.boxShadow = '0 0 10px rgba(74,222,128,0.5), inset 0 1px 2px rgba(255,255,255,0.4)'
    } else if (pct > 0.35) {
      boss.hpFill.style.background = 'linear-gradient(90deg, #facc15, #eab308)'
      boss.hpFill.style.boxShadow = '0 0 10px rgba(250,204,21,0.5), inset 0 1px 2px rgba(255,255,255,0.4)'
    } else {
      boss.hpFill.style.background = 'linear-gradient(90deg, #f87171, #ef4444)'
      boss.hpFill.style.boxShadow = '0 0 10px rgba(239,68,68,0.5), inset 0 1px 2px rgba(255,255,255,0.4)'
    }
  }

  updateBossMovement(boss: BossData, dt: number): void {
    const isDashing = boss.speed > 500
    boss.trailTimer = (boss.trailTimer || 0) + dt
    const trailInterval = boss.pauseTimer > 0 ? 0.25 : 0.1
    if (!isDashing && boss.trailTimer >= trailInterval) {
      boss.trailTimer = 0
      this.spawnBossTrailParticle(boss)
    }

    if (boss.pauseTimer > 0) {
      boss.pauseTimer -= dt
      return
    }

    const dx = boss.targetX - boss.x
    const dy = boss.targetY - boss.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 5) {
      if (boss.dashCount > 0) {
        boss.pauseTimer = 0.05
        this.startNextDash(boss)
      } else {
        boss.targetX = rand(60, window.innerWidth - 60)
        boss.targetY = rand(60, window.innerHeight - 100)
        boss.speed = boss.stage === 3 ? rand(80, 150) : rand(40, 100)
        boss.pauseTimer = rand(0.5, 1.5)
      }
      return
    }

    let step = boss.speed * dt
    if (isDashing && dist < 150) {
      step = Math.min(Math.max(800 * dt, dist * 8 * dt), dist)
    } else {
      step = Math.min(step, dist)
    }

    const moveX = (dx / dist) * step
    const moveY = (dy / dist) * step
    const lastX = boss.x
    const lastY = boss.y

    boss.x += moveX
    boss.y += moveY

    const moveDist = Math.sqrt(moveX * moveX + moveY * moveY)
    if (moveDist > 20) {
      const color = this.getBossTrailColor(boss)
      const steps = Math.floor(moveDist / 20)
      for (let i = 1; i <= steps; i++) {
        const interX = lastX + (moveX / steps) * i
        const interY = lastY + (moveY / steps) * i
        this.spawnBossPhysicsParticle(interX, interY, moveX, moveY, color)
      }
    }

    const wobble = isDashing ? 0 : Math.sin(performance.now() * 0.003) * 3
    boss.container.style.left = (boss.x + wobble) + 'px'
    boss.container.style.top = boss.y + 'px'
  }

  triggerBossDash(boss: BossData): void {
    boss.dashCount = boss.maxDashes
    this.startNextDash(boss)
  }

  private startNextDash(boss: BossData): void {
    if (boss.dashCount <= 0) {
      boss.speed = rand(80, 150)
      boss.pauseTimer = rand(0.5, 1.0)
      return
    }
    boss.dashCount--
    boss.speed = rand(1500, 2200)
    this.spawnBossGhost(boss)

    const angle = Math.random() * Math.PI * 2
    const dist = rand(300, 500)
    let tx = boss.x + Math.cos(angle) * dist
    let ty = boss.y + Math.sin(angle) * dist
    const padX = 80, padY = 120, w = window.innerWidth, h = window.innerHeight
    if (tx < padX) tx = padX + (padX - tx)
    else if (tx > w - padX) tx = (w - padX) - (tx - (w - padX))
    if (ty < padX) ty = padX + (padX - ty)
    else if (ty > h - padY) ty = (h - padY) - (ty - (h - padY))
    tx = Math.max(padX, Math.min(w - padX, tx))
    ty = Math.max(padX, Math.min(h - padY, ty))

    boss.targetX = tx
    boss.targetY = ty
    boss.pauseTimer = 0
  }

  private spawnBossGhost(boss: BossData): void {
    const ghost = boss.container.cloneNode(true) as HTMLElement
    ghost.style.pointerEvents = 'none'
    ghost.style.opacity = '0.35'
    ghost.style.filter = 'blur(4px)'
    ghost.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out'
    ghost.style.left = boss.container.style.left
    ghost.style.top = boss.container.style.top
    ghost.style.transform = 'scale(1.1)'
    this.container.appendChild(ghost)
    requestAnimationFrame(() => { ghost.style.opacity = '0' })
    setTimeout(() => ghost.remove(), 450)
  }

  private getBossTrailColor(boss: BossData): string {
    switch (boss.stage) {
      case 1: return 'rgba(180, 170, 210, 0.5)'
      case 2: return 'rgba(160, 160, 165, 0.5)'
      case 3: return 'rgba(220, 130, 130, 0.5)'
      default: return 'rgba(180, 170, 210, 0.5)'
    }
  }

  private spawnBossTrailParticle(boss: BossData): void {
    const color = this.getBossTrailColor(boss)
    const size = 6 + Math.random() * 8
    const p = document.createElement('div')
    p.style.cssText = `
      position:fixed; left:${boss.x + 45}px; top:${boss.y + 45 + size}px;
      width:${size}px; height:${size}px; background:${color};
      border-radius:50%; pointer-events:none; z-index:14; filter:blur(2px);
      --tx:${(Math.random()-0.5)*20}px; --ty:${20+Math.random()*20}px;
      animation: organic-fade 0.8s ease-out forwards;
    `
    this.container.appendChild(p)
    p.addEventListener('animationend', () => p.remove())
  }

  private spawnBossPhysicsParticle(x: number, y: number, dx: number, dy: number, color: string): void {
    const size = 6 + Math.random() * 8
    const tx = dx * 0.3 + (Math.random() - 0.5) * 40
    const ty = dy * 0.3 + (Math.random() - 0.5) * 40 + 30
    const p = document.createElement('div')
    p.style.cssText = `
      position:fixed; left:${x + 45 + (Math.random()-0.5)*20}px; top:${y + 90 + Math.random()*10}px;
      width:${size}px; height:${size}px; background:${color};
      border-radius:50%; pointer-events:none; z-index:14; filter:blur(2px);
      --tx:${tx}px; --ty:${ty}px; animation: organic-fade 0.8s ease-out forwards;
    `
    this.container.appendChild(p)
    p.addEventListener('animationend', () => p.remove())
  }

  bossHitFlash(boss: BossData): void {
    boss.el.classList.add('boss-flash')
    setTimeout(() => boss.el.classList.remove('boss-flash'), 80)
  }

  bossHitAnim(boss: BossData): void {
    boss.el.classList.remove('hit')
    void boss.el.offsetWidth
    boss.el.classList.add('hit')
    setTimeout(() => boss.el.classList.remove('hit'), 200)
  }

  bossCrack(boss: BossData): void {
    boss.el.classList.add('boss-cracked')
  }

  bossExplode(boss: BossData): void {
    boss.el.classList.add('exploding')
    boss.hpBar.style.opacity = '0'
  }

  removeBoss(boss: BossData): void {
    boss.container.remove()
  }

  // ── Smoke ──

  updateSmoke(npcId: string, worry: number): void {
    const existing = this.smokeEls.get(npcId)
    if (worry < 40) {
      if (existing) { existing.container.remove(); this.smokeEls.delete(npcId) }
      return
    }

    const puffCount = worry >= 80 ? 8 : worry >= 60 ? 5 : 3

    if (!existing) {
      const smokeContainer = document.createElement('div')
      smokeContainer.className = 'npc-smoke-container'
      this.container.appendChild(smokeContainer)
      const puffs: HTMLSpanElement[] = []
      for (let i = 0; i < 8; i++) {
        const puff = document.createElement('span')
        puff.className = 'npc-smoke-puff'
        puff.style.animationDelay = `${i * 1.2}s`
        smokeContainer.appendChild(puff)
        puffs.push(puff)
      }
      this.smokeEls.set(npcId, { container: smokeContainer, puffs })
    }

    const data = this.smokeEls.get(npcId)!
    data.puffs.forEach((p, i) => { p.style.display = i < puffCount ? '' : 'none' })
    const alpha = worry >= 80 ? 0.9 : worry >= 60 ? 0.75 : 0.55
    data.container.style.setProperty('--smoke-alpha', String(alpha))
  }

  updateSmokePositions(): void {
    const cam = this.camera
    const el = this.renderer.domElement
    for (const [npcId, data] of this.smokeEls) {
      const npc = this.getNpc(npcId)
      if (!npc) continue
      npc.mesh.getWorldPosition(_pos)
      _pos.y += 1.6
      _ndc.copy(_pos).project(cam)
      if (_ndc.z > 1) { data.container.style.display = 'none'; continue }
      const sx = (_ndc.x * 0.5 + 0.5) * el.clientWidth
      const sy = (-_ndc.y * 0.5 + 0.5) * el.clientHeight
      data.container.style.display = ''
      data.container.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`
    }
  }

  clearNpcSmoke(npcId: string): void {
    const data = this.smokeEls.get(npcId)
    if (data) { data.container.remove(); this.smokeEls.delete(npcId) }
  }

  // ── VFX helpers ──

  shakeScreen(strong?: boolean): void {
    const cls = strong ? 'screen-shake-strong' : 'screen-shake'
    this.container.classList.remove('screen-shake', 'screen-shake-strong')
    void this.container.offsetWidth
    this.container.classList.add(cls)
    this.container.addEventListener('animationend', () => this.container.classList.remove(cls), { once: true })
  }

  spawnParticles(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div')
      p.className = 'boss-hit-particle'
      const angle = (Math.PI * 2 / count) * i + rand(-0.3, 0.3)
      const dist = rand(25, 50)
      p.style.cssText = `left:${x}px;top:${y}px;background:${color};--px:${Math.cos(angle)*dist}px;--py:${Math.sin(angle)*dist}px;width:${rand(4,8)}px;height:${rand(4,8)}px;`
      this.container.appendChild(p)
      p.addEventListener('animationend', () => p.remove())
    }
  }

  flashOverlay(color: string): void {
    const el = document.createElement('div')
    el.className = 'boss-flash-overlay'
    el.style.background = color
    this.container.appendChild(el)
    el.addEventListener('animationend', () => el.remove())
  }

  // ── HUD ──

  showCombo(n: number): void {
    const el = this.hudCombo
    if (!el) return
    let text: string, cls: string
    const isEn = getLocale() === 'en'
    if (n >= 10)     { text = isEn ? `Worry-free!!! x${n}` : `烦恼全消!!! x${n}`; cls = 'bw-combo-10' }
    else if (n >= 7) { text = isEn ? `Relieved! x${n}` : `知心解忧! x${n}`;   cls = 'bw-combo-7' }
    else if (n >= 4) { text = isEn ? `Comforted! x${n}` : `温暖治愈! x${n}`;   cls = 'bw-combo-4' }
    else if (n >= 2) { text = isEn ? `Cheered! x${n}` : `开心! x${n}`;       cls = 'bw-combo-2' }
    else return

    el.textContent = text
    el.className = 'bw-hud-combo ' + cls
    void el.offsetWidth
    el.classList.add('show')
    if (n >= 10) {
      el.style.animation = 'combo-slam-mega 0.7s cubic-bezier(0.22,1,0.36,1) forwards'
    } else {
      el.style.animation = ''
    }
    this.showHud()
  }

  showVoice(npc: { name: string; initial: string; color: string; config?: NPCConfig | null }, text: string, isWarn: boolean): void {
    const el = this.hudVoice
    if (!el) return
    el.innerHTML = ''
    el.className = 'bw-hud-voice' + (isWarn ? ' bw-voice-warn' : '')

    let avatar: HTMLElement
    if (npc.config) {
      avatar = buildAvatarEl('bw-voice-avatar', npc.config, 28)
      ;(avatar as HTMLElement).style.setProperty('--avatar-color', npc.color)
    } else {
      const fallbackAvatar = document.createElement('span')
      fallbackAvatar.className = 'bw-voice-avatar'
      fallbackAvatar.style.setProperty('--avatar-color', npc.color)
      fallbackAvatar.textContent = npc.initial
      avatar = fallbackAvatar
    }

    const txt = document.createElement('span')
    txt.className = 'bw-voice-text'
    txt.textContent = isWarn ? text : `${npc.name}: "${text}"`

    el.appendChild(avatar)
    el.appendChild(txt)
    void el.offsetWidth
    el.classList.add('show')
    this.showHud()
  }

  clearCombo(): void {
    if (!this.hudCombo) return
    this.hudCombo.textContent = ''
    this.hudCombo.className = 'bw-hud-combo'
    this.hudCombo.style.animation = ''
  }

  clearVoice(): void {
    if (!this.hudVoice) return
    this.hudVoice.innerHTML = ''
    this.hudVoice.className = 'bw-hud-voice'
  }

  showHud(): void {
    this.hudEl?.classList.remove('fading')
  }

  hideHud(): void {
    this.hudEl?.classList.add('fading')
  }

  cancelHudFade(): void {
    if (this.hudFadeTimer) { clearTimeout(this.hudFadeTimer); this.hudFadeTimer = null }
  }

  scheduleHudFade(ms: number, afterFadeCb?: () => void): void {
    this.cancelHudFade()
    this.hudFadeTimer = setTimeout(() => {
      this.hideHud()
      if (afterFadeCb) setTimeout(afterFadeCb, 500)
    }, ms)
  }

  // ── Visibility (scene switch) ──

  setAllVisible(visible: boolean, orbs: OrbData[], bosses: BossData[]): void {
    const display = visible ? '' : 'none'
    for (const orb of orbs) orb.el.style.display = display
    for (const boss of bosses) boss.container.style.display = display
    for (const data of this.smokeEls.values()) data.container.style.display = display
    if (this.hudEl) this.hudEl.style.display = display
  }

  // ── Cleanup ──

  clearAll(): void {
    for (const data of this.smokeEls.values()) data.container.remove()
    this.smokeEls.clear()
  }

  destroy(): void {
    this.clearAll()
    this.hudEl?.remove()
    this.hudEl = null
    this.hudCombo = null
    this.hudVoice = null
    if (this.hudFadeTimer) clearTimeout(this.hudFadeTimer)
  }
}
