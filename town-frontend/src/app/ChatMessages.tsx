import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { cn } from '@/lib/utils'
import { Bot, User, Loader2, X } from 'lucide-react'

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
  connected?: boolean
  visible?: boolean
  historyLoading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  className?: string
  contextInfo?: { used: number; limit: number; percent: number }
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
  if (raw.startsWith('/steward-workspace/') || raw.startsWith('/citizen-workshop/_api/media?path=')) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/Users/')) {
    const stewardMarker = '/.openclaw/agents/town-steward/'
    const markerIdx = raw.indexOf(stewardMarker)
    if (markerIdx >= 0) {
      const rel = raw.slice(markerIdx + stewardMarker.length)
      return `/steward-workspace/${rel}`
    }
    return `/citizen-workshop/_api/media?path=${encodeURIComponent(raw)}`
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
  const regex = /(?:\/steward-workspace\/[^\s"'`<>()]+|\/citizen-workshop\/_api\/media\?path=[^\s"'`<>()]+|\/Users\/[^\s"'`<>()]+\.[A-Za-z0-9]+|projects\/[^\s"'`<>()]+\.[A-Za-z0-9]+|tasks\/[^\s"'`<>()]+\.[A-Za-z0-9]+|https?:\/\/[^\s"'`<>()]+\.[A-Za-z0-9/._?=%-]+)/gu
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

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-cyan hover:underline">{children}</a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith('language-')
          if (isBlock) {
            return (
              <div className="my-2 rounded-lg bg-bg-base border border-border-subtle overflow-hidden">
                <div className="flex items-center px-3 py-1.5 bg-bg-canvas border-b border-border-subtle">
                  <span className="text-[10px] text-text-quaternary">{className?.replace('language-', '') || 'code'}</span>
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
      {text}
    </ReactMarkdown>
  )
})

function ThinkingIndicator({ avatarUrl }: { avatarUrl?: string }) {
  return (
    <div className="flex gap-3 max-w-[85%]">
      <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 overflow-hidden">
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="w-full h-full object-cover rounded-full" />
          : <div className="w-full h-full bg-bg-elevated flex items-center justify-center rounded-full"><Bot size={13} strokeWidth={1.8} className="text-text-quaternary" /></div>
        }
      </div>
      <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-bg-elevated border border-border-subtle">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
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
      <Loader2 size={14} className="animate-spin text-text-quaternary" />
      <span className="text-[12px] text-text-quaternary">{text}</span>
    </div>
  )
}

export function ChatMessages({
  items, agentName, agentSpecialty, agentAvatarUrl, agentThinking, connected, visible,
  historyLoading, loadingMore, hasMore, onLoadMore, className, contextInfo,
}: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const onLoadMoreRef = useRef(onLoadMore)
  const hasMoreRef = useRef(hasMore)
  const loadingMoreRef = useRef(loadingMore)
  onLoadMoreRef.current = onLoadMore
  hasMoreRef.current = hasMore
  loadingMoreRef.current = loadingMore

  const messages = items.filter(it => it.kind === 'text' || it.kind === 'media')
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
        'flex-1 overflow-y-auto px-4 py-4 styled-scrollbar',
        'flex flex-col-reverse',
        'transition-opacity duration-150',
        className,
      )}
      style={{ opacity: ready ? 1 : 0 }}
    >
      <div className="max-w-3xl mx-auto w-full">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3 max-w-[85%]',
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
                    ? <img src={agentAvatarUrl} alt={agentName} className="w-full h-full object-cover rounded-full" />
                    : <div className="w-full h-full bg-bg-elevated flex items-center justify-center rounded-full"><Bot size={13} strokeWidth={1.8} className="text-text-quaternary" /></div>
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
                      <div className="flex items-center gap-1.5 text-[11px] text-text-quaternary mb-1 px-0.5 flex-wrap">
                        <span>{agentName}{agentSpecialty && <span className="text-text-quaternary/70">（{agentSpecialty}）</span>}</span>
                        {msg.timestamp > 0 && <span className="text-text-quaternary/60 tabular-nums">{formatClockTime(msg.timestamp)}</span>}
                        {msg.usage && (
                          <span className="text-text-quaternary/50 tabular-nums" title={`输入 ${msg.usage.input} / 输出 ${msg.usage.output} tokens`}>
                            ↑{formatTokens(msg.usage.input)} ↓{formatTokens(msg.usage.output)}
                          </span>
                        )}
                        {msg.usage && contextInfo && contextInfo.limit > 0 && (
                          <span className="text-text-quaternary/50 tabular-nums" title={`上下文 ${formatTokens(contextInfo.used)}/${formatTokens(contextInfo.limit)}`}>
                            ctx {formatTokens(contextInfo.used)}/{formatTokens(contextInfo.limit)}
                          </span>
                        )}
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed min-w-0 w-fit',
                      msg.role === 'user'
                        ? 'bg-[rgba(212,165,116,0.12)] text-text-primary rounded-tr-md border border-[rgba(212,165,116,0.20)]'
                        : 'bg-bg-elevated text-text-secondary rounded-tl-md border border-border-subtle',
                    )}>
                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap break-words">{msg.text ?? ''}</div>
                      ) : (
                        <div className="markdown-body break-words">
                          <MarkdownContent text={msg.text ?? ''} />
                        </div>
                      )}
                    </div>
                    {msg.role === 'user' && msg.timestamp > 0 && (
                      <div className="text-[10px] text-text-quaternary/60 mt-0.5 px-1 text-right tabular-nums">{formatClockTime(msg.timestamp)}</div>
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
          ))}

          {agentThinking && <ThinkingIndicator avatarUrl={agentAvatarUrl} />}
        </div>
      </div>

      {/* In column-reverse, this div appears at visual top (oldest messages) */}
      {hasMore ? (
        <div className="max-w-3xl mx-auto w-full pt-2 pb-4">
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
        <div className="max-w-3xl mx-auto w-full pt-2 pb-4">
          <div className="text-center text-[11px] text-text-quaternary select-none">只展示最近 100 条 session 记录</div>
        </div>
      ) : null}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  )
}
