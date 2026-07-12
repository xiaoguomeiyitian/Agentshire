import type { NPC } from '../../npc/NPC'
import type { ModeManager } from './ModeManager'
import type { DailyBehavior } from '../../npc/DailyBehavior'
import type { ActivityJournal } from '../../npc/ActivityJournal'
import { WAYPOINTS } from '../../types'
import { BaseOrchestrator } from './BaseOrchestrator'
import { getLocale } from '../../i18n'

// ── Role-based acceptance phrases (v2.1: indexed by role, not NPC name) ──

const ACCEPT_PHRASES_ZH: Record<string, string[]> = {
  programming: ['收到，我看看。', '没问题，开搞！', '了解了解！', '好的！我有想法了！'],
  design:       ['好的，交给我！', '没问题，我来！', '放心吧～', '包在我身上！'],
  planning:     ['明白！我来规划。', 'OK，我想到了。', '收到收到。', '有方向了！'],
  writing:      ['交给我！', '这个选题我有感觉！', '我来写！', '灵感来了！'],
  data:         ['给我数据。', '我来分析。', '收到，先看看数据质量。', '嗯，有方向了。'],
  default:          ['好的！', '收到！', '没问题！', '了解！', '马上开始！'],
}

const ACCEPT_PHRASES_EN: Record<string, string[]> = {
  programming: ['Got it, let me check.', 'No problem!', 'On it!', 'I have an idea!'],
  design:       ['Leave it to me!', 'Sure thing!', 'Don\'t worry~', 'I\'m on it!'],
  planning:     ['Got it! Let me plan.', 'OK, I see it.', 'Roger that.', 'I have a direction!'],
  writing:      ['On it!', 'This topic speaks to me!', 'I\'ll write it!', 'Inspiration hit!'],
  data:         ['Give me the data.', 'I\'ll analyze.', 'Got it, checking quality.', 'I see a pattern.'],
  default:          ['OK!', 'Got it!', 'Sure!', 'Roger!', 'Starting now!'],
}

const MARCH_PHRASES_ZH = ['好期待啊！', '这个项目听起来很有意思', '走走走！', '冲鸭！']
const MARCH_PHRASES_EN = ['So excited!', 'This sounds fun!', 'Let\'s go!', 'Charge!']

function getAcceptPhrases(): Record<string, string[]> {
  return getLocale() === 'en' ? ACCEPT_PHRASES_EN : ACCEPT_PHRASES_ZH
}
function getMarchPhrases(): string[] {
  return getLocale() === 'en' ? MARCH_PHRASES_EN : MARCH_PHRASES_ZH
}

const BUBBLE_MS_PER_CHAR = 120
const BUBBLE_MIN_MS = 1500
const WALK_SPEED = 3.0

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function bubbleDuration(text: string): number {
  return Math.max(BUBBLE_MIN_MS, text.length * BUBBLE_MS_PER_CHAR)
}

export interface BriefingConfig {
  steward: NPC
  mayor: NPC | null
  npcs: NPC[]
  lines: string[]
  gameName: string
  modeManager: ModeManager
  getBehavior: (npcId: string) => DailyBehavior | undefined
  getJournal: (npcId: string) => ActivityJournal | undefined
  onBubble: (npc: NPC, text: string, durationMs: number) => void
  onBubbleEnd: (npc: NPC) => void
  onCameraFocus: (target: { x: number; z: number }) => void
  onSceneSwitch: (scene: 'office') => void
}

export class BriefingOrchestrator extends BaseOrchestrator<BriefingConfig> {

  async run(cfg: BriefingConfig): Promise<void> {
    const { steward, npcs, lines, modeManager } = cfg

    // ── 1. Opening speech ──
    const opener = getLocale() === 'en'
      ? 'Alright, I\'ve got the plan!'
      : '好的，镇长的任务我已经想好分工了！'
    steward.playAnim('idle')
    cfg.onBubble(steward, opener, bubbleDuration(opener))
    await this.delay(bubbleDuration(opener) + 400)
    if (this.shouldAbort()) return

    // ── 2. Per-NPC assignment loop ──
    for (let i = 0; i < npcs.length; i++) {
      if (this.shouldAbort()) return
      const npc = npcs[i]
      const line = lines[i] ?? (getLocale() === 'en'
        ? `${npc.label ?? npc.id}, it's yours!`
        : `${npc.label ?? npc.id}，交给你了！`)

      // 2a. Steward turns to NPC
      steward.lookAtTarget({ x: npc.getPosition().x, z: npc.getPosition().z })
      await this.delay(500)

      // 2b. Camera follows steward-NPC midpoint
      const sp = steward.getPosition()
      const np = npc.getPosition()
      cfg.onCameraFocus({ x: (sp.x + np.x) / 2, z: (sp.z + np.z) / 2 })

      // 2c. Steward says assignment line
      cfg.onBubble(steward, line, bubbleDuration(line))
      await this.delay(bubbleDuration(line) + 300)
      if (this.shouldAbort()) return

      // 2d. NPC responds
      const role = npc.role || 'default'
      const phrases = getAcceptPhrases()[role] ?? getAcceptPhrases().default
      const reply = pick(phrases)
      npc.playAnim('wave')
      cfg.onBubble(npc, reply, 1200)
      await this.delay(1200)
      npc.playAnim('idle')

      // Record in journal
      cfg.getJournal?.(npc.id)?.record({
        location: 'gathering_point',
        locationName: getLocale() === 'en' ? 'Rally Point' : '聚集点',
        action: 'assigned_task',
        detail: line,
      })

      cfg.getBehavior?.(npc.id)?.advanceTo('assigned')

      await this.delay(400)
    }

    if (this.shouldAbort()) return

    // ── 3. Closing line ──
    const closer = getLocale() === 'en'
      ? 'Let\'s go, office time!'
      : '走，去办公室开干！'
    steward.lookAtTarget({ x: WAYPOINTS.office_door.x, z: WAYPOINTS.office_door.z })
    cfg.onBubble(steward, closer, bubbleDuration(closer))
    await this.delay(bubbleDuration(closer) + 300)
    if (this.shouldAbort()) return

    // ── 4. March to office ──
    modeManager.advanceWorkState('going_to_office')
    await this.marchToOffice(cfg)
    if (this.shouldAbort()) return

    // ── 5. Scene switch ──
    await this.delay(800)
    for (const npc of npcs) {
      cfg.getBehavior?.(npc.id)?.advanceTo('at_office')
    }
    cfg.onSceneSwitch('office')
  }

  // ── March to office: everyone walks to the door, then shrinks+fades into the building ──

  private async marchToOffice(cfg: BriefingConfig): Promise<void> {
    const { steward, mayor, npcs } = cfg
    const door = WAYPOINTS.office_door
    const buildingEntry = { x: door.x, z: door.z - 3 }
    const FADE_DURATION = 400
    let fadeCancelled = false

    const allNpcs: NPC[] = [steward]
    if (mayor) allNpcs.push(mayor)
    allNpcs.push(...npcs)

    cfg.onCameraFocus(door)

    const fadePromises: Promise<void>[] = []

    for (let i = 0; i < allNpcs.length; i++) {
      const npc = allNpcs[i]
      npc.playAnim('walk')

      const spread = (i % 2 === 0 ? -0.5 : 0.5) * Math.ceil(i / 2)
      const target = {
        x: buildingEntry.x + spread,
        z: buildingEntry.z + (Math.random() - 0.5) * 0.4,
      }

      const promise = (async () => {
        const result = await Promise.race([
          npc.moveTo(target, WALK_SPEED),
          new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 12_000)),
        ])
        if (result === 'timeout') {
          npc.mesh.position.set(target.x, 0, target.z)
        }
        if (fadeCancelled || result === 'timeout') return
        npc.lookAtTarget({ x: door.x, z: door.z - 5 })
        await npc.fadeOut(FADE_DURATION)
      })()
      fadePromises.push(promise)

      if (i < 2 && npcs[i] && Math.random() < 0.3) {
        cfg.onBubble(npcs[i], pick(getMarchPhrases()), 1500)
      }
    }

    await Promise.race([
      Promise.all(fadePromises),
      new Promise<void>(r => setTimeout(() => {
        fadeCancelled = true
        r()
      }, 15_000)),
    ])

    for (const npc of allNpcs) {
      npc.setVisible(false)
    }
  }

}
