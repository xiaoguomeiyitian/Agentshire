import * as THREE from 'three'

interface ActiveBubble {
  el: HTMLDivElement
  contentEl: HTMLDivElement
  indicatorEl: HTMLDivElement
  target: THREE.Object3D
  fullText: string
  pages: string[]
  pageIndex: number
  charIndex: number
  lastCharTime: number
  streaming: boolean
  pageCompleteTime: number
  fadeStart: number
  fadeDuration: number
  removed: boolean
}

const LINE_HEIGHT = 18
const MAX_VISIBLE_LINES = 4
const CHARS_PER_LINE = 13
const PAGE_READ_TIME = 1600
const STREAM_END_LINGER = 2600
const CHAR_SPEED = 30
const NPC_MIN_LINGER = 1200
const NPC_MAX_LINGER = 3600
const NPC_MS_PER_CHAR = 75
const USER_MIN_LINGER = 900
const USER_MAX_LINGER = 1800
const USER_MS_PER_CHAR = 65

export type BubbleRole = 'user' | 'npc'

export function cleanBubbleText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?\s*>/g, '')
    .replace(/^[ \t]*[•·▪◦\-*]\s+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function getBubbleDurationMs(text: string, role: BubbleRole = 'npc'): number {
  const clean = cleanBubbleText(text)
  if (role === 'user') {
    return Math.max(USER_MIN_LINGER, Math.min(clean.length * USER_MS_PER_CHAR, USER_MAX_LINGER))
  }
  return Math.max(NPC_MIN_LINGER, Math.min(clean.length * NPC_MS_PER_CHAR, NPC_MAX_LINGER))
}

function cleanText(text: string): string {
  return cleanBubbleText(text)
}

function paginate(text: string): string[] {
  const clean = cleanText(text)
  if (!clean) return ['']
  const pages: string[] = []
  let current = ''
  let lineCount = 0
  let lineLen = 0

  for (const ch of clean) {
    if (ch === '\n') {
      current += ch
      lineCount++
      lineLen = 0
    } else {
      current += ch
      lineLen++
      if (lineLen >= CHARS_PER_LINE) {
        lineCount++
        lineLen = 0
      }
    }
    if (lineCount >= MAX_VISIBLE_LINES) {
      pages.push(current.trim())
      current = ''
      lineCount = 0
      lineLen = 0
    }
  }
  if (current.trim()) pages.push(current.trim())
  return pages.length ? pages : ['']
}

export type BubbleCallback = (npcId: string, text: string, isStreaming: boolean) => void

export class ChatBubbleSystem {
  private container: HTMLElement
  private camera: THREE.Camera
  private renderer: THREE.WebGLRenderer
  private bubbles: ActiveBubble[] = []
  private onBubbleCb: BubbleCallback | null = null

  constructor(container: HTMLElement, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this.container = container
    this.camera = camera
    this.renderer = renderer

    if (!document.getElementById('bubble-flip-style')) {
      const style = document.createElement('style')
      style.id = 'bubble-flip-style'
      style.textContent = '@keyframes bubbleFlip{0%,100%{opacity:0.3;transform:translateY(0)}50%{opacity:1;transform:translateY(3px)}}'
      document.head.appendChild(style)
    }
  }

  /** Register a callback fired whenever a bubble is shown or streamed. */
  onBubble(cb: BubbleCallback): void {
    this.onBubbleCb = cb
  }

  private fireBubbleCallback(target: THREE.Object3D, text: string, isStreaming: boolean): void {
    if (!this.onBubbleCb) return
    const npcId = (target.userData?.npcId as string) ?? ''
    const clean = cleanBubbleText(text)
    if (!clean) return
    this.onBubbleCb(npcId, clean, isStreaming)
  }

  show(target: THREE.Object3D, text: string, duration?: number): void {
    this.removeBubblesFor(target)
    const b = this.createBubble(target, text, false)
    b.fadeDuration = duration ?? getBubbleDurationMs(text, 'npc')
    this.fireBubbleCallback(target, text, false)
  }

  streamUpdate(target: THREE.Object3D, text: string): void {
    const existing = this.bubbles.find(b => b.target === target)
    if (existing) {
      const oldText = existing.fullText
      existing.fullText = text
      existing.pages = paginate(text)

      const isNewConversation = !text.startsWith(oldText.slice(0, Math.min(oldText.length, 20)))
      if (isNewConversation || existing.pageIndex >= existing.pages.length) {
        existing.pageIndex = 0
        existing.charIndex = 0
        existing.pageCompleteTime = 0
        existing.contentEl.textContent = ''
        existing.indicatorEl.style.display = 'none'
      }

      existing.streaming = true
      existing.el.style.opacity = '1'
      existing.fadeStart = 0
      this.fireBubbleCallback(target, text, true)
      return
    }

    this.createBubble(target, text, true)
    this.fireBubbleCallback(target, text, true)
  }

  endStream(target: THREE.Object3D): void {
    const existing = this.bubbles.find(b => b.target === target)
    if (!existing) return
    existing.streaming = false
  }

  private removeBubblesFor(target: THREE.Object3D): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      if (this.bubbles[i].target === target) {
        const old = this.bubbles[i]
        old.el.style.opacity = '0'
        old.removed = true
        setTimeout(() => old.el.remove(), 300)
        this.bubbles.splice(i, 1)
      }
    }
  }

  private createBubble(target: THREE.Object3D, text: string, streaming: boolean): ActiveBubble {
    const el = document.createElement('div')
    el.style.cssText = `
      position:absolute; pointer-events:none; z-index:50;
      background:rgba(30,35,55,0.92); color:#eee;
      padding:8px 12px 6px; border-radius:12px; font-size:13px;
      max-width:200px; overflow:hidden;
      line-height:${LINE_HEIGHT}px; white-space:pre-wrap; word-break:break-word; overflow-wrap:break-word;
      border:1px solid rgba(255,255,255,0.15);
      box-shadow:0 2px 12px rgba(0,0,0,0.4);
      opacity:0; transition:opacity 0.3s;
    `

    const contentEl = document.createElement('div')
    el.appendChild(contentEl)

    const indicatorEl = document.createElement('div')
    indicatorEl.style.cssText = `
      text-align:center; color:rgba(255,255,255,0.5); font-size:10px;
      animation:bubbleFlip 1.2s ease-in-out infinite; display:none;
      margin-top:2px; height:14px;
    `
    indicatorEl.textContent = '▼'
    el.appendChild(indicatorEl)

    this.container.appendChild(el)
    requestAnimationFrame(() => { el.style.opacity = '1' })

    const pages = paginate(text)
    const bubble: ActiveBubble = {
      el, contentEl, indicatorEl, target,
      fullText: text,
      pages,
      pageIndex: 0,
      charIndex: 0,
      lastCharTime: performance.now(),
      streaming,
      pageCompleteTime: 0,
      fadeStart: 0,
      fadeDuration: STREAM_END_LINGER,
      removed: false,
    }
    this.bubbles.push(bubble)
    return bubble
  }

  update(): void {
    const now = performance.now()
    const canvas = this.renderer.domElement
    const rect = canvas.getBoundingClientRect()

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]
      if (b.removed) continue

      const pageText = b.pages[b.pageIndex] ?? ''
      const isLastPage = b.pageIndex >= b.pages.length - 1

      // --- Typewriter: reveal chars one by one ---
      if (b.charIndex < pageText.length) {
        if (now - b.lastCharTime > CHAR_SPEED) {
          b.charIndex = Math.min(b.charIndex + 1, pageText.length)
          b.lastCharTime = now
          b.contentEl.textContent = pageText.slice(0, b.charIndex)
        }
        b.indicatorEl.style.display = 'none'
      }
      // --- Page complete: show indicator if more pages ---
      else if (!isLastPage) {
        if (b.pageCompleteTime === 0) {
          b.pageCompleteTime = now
        }
        b.indicatorEl.style.display = 'block'

        if (now - b.pageCompleteTime > PAGE_READ_TIME) {
          b.pageIndex++
          b.charIndex = 0
          b.pageCompleteTime = 0
          b.contentEl.textContent = ''
          b.indicatorEl.style.display = 'none'
        }
      }
      // --- Last page complete ---
      else {
        b.indicatorEl.style.display = 'none'

        if (!b.streaming) {
          if (b.fadeStart === 0) {
            b.fadeStart = now
          }
          const fadeElapsed = now - b.fadeStart
          if (fadeElapsed > b.fadeDuration) {
            b.el.style.opacity = '0'
            b.removed = true
            setTimeout(() => b.el.remove(), 300)
            this.bubbles.splice(i, 1)
            continue
          }
          if (fadeElapsed > b.fadeDuration - 500) {
            b.el.style.opacity = String(Math.max(0, (b.fadeDuration - fadeElapsed) / 500))
          }
        }
      }

      // --- Position bubble (hide if target NPC is in a different scene) ---
      if (b.target.userData?.isInActiveScene !== true) {
        b.el.style.display = 'none'
        continue
      }

      const worldPos = new THREE.Vector3()
      b.target.getWorldPosition(worldPos)
      worldPos.y += 2.2

      const ndc = worldPos.clone().project(this.camera)
      const x = (ndc.x * 0.5 + 0.5) * rect.width
      const y = (-ndc.y * 0.5 + 0.5) * rect.height

      if (ndc.z > 1 || x < -100 || x > rect.width + 100) {
        b.el.style.display = 'none'
      } else {
        b.el.style.display = 'block'
        const pad = 8
        const bubbleW = b.el.offsetWidth || 200
        let left = x - bubbleW / 2
        if (left < pad) left = pad
        if (left + bubbleW > rect.width - pad) left = rect.width - pad - bubbleW
        b.el.style.left = left + 'px'
        b.el.style.right = ''
        b.el.style.transform = 'translateY(-100%)'
        b.el.style.top = Math.max(pad, y - 10) + 'px'
      }
    }
  }

  clear(): void {
    this.bubbles.forEach(b => b.el.remove())
    this.bubbles = []
  }

  updateCamera(camera: THREE.Camera): void {
    this.camera = camera
  }
}
