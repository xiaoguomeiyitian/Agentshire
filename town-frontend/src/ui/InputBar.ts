/**
 * Bottom input bar for the Agentshire.
 * Handles text input, voice (browser STT), image attachment, and send.
 * Communicates with OpenClaw backend via WebSocket.
 */
import { isSttSupported, startStt, stopStt, isSttActive } from './speech'
import { parseCommand } from '../utils/command-parser'
import { t } from '../i18n'
import { showMentionPicker, parseMentionsFromInput, type MentionableCitizen } from './MentionPicker'

export type TownMessage =
  | { type: 'chat'; message: string; mentions?: string[] }
  | { type: 'multimodal'; parts: Array<{ kind: 'text'; text: string } | { kind: 'image'; data: string; mimeType: string }> }

export type SendFn = (msg: TownMessage) => void

export interface InputBarOptions {
  send: SendFn
  onUserMessage?: (text: string, images?: Array<{ data: string; mimeType: string }>) => void
  onNewSession?: () => void
  wrapMessage?: (text: string) => string
}

interface PendingImage {
  data: string
  mimeType: string
}

export class InputBar {
  private textarea: HTMLTextAreaElement
  private sendBtn: HTMLButtonElement
  private voiceBtn: HTMLButtonElement | null
  private attachBtn: HTMLButtonElement | null
  private mentionBtn: HTMLButtonElement | null
  private fileInput: HTMLInputElement | null
  private previewBar: HTMLElement | null
  private sttInterim: HTMLElement | null
  private composing = false
  private recording = false
  private pendingImages: PendingImage[] = []
  private opts: InputBarOptions
  private groupMode = false
  private mentionableCitizens: MentionableCitizen[] = []

  constructor(opts: InputBarOptions) {
    this.opts = opts
    this.textarea = document.getElementById('town-input-text') as HTMLTextAreaElement
    this.sendBtn = document.getElementById('town-send-btn') as HTMLButtonElement
    this.voiceBtn = document.getElementById('town-voice-btn') as HTMLButtonElement | null
    this.attachBtn = document.getElementById('town-attach-btn') as HTMLButtonElement | null
    this.mentionBtn = document.getElementById('town-mention-btn') as HTMLButtonElement | null
    this.fileInput = document.getElementById('town-file-input') as HTMLInputElement | null
    this.previewBar = document.getElementById('town-image-preview') as HTMLElement | null
    this.sttInterim = document.getElementById('town-stt-interim') as HTMLElement | null

    this.bind()
  }

  private bind(): void {
    this.sendBtn.addEventListener('click', () => this.submit())

    this.textarea.addEventListener('compositionstart', () => { this.composing = true })
    this.textarea.addEventListener('compositionend', () => { this.composing = false })
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !this.composing) {
        e.preventDefault()
        this.submit()
      }
    })
    this.textarea.addEventListener('input', () => {
      this.textarea.style.height = 'auto'
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px'
    })

    if (this.voiceBtn && isSttSupported()) {
      this.voiceBtn.style.display = ''
      this.voiceBtn.addEventListener('click', () => this.toggleVoice())
    } else if (this.voiceBtn) {
      this.voiceBtn.style.display = 'none'
    }

    if (this.attachBtn && this.fileInput) {
      this.attachBtn.addEventListener('click', () => this.fileInput!.click())
      this.fileInput.addEventListener('change', () => this.handleFileSelect())
    }

    // @mention button (only visible in group mode)
    if (this.mentionBtn) {
      this.mentionBtn.style.display = 'none'
      this.mentionBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (!this.groupMode || this.mentionableCitizens.length === 0) return
        showMentionPicker(
          { citizens: this.mentionableCitizens, onSelect: (c) => this.insertMention(c) },
          this.textarea,
        )
      })
    }

    // @ trigger on typing
    this.textarea.addEventListener('input', () => {
      this.textarea.style.height = 'auto'
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px'
      // Detect @ trigger
      if (this.groupMode) {
        this.checkAtTrigger()
      }
    })

    this.textarea.addEventListener('paste', (e) => this.handlePaste(e))
  }

  /** Set group chat mode with available citizens for @mention. */
  setGroupMode(enabled: boolean, citizens: MentionableCitizen[] = []): void {
    this.groupMode = enabled
    this.mentionableCitizens = citizens
    if (this.mentionBtn) {
      this.mentionBtn.style.display = enabled ? '' : 'none'
    }
  }

  /** Insert an @mention at cursor position. */
  private insertMention(c: { npcId: string; name: string }): void {
    const mentionText = `@${c.name} `
    const start = this.textarea.selectionStart
    const end = this.textarea.selectionEnd
    const before = this.textarea.value.slice(0, start)
    const after = this.textarea.value.slice(end)

    // Check if we're already after an @
    const textBefore = this.textarea.value.slice(0, start)
    if (textBefore.endsWith('@')) {
      // Replace the trailing @ with the mention
      this.textarea.value = textBefore.slice(0, -1) + mentionText + after
    } else {
      this.textarea.value = before + mentionText + after
    }
    const newPos = start + mentionText.length
    this.textarea.setSelectionRange(newPos, newPos)
    this.textarea.focus()
  }

  /** Check if user typed @ and show picker. */
  private checkAtTrigger(): void {
    const cursor = this.textarea.selectionStart
    const text = this.textarea.value.slice(0, cursor)
    // Find last @ that's not followed by a space (incomplete mention)
    const atIdx = text.lastIndexOf('@')
    if (atIdx < 0) return
    const afterAt = text.slice(atIdx + 1)
    // If there's a space after @, it's a completed mention — don't trigger
    if (afterAt.includes(' ')) return
    // Only trigger if @ is at start or preceded by space
    if (atIdx > 0 && !/\s/.test(text[atIdx - 1])) return

    // Show picker filtered by what's typed after @
    const filter = afterAt.toLowerCase()
    const filtered = this.mentionableCitizens.filter(c =>
      c.name.toLowerCase().includes(filter) || (c.specialty?.toLowerCase().includes(filter) ?? false),
    )
    if (filtered.length === 0 && filter.length > 0) return

    showMentionPicker(
      {
        citizens: filtered.length > 0 ? filtered : this.mentionableCitizens,
        onSelect: (c) => {
          // Replace the partial @text with the full mention
          const fullText = this.textarea.value
          const before = fullText.slice(0, atIdx)
          const after = fullText.slice(cursor)
          this.textarea.value = before + `@${c.name} ` + after
          const newPos = before.length + c.name.length + 2
          this.textarea.setSelectionRange(newPos, newPos)
          this.textarea.focus()
        },
      },
      this.textarea,
    )
  }

  private toggleVoice(): void {
    if (this.recording) {
      stopStt()
      this.recording = false
      this.voiceBtn?.classList.remove('recording')
      if (this.sttInterim) this.sttInterim.style.display = 'none'
      return
    }

    const started = startStt({
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          const current = this.textarea.value
          const sep = current && !current.endsWith(' ') ? ' ' : ''
          this.textarea.value = current + sep + text
          if (this.sttInterim) this.sttInterim.style.display = 'none'
        } else if (this.sttInterim) {
          this.sttInterim.textContent = text
          this.sttInterim.style.display = 'block'
        }
      },
      onStart: () => {
        this.recording = true
        this.voiceBtn?.classList.add('recording')
      },
      onEnd: () => {
        this.recording = false
        this.voiceBtn?.classList.remove('recording')
        if (this.sttInterim) this.sttInterim.style.display = 'none'
      },
      onError: () => {
        this.recording = false
        this.voiceBtn?.classList.remove('recording')
        if (this.sttInterim) this.sttInterim.style.display = 'none'
      },
    })

    if (started) {
      this.recording = true
      this.voiceBtn?.classList.add('recording')
    }
  }

  private handleFileSelect(): void {
    if (!this.fileInput?.files) return
    for (const file of this.fileInput.files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        this.pendingImages.push({ data: (reader.result as string).split(',')[1], mimeType: file.type })
        this.renderPreviews()
      }
      reader.readAsDataURL(file)
    }
    this.fileInput.value = ''
  }

  private handlePaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        this.pendingImages.push({ data: (reader.result as string).split(',')[1], mimeType: file.type })
        this.renderPreviews()
      }
      reader.readAsDataURL(file)
    }
  }

  private renderPreviews(): void {
    if (!this.previewBar) return
    this.previewBar.innerHTML = ''
    if (this.pendingImages.length === 0) {
      this.previewBar.style.display = 'none'
      return
    }
    this.previewBar.style.display = 'flex'
    this.pendingImages.forEach((img, idx) => {
      const thumb = document.createElement('div')
      thumb.className = 'town-img-thumb'
      const imgEl = document.createElement('img')
      imgEl.src = `data:${img.mimeType};base64,${img.data}`
      thumb.appendChild(imgEl)
      const removeBtn = document.createElement('button')
      removeBtn.className = 'town-img-remove'
      removeBtn.textContent = '✕'
      removeBtn.addEventListener('click', () => {
        this.pendingImages.splice(idx, 1)
        this.renderPreviews()
      })
      thumb.appendChild(removeBtn)
      this.previewBar!.appendChild(thumb)
    })
  }

  private submit(): void {
    const text = this.textarea.value.trim()
    const images = this.pendingImages.splice(0)
    this.renderPreviews()

    if (!text && images.length === 0) return

    if (images.length === 0) {
      const cmd = parseCommand(text)
      if (cmd) {
        if (cmd.command === 'new' || cmd.command === 'reset') {
          this.textarea.value = ''
          this.textarea.style.height = 'auto'
          this.opts.onNewSession?.()
          return
        }
        if (cmd.type === 'gateway') {
          this.textarea.value = ''
          this.textarea.style.height = 'auto'
          this.opts.send({ type: 'chat', message: cmd.raw })
          this.opts.onUserMessage?.(cmd.raw)
          return
        }
      }
    }

    if (images.length > 0) {
      const parts: Array<{ kind: 'text'; text: string } | { kind: 'image'; data: string; mimeType: string }> = []
      if (text) parts.push({ kind: 'text', text })
      for (const img of images) parts.push({ kind: 'image', data: img.data, mimeType: img.mimeType })
      this.opts.send({ type: 'multimodal', parts })
      this.opts.onUserMessage?.(text, images)
    } else {
      const wrapped = this.opts.wrapMessage ? this.opts.wrapMessage(text) : text
      // Parse @mentions in group mode
      const mentions = this.groupMode
        ? parseMentionsFromInput(text, this.mentionableCitizens)
        : undefined
      this.opts.send({ type: 'chat', message: wrapped, mentions })
      this.opts.onUserMessage?.(text)
    }

    this.textarea.value = ''
    this.textarea.style.height = 'auto'
    this.textarea.focus()
  }

  setBusy(busy: boolean): void {
    this.textarea.placeholder = busy ? t('input.busy') : t('input.idle')
    this.sendBtn.classList.toggle('btn-busy', busy)
  }

  focus(): void { this.textarea.focus() }
}
