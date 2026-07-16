import React, { useRef, useEffect, useCallback, useState, memo } from 'react'
import { cn } from '@/lib/utils'
import { Bot, User, Loader2, X, Copy, RotateCcw, ChevronRight, Wrench, Brain, CheckCircle2, AlertCircle, Pencil, Check } from 'lucide-react'
import { t } from '../i18n'
import { apiUrl } from '@/utils/api-base'

function formatClockTime(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

/** Format token count: 1234 → 1.2K, 12345 → 12K */
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return String(n)
}
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatItem } from '@/hooks/useWebSocket'
import { MediaCard } from './MediaCard'
import { RichAttachmentCard } from './RichAttachmentCard'

interface ChatMessagesProps {
  items: ChatItem[]
  agentName: string
  agentSpecialty?: string
  agentAvatarUrl?: string
  agentThinking?: boolean
  /** Live reasoning/thinking text being streamed (shown while agent is thinking) */
  liveThinkingText?: string
  connected?: boolean
  visible?: boolean
  historyLoading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  className?: string
  contextInfo?: { used: number; limit: number; percent: number }
  /** Retry: re-send a user message to the agent. Receives the text of the user message. */
  onRetry?: (text: string) => void
  /** Edit: replace a user message with new text and re-send. Receives message id, old text, and new text. */
  onEdit?: (msgId: string, oldText: string, newText: string) => void
  /** Whether the agent is currently thinking (disables retry/edit buttons) */
  retryDisabled?: boolean
  /** Reasoning visibility setting: 'off' hides reasoning, 'on'/'stream'/undefined shows it */
  reasoningVisibility?: string
  /** Usage footer mode: 'off' hides token stats, 'tokens' shows input/output, 'full' shows input/output/cache/reasoning */
  usageMode?: 'off' | 'tokens' | 'full'
}

interface DerivedAttachment {
  key: string
  kind: 'media' | 'rich'
  mediaType?: 'image' | 'video' | 'audio' | 'file'
  fileUrl: string
  fileName?: string
  mimeType?: string
  displayTitle?: string
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'css', 'scss', 'sh', 'java', 'go', 'rs', 'yaml', 'yml'])

function normalizeResolvedUrl(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('/steward-workspace/') || raw.startsWith('/citizen-workshop/_api/media/')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/Users/')) {
    const stewardMarker = '/.openclaw/agents/town-steward/'
    const markerIdx = raw.indexOf(stewardMarker)
    if (markerIdx >= 0) {
      const rel = raw.slice(markerIdx + stewardMarker.length)
      return `/steward-workspace/${rel}`
    }
    // base64url 编码：避免 %2F 被 nginx 反代吞掉（只用 A-Za-z0-9-_ 字符）
    const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `/citizen-workshop/_api/media/${b64}`
  }
  if (raw.startsWith('projects/') || raw.startsWith('tasks/')) {
    return `/steward-workspace/${raw}`
  }
  return raw
}

function inferAttachmentFromPath(rawPath: string): DerivedAttachment | null {
  const clean = rawPath.replace(/[)\]】》》」>.,，。；！？]+$/u, '')
  const fileName = clean.split('/').pop() || clean
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (!ext) return null
  const fileUrl = normalizeResolvedUrl(clean)
  if (!fileUrl) return null
  const mimeType =
    IMAGE_EXTS.has(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` :
    VIDEO_EXTS.has(ext) ? `video/${ext === 'mov' ? 'quicktime' : ext}` :
    AUDIO_EXTS.has(ext) ? `audio/${ext === 'm4a' ? 'mp4' : ext}` :
    ext === 'md' ? 'text/markdown' :
    ext === 'html' ? 'text/html' :
    'application/octet-stream'

  if (IMAGE_EXTS.has(ext)) return { key: `attachment:${clean}`, kind: 'media', mediaType: 'image', fileUrl, fileName, mimeType }
  if (VIDEO_EXTS.has(ext)) return { key: `attachment:${clean}`, kind: 'media', mediaType: 'video', fileUrl, fileName, mimeType }
  if (AUDIO_EXTS.has(ext)) return { key: `attachment:${clean}`, kind: 'media', mediaType: 'audio', fileUrl, fileName, mimeType }
  if (ext === 'md' || ext === 'html' || CODE_EXTS.has(ext)) return { key: `attachment:${clean}`, kind: 'rich', fileUrl, fileName, mimeType }
  return { key: `attachment:${clean}`, kind: 'media', mediaType: 'file', fileUrl, fileName, mimeType }
}

function findContextualTitle(text: string, pathIndex: number): string | undefined {
  const before = text.slice(0, pathIndex)
  const boldMatches = [...before.matchAll(/\*\*(.+?)\*\*/g)]
  if (boldMatches.length > 0) {
    const last = boldMatches[boldMatches.length - 1][1]
    if (last.length >= 2 && last.length <= 60) return last
  }
  return undefined
}

function extractAttachmentsFromText(text: string, existingUrls: Set<string>): DerivedAttachment[] {
  if (!text) return []
  const regex = /(?:\/steward-workspace\/[^\s"'`<>()]+|\/citizen-workshop\/_api\/media\/[A-Za-z0-9_-]+|\/citizen-workshop\/_api\/media\?path=[^\s"'`<>()]+|\/Users\/[^\s"'`<>()]+\.[A-Za-z0-9]+|projects\/[^\s"'`<>()]+\.[A-Za-z0-9]+|tasks\/[^\s"'`<>()]+\.[A-Za-z0-9]+|https?:\/\/[^\s"'`<>()]+\.[A-Za-z0-9/._?=%-]+)/gu
  const results: DerivedAttachment[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(regex)) {
    const raw = match[0]
    const attachment = inferAttachmentFromPath(raw)
    if (!attachment) continue
    if (existingUrls.has(attachment.fileUrl)) continue
    if (seen.has(attachment.fileUrl)) continue
    seen.add(attachment.fileUrl)
    attachment.displayTitle = findContextualTitle(text, match.index ?? 0)
    results.push(attachment)
  }
  return results
}

/** Highlight @mention patterns in string children by wrapping them in a styled span. */
function highlightMentionsInChildren(
  children: React.ReactNode,
  mentions: string[],
  participants: Array<{ npcId: string; name: string }>,
): React.ReactNode {
  if (!mentions || mentions.length === 0) return children
  // Build a set of mention names to highlight
  const namesToHighlight = new Set<string>()
  if (mentions.includes('all')) {
    namesToHighlight.add('所有人')
    namesToHighlight.add('all')
    namesToHighlight.add('全体')
  }
  for (const npcId of mentions) {
    if (npcId === 'all') continue
    const p = participants.find(pp => pp.npcId === npcId)
    if (p) namesToHighlight.add(p.name)
  }
  if (namesToHighlight.size === 0) return children

  // Build regex pattern: @name for each name
  const escapedNames = [...namesToHighlight].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escapedNames.join('|')})(?=\\s|$|[,，。.!！?？])`, 'g')

  return React.Children.map(children, (child) => {
    if (typeof child !== 'string') return child
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    let key = 0
    while ((match = pattern.exec(child)) !== null) {
      if (match.index > lastIndex) {
        parts.push(child.slice(lastIndex, match.index))
      }
      parts.push(
        <span key={`mention-${key++}`} style={{ color: '#D4A574', fontWeight: 600 }}>{match[0]}</span>
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex === 0) return child
    if (lastIndex < child.length) parts.push(child.slice(lastIndex))
    return <>{parts}</>
  })
}

export const MarkdownContent = memo(function MarkdownContent({ text, mentionHighlight, breaks }: { text: string; mentionHighlight?: { mentions: string[]; participants: Array<{ npcId: string; name: string }> }; breaks?: boolean }) {
  // breaks=true: convert single newlines to Markdown hard line breaks to preserve user line structure
  const md = breaks ? text.replace(/\n/g, '  \n') : text
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => {
          // Highlight @mentions in paragraph text nodes
          let processedChildren = children
          if (mentionHighlight && mentionHighlight.mentions.length > 0) {
            processedChildren = highlightMentionsInChildren(children, mentionHighlight.mentions, mentionHighlight.participants)
          }
          return <p className="mb-2 last:mb-0">{processedChildren}</p>
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-cyan hover:underline">{children}</a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith('language-')
          if (isBlock) {
            return (
              <div className="my-2 rounded-lg bg-bg-base border border-border-subtle overflow-hidden">
                <div className="flex items-center px-3 py-1.5 bg-bg-canvas border-b border-border-subtle">
                  <span className="text-[10px] text-text-tertiary">{className?.replace('language-', '') || 'code'}</span>
                </div>
                <pre className="p-3 overflow-x-auto styled-scrollbar">
                  <code className="text-[12px] leading-relaxed text-text-secondary">{children}</code>
                </pre>
              </div>
            )
          }
          return <code className="px-1.5 py-0.5 rounded bg-bg-elevated text-[12px] text-brand-secondary" {...props}>{children}</code>
        },
        pre: ({ children }) => <>{children}</>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-text-secondary">{children}</li>,
        h1: ({ children }) => <h1 className="text-lg font-bold text-text-primary mb-2 mt-3">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-text-primary mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold text-text-primary mb-1 mt-2">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-brand-primary/30 pl-3 my-2 text-text-tertiary italic">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto styled-scrollbar"><table className="text-[12px] border-collapse w-full">{children}</table></div>
        ),
        th: ({ children }) => <th className="border border-border-default px-2 py-1 bg-bg-elevated text-text-primary text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border border-border-subtle px-2 py-1 text-text-secondary">{children}</td>,
        hr: () => <hr className="my-3 border-border-subtle" />,
        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
      }}
    >
      {md}
    </ReactMarkdown>
  )
})

/** Collapsible tool call item — styled like VS Code Copilot Chat tool invocations. */
function ToolCallItem({ item }: { item: ChatItem }) {
  const [expanded, setExpanded] = useState(false)
  if (item.kind !== 'tool') return null
  const isStart = item.phase === 'start'
  const isError = item.isError
  const icon = isStart
    ? (isError ? <AlertCircle size={12} strokeWidth={1.8} className="text-status-error shrink-0" /> : <Wrench size={12} strokeWidth={1.8} className="text-text-tertiary shrink-0" />)
    : <CheckCircle2 size={12} strokeWidth={1.8} className="text-status-success shrink-0" />
  const label = isStart ? item.toolName : `${item.toolName} →`
  const detail = isStart
    ? (item.input ? JSON.stringify(item.input, null, 2) : '')
    : (item.outputText ?? '')
  return (
    <div className="text-[11px]">
      <button
        onClick={() => detail && setExpanded(e => !e)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg w-full text-left',
          'transition-colors duration-150',
          detail ? 'cursor-pointer hover:bg-bg-elevated/40' : 'cursor-default',
        )}
      >
        {detail && <ChevronRight size={10} strokeWidth={1.8} className={cn('shrink-0 transition-transform duration-150', expanded && 'rotate-90')} />}
        {!detail && <span className="w-2.5 shrink-0" />}
        {icon}
        <span className="text-text-tertiary font-medium truncate">{label}</span>
      </button>
      {expanded && detail && (
        <div className="mt-1 ml-6 mr-2 p-2 rounded-lg bg-bg-base/60 border border-border-subtle overflow-x-auto">
          <pre className="text-[10px] text-text-tertiary whitespace-pre-wrap break-all font-mono leading-relaxed">{detail}</pre>
        </div>
      )}
    </div>
  )
}

/** Collapsible reasoning/thinking box — styled like VS Code Copilot Chat thinking process. */
export function ReasoningBox({ reasoning, reasoningTokens }: { reasoning?: string; reasoningTokens?: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasText = reasoning && reasoning.length > 0
  return (
    <div className="mb-1.5">
      <button
        onClick={() => hasText && setExpanded(e => !e)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] text-text-tertiary',
          'transition-colors duration-150',
          hasText && 'cursor-pointer hover:bg-bg-elevated/40',
        )}
      >
        <ChevronRight size={10} strokeWidth={1.8} className={cn('shrink-0 transition-transform duration-150', expanded && 'rotate-90')} />
        <Brain size={12} strokeWidth={1.8} className="shrink-0 text-brand-primary/50" />
        <span className="font-medium">思考过程</span>
        {reasoningTokens && reasoningTokens > 0 && (
          <span className="text-text-tertiary/70 tabular-nums">· {reasoningTokens} tokens</span>
        )}
      </button>
      {expanded && hasText && (
        <div className="mt-1 ml-6 mr-2 p-2.5 rounded-lg bg-bg-base/40 border border-border-subtle/60 overflow-x-auto">
          <div className="text-[11px] text-text-tertiary leading-relaxed whitespace-pre-wrap break-words">{reasoning}</div>
        </div>
      )}
    </div>
  )
}

/** Live thinking box — shows reasoning text as it streams in (like Copilot's thinking process). */
function LiveThinkingBox({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Auto-scroll to bottom when text grows
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [text])
  return (
    <div className="rounded-2xl rounded-tl-md bg-bg-elevated border border-border-subtle overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-text-tertiary transition-colors duration-150 cursor-pointer hover:bg-bg-base/40"
      >
        <ChevronRight size={10} strokeWidth={1.8} className={cn('shrink-0 transition-transform duration-150', expanded && 'rotate-90')} />
        <Brain size={12} strokeWidth={1.8} className="shrink-0 text-brand-primary/50" />
        <span className="font-medium">思考中</span>
        <span className="w-1.5 h-1.5 rounded-full bg-brand-primary/60 animate-pulse ml-0.5" />
      </button>
      {expanded && text && (
        <div ref={scrollRef} className="px-3 pb-2.5 max-h-[200px] overflow-y-auto styled-scrollbar">
          <div className="text-[11px] text-text-tertiary leading-relaxed whitespace-pre-wrap break-words">{text}</div>
        </div>
      )}
    </div>
  )
}

/** Hover action buttons for message bubbles (copy + optional retry/edit + model badge). */
function MessageActions({ text, onRetry, onEdit, retryDisabled, model, isError }: { text: string; onRetry?: () => void; onEdit?: () => void; retryDisabled?: boolean; model?: string; isError?: boolean }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }, [text])

  return (
    <div className="flex items-center gap-1 mt-0.5 px-1 transition-opacity duration-150">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/60 cursor-pointer transition-colors duration-150"
        title={t('chat.copy')}
      >
        {copied ? <span className="text-status-success">{t('chat.copied')}</span> : <Copy size={11} strokeWidth={1.5} />}
      </button>
      {model && (
        <span className="text-[10px] text-text-tertiary/70 tabular-nums px-1 max-w-[160px] truncate" title={`模型: ${model}`}>
          {model}
        </span>
      )}
      {onEdit && (
        <button
          onClick={onEdit}
          disabled={retryDisabled}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors duration-150',
            'text-text-tertiary hover:text-brand-secondary hover:bg-bg-elevated/60',
            retryDisabled && 'opacity-40 cursor-default',
          )}
          title={t('chat.edit')}
        >
          <Pencil size={11} strokeWidth={1.5} />
        </button>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors duration-150',
            isError
              ? 'text-status-error hover:text-status-error hover:bg-status-error/10'
              : 'text-text-tertiary hover:text-brand-secondary hover:bg-bg-elevated/60',
            retryDisabled && 'opacity-40 cursor-default',
          )}
          title={isError ? t('chat.retry_error') : t('chat.retry')}
        >
          <RotateCcw size={11} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

/** Inline editor for user messages — styled like VS Code Copilot Chat edit mode. */
function EditableUserMessage({ text, onSave, onCancel }: { text: string; onSave: (newText: string) => void; onCancel: () => void }) {
  const [editText, setEditText] = useState(text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === text) { onCancel(); return }
    onSave(trimmed)
  }, [editText, text, onSave, onCancel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [handleSubmit, onCancel])

  return (
    <div className="ml-auto flex flex-col gap-1.5 max-w-[85%]">
      <textarea
        ref={textareaRef}
        value={editText}
        onChange={(e) => {
          setEditText(e.target.value)
          const ta = e.target
          ta.style.height = 'auto'
          ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-2xl rounded-tr-md px-3.5 py-2.5 text-[13px] leading-relaxed bg-bg-elevated text-text-primary border border-brand-primary/40 outline-none resize-none styled-scrollbar focus:border-brand-primary/60 transition-colors"
        rows={1}
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/60 cursor-pointer transition-colors duration-150"
        >
          {t('chat.cancel_edit')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!editText.trim() || editText.trim() === text}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors duration-150',
            'bg-brand-primary/15 text-brand-primary hover:bg-brand-primary/25',
            (!editText.trim() || editText.trim() === text) && 'opacity-40 cursor-default',
          )}
        >
          <Check size={12} strokeWidth={2} />
          {t('chat.save_edit')}
        </button>
      </div>
    </div>
  )
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center cursor-pointer backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors z-10"
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt="preview"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function LoadingSpinner({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-4 gap-2">
      <Loader2 size={14} className="animate-spin text-text-tertiary" />
      <span className="text-[12px] text-text-tertiary">{text}</span>
    </div>
  )
}

export function ChatMessages({
  items, agentName, agentSpecialty, agentAvatarUrl, agentThinking, liveThinkingText,
  historyLoading, loadingMore, hasMore, onLoadMore, className, onRetry, onEdit, retryDisabled, reasoningVisibility, usageMode,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const hasMoreRef = useRef(hasMore)
  const loadingMoreRef = useRef(loadingMore)
  onLoadMoreRef.current = onLoadMore
  hasMoreRef.current = hasMore
  loadingMoreRef.current = loadingMore

  const messages = items.filter(it => it.kind === 'text' || it.kind === 'media' || it.kind === 'tool' || it.kind === 'status')
  const existingMediaUrls = new Set(
    messages
      .filter((it) => it.kind === 'media' && it.fileUrl)
      .map((it) => it.fileUrl as string),
  )

  useEffect(() => {
    if (historyLoading || messages.length === 0) {
      setReady(false)
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true))
    })
  }, [historyLoading, messages.length > 0])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasMoreRef.current || loadingMoreRef.current) return
    const distanceFromTop = el.scrollHeight - el.clientHeight + el.scrollTop
    if (distanceFromTop < 150) {
      onLoadMoreRef.current?.()
    }
  }, [])

  if (historyLoading) {
    return (
      <div className={cn('flex-1 flex flex-col items-center justify-center', className)}>
        <Loader2 size={24} className="animate-spin text-brand-primary/40 mb-3" />
        <div className="text-[13px] text-text-tertiary">正在加载聊天记录...</div>
      </div>
    )
  }

  if (messages.length === 0 && !agentThinking) {
    return (
      <div className={cn('flex-1 flex flex-col', className)}>
        <div className="flex-1" />
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 styled-scrollbar',
        'flex flex-col-reverse',
        'transition-opacity duration-150',
        className,
      )}
      style={{ opacity: ready ? 1 : 0 }}
    >
      <div className="w-full">
        <div className="space-y-4">
          {messages.map((msg) => {
            // Tool calls and status items render as compact inline items (no avatar/bubble)
            if (msg.kind === 'tool') {
              return (
                <div key={msg.id} className="flex gap-3 max-w-[85%]">
                  <div className="w-7 shrink-0" />
                  <div className="min-w-0">
                    <ToolCallItem item={msg} />
                  </div>
                </div>
              )
            }
            if (msg.kind === 'status') {
              return (
                <div key={msg.id} className="flex gap-3 max-w-[85%]">
                  <div className="w-7 shrink-0" />
                  <div className="min-w-0 text-[11px] text-text-tertiary/70 px-2 py-0.5">
                    {msg.text}
                  </div>
                </div>
              )
            }
            return (
            <div
              key={msg.id}
              className={cn(
                'group flex gap-3 max-w-[85%]',
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : '',
              )}
            >
              <div className={cn(
                'w-7 h-7 rounded-full shrink-0 mt-0.5 overflow-hidden',
                msg.role === 'user' ? 'bg-[rgba(212,165,116,0.15)] flex items-center justify-center' : '',
              )}>
                {msg.role === 'user'
                  ? <User size={13} strokeWidth={1.8} className="text-brand-primary" />
                  : agentAvatarUrl
                    ? <img src={apiUrl(agentAvatarUrl)} alt={agentName} className="w-full h-full object-cover rounded-full" />
                    : <div className="w-full h-full bg-bg-elevated flex items-center justify-center rounded-full"><Bot size={13} strokeWidth={1.8} className="text-text-tertiary" /></div>
                }
              </div>

              <div className="min-w-0">
                {msg.kind === 'media' ? (
                  msg.role === 'assistant' && msg.mediaType === 'file' && (msg.fileName?.toLowerCase().endsWith('.md') || msg.fileName?.toLowerCase().endsWith('.html') || CODE_EXTS.has(msg.fileName?.split('.').pop()?.toLowerCase() ?? '')) ? (
                    <RichAttachmentCard
                      fileUrl={msg.fileUrl ?? ''}
                      fileName={msg.fileName}
                      mimeType={msg.mimeType}
                    />
                  ) : (
                    <MediaCard
                      type={msg.mediaType ?? 'file'}
                      text={msg.caption ?? ''}
                      imageData={msg.imageData}
                      mimeType={msg.mimeType}
                      fileUrl={msg.fileUrl}
                      fileName={msg.fileName}
                      fileSize={msg.fileSize}
                      onImageClick={(src) => setLightboxSrc(src)}
                    />
                  )
                ) : (
                  <>
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary mb-1 px-0.5 flex-wrap">
                        <span>{agentName}{agentSpecialty && <span className="text-text-tertiary/80">（{agentSpecialty}）</span>}</span>
                        {msg.timestamp > 0 && <span className="text-text-tertiary/80 tabular-nums">{formatClockTime(msg.timestamp)}</span>}
                        {usageMode !== 'off' && msg.usage && (msg.usage.input > 0 || msg.usage.output > 0) && (
                          <span className="text-text-tertiary/70 tabular-nums" title={`输入 ${msg.usage.input} / 输出 ${msg.usage.output} tokens`}>
                            ↑{formatTokens(msg.usage.input)} ↓{formatTokens(msg.usage.output)}
                            {usageMode === 'full' && (() => {
                              const cr = msg.usage!.cacheRead ?? 0
                              const inp = msg.usage!.input ?? 0
                              if (cr <= 0) return null
                              const total = cr + inp
                              const pct = total > 0 ? Math.round((cr / total) * 100) : 0
                              return (
                                <span className="ml-1" title={`缓存命中 ${cr} tokens (${pct}%)`}>
                                  · cache {pct}% ({formatTokens(cr)})
                                </span>
                              )
                            })()}
                            {usageMode === 'full' && msg.usage.reasoningTokens && msg.usage.reasoningTokens > 0 && (
                              <span className="ml-1" title={`推理 ${msg.usage.reasoningTokens} tokens`}>
                                · think {formatTokens(msg.usage.reasoningTokens)}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.kind === 'text' && reasoningVisibility !== 'off' && !!(msg.reasoning || (msg.usage?.reasoningTokens && msg.usage.reasoningTokens > 0)) && (
                      <ReasoningBox reasoning={msg.reasoning} reasoningTokens={msg.usage?.reasoningTokens} />
                    )}
                    {msg.role === 'user' && msg.kind === 'text' && editingId === msg.id ? (
                      <EditableUserMessage
                        text={msg.text ?? ''}
                        onSave={(newText) => {
                          setEditingId(null)
                          onEdit?.(msg.id, msg.text ?? '', newText)
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                    <>
                    <div className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed min-w-0 w-fit',
                      msg.role === 'user'
                        ? 'bg-[rgba(212,165,116,0.12)] text-text-primary rounded-tr-md border border-[rgba(212,165,116,0.20)]'
                        : msg.isError
                          ? 'bg-[rgba(248,113,113,0.06)] text-text-secondary rounded-tl-md border border-status-error/30'
                          : 'bg-bg-elevated text-text-secondary rounded-tl-md border border-border-subtle',
                    )}>
                      {msg.role === 'assistant' && msg.isError && (
                        <div className="flex items-center gap-1.5 mb-1.5 text-[11px] text-status-error">
                          <AlertCircle size={12} strokeWidth={1.8} className="shrink-0" />
                          <span className="font-medium">{t('chat.error_occurred')}</span>
                        </div>
                      )}
                      {msg.role === 'user' ? (
                        <div className="markdown-body break-words">
                          <MarkdownContent text={msg.text ?? ''} breaks />
                        </div>
                      ) : (
                        <div className="markdown-body break-words">
                          <MarkdownContent text={msg.text ?? ''} />
                        </div>
                      )}
                    </div>
                    {msg.role === 'user' && msg.timestamp > 0 && (
                      <div className="text-[10px] text-text-tertiary/80 mt-0.5 px-1 text-right tabular-nums">{formatClockTime(msg.timestamp)}</div>
                    )}
                    {msg.role === 'user' && msg.kind === 'text' && (
                      <div className="flex justify-end">
                        <MessageActions
                          text={msg.text ?? ''}
                          onRetry={onRetry ? () => onRetry(msg.text ?? '') : undefined}
                          onEdit={onEdit ? () => setEditingId(msg.id) : undefined}
                          retryDisabled={retryDisabled}
                        />
                      </div>
                    )}
                    </>
                    )}
                    {msg.role === 'assistant' && msg.kind === 'text' && (
                      <MessageActions
                        text={msg.text ?? ''}
                        model={msg.model}
                        isError={msg.isError}
                        onRetry={msg.isError && onRetry ? (() => {
                          // Find the last user text message before this error message
                          const msgIdx = messages.findIndex(m => m.id === msg.id)
                          if (msgIdx < 0) return
                          for (let i = msgIdx - 1; i >= 0; i--) {
                            if (messages[i].role === 'user' && messages[i].kind === 'text' && messages[i].text) {
                              onRetry(messages[i].text!)
                              return
                            }
                          }
                        }) : undefined}
                        retryDisabled={retryDisabled}
                      />
                    )}
                    {msg.kind === 'text' && msg.role === 'assistant' && (
                      (() => {
                        const attachments = extractAttachmentsFromText(msg.text ?? '', existingMediaUrls)
                        if (attachments.length === 0) return null
                        return (
                          <div className="mt-2 space-y-3">
                            {attachments.map((attachment) => (
                              attachment.kind === 'rich' ? (
                                <RichAttachmentCard
                                  key={attachment.key}
                                  fileUrl={attachment.fileUrl}
                                  fileName={attachment.fileName}
                                  mimeType={attachment.mimeType}
                                  displayTitle={attachment.displayTitle}
                                />
                              ) : (
                                <MediaCard
                                  key={attachment.key}
                                  type={attachment.mediaType ?? 'file'}
                                  fileUrl={attachment.fileUrl}
                                  fileName={attachment.fileName}
                                  mimeType={attachment.mimeType}
                                  onImageClick={(src) => setLightboxSrc(src)}
                                />
                              )
                            ))}
                          </div>
                        )
                      })()
                    )}
                  </>
                )}
              </div>
            </div>
            )
          })}

          {agentThinking && (
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 overflow-hidden">
                {agentAvatarUrl
                  ? <img src={apiUrl(agentAvatarUrl)} alt="" className="w-full h-full object-cover rounded-full" />
                  : <div className="w-full h-full bg-bg-elevated flex items-center justify-center rounded-full"><Bot size={13} strokeWidth={1.8} className="text-text-tertiary" /></div>
                }
              </div>
              <div className="flex-1 min-w-0">
                {liveThinkingText && reasoningVisibility !== 'off' ? (
                  <LiveThinkingBox text={liveThinkingText} />
                ) : (
                  <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-bg-elevated border border-border-subtle">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* In column-reverse, this div appears at visual top (oldest messages) */}
      {hasMore ? (
        <div className="w-full pt-2 pb-4">
          {loadingMore ? (
            <LoadingSpinner text="加载更多..." />
          ) : (
            <div className="text-center">
              <button
                onClick={onLoadMore}
                className="text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
              >
                加载更早的消息
              </button>
            </div>
          )}
        </div>
      ) : messages.length > 0 ? (
        <div className="w-full pt-2 pb-4">
          <div className="text-center text-[11px] text-text-tertiary select-none">只展示最近 100 条 session 记录</div>
        </div>
      ) : null}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  )
}
