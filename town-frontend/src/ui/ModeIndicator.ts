import type { ModeState, WorkSubState } from '../types'
import { getWorkSubStateLabel } from '../types'
import { createFilledGearIcon } from './LucideIcon'
import { t } from '../i18n'

export class ModeIndicator {
  private container: HTMLElement
  private iconWrap: HTMLSpanElement
  private textEl: HTMLSpanElement
  private progressWrap: HTMLElement | null = null
  private progressBar: HTMLElement | null = null
  private progressText: HTMLSpanElement | null = null
  private actionBtn: HTMLButtonElement | null = null
  private visible = true
  private lastKey = ''
  private currentSceneType: 'town' | 'office' | 'other' = 'town'
  private onAction: (() => void) | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'mode-indicator'
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'linear-gradient(180deg, rgba(30,35,60,0.72) 0%, rgba(15,18,35,0.68) 100%)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      borderRadius: '22px',
      padding: '7px 16px',
      color: '#fff',
      fontFamily: "'SF Pro Rounded', system-ui, sans-serif",
      fontSize: '13px',
      fontWeight: '500',
      letterSpacing: '0.3px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'auto',
      userSelect: 'none',
      zIndex: '999',
      transition: 'opacity 0.4s ease',
      opacity: '1',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
      maxWidth: 'calc(100vw - 200px)',
      overflow: 'hidden',
    })

    this.iconWrap = document.createElement('span')
    Object.assign(this.iconWrap.style, {
      display: 'flex',
      alignItems: 'center',
      flexShrink: '0',
      position: 'relative',
      zIndex: '1',
      lineHeight: '0',
    })

    this.textEl = document.createElement('span')
    Object.assign(this.textEl.style, {
      whiteSpace: 'nowrap',
      position: 'relative',
      zIndex: '1',
    })

    this.container.appendChild(this.iconWrap)
    this.container.appendChild(this.textEl)

    this.injectStyles()
    document.body.appendChild(this.container)

    this.renderLife()
  }

  setSceneType(sceneType: string): void {
    if (sceneType === 'office') this.currentSceneType = 'office'
    else if (sceneType === 'town') this.currentSceneType = 'town'
    else this.currentSceneType = 'other'
    this.lastKey = ''
    this.updateActionButtonLabel()
  }

  setActionCallback(fn: () => void): void {
    this.onAction = fn
  }

  setActionCompact(_compact: boolean): void {
    this.updateActionButtonLabel()
  }

  update(state: ModeState): void {
    if (!this.visible) return

    const sceneKey = this.currentSceneType
    const key = state.mode === 'work'
      ? `work:${state.workSubState ?? ''}:${sceneKey}`
      : `life:${sceneKey}`

    if (key === this.lastKey) return
    this.lastKey = key

    if (state.mode === 'life') {
      this.renderLife()
    } else {
      this.renderWork(state.workSubState)
    }
  }

  setProgress(completed: number, total: number): void {
    if (!this.progressBar || !this.progressText) return
    const pct = total > 0 ? (completed / total) * 100 : 0
    this.progressBar.style.width = `${pct}%`
    this.progressText.textContent = `${completed}/${total}`
  }

  private renderLife(): void {
    this.clearExtras()
    this.container.style.display = 'none'
    this.container.classList.remove('mode-indicator--work')
    this.ensureActionButton()
  }

  private renderWork(subState?: WorkSubState): void {
    this.container.style.display = 'flex'
    const label = subState ? getWorkSubStateLabel(subState) : t('mode.work')

    this.iconWrap.innerHTML = ''
    const gearSvg = createFilledGearIcon(18, '#3b82f6')
    gearSvg.classList.add('mi-gear-anim')
    this.iconWrap.appendChild(gearSvg)

    this.textEl.textContent = label
    this.container.classList.add('mode-indicator--work')

    this.ensureProgressBar()
    this.ensureActionButton()
  }

  private ensureProgressBar(): void {
    if (this.progressWrap) return

    this.progressWrap = document.createElement('div')
    Object.assign(this.progressWrap.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      position: 'relative',
      zIndex: '1',
    })

    const barOuter = document.createElement('div')
    Object.assign(barOuter.style, {
      width: '56px',
      height: '5px',
      borderRadius: '3px',
      background: 'rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
      overflow: 'hidden',
      flexShrink: '0',
    })

    this.progressBar = document.createElement('div')
    this.progressBar.className = 'mi-bar-inner'
    Object.assign(this.progressBar.style, {
      height: '100%',
      width: '0%',
      borderRadius: '3px',
      background: 'linear-gradient(90deg, #2563eb, #3b82f6, #60a5fa)',
      boxShadow: '0 0 6px rgba(59,130,246,0.45), 0 0 2px rgba(59,130,246,0.7)',
      transition: 'width 0.5s ease',
      position: 'relative',
      overflow: 'hidden',
    })
    barOuter.appendChild(this.progressBar)

    this.progressText = document.createElement('span')
    Object.assign(this.progressText.style, {
      fontSize: '12px',
      opacity: '0.7',
      fontVariantNumeric: 'tabular-nums',
      flexShrink: '0',
      position: 'relative',
      zIndex: '1',
    })
    this.progressText.textContent = '0/0'

    this.progressWrap.appendChild(barOuter)
    this.progressWrap.appendChild(this.progressText)
    this.container.appendChild(this.progressWrap)
  }

  private ensureActionButton(): void {
    if (this.actionBtn) {
      this.updateActionButtonLabel()
      return
    }

    this.actionBtn = document.createElement('button')
    Object.assign(this.actionBtn.style, {
      position: 'fixed',
      top: '12px',
      left: '12px',
      background: 'rgba(20, 20, 30, 0.7)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      borderRadius: '20px',
      color: '#fff',
      fontSize: '13px',
      fontWeight: '500',
      padding: '7px 16px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontFamily: "'SF Pro Rounded', system-ui, sans-serif",
      transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
      zIndex: '999',
    })
    this.actionBtn.addEventListener('mouseenter', () => {
      if (this.actionBtn) {
        this.actionBtn.style.background = 'rgba(40, 40, 50, 0.8)'
        this.actionBtn.style.borderColor = 'rgba(255, 255, 255, 0.25)'
        this.actionBtn.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5)'
      }
    })
    this.actionBtn.addEventListener('mouseleave', () => {
      if (this.actionBtn) {
        this.actionBtn.style.background = 'rgba(20, 20, 30, 0.7)'
        this.actionBtn.style.borderColor = 'rgba(255, 255, 255, 0.1)'
        this.actionBtn.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)'
      }
    })
    this.actionBtn.addEventListener('click', () => {
      this.onAction?.()
    })
    this.updateActionButtonLabel()
    document.body.appendChild(this.actionBtn)
  }

  private updateActionButtonLabel(): void {
    if (!this.actionBtn) return
    this.actionBtn.style.display = 'none'
  }

  private clearExtras(): void {
    if (this.progressWrap) {
      this.progressWrap.remove()
      this.progressWrap = null
      this.progressBar = null
      this.progressText = null
    }
    if (this.actionBtn) {
      this.actionBtn.remove()
      this.actionBtn = null
    }
  }

  show(): void {
    this.visible = true
    this.container.style.opacity = '1'
  }

  hide(): void {
    this.visible = false
    this.container.style.opacity = '0'
  }

  destroy(): void {
    this.container.remove()
  }

  private injectStyles(): void {
    if (document.getElementById('mode-indicator-style')) return
    const style = document.createElement('style')
    style.id = 'mode-indicator-style'
    style.textContent = `
      @keyframes mi-gear-breathe {
        0%   { transform: rotate(0deg); }
        12%  { transform: rotate(0deg); }
        82%  { transform: rotate(360deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes mi-gear-glow {
        0%, 12%, 82%, 100% { filter: drop-shadow(0 0 2px rgba(59,130,246,0.25)); }
        47%                { filter: drop-shadow(0 0 7px rgba(59,130,246,0.6)); }
      }
      .mi-gear-anim {
        animation: mi-gear-breathe 3s ease-in-out infinite, mi-gear-glow 3s ease-in-out infinite;
      }

      @keyframes mi-sweep {
        0%   { left: -30%; opacity: 0; }
        10%  { opacity: 1; }
        50%  { left: 120%; opacity: 1; }
        60%  { opacity: 0; }
        100% { left: 120%; opacity: 0; }
      }
      .mode-indicator--work::before {
        content: '';
        position: absolute;
        top: 0;
        left: -30%;
        width: 25%;
        height: 100%;
        background: linear-gradient(90deg,
          transparent 0%,
          rgba(59,130,246,0.05) 30%,
          rgba(255,255,255,0.3) 50%,
          rgba(59,130,246,0.05) 70%,
          transparent 100%
        );
        transform: skewX(-25deg);
        mix-blend-mode: overlay;
        animation: mi-sweep 3s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        pointer-events: none;
        border-radius: inherit;
        z-index: 10;
      }

      @keyframes mi-bar-shimmer {
        0%   { left: -80%; }
        100% { left: 180%; }
      }
      .mi-bar-inner::after {
        content: '';
        position: absolute;
        top: 0; left: -80%; width: 80%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
        animation: mi-bar-shimmer 2s ease-in-out infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .mi-gear-anim { animation: none; }
        .mode-indicator--work::before { animation: none; }
        .mi-bar-inner::after { animation: none; }
      }
    `
    document.head.appendChild(style)
  }
}
