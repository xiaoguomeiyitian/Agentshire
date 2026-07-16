import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { SendHorizonal, Paperclip, Mic, X, FileText, ImageIcon, Film, Music, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseCommand, getCommandSuggestions, type ParsedCommand, type CommandSuggestion } from '@/utils/command-parser'

interface AttachedFile {
  file: File
  preview?: string
}

interface ChatInputBarProps {
  onSend: (text: string) => void
  onSendMultimodal?: (parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string; fileName?: string }>) => void
  onCommand?: (cmd: ParsedCommand) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** When true, the agent is thinking — show a stop/abort button instead of send */
  thinking?: boolean
  /** Called when the user clicks the stop button */
  onAbort?: () => void
}

const MAX_TEXTAREA_HEIGHT = 200

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon size={14} strokeWidth={1.5} />
  if (type.startsWith('video/')) return <Film size={14} strokeWidth={1.5} />
  if (type.startsWith('audio/')) return <Music size={14} strokeWidth={1.5} />
  return <FileText size={14} strokeWidth={1.5} />
}

export function ChatInputBar({ onSend, onSendMultimodal, onCommand, disabled, placeholder, className, thinking, onAbort }: ChatInputBarProps) {
  const [text, setText] = useState('')
  const [multiline, setMultiline] = useState(false)
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)

  // Command autocomplete suggestions (filtered by current input)
  const suggestions = useMemo(() => getCommandSuggestions(text), [text])
  const showSuggestions = suggestions.length > 0 && !disabled

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedSuggestion(0)
  }, [suggestions])

  const submit = useCallback(() => {
    const trimmed = text.trim()
    const hasFiles = attachments.length > 0

    if (!trimmed && !hasFiles) return

    if (!hasFiles) {
      const cmd = parseCommand(trimmed)
      if (cmd) {
        setText('')
        setMultiline(false)
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        onCommand?.(cmd)
        return
      }
    }

    if (hasFiles && onSendMultimodal) {
      const parts: Array<{ kind: string; text?: string; data?: string; mimeType?: string; fileName?: string }> = []
      if (trimmed) parts.push({ kind: 'text', text: trimmed })

      let pending = attachments.length
      const filePartsReady: Array<{ kind: string; data: string; mimeType: string; fileName: string }> = []

      for (const att of attachments) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] ?? ''
          filePartsReady.push({
            kind: att.file.type.startsWith('image/') ? 'image' : 'file',
            data: base64,
            mimeType: att.file.type || 'application/octet-stream',
            fileName: att.file.name,
          })
          pending--
          if (pending === 0) {
            onSendMultimodal([...parts, ...filePartsReady])
          }
        }
        reader.readAsDataURL(att.file)
      }
    } else if (trimmed) {
      onSend(trimmed)
    }

    setText('')
    setMultiline(false)
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, attachments, onSend, onSendMultimodal, onCommand])

  /** Apply a command suggestion: replace the current "/" prefix with "/<name> " */
  const applySuggestion = useCallback((s: CommandSuggestion) => {
    const newText = '/' + s.name + ' '
    setText(newText)
    // Focus the textarea and move cursor to end
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(newText.length, newText.length)
      }
    })
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Command autocomplete keyboard navigation
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSuggestion(i => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSuggestion(i => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !composingRef.current)) {
        e.preventDefault()
        applySuggestion(suggestions[selectedSuggestion])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Clear the "/" to dismiss suggestions
        setText('')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault()
      // Block sending while thinking (send button is replaced by stop button)
      if (thinking) return
      submit()
    }
  }, [submit, thinking, showSuggestions, suggestions, selectedSuggestion, applySuggestion])

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const scrollH = el.scrollHeight
    const clamped = Math.min(scrollH, MAX_TEXTAREA_HEIGHT)
    el.style.height = clamped + 'px'
    setMultiline(scrollH > 44)
  }, [])

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          const att: AttachedFile = { file, preview: URL.createObjectURL(file) }
          setAttachments((prev) => [...prev, att])
        }
        return
      }
    }
  }, [])

  const handleFilesChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newAttachments: AttachedFile[] = []
    for (const file of Array.from(files)) {
      const att: AttachedFile = { file }
      if (file.type.startsWith('image/')) {
        att.preview = URL.createObjectURL(file)
      }
      newAttachments.push(att)
    }
    setAttachments((prev) => [...prev, ...newAttachments])
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      const removed = next.splice(idx, 1)[0]
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return next
    })
  }, [])

  return (
    <div className={cn('px-4 pb-4 pt-1 w-full max-w-3xl mx-auto relative', className)}>
      {/* Command autocomplete popup */}
      {showSuggestions && (
        <div className="absolute bottom-full left-4 right-4 max-w-3xl mx-auto mb-1 z-50">
          <div className="max-h-[280px] overflow-y-auto rounded-xl bg-bg-surface border border-border-default shadow-2xl shadow-black/60 backdrop-blur-xl styled-scrollbar">
            {suggestions.map((s, i) => (
              <button
                key={s.name}
                onClick={() => applySuggestion(s)}
                onMouseEnter={() => setSelectedSuggestion(i)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer transition-colors duration-100',
                  i === selectedSuggestion
                    ? 'bg-brand-primary/10'
                    : 'hover:bg-bg-hover',
                )}
              >
                <span className={cn(
                  'text-[13px] font-mono font-medium shrink-0',
                  i === selectedSuggestion ? 'text-brand-primary' : 'text-text-secondary',
                )}>
                  /{s.name}
                </span>
                {s.argsHint && (
                  <span className="text-[11px] text-text-quaternary font-mono shrink-0">
                    {s.argsHint}
                  </span>
                )}
                <span className="text-[12px] text-text-tertiary truncate flex-1">
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-elevated border border-border-subtle text-[12px] text-text-secondary"
            >
              {att.preview ? (
                <img src={att.preview} className="w-8 h-8 rounded object-cover" alt="" />
              ) : (
                getFileIcon(att.file.type)
              )}
              <span className="max-w-[120px] truncate">{att.file.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                className="ml-0.5 text-text-quaternary hover:text-text-primary cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={cn(
        'flex gap-2 rounded-full px-3',
        multiline ? 'items-end rounded-3xl py-2.5' : 'items-center py-1.5',
        'bg-bg-elevated/90 backdrop-blur-xl',
        'border border-border-default',
        'focus-within:border-border-strong',
        'transition-all duration-200',
      )}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.zip,.tar,.gz,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.json,.csv"
          className="hidden"
          onChange={handleFilesChosen}
        />
        <button
          onClick={handleFileSelect}
          disabled={disabled}
          className="flex items-center justify-center w-9 h-9 rounded-full text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.1)] cursor-pointer transition-colors duration-150 shrink-0"
          aria-label="附件"
        >
          <Paperclip size={17} strokeWidth={1.5} />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          placeholder={placeholder || '输入消息...'}
          // readOnly (not disabled) avoids iOS Safari keyboard dismissal on toggle
          readOnly={disabled}
          rows={1}
          className={cn(
            'flex-1 bg-transparent text-[16px] md:text-[14px] text-text-primary placeholder:text-text-quaternary',
            'resize-none outline-none leading-9 styled-scrollbar',
            multiline ? 'leading-[1.5] py-1 overflow-y-auto' : 'overflow-hidden',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          style={{ maxHeight: MAX_TEXTAREA_HEIGHT }}
        />

        <button
          className="flex items-center justify-center w-9 h-9 rounded-full text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.1)] cursor-pointer transition-colors duration-150 shrink-0"
          aria-label="语音"
        >
          <Mic size={17} strokeWidth={1.5} />
        </button>

        <button
          onClick={thinking && onAbort ? onAbort : submit}
          disabled={thinking ? false : (disabled || (!text.trim() && attachments.length === 0))}
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-full cursor-pointer shrink-0',
            'transition-all duration-150',
            thinking
              ? 'bg-status-error/20 text-status-error hover:bg-status-error/30 hover:brightness-110 active:scale-92 border border-status-error/30'
              : (text.trim() || attachments.length > 0)
                ? 'bg-gradient-to-br from-[#C4915E] to-[#D4A574] text-white shadow-[0_4px_12px_rgba(212,165,116,0.3)] hover:shadow-[0_4px_16px_rgba(212,165,116,0.4)] hover:brightness-110 active:scale-92'
                : 'bg-[rgba(255,255,255,0.06)] text-text-quaternary cursor-default',
          )}
          aria-label={thinking ? '中断' : '发送'}
          title={thinking ? '中断回答' : '发送'}
        >
          {thinking ? <Square size={14} strokeWidth={2.5} className="fill-current" /> : <SendHorizonal size={16} strokeWidth={2} />}
        </button>
      </div>
    </div>
  )
}
