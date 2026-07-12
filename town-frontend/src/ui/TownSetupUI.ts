import type { GameAction } from '../data/GameProtocol'
import { t } from '../i18n'
import {
  type TownConfig,
  getSpecialtyLabel,
  createDefaultTownConfig,
} from '../data/TownConfig'

type ActionEmitter = (action: GameAction) => void

export class TownSetupUI {
  private overlay: HTMLElement
  private card: HTMLElement
  private townConfig: TownConfig

  constructor(_emitter: ActionEmitter) {
    this.overlay = document.getElementById('town-setup-overlay')!
    this.card = document.getElementById('ts-card')!
    this.townConfig = createDefaultTownConfig()
  }

  show(): void {
    this.overlay.classList.add('visible')
  }

  hide(): void {
    this.overlay.classList.remove('visible')
  }

  showOverview(config?: TownConfig): void {
    if (config) this.townConfig = config
    const citizens = this.townConfig.citizens

    const rows = citizens.map((c) => {
      return `
        <div class="ts-citizen-row">
          <div class="ts-citizen-avatar">👤</div>
          <div class="ts-citizen-info">
            <div class="ts-citizen-name">${this.escHtml(c.name)}</div>
            <div class="ts-citizen-spec">${getSpecialtyLabel(c.specialty)}</div>
          </div>
        </div>
      `
    }).join('')

    this.card.className = 'ts-card shimmer'
    this.card.innerHTML = `
      <div class="ts-title">🏘️ ${this.escHtml(this.townConfig.townName)} ${t('setup.title_suffix')}</div>
      <div style="position:relative;">${rows}</div>
      <div class="ts-hint" style="margin-top:12px;">${t('setup.hint')}</div>
      <button class="ts-primary-btn" id="ts-close-btn" style="margin-top:16px;">${t('setup.close')}</button>
    `
    this.show()

    document.getElementById('ts-close-btn')!.addEventListener('click', () => {
      this.hide()
    })
  }

  getTownConfig(): TownConfig {
    return { ...this.townConfig }
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
