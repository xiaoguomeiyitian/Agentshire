export interface PersonaCache {
  npcId: string
  name: string
  coreSummary: string
  speakingStyle: string
  specialty: string
  loadedAt: number
}

const DEFAULT_PERSONAS: Record<string, { summary: string; style: string; specialty: string }> = {
  planner:   { summary: '热情洋溢的点子王，创意无穷，喜欢用比喻来表达想法', style: '语气活泼，爱用感叹号，偶尔蹦出新奇的点子', specialty: '出点子' },
  explorer:  { summary: '细腻敏感的木工，追求完美的结构呈现', style: '语调沉稳，偶尔用榫卯和梁柱来比喻事物', specialty: '木工与搭建' },
  coder:     { summary: '行动派的修理匠，手脚麻利，有点闷骚的幽默感', style: '简洁直接，偶尔冒出工具梗', specialty: '修理与种植' },
  architect: { summary: '安静优雅的画师，审美洁癖，喜欢从色彩思考问题', style: '说话轻柔，常用颜色和构图来比喻事物', specialty: '绘画与布置' },
}

const FALLBACK_PERSONA = {
  summary: '一个友善的小镇居民，性格随和',
  style: '说话简短自然',
  specialty: '',
}

export class PersonaStore {
  private cache = new Map<string, PersonaCache>()

  register(npcId: string, name: string, personaText?: string): PersonaCache {
    if (this.cache.has(npcId)) return this.cache.get(npcId)!

    let coreSummary: string
    let speakingStyle: string
    let specialty: string

    if (personaText) {
      const parsed = this.parsePersonaText(personaText)
      coreSummary = parsed.summary
      speakingStyle = parsed.style
      specialty = parsed.specialty
    } else {
      const preset = DEFAULT_PERSONAS[npcId] ?? FALLBACK_PERSONA
      coreSummary = preset.summary
      speakingStyle = preset.style
      specialty = preset.specialty
    }

    const entry: PersonaCache = {
      npcId,
      name,
      coreSummary,
      speakingStyle,
      specialty,
      loadedAt: Date.now(),
    }
    this.cache.set(npcId, entry)
    return entry
  }

  get(npcId: string): PersonaCache | undefined {
    return this.cache.get(npcId)
  }

  remove(npcId: string): void {
    this.cache.delete(npcId)
  }

  clear(): void {
    this.cache.clear()
  }

  /**
   * Build a compact system prompt fragment (~50-100 tokens) for implicit chat.
   * Full soul files are only injected via subagent_spawning hook for direct user chat.
   */
  buildImplicitPrompt(npcId: string): string {
    const p = this.cache.get(npcId)
    if (!p) return ''
    const parts: string[] = []
    parts.push(`你是${p.name}${p.specialty ? `，${p.specialty}` : ''}。`)
    if (p.coreSummary) parts.push(p.coreSummary.endsWith('。') ? p.coreSummary : p.coreSummary + '。')
    if (p.speakingStyle) parts.push(`说话风格：${p.speakingStyle}`)
    return parts.join('')
  }

  private parsePersonaText(text: string): { summary: string; style: string; specialty: string } {
    let summary = ''
    let style = ''
    let specialty = ''

    const bracketMatch = text.match(/^\[.+\]$/m)
    if (bracketMatch) {
      const inner = bracketMatch[0].slice(1, -1)
      const colonIdx = inner.indexOf(':')
      if (colonIdx > 0) {
        const content = inner.slice(colonIdx + 1).trim()
        const styleMatch = content.match(/说话风格\s*[:：]\s*([^;；]+)/)
        if (styleMatch) {
          style = styleMatch[1].trim().slice(0, 80)
        }
        const traitsEnd = content.indexOf(';')
        const traits = traitsEnd > 0 ? content.slice(0, traitsEnd).trim() : content.split(/说话风格/)[0].trim()
        summary = traits.slice(0, 200)
      }
    }

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      const specMatch = trimmed.match(/^>\s*手艺\s*[:：]\s*(.+)/)
      if (specMatch) {
        specialty = specMatch[1].trim().split(/[（(]/)[0].trim()
        break
      }
    }

    if (!summary) {
      const lines = text.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        const tagMatch = trimmed.match(/^\[(.+?):\s*(.+)\]$/)
        if (tagMatch) {
          summary += (summary ? '，' : '') + tagMatch[2].trim()
        }
        if (/说话风格|语言风格|说话方式|语气/.test(trimmed) && !style) {
          const idx = lines.indexOf(line)
          if (idx + 1 < lines.length) {
            style = lines[idx + 1].trim()
          }
        }
      }
    }

    return {
      summary: summary.slice(0, 200) || FALLBACK_PERSONA.summary,
      style: style.slice(0, 80) || FALLBACK_PERSONA.style,
      specialty: specialty || FALLBACK_PERSONA.specialty,
    }
  }
}
