import type { MinigameSlot, MinigameContext } from './MinigameSlot'
import { TroubleRenderer, type OrbData, type BossData } from './TroubleRenderer'
import { TroubleNpcEffects } from './TroubleNpcEffects'
import { getLocale } from '../../i18n'
import { VOICE_POOL_EN, WARN_POOL_EN } from '../../i18n/trouble-en'

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function rand(a: number, b: number): number { return a + Math.random() * (b - a) }

const STEWARD_ZH = { name: '管家', initial: '管', color: '#8888aa' }
const STEWARD_EN = { name: 'Steward', initial: 'S', color: '#8888aa' }
function getSteward() { return getLocale() === 'en' ? STEWARD_EN : STEWARD_ZH }

const VOICE_POOL_ZH: Record<number | string, string[]> = {
  2: [
    '嗯？好像轻松了一点', '有人在安慰我？', '谢谢你愿意听我说', '心里好受了一些',
    '我的心情稍微平复了', '感觉没那么孤单了', '好像没那么难过了',
    '刚才有点钻牛角尖了', '烦恼减轻了一点点', '我的心情好了一点点',
    '紧绷的神经放松了一些', '刚才闻到了花香，心情好了', '谢谢你，我没事了',
    '被理解的感觉真好', '好像又看到了希望', '这波属于回了一口血',
    '心情从阴转多云了', '眉头舒展了一点', '烦恼指数略微下降',
    '我不确定，但好像没那么难过了', '确认过眼神，是关心我的人', '感觉空气清新了一些',
    '麻木的心突然暖了一下', '好消息：我还没有被烦恼打倒', '心里的石头轻了一点',
    '脑子里的乱麻理清了一点', '谢谢你，我好像想通了', '心情：柳暗花明又一村',
    '感觉如同雨天看到了一缕阳光', '你做了什么？我突然没那么难过了',
  ],
  4: [
    '感觉又能笑出来了', '刚才差点被烦恼淹没', '今天总算有点开心了', '你真的帮了我大忙',
    '不是，你人真的好好', '这波操作直接把我从低谷拉回来了', '心情DNA动了！',
    '心结打开了，烦恼关闭了', '我宣布你就是小镇的温暖', '终于喘上气了，真的会谢',
    '这波我直接心情大好', '好家伙，整个人都精神了', '我不允许还有人不知道你的好',
    '什么神仙邻居？烦恼直接蒸发', '心结散了，人间清醒了', '从愁眉苦脸切换到开心模式',
    '你是会安慰人的', '不是，这合理吗？太暖心了', '太好了，我直接原地复活',
    '这泼天的温暖终于轮到我了', '心情良好.jpg', '感觉自己又活过来了！',
    '烦恼大退潮！打不倒我！', '难过？不存在的，我现在很开心', '烦恼你给我等着',
    '感觉我的世界在发光', '直接从愁容满面进化到笑逐颜开',
    '什么叫温暖？这就叫温暖', '属于是满满的善意砸我脸上了',
  ],
  7: [
    '活过来了...', '这一刻我不想叹气了', '感觉生活充满希望', '我要发朋友圈表扬你',
    '绝了绝了，你YYDS！', '我超！我真的哭死！太感动了', '这波属于是满血复活了',
    '不是，我怎么突然这么开心？', '有被暖到！烦恼完全消失！', '我现在的心情能打十个！',
    '建议全小镇推广这种好人！', '太顶了，我甚至想拥抱你', '破防了家人们，是幸福的泪水',
    '请给我再安排十个烦恼！（开玩笑的）', '我命由我不由天，烦恼休想缠着我', '治愈能力MAX',
    '完了，我开始热爱生活了，离谱', '赢麻了！今天就是我的好日子', '什么烦恼？我是快乐之神！',
    '你看我一眼我直接满状态', '快乐之王，说的就是我！', '开心能量全开！冲！',
    '感觉全小镇的温暖都在我这了', '这波直接一键三连——点赞投币收藏', '温暖温暖温暖',
    '拿捏了，这烦恼被我完全拿捏了', '从愁人进化为快乐之神', '你是懂治愈的',
    '我超，开心喷涌如泉水', '今天的我，快乐得可怕',
  ],
  10: [
    '你是天使！真的！', '下辈子还跟你做邻居！', '建议全小镇推广这种好人', '呜呜呜终于有人看到我了',
    '我直接跪下了，你是神！', '有被震撼到，什么绝世好邻居', '太暖了！你太暖了！',
    '我已经不是愁人了，我是快乐战神！！', '请收下我的一键三连！！', '谁懂啊！这就是被关心的感觉！',
    '我为你打call到天荒地老！', '啊啊啊啊啊我可以！！！', '这就是传说中的神级安慰吗？？',
    '爷青回！我的笑容回来了！', '我超我超我超！！无敌了！', '给你磕一个！咚咚咚！',
    '你知道你有多离谱吗（褒义）', '什么叫降维治愈？这就是！', '烦恼：已死。你：封神。',
    '全体起立！为你鼓掌！！', '你指哪我走哪！绝无二话！', '属于是直接封神了，没有悬念',
    '我不允许你没有一座雕像！', '完了，我觉得生活真美好', '什么档次？顶级档次！',
    '这波温暖我要写进日记！', '我已经分不清这是人间还是天堂了', '你！我的快乐全靠你了！',
    '格局，绝对的格局！我服了！', '整个小镇最暖的人就是你！',
  ],
  boss: [
    '烦恼乌云被驱散了！！', '小镇空气都清新了', '全员恢复好心情！',
    '消散的是乌云！不是我们！', '乌云：我也想散了（已消散）', '全体居民宣布胜利！',
    '这历史性一刻建议载入小镇史册！', '乌云已散！拨云见日！', '烦恼净化完毕，心情优！',
    '赢！赢麻了！彻底赢麻了！', '居民团结起来是无敌的！', 'GG，乌云请回吧',
    '终于可以开怀大笑了！奥利给！', '万恶的烦恼，永远的消失吧！', '今晚我请全小镇喝奶茶！',
    '躺平？不，是躺赢！', '我们不是在发愁，我们是在创造快乐！', '乌云的烦恼被完全蒸发了！',
    '自由！！呼吸新鲜空气的自由！', '这一战，将被载入小镇传说！', '什么叫拨云见日？这就叫',
    '我已经开始期待明天了', '小镇和平，由我们守护！', '乌云你给我记住，别再来了',
    '感谢队友！感谢你！感谢自己！', '从此烦恼是路人！', '居民翻身的一天！YYDS！',
    '全网最强小镇，不接受反驳', '谢谢乌云的配合演出（不是）', '今天以后，再也没有人说我是愁人！',
  ],
}

const WARN_POOL_ZH: Record<number, string> = {
  3: '烦恼浓度持续上升... ⚠️',
  6: '烦恼已经开始蔓延了！ ⚠️',
  9: '再不处理居民要难过了！ ⚠️',
  12: '烦恼浓度已达危险水平！！ ⚠️',
}

function getVoicePool(): Record<number | string, string[]> {
  return getLocale() === 'en' ? VOICE_POOL_EN : VOICE_POOL_ZH
}
function getWarnPool(): Record<number, string> {
  return getLocale() === 'en' ? WARN_POOL_EN : WARN_POOL_ZH
}

const NPC_COLORS: Record<string, string> = {
  'chen':   '#5a8fd4',
  'lin':    '#d45a8f',
  'wang':   '#5ad4a0',
  'diandian': '#e8a040',
  'qiqi':   '#6dc0d0',
  'yan':    '#c06080',
  'haitang': '#80b060',
  'xiaolie': '#d08050',
}

export class TroubleGame implements MinigameSlot {
  readonly id = 'trouble'

  private ctx: MinigameContext | null = null
  private renderer = new TroubleRenderer()
  private effects = new TroubleNpcEffects()

  private running = false
  private troubledNpcIds = new Set<string>()

  private orbs: OrbData[] = []
  private bosses: BossData[] = []
  private npcWorry = new Map<string, number>()
  private npcOrbSlots = new Map<string, { ox: number; oy: number }[]>()
  private spawnTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private silenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private combo = 0
  private comboTimer: ReturnType<typeof setTimeout> | null = null
  private totalUncleared = 0
  private spawnsSinceBoss = 0
  private bossSpawnedTotal = 0
  private lastWarnLevel = 0
  private firstOrbShown = false
  private orbIdCounter = 0
  private bossIdCounter = 0
  private celebrationCooldown = false
  private updateCb: ((dt: number) => void) | null = null

  // ── MinigameSlot lifecycle ──

  mount(ctx: MinigameContext): void {
    this.ctx = ctx
    this.renderer.mount(ctx.camera, ctx.renderer, ctx.container, ctx.getNpc)
  }

  unmount(): void {
    this.stop()
    this.renderer.destroy()
    this.effects.destroy()
    this.ctx = null
  }

  start(): void {
    if (this.running || !this.ctx) return
    this.running = true
    this.combo = 0
    this.totalUncleared = 0
    this.spawnsSinceBoss = 0
    this.bossSpawnedTotal = 0
    this.lastWarnLevel = 0
    this.firstOrbShown = false
    this.celebrationCooldown = false

    this.updateCb = (dt: number) => this.loop(dt)
    this.ctx.onUpdate(this.updateCb)

    const existingNpcs = this.ctx.getTroubledNpcIds()
    for (const npcId of existingNpcs) this.addTroubledNpc(npcId)

    console.log('[Trouble] game started, existing NPCs:', existingNpcs)
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.updateCb && this.ctx) {
      this.ctx.offUpdate(this.updateCb)
      this.updateCb = null
    }

    for (const t of this.spawnTimers.values()) clearTimeout(t)
    this.spawnTimers.clear()
    for (const t of this.silenceTimers.values()) clearTimeout(t)
    this.silenceTimers.clear()
    if (this.comboTimer) clearTimeout(this.comboTimer)
    this.renderer.cancelHudFade()

    for (const orb of [...this.orbs]) this.removeOrb(orb, false)
    for (const boss of [...this.bosses]) { this.renderer.removeBoss(boss); this.bosses.splice(this.bosses.indexOf(boss), 1) }
    this.orbs = []
    this.bosses = []

    for (const npcId of this.troubledNpcIds) {
      this.restoreNpc(npcId)
    }
    this.troubledNpcIds.clear()
    this.npcWorry.clear()
    this.npcOrbSlots.clear()
    this.renderer.clearAll()

      this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, getLocale() === 'en' ? 'All better now!!!' : '烦恼都散了！！！', false)
    this.renderer.scheduleHudFade(2000)

    console.log('[Trouble] game stopped')
  }

  // ── Per-NPC lifecycle ──

  addTroubledNpc(npcId: string): void {
    if (!this.running || this.troubledNpcIds.has(npcId)) return
    const npc = this.ctx?.getNpc(npcId)
    if (!npc) return

    this.troubledNpcIds.add(npcId)
    this.npcWorry.set(npcId, 0)
    this.npcOrbSlots.set(npcId, this.generateOrbSlots())
    this.effects.snapshot(npc)
    this.scheduleSpawn(npcId)
    console.log(`[Trouble] NPC added: ${npcId}`)
  }

  removeTroubledNpc(npcId: string): void {
    if (!this.troubledNpcIds.has(npcId)) return

    const orbsToRemove = this.orbs.filter(o => o.npcId === npcId)
    for (const orb of orbsToRemove) {
      this.removeOrb(orb, false)
    }

    this.restoreNpc(npcId)
    this.troubledNpcIds.delete(npcId)
    this.npcWorry.delete(npcId)
    this.npcOrbSlots.delete(npcId)

    const timer = this.spawnTimers.get(npcId)
    if (timer) { clearTimeout(timer); this.spawnTimers.delete(npcId) }
    const silence = this.silenceTimers.get(npcId)
    if (silence) { clearTimeout(silence); this.silenceTimers.delete(npcId) }

    this.renderer.clearNpcSmoke(npcId)
    this.syncHudWithHazards()
    console.log(`[Trouble] NPC removed: ${npcId}`)
  }

  private restoreNpc(npcId: string): void {
    const npc = this.ctx?.getNpc(npcId)
    if (npc) {
      this.effects.restore(npc)
      npc.mesh.scale.set(1, 1, 1)
    }
  }

  // ── Orb spawning ──

  private scheduleSpawn(npcId: string): void {
    if (!this.running || !this.troubledNpcIds.has(npcId)) return
    const delay = rand(5000, 30000)
    const timer = setTimeout(() => {
      if (!this.running || !this.troubledNpcIds.has(npcId)) return
      this.spawnOrb(npcId)
      this.scheduleSpawn(npcId)
    }, delay)
    this.spawnTimers.set(npcId, timer)
  }

  private generateOrbSlots(): { ox: number; oy: number }[] {
    const angles: number[] = []
    const startAngle = rand(0, Math.PI * 2)
    for (let i = 0; i < 6; i++) {
      angles.push(startAngle + (Math.PI * 2 / 6) * i + rand(-0.4, 0.4))
    }
    for (let i = angles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[angles[i], angles[j]] = [angles[j], angles[i]]
    }
    return angles.map(a => {
      const r = rand(28, 48)
      return { ox: Math.cos(a) * r, oy: Math.sin(a) * r * 0.7 }
    })
  }

  private spawnOrb(npcId: string): void {
    const npcOrbs = this.orbs.filter(o => o.npcId === npcId)
    if (npcOrbs.length >= 6) return

    const count = npcOrbs.length
    const grade = count < 2 ? 'light' : count < 4 ? 'medium' : 'heavy'
    const slots = this.npcOrbSlots.get(npcId) || [{ ox: 0, oy: 0 }]
    const slot = slots[count % slots.length]

    const orb = this.renderer.createOrb(this.orbIdCounter++, npcId, grade, slot, (o) => this.clickOrb(o))
    this.orbs.push(orb)
    this.totalUncleared++
    this.spawnsSinceBoss++
    this.updateNpcWorry(npcId)

    if (this.spawnsSinceBoss >= 6 && this.bosses.length < 3) {
      this.spawnsSinceBoss = 0
      this.spawnBoss()
    }

    if (!this.firstOrbShown) {
      this.firstOrbShown = true
      this.renderer.clearCombo()
      this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, getLocale() === 'en' ? 'Citizens are worried! Click to help' : '居民开始烦恼了，请点击帮他们解忧', false)
      this.renderer.cancelHudFade()
      this.renderer.addPulseIndicator(orb.el)
    }

    if (this.totalUncleared > 0 && this.totalUncleared % 3 === 0) {
      const level = Math.min(12, this.totalUncleared)
      if (level > this.lastWarnLevel) {
        this.lastWarnLevel = level
        const warnKey = ([3, 6, 9, 12] as number[]).find(k => k >= level) || 12
        this.showWarning(getWarnPool()[warnKey])
      }
    }
  }

  private clickOrb(orb: OrbData): void {
    if (!orb.el.classList.contains('clickable')) return
    this.renderer.popOrb(orb)
    orb.el.addEventListener('animationend', () => this.removeOrb(orb, true), { once: true })

    this.combo++
    if (this.comboTimer) clearTimeout(this.comboTimer)
    this.comboTimer = setTimeout(() => {
      this.combo = 0
      this.recheckWarning()
    }, 1500)

    const tier = this.combo >= 10 ? 10 : this.combo >= 7 ? 7 : this.combo >= 4 ? 4 : this.combo >= 2 ? 2 : 0
    if (tier >= 2) {
      this.renderer.showCombo(this.combo)
      const npc = this.ctx?.getNpc(orb.npcId)
      if (npc) {
        const pool = getVoicePool()[tier]
        const npcColor = NPC_COLORS[npc.id] || NPC_COLORS[npc.name] || '#8888aa'
        this.renderer.showVoice(
          {
            name: npc.name,
            initial: npc.name[1] || npc.name[0],
            color: npcColor,
            config: this.ctx?.getNpcVoiceConfig(npc.id) ?? null,
          },
          pick(pool), false,
        )
      }
      this.renderer.scheduleHudFade(3500, () => this.recheckWarning())
    } else {
      this.renderer.scheduleHudFade(1500, () => this.recheckWarning())
    }
  }

  private removeOrb(orb: OrbData, updateWorry: boolean): void {
    const idx = this.orbs.indexOf(orb)
    if (idx >= 0) this.orbs.splice(idx, 1)
    this.renderer.removeOrbEl(orb)
    this.totalUncleared = Math.max(0, this.totalUncleared - 1)

    if (updateWorry) {
      this.updateNpcWorry(orb.npcId)

      const existingSpawn = this.spawnTimers.get(orb.npcId)
      if (existingSpawn) clearTimeout(existingSpawn)
      this.spawnTimers.delete(orb.npcId)

      const existingSilence = this.silenceTimers.get(orb.npcId)
      if (existingSilence) clearTimeout(existingSilence)

      const silenceTimer = setTimeout(() => {
        this.silenceTimers.delete(orb.npcId)
        if (this.running && this.troubledNpcIds.has(orb.npcId)) this.scheduleSpawn(orb.npcId)
      }, rand(60000, 180000))
      this.silenceTimers.set(orb.npcId, silenceTimer)
    }

    this.syncHudWithHazards()
  }

  // ── NPC worry ──

  private updateNpcWorry(npcId: string): void {
    const npc = this.ctx?.getNpc(npcId)
    if (!npc) return
    const count = this.orbs.filter(o => o.npcId === npcId).length
    const worry = Math.min(100, count * 20)
    this.npcWorry.set(npcId, worry)

    this.effects.applyWorry(npc, worry)
    this.renderer.updateSmoke(npcId, worry)
  }

  // ── Boss ──

  private spawnBoss(): void {
    if (this.bosses.length >= 3) return

    const stageIndex = this.bossSpawnedTotal % 3
    this.bossSpawnedTotal++
    const hpByStage = [6, 10, 6]

    const boss = this.renderer.createBoss(
      this.bossIdCounter++, stageIndex, hpByStage[stageIndex],
      (b, e) => this.clickBoss(b, e),
    )
    this.bosses.push(boss)
    console.log('[Trouble] Boss spawned, stage:', boss.stage, 'total:', this.bosses.length)
  }

  private clickBoss(boss: BossData, e: MouseEvent): void {
    if (!this.running) return
    const now = Date.now()
    if (now - boss.lastClickTime > 2000) {
      boss.hp = boss.maxHp
      boss.hitCount = 0
      boss.el.classList.remove('boss-cracked')
      this.renderer.updateBossBar(boss)
    }
    boss.lastClickTime = now
    boss.hp--
    boss.hitCount++
    this.renderer.updateBossBar(boss)

    this.combo++
    if (this.comboTimer) clearTimeout(this.comboTimer)
    this.comboTimer = setTimeout(() => { this.combo = 0; this.recheckWarning() }, 1500)
    const tier = this.combo >= 10 ? 10 : this.combo >= 7 ? 7 : this.combo >= 4 ? 4 : this.combo >= 2 ? 2 : 0
    if (tier >= 2) this.renderer.showCombo(this.combo)

    const hit = boss.hitCount
    this.renderer.bossHitAnim(boss)
    if (hit >= 1) this.renderer.bossHitFlash(boss)
    if (hit >= 2) this.renderer.shakeScreen()
    if (hit >= 3) {
      const colors = ['#4de8c2', '#ffd700', '#ff6b35']
      this.renderer.spawnParticles(e.clientX, e.clientY, 6 + hit * 2, colors[Math.min(hit - 3, 2)])
    }
    if (hit >= 4) {
      this.renderer.bossCrack(boss)
      this.renderer.flashOverlay('rgba(255,80,60,0.15)')
    }
    if (boss.hp <= 0) {
      this.renderer.shakeScreen(true)
      this.renderer.flashOverlay('rgba(255,255,255,0.3)')
      this.renderer.spawnParticles(e.clientX, e.clientY, 20, '#ffd700')
      this.destroyBoss(boss)
    } else if (boss.stage === 3) {
      this.renderer.triggerBossDash(boss)
    }
  }

  private destroyBoss(boss: BossData): void {
    this.renderer.bossExplode(boss)
    const isLast = this.bosses.length === 1
    setTimeout(() => {
      const idx = this.bosses.indexOf(boss)
      if (idx >= 0) this.bosses.splice(idx, 1)
      this.renderer.removeBoss(boss)
      this.syncHudWithHazards()

      const orbsToRemove = isLast ? [...this.orbs] : this.orbs.slice(0, Math.min(4, this.orbs.length))
      let cleaned = 0
      const total = orbsToRemove.length

      if (total === 0) { this.onBossCleanupDone(isLast); return }

      for (const orb of orbsToRemove) {
        this.renderer.popOrb(orb)
        setTimeout(() => {
          this.removeOrb(orb, true)
          cleaned++
          if (cleaned >= total) this.onBossCleanupDone(isLast)
        }, 300)
      }
    }, 500)
  }

  private onBossCleanupDone(wasLastBoss: boolean): void {
    if (wasLastBoss) {
      this.renderer.clearCombo()
      this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, pick(getVoicePool().boss), false)
    }
    this.celebrationCooldown = true
    this.renderer.scheduleHudFade(5000, () => {
      this.celebrationCooldown = false
      this.recheckWarning()
    })
  }

  // ── Warnings ──

  private showWarning(text: string): void {
    this.renderer.clearCombo()
    this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, text, true)
    this.renderer.cancelHudFade()
  }

  private hasActiveHazards(): boolean {
    return this.orbs.length > 0 || this.bosses.length > 0
  }

  private syncHudWithHazards(): void {
    if (this.hasActiveHazards()) return
    this.lastWarnLevel = 0
    this.renderer.cancelHudFade()
    this.renderer.clearCombo()
    this.renderer.clearVoice()
    this.renderer.hideHud()
  }

  private recheckWarning(): void {
    if (!this.running || this.celebrationCooldown) return
    const level = this.totalUncleared
    if (level >= 3) {
      const warnKey = ([3, 6, 9, 12] as number[]).find(k => k >= Math.min(12, level)) || 12
      this.showWarning(getWarnPool()[warnKey])
    } else {
      this.syncHudWithHazards()
    }
  }

  // ── Game loop ──

  private _wasVisible = true
  private _loopLogCount = 0

  private loop(dt: number): void {
    if (!this.running) return
    const troubledNpcIds = this.ctx?.getTroubledNpcIds() ?? []
    for (const npcId of troubledNpcIds) {
      if (!this.troubledNpcIds.has(npcId)) {
        this.addTroubledNpc(npcId)
      }
    }
    for (const npcId of [...this.troubledNpcIds]) {
      if (!troubledNpcIds.includes(npcId)) {
        this.removeTroubledNpc(npcId)
      }
    }
    if (this._loopLogCount < 5 && this._loopLogCount % 1 === 0) {
      const myIds = [...this.troubledNpcIds]
      void myIds
    }
    this._loopLogCount++

    const inOffice = this.ctx?.getSceneType() === 'office'
    if (!inOffice) {
      if (this._wasVisible) {
        this.renderer.setAllVisible(false, this.orbs, this.bosses)
        this._wasVisible = false
      }
      return
    }
    if (!this._wasVisible) {
      this.renderer.setAllVisible(true, this.orbs, this.bosses)
      this._wasVisible = true
      this.syncHudWithHazards()
    }

    this.renderer.updateOrbPositions(this.orbs)
    this.renderer.updateSmokePositions()
    for (const boss of this.bosses) this.renderer.updateBossMovement(boss, dt)
  }
}
