import type { MinigameSlot, MinigameContext } from './MinigameSlot'
import { BanweiRenderer, type OrbData, type BossData } from './BanweiRenderer'
import { BanweiNpcEffects } from './BanweiNpcEffects'
import { getLocale } from '../../i18n'
import { VOICE_POOL_EN, WARN_POOL_EN } from '../../i18n/banwei-en'

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function rand(a: number, b: number): number { return a + Math.random() * (b - a) }

const STEWARD_ZH = { name: '管家', initial: '管', color: '#8888aa' }
const STEWARD_EN = { name: 'Steward', initial: 'S', color: '#8888aa' }
function getSteward() { return getLocale() === 'en' ? STEWARD_EN : STEWARD_ZH }

const VOICE_POOL_ZH: Record<number | string, string[]> = {
  2: [
    '嗯？好像轻松了一点', '有人在帮我减压？', '镇长今天人不错', '续了一口气',
    '我的精神状态稍微正常了', '感觉从ICU转到普通病房了', '属于是活过来了一点',
    '好家伙，我差点就躺平了', '班味浓度-1，微乎其微', '我的i人电量充了1%',
    '头发停止了脱落（暂时的）', '刚才闻到一丝自由的味道', '谢邀，人在工位，刚续命',
    '摸鱼被发现的恐惧感降低了', '从社畜变回了社…蓄？', '这波属于回了一口血',
    '精神状态从-100到-99了', '键盘上的泪痕干了一点', '班味radar显示略有下降',
    '我不确定，但好像没那么想死了', '确认过眼神，是来救我的人', '感觉这空气不那么窒息了',
    '麻木的神经突然跳了一下', '好消息：我还没有原地去世', '工位的怨气浓度降低0.1%',
    '脑子里的浆糊稀了一点', '栓Q…等一下，好像没那么Q了', '精神状态：垂死病中惊坐起',
    '感觉如同沙漠里喝到一滴水', '镇长做了什么？我突然没那么emo了',
  ],
  4: [
    '感觉又能写两行了', '差点以为要猝死在工位上', '这个班上得有点人味了', '镇长出手了？',
    '不是，哥们，你有点东西啊', '这波操作直接把我从ICU拉到蹦迪', '打工人DNA动了！',
    '格局打开了，班味关闭了', '我宣布这就是遥遥领先', '牛马终于喘上气了，真的会谢',
    '这波我直接精神状态遥遥领先', '好家伙，效率直接起飞', '我不允许还有人不知道这种镇长',
    '什么神仙操作？班味直接蒸发', '脑雾散了，人间清醒了', '从摆烂直接切换到卷王模式',
    '镇长这是开了外挂吧？', '不是哥们，这合理吗？太强了', '6到飞起，我直接原地复活',
    '这泼天的福气终于轮到我了', '精神状态良好.jpg', '感觉自己又是一条好汉！',
    '这代码我直接一把梭了', '班味大退潮！芭比Q不了我！', '内卷？不存在的，我现在是王',
    '老六班味你给我等着', '感觉我的工位在发光', '直接从干饭人进化成干活人',
    '什么叫专业？这就叫专业', '属于是泼天的富贵砸我脸上了',
  ],
  7: [
    '活过来了...', '这一刻我不想提离职了', '感觉升职加薪有望', '我要发朋友圈表扬镇长',
    '绝了绝了，镇长YYDS！', '我超！我真的哭死！太感动了', '这波属于是满血复活了',
    '不是，我怎么突然这么能打？', '有被爽到！班味完全消失！', '我现在的精神状态能打十个！',
    '建议全国推广这种镇长！', '太顶了，我甚至想加班（？）', '破防了家人们，是幸福的泪水',
    '请给我再安排十个需求！（开玩笑的）', '我命由我不由天，班味休想缠着我', '整活能力MAX，代码随便写',
    '完了，我开始热爱工作了，离谱', '赢麻了！今天就是我的主场', '什么卷王？我是卷神！',
    '镇长看我一眼我直接满状态', '效率之王，说的就是我！', '显眼包精神状态全开！冲！',
    '感觉全小镇的气运都在我这了', '这波直接一键三连——点赞投币收藏', '遥遥领先遥遥领先遥遥领先',
    '拿捏了，这工作被我完全拿捏了', '从打工人进化为打工之神', '镇长你是懂管理的',
    '我超，灵感喷涌如泉水', '今天的我，强得可怕',
  ],
  10: [
    '镇长！你是人！', '下辈子还跟你干！', '建议全行业推广这种镇长', '呜呜呜终于有人看到我了',
    '我直接跪下了，镇长你是神！', '有被震撼到，什么绝世好镇长', '泰裤辣！镇长泰裤辣！',
    '我已经不是牛马了，我是战神！！', '镇长请收下我的一键三连！！', '谁懂啊！这就是被当人看的感觉！',
    '我为镇长打call到天荒地老！', '啊啊啊啊啊镇长我可以！！！', '这就是传说中的神级操作吗？？',
    '爷青回！爷的工作热情回来了！', '我超我超我超！！无敌了！', '给镇长磕一个！咚咚咚！',
    '镇长，你知道你有多离谱吗（褒义）', '什么叫降维打击？这就是！', '班味：已死。镇长：封神。',
    '全体起立！为镇长鼓掌！！', '镇长指哪我打哪！绝无二话！', '属于是直接封神了，没有悬念',
    '我不允许镇长没有一座雕像！', '完了，我觉得996也不是不行（大雾）', '什么档次？顶级档次！',
    '镇长这波操作我要写进简历！', '我已经分不清这是上班还是天堂了', '镇长！我的精神状态全靠你了！',
    '格局，绝对的格局！我服了！', '整个小镇最靓的仔就是镇长！',
  ],
  boss: [
    '班味大魔王被消灭了！！', '办公室空气都清新了', '全员恢复战斗力！',
    '芭比Q的是大魔王！不是我们！', '大魔王：我也想下班了（已被击毙）', '全体打工人宣布胜利！',
    '这历史性一刻建议载入小镇史册！', '大魔王已死！有事烧纸！', '班味净化完毕，空气质量优！',
    '赢！赢麻了！彻底赢麻了！', '打工人团结起来是无敌的！', 'GG，大魔王请回吧',
    '终于可以准时下班了！奥利给！', '万恶的班味，永远的消失吧！', '今晚我请全小镇喝奶茶！',
    '躺平？不，是躺赢！', '我们不是在上班，我们是在创造历史！', '大魔王的班味被完全蒸发了！',
    '自由！！呼吸新鲜空气的自由！', '这一战，将被载入打工人传说！', '什么叫团灭？这就叫团灭（指魔王）',
    '我已经开始期待明天上班了（？？）', '小镇和平，由我们守护！', '大魔王你给我记住，别再来了',
    '感谢队友！感谢镇长！感谢自己！', '从此班味是路人！', '打工人翻身的一天！YYDS！',
    '全网最强小镇，不接受反驳', '谢谢大魔王的配合演出（不是）', '今天以后，再也没有人说我是牛马！',
  ],
}

const WARN_POOL_ZH: Record<number, string> = {
  3: '班味浓度持续上升... ⚠️',
  6: '班味已经开始蔓延了！ ⚠️',
  9: '再不处理居民要罢工了！ ⚠️',
  12: '班味浓度已达危险水平！！ ⚠️',
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

export class BanweiGame implements MinigameSlot {
  readonly id = 'banwei'

  private ctx: MinigameContext | null = null
  private renderer = new BanweiRenderer()
  private effects = new BanweiNpcEffects()

  private running = false
  private workingNpcIds = new Set<string>()

  private orbs: OrbData[] = []
  private bosses: BossData[] = []
  private npcStress = new Map<string, number>()
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

    const existingNpcs = this.ctx.getWorkingNpcIds()
    for (const npcId of existingNpcs) this.addWorkingNpc(npcId)

    console.log('[Banwei] game started, existing NPCs:', existingNpcs)
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

    for (const npcId of this.workingNpcIds) {
      this.restoreNpc(npcId)
    }
    this.workingNpcIds.clear()
    this.npcStress.clear()
    this.npcOrbSlots.clear()
    this.renderer.clearAll()

      this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, getLocale() === 'en' ? 'Off work!!!' : '下班了！！！', false)
    this.renderer.scheduleHudFade(2000)

    console.log('[Banwei] game stopped')
  }

  // ── Per-NPC lifecycle ──

  addWorkingNpc(npcId: string): void {
    if (!this.running || this.workingNpcIds.has(npcId)) return
    const npc = this.ctx?.getNpc(npcId)
    if (!npc) return

    this.workingNpcIds.add(npcId)
    this.npcStress.set(npcId, 0)
    this.npcOrbSlots.set(npcId, this.generateOrbSlots())
    this.effects.snapshot(npc)
    this.scheduleSpawn(npcId)
    console.log(`[Banwei] NPC added: ${npcId}`)
  }

  removeWorkingNpc(npcId: string): void {
    if (!this.workingNpcIds.has(npcId)) return

    const orbsToRemove = this.orbs.filter(o => o.npcId === npcId)
    for (const orb of orbsToRemove) {
      this.removeOrb(orb, false)
    }

    this.restoreNpc(npcId)
    this.workingNpcIds.delete(npcId)
    this.npcStress.delete(npcId)
    this.npcOrbSlots.delete(npcId)

    const timer = this.spawnTimers.get(npcId)
    if (timer) { clearTimeout(timer); this.spawnTimers.delete(npcId) }
    const silence = this.silenceTimers.get(npcId)
    if (silence) { clearTimeout(silence); this.silenceTimers.delete(npcId) }

    this.renderer.clearNpcSmoke(npcId)
    this.syncHudWithHazards()
    console.log(`[Banwei] NPC removed: ${npcId}`)
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
    if (!this.running || !this.workingNpcIds.has(npcId)) return
    const delay = rand(5000, 30000)
    const timer = setTimeout(() => {
      if (!this.running || !this.workingNpcIds.has(npcId)) return
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
    this.updateNpcStress(npcId)

    if (this.spawnsSinceBoss >= 6 && this.bosses.length < 3) {
      this.spawnsSinceBoss = 0
      this.spawnBoss()
    }

    if (!this.firstOrbShown) {
      this.firstOrbShown = true
      this.renderer.clearCombo()
      this.renderer.showVoice({ ...getSteward(), config: this.ctx?.getNpcVoiceConfig('steward') ?? null }, getLocale() === 'en' ? 'Citizens are stressed! Click to help' : '居民开始出现班味了，镇长请点击帮他们减压', false)
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

  private removeOrb(orb: OrbData, updateStress: boolean): void {
    const idx = this.orbs.indexOf(orb)
    if (idx >= 0) this.orbs.splice(idx, 1)
    this.renderer.removeOrbEl(orb)
    this.totalUncleared = Math.max(0, this.totalUncleared - 1)

    if (updateStress) {
      this.updateNpcStress(orb.npcId)

      const existingSpawn = this.spawnTimers.get(orb.npcId)
      if (existingSpawn) clearTimeout(existingSpawn)
      this.spawnTimers.delete(orb.npcId)

      const existingSilence = this.silenceTimers.get(orb.npcId)
      if (existingSilence) clearTimeout(existingSilence)

      const silenceTimer = setTimeout(() => {
        this.silenceTimers.delete(orb.npcId)
        if (this.running && this.workingNpcIds.has(orb.npcId)) this.scheduleSpawn(orb.npcId)
      }, rand(60000, 180000))
      this.silenceTimers.set(orb.npcId, silenceTimer)
    }

    this.syncHudWithHazards()
  }

  // ── NPC stress ──

  private updateNpcStress(npcId: string): void {
    const npc = this.ctx?.getNpc(npcId)
    if (!npc) return
    const count = this.orbs.filter(o => o.npcId === npcId).length
    const stress = Math.min(100, count * 20)
    this.npcStress.set(npcId, stress)

    this.effects.applyStress(npc, stress)
    this.renderer.updateSmoke(npcId, stress)
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
    console.log('[Banwei] Boss spawned, stage:', boss.stage, 'total:', this.bosses.length)
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
    const workflowNpcIds = this.ctx?.getWorkingNpcIds() ?? []
    for (const npcId of workflowNpcIds) {
      if (!this.workingNpcIds.has(npcId)) {
        this.addWorkingNpc(npcId)
      }
    }
    for (const npcId of [...this.workingNpcIds]) {
      if (!workflowNpcIds.includes(npcId)) {
        this.removeWorkingNpc(npcId)
      }
    }
    if (this._loopLogCount < 5 && this._loopLogCount % 1 === 0) {
      const myIds = [...this.workingNpcIds]
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
