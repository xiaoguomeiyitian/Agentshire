import { getLocale } from '../../i18n'
import { apiUrl } from '@/utils/api-base'

export interface SoulContext {
  name: string
  bio: string
  industry: string
  specialty: string
}

export class SoulEditor {
  private container: HTMLElement
  private textarea: HTMLTextAreaElement | null = null
  private expanded = false
  private content = ''
  private onChange: ((content: string) => void) | null = null
  private context: SoulContext | null = null

  constructor(container: HTMLElement) {
    this.container = container
  }

  setContext(ctx: SoulContext): void {
    this.context = ctx
  }

  render(soulContent: string, onChange: (content: string) => void): void {
    this.content = soulContent
    this.onChange = onChange
    this.expanded = false
    this.container.innerHTML = ''

    const toggle = document.createElement('div')
    toggle.className = 'cw-soul-toggle'
    toggle.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      <span>${getLocale() === 'en' ? 'Edit Full Soul' : '编辑完整 Soul'}</span>
    `

    const editorWrap = document.createElement('div')
    editorWrap.style.cssText = 'max-height:0;overflow:hidden;transition:max-height 300ms ease;'

    const ta = document.createElement('textarea')
    ta.className = 'cw-textarea cw-soul-textarea'
    ta.value = soulContent
    ta.placeholder = getLocale() === 'en' ? 'Edit full Soul Markdown here...\n\nClick "AI Generate" to auto-create' : '在此编辑完整的 Soul Markdown 文件...\n\n点击「AI 生成」可自动创建'
    ta.style.minHeight = '200px'
    this.textarea = ta

    ta.addEventListener('input', () => {
      this.content = ta.value
      this.onChange?.(ta.value)
    })

    const aiBtn = document.createElement('button')
    aiBtn.className = 'cw-ai-gen-btn'
    aiBtn.textContent = getLocale() === 'en' ? '✦ AI Generate' : '✦ AI 生成'
    aiBtn.addEventListener('click', () => this.triggerAIGeneration(aiBtn))

    editorWrap.appendChild(ta)
    editorWrap.appendChild(aiBtn)

    toggle.addEventListener('click', () => {
      this.expanded = !this.expanded
      toggle.classList.toggle('expanded', this.expanded)
      editorWrap.style.maxHeight = this.expanded ? `${Math.max(ta.scrollHeight, 200) + 60}px` : '0'
    })

    this.container.appendChild(toggle)
    this.container.appendChild(editorWrap)
  }

  private async triggerAIGeneration(btn: HTMLElement): Promise<void> {
    if (!this.context) return
    const { name, bio, industry, specialty } = this.context
    if (!name || !bio) return

    btn.textContent = getLocale() === 'en' ? '⏳ Generating...' : '⏳ 生成中...'
    btn.classList.add('disabled')

    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 120_000)
      const r = await fetch(apiUrl('/citizen-workshop/_api/generate-soul'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bio, industry, specialty }),
        signal: ac.signal,
      })
      clearTimeout(timer)
      const d = await r.json()
      if (d.content && this.textarea) {
        this.textarea.value = d.content
        this.content = d.content
        this.onChange?.(d.content)
        if (!this.expanded) {
          const toggle = this.container.querySelector('.cw-soul-toggle') as HTMLElement
          toggle?.click()
        }
      } else if (d.error) {
        console.warn('AI Soul generation failed:', d.error)
      }
    } catch (e) {
      console.warn('AI Soul generation request failed:', e)
    }

    btn.textContent = getLocale() === 'en' ? '✦ AI Generate' : '✦ AI 生成'
    btn.classList.remove('disabled')
  }

  getContent(): string {
    return this.content
  }
}
