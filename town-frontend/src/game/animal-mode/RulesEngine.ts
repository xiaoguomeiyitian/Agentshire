/**
 * RulesEngine — loads the Markdown rules handbook and injects it into
 * LLM system prompts for citizen autonomy decisions.
 *
 * The rules file lives at `town-data/animal-rules.md` and is fetched
 * at runtime. It is cached after first load.
 */

const RULES_URL = '/town-data/animal-rules.md'

export class RulesEngine {
  private rulesText: string | null = null
  private loading: Promise<string> | null = null
  private loadError: string | null = null

  /** Load the rules handbook (cached after first success). */
  async load(): Promise<string> {
    if (this.rulesText) return this.rulesText
    if (this.loading) return this.loading
    this.loading = fetch(RULES_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then((text) => {
        this.rulesText = text
        this.loadError = null
        return text
      })
      .catch((e) => {
        this.loadError = String(e)
        // Fallback minimal rules if fetch fails
        this.rulesText = FALLBACK_RULES
        return FALLBACK_RULES
      })
    return this.loading
  }

  /** Get the cached rules text (empty string if not loaded). */
  getRules(): string {
    return this.rulesText ?? ''
  }

  /** Build the system prompt fragment for a citizen's LLM decision. */
  buildSystemPromptFragment(persona: string, citizenName: string): string {
    const rules = this.rulesText ?? ''
    return [
      `你是小镇居民「${citizenName}」，你的性格：${persona}`,
      '',
      '你必须遵守以下小镇规则：',
      '---',
      rules,
      '---',
      '',
      '请根据规则、你的性格、当前状态（时间/天气/需求/心情/附近的人）做出决策。',
    ].join('\n')
  }

  /** Whether the rules have been loaded successfully. */
  isLoaded(): boolean {
    return this.rulesText !== null && this.loadError === null
  }
}

const FALLBACK_RULES = `# 小镇规则（精简版）
- 遵守作息：黎明起床，夜晚回家
- 天气应对：雨天去室内，雷暴躲避
- 社交：路遇打招呼，22:00 后不串门
- 需求：饥饿去用餐，疲劳回家睡觉
- 心情：影响对话语气和行为`
