import type { NPC } from '../../npc/NPC'
import type { ModeManager } from './ModeManager'
import type { VFXSystem } from '../visual/VFXSystem'
import type { GameClock } from '../GameClock'
import { BaseOrchestrator } from './BaseOrchestrator'
import { getLocale } from '../../i18n'

const CELEBRATION_PHRASES_ZH: Record<string, string[]> = {
  programmer: ['终于跑通了！', '没有 bug！太好了！', '完美！', 'ship it！', '太酷了！'],
  artist:     ['好好看！', '效果超棒的！', '太满意了！', '视觉完美！'],
  planner:    ['和预期一模一样！', '完美交付！', '大家太厉害了！', '达成目标！'],
  default:    ['太棒了！', '完成啦！', '好厉害！', '🎉', '成功！'],
}

const CELEBRATION_PHRASES_EN: Record<string, string[]> = {
  programmer: ['It runs!', 'Zero bugs!', 'Perfect!', 'Ship it!', 'So cool!'],
  artist:     ['Looks great!', 'Amazing!', 'Love it!', 'Pixel perfect!'],
  planner:    ['Just as planned!', 'Delivered!', 'Team rocks!', 'Goal hit!'],
  default:    ['Awesome!', 'Done!', 'Wow!', '🎉', 'Success!'],
}

function getCelebrationPhrases(): Record<string, string[]> {
  return getLocale() === 'en' ? CELEBRATION_PHRASES_EN : CELEBRATION_PHRASES_ZH
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export interface CelebrationConfig {
  steward: NPC
  mayor: NPC | null
  npcs: NPC[]
  gameName: string
  teamText: string
  iframeSrc: string
  coverUrl: string | null
  inOffice: boolean
  modeManager: ModeManager
  vfx: VFXSystem
  gameClock: GameClock
  onBubble: (npc: NPC, text: string, durationMs: number) => void
  onScreenFlash: () => void
  onSetAllScreens: (state: string) => void
  onShowPopup: (opts: {
    gameName: string; iframeSrc: string; onClose: () => void
  }) => void
  onSwitchScene: (scene: 'town') => Promise<void>
  onFadeToBlack: (ms: number) => Promise<void>
  onFadeFromBlack: (ms: number) => Promise<void>
  onRestoreLifeMode: (npcs: NPC[]) => void
}

export class CelebrationOrchestrator extends BaseOrchestrator<CelebrationConfig> {

  async run(cfg: CelebrationConfig): Promise<void> {

    if (cfg.inOffice) {
      await this.publishingPhase(cfg)
      if (this.shouldAbort()) return

      await this.celebratingPhase(cfg)
      if (this.shouldAbort()) return
    }

    await this.popupPhase(cfg)
  }

  // ── Phase 1: Publishing (~6s) ──

  private async publishingPhase(cfg: CelebrationConfig): Promise<void> {
    cfg.onSetAllScreens('publishing')
    cfg.onBubble(cfg.steward, getLocale() === 'en' ? 'All done! Publishing...' : '全部完成！正在发布...', 2000)

    await this.delay(2000)
    if (this.shouldAbort()) return

    await this.delay(3000)
    if (this.shouldAbort()) return

    cfg.onSetAllScreens('done')

    await this.delay(1000)
    if (this.shouldAbort()) return

    cfg.modeManager.advanceWorkState('celebrating')
  }

  // ── Phase 2: Celebrating (~5s) ──

  private async celebratingPhase(cfg: CelebrationConfig): Promise<void> {
    cfg.onScreenFlash()

    const stewardPos = cfg.steward.getPosition()
    setTimeout(() => cfg.vfx.confetti(stewardPos, 200, 3000), 300)
    setTimeout(() => cfg.vfx.lightPillar(stewardPos, 1500), 500)

    for (const npc of cfg.npcs) {
      npc.playAnim('idle')
    }
    await this.delay(500)
    if (this.shouldAbort()) return

    for (const npc of cfg.npcs) {
      npc.playAnim('cheer')
    }
    cfg.steward.playAnim('cheer')
    cfg.mayor?.playAnim('cheer')

    await this.delay(500)
    if (this.shouldAbort()) return

    for (const npc of cfg.npcs) {
      const role = (npc as any).persona?.role || 'default'
      const phrases = getCelebrationPhrases()[role] || getCelebrationPhrases().default
      cfg.onBubble(npc, pick(phrases), 3000)
    }
    cfg.onBubble(cfg.steward, getLocale() === 'en' ? 'Great job, everyone!' : '太棒了！大家辛苦了！', 3000)

    await this.delay(3000)
    if (this.shouldAbort()) return

    for (const npc of cfg.npcs) {
      npc.playAnim('wave')
    }
    cfg.steward.playAnim('wave')
    cfg.mayor?.playAnim('wave')

    await this.delay(1500)
    if (this.shouldAbort()) return

    for (const npc of cfg.npcs) {
      npc.playAnim('idle')
    }
    cfg.steward.playAnim('idle')
    cfg.mayor?.playAnim('idle')
  }

  // ── Phase 3: Popup (user interaction) ──

  private popupPhase(cfg: CelebrationConfig): Promise<void> {
    return new Promise<void>((resolve) => {
      cfg.onShowPopup({
        gameName: cfg.gameName,
        iframeSrc: cfg.iframeSrc,
        onClose: () => resolve(),
      })
    })
  }

}
