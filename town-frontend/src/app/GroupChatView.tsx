import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Users, AtSign, SendHorizonal, Paperclip, Mic, X, FileText, ImageIcon, Film, Music, Trash2, Archive, Copy, RotateCcw } from 'lucide-react'
import type { AgentInfo } from '@/hooks/useAgents'
import type { GroupChatMessageItem, GroupChatInfo } from '@/hooks/useWebSocket'
import { MarkdownContent } from './ChatMessages'
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

interface GroupChatViewProps {
  visible: boolean
  agents: AgentInfo[]
  groupInfo: GroupChatInfo | null
  messages: GroupChatMessageItem[]
  onSend: (text: string, mentions: string[]) => void
  onClear?: () => void
  onCompact?: () => void
  compacting?: boolean
  thinking?: boolean
  typingCitizens?: Map<string, string>
  /** Retry: re-send a user message to the group. */
  onRetry?: (text: string, mentions: string[]) => void
}

interface MentionableCitizen {
  npcId: string
  name: string
  specialty?: string
  avatarUrl?: string
}

/** Hover action buttons for group message bubbles (copy + optional retry for user messages + model badge). */
function GroupMessageActions({ text, onRetry, retryDisabled, model }: { text: string; onRetry?: () => void; retryDisabled?: boolean; model?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
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
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-quaternary hover:text-text-secondary hover:bg-bg-elevated/60 cursor-pointer transition-colors duration-150"
        title="复制"
      >
        {copied ? <span className="text-status-success">已复制</span> : <Copy size={11} strokeWidth={1.5} />}
      </button>
      {model && (
        <span className="text-[10px] text-text-quaternary/60 tabular-nums px-1 max-w-[160px] truncate" title={`模型: ${model}`}>
          {model}
        </span>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors duration-150',
            'text-text-quaternary hover:text-brand-secondary hover:bg-bg-elevated/60',
            retryDisabled && 'opacity-40 cursor-default',
          )}
          title="重试"
        >
          <RotateCcw size={11} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

export function GroupChatView({ visible, agents, groupInfo, messages, onSend, onClear, onCompact, compacting, thinking, typingCitizens, onRetry }: GroupChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [showMentionPicker, setShowMentionPicker] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [activeMentions, setActiveMentions] = useState<string[]>([])
  const [attachments, setAttachments] = useState<Array<{ file: File; preview?: string }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mentionPickerRef = useRef<HTMLDivElement>(null)
  const mentionPickerListRef = useRef<HTMLDivElement>(null)
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Build mentionable citizens from group participants
  const mentionableCitizens: MentionableCitizen[] = useMemo(() => {
    if (!groupInfo) return []
    return groupInfo.participants.map(p => {
      const agent = agents.find(a => a.id === p.npcId)
      return {
        npcId: p.npcId,
        name: p.name,
        specialty: p.specialty,
        avatarUrl: agent?.avatarUrl,
      }
    })
  }, [groupInfo, agents])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (visible && messagesContainerRef.current) {
      // Use scrollTop instead of scrollIntoView to avoid scrolling ancestor containers
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [messages, visible])

  // Handle @ trigger in textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setInputText(value)

    // Detect @ trigger
    const lastAt = value.lastIndexOf('@')
    if (lastAt >= 0) {
      const textAfterAt = value.slice(lastAt + 1)
      // Only trigger if @ is at end or followed by non-space chars
      if (!textAfterAt.includes(' ') && textAfterAt.length <= 10) {
        setMentionFilter(textAfterAt)
        setShowMentionPicker(true)
        return
      }
    }
    setShowMentionPicker(false)
  }, [])

  // Insert mention
  const insertMention = useCallback((citizen: MentionableCitizen | 'all') => {
    const value = inputText
    const lastAt = value.lastIndexOf('@')
    const before = lastAt >= 0 ? value.slice(0, lastAt) : value
    const mentionTag = citizen === 'all' ? '@所有人' : `@${citizen.name}`
    const npcId = citizen === 'all' ? 'all' : citizen.npcId
    const newValue = `${before}${mentionTag} `

    setInputText(newValue)
    setActiveMentions(prev => prev.includes(npcId) ? prev : [...prev, npcId])
    setShowMentionPicker(false)
    setMentionFilter('')
    setMentionIndex(0)
    inputRef.current?.focus()
  }, [inputText])

  // Parse mentions from final text
  const parseMentions = useCallback((text: string): string[] => {
    const mentions: string[] = []
    if (/@所有人|@all|@全体/i.test(text)) {
      mentions.push('all')
    }
    for (const c of mentionableCitizens) {
      const pattern = new RegExp(`@${escapeRegExp(c.name)}(?=\\s|$|[,，。.!！?？])`, 'g')
      if (pattern.test(text)) {
        mentions.push(c.npcId)
      }
    }
    return mentions
  }, [mentionableCitizens])

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFilesChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newAttachments: Array<{ file: File; preview?: string }> = []
    for (const file of Array.from(files)) {
      const att: { file: File; preview?: string } = { file }
      if (file.type.startsWith('image/')) {
        att.preview = URL.createObjectURL(file)
      }
      newAttachments.push(att)
    }
    setAttachments(prev => [...prev, ...newAttachments])
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => {
      const next = [...prev]
      const removed = next.splice(idx, 1)[0]
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return next
    })
  }, [])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text && attachments.length === 0) return
    const mentions = parseMentions(text)
    onSend(text, mentions)
    setInputText('')
    setActiveMentions([])
    // Clear attachments
    setAttachments(prev => {
      for (const a of prev) if (a.preview) URL.revokeObjectURL(a.preview)
      return []
    })
  }, [inputText, parseMentions, onSend])

  const getFilteredMentions = useCallback((): (MentionableCitizen | 'all')[] => {
    const result: (MentionableCitizen | 'all')[] = []
    if (!mentionFilter || '所有人'.includes(mentionFilter) || 'all'.toLowerCase().includes(mentionFilter.toLowerCase())) {
      result.push('all')
    }
    for (const c of mentionableCitizens) {
      if (!mentionFilter || c.name.includes(mentionFilter)) {
        result.push(c)
      }
    }
    return result
  }, [mentionFilter, mentionableCitizens])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showMentionPicker) {
      const filtered = getFilteredMentions()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filtered.length > 0) {
          setMentionIndex(prev => (prev + 1) % filtered.length)
        }
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filtered.length > 0) {
          setMentionIndex(prev => (prev - 1 + filtered.length) % filtered.length)
        }
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filtered.length > 0) {
          insertMention(filtered[mentionIndex] ?? filtered[0])
        } else {
          setShowMentionPicker(false)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionPicker(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Block sending while the group is thinking — the send button is
      // disabled in this state, so Enter should not trigger a new message.
      if (thinking) return
      handleSend()
    }
  }, [showMentionPicker, handleSend, insertMention, getFilteredMentions, mentionIndex, thinking])

  // Reset mention index when filter changes or picker closes
  useEffect(() => {
    setMentionIndex(0)
  }, [mentionFilter, showMentionPicker])

  // Auto-scroll mention picker to keep active item visible
  useEffect(() => {
    if (!showMentionPicker) return
    const el = mentionItemRefs.current[mentionIndex]
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [mentionIndex, showMentionPicker])

  // Close mention picker on outside click
  useEffect(() => {
    if (!showMentionPicker) return
    const handler = (e: MouseEvent) => {
      if (mentionPickerRef.current && !mentionPickerRef.current.contains(e.target as Node)) {
        setShowMentionPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMentionPicker])

  if (!visible) return null

  const filteredMentions = getFilteredMentions()

  return (
    <div className="flex flex-col h-full w-full bg-bg-surface">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle shrink-0">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[rgba(212,165,116,0.12)] shrink-0">
          <Users size={12} strokeWidth={1.8} className="text-brand-secondary" />
        </div>
        <span className="text-[13px] font-semibold text-text-primary truncate" style={{ fontFamily: "'Trap', sans-serif" }}>
          {groupInfo?.groupName || '小镇广场'}
        </span>
        <span className="text-[11px] text-text-quaternary shrink-0">
          {groupInfo ? `${groupInfo.participants.length} 位居民` : '加载中...'}
        </span>
        {groupInfo && typeof groupInfo.compactionCount === 'number' && groupInfo.compactionCount > 0 && (
          <span className="text-[11px] text-text-quaternary/50 tabular-nums shrink-0" title={`上下文压缩次数 ${groupInfo.compactionCount}`}>
            · 压缩 {groupInfo.compactionCount}
          </span>
        )}
        <div className="flex-1" />
        {onCompact && (
          <button
            onClick={onCompact}
            disabled={compacting || thinking}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-lg cursor-pointer',
              'transition-colors duration-150',
              'text-text-tertiary hover:text-brand-secondary hover:bg-[rgba(212,165,116,0.08)]',
              (compacting || thinking) && 'opacity-40 cursor-default',
            )}
            aria-label="压缩群聊"
            title="压缩群聊会话"
          >
            <Archive size={12} strokeWidth={1.5} className={compacting ? 'animate-pulse' : ''} />
          </button>
        )}
        {onClear && (
          <button
            onClick={onClear}
            disabled={thinking}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-lg cursor-pointer',
              'transition-colors duration-150',
              'text-text-tertiary hover:text-status-error hover:bg-[rgba(248,113,113,0.08)]',
              thinking && 'opacity-40 cursor-default',
            )}
            aria-label="清空群聊"
            title="清空群聊会话"
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-3 styled-scrollbar">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-text-quaternary text-[13px]">
            群聊已就绪，发条消息开始对话吧
          </div>
        )}
        {messages.map((msg) => {
          const isUser = msg.speakerNpcId === 'user'
          const isSystem = msg.speakerNpcId === 'system'
          const participant = groupInfo?.participants.find(p => p.npcId === msg.speakerNpcId)
          const agent = agents.find(a => a.id === msg.speakerNpcId)
          const avatarUrl = agent?.avatarUrl
          const bgColor = isUser ? '#D4A574' : participant ? '#4488CC' : '#4488CC'

          if (isSystem) {
            return (
              <div key={msg.sequenceId} className="flex items-center justify-center py-2">
                <span className="text-[12px] text-text-quaternary/80 bg-bg-elevated/60 px-3 py-1 rounded-full">
                  {msg.text}
                </span>
              </div>
            )
          }

          return (
            <div key={msg.sequenceId} className={cn('group flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
              {/* Avatar */}
              {avatarUrl ? (
                <img src={apiUrl(avatarUrl)} alt={msg.speakerName} className="w-8 h-8 rounded-full object-cover shrink-0" />
              ) : (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0"
                  style={{ background: bgColor }}
                >
                  {msg.speakerName[0]}
                </div>
              )}

              {/* Content */}
              <div className={cn('flex flex-col gap-1 max-w-[75%] min-w-0', isUser ? 'items-end' : 'items-start')}>
                {!isUser && (
                  <div className="flex items-center gap-1.5 text-[11px] text-text-quaternary px-1 flex-wrap">
                    <span>{msg.speakerName}{participant?.specialty && <span className="text-text-quaternary/70">（{participant.specialty}）</span>}</span>
                    {msg.timestamp > 0 && <span className="text-text-quaternary/60 tabular-nums">{formatClockTime(msg.timestamp)}</span>}
                    {msg.usage && (
                      <span className="text-text-quaternary/50 tabular-nums" title={`输入 ${msg.usage.input} / 输出 ${msg.usage.output} tokens`}>
                        ↑{formatTokens(msg.usage.input)} ↓{formatTokens(msg.usage.output)}
                        {(() => {
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
                      </span>
                    )}
                    {msg.usage && typeof msg.contextBudget === 'number' && msg.contextBudget > 0 && (
                      <span className="text-text-quaternary/50 tabular-nums" title={`上下文 ${formatTokens(msg.usage.input)}/${formatTokens(msg.contextBudget)}`}>
                        ctx {Math.round((msg.usage.input / msg.contextBudget) * 100)}%
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed break-words',
                    isUser
                      ? 'bg-[rgba(212,165,116,0.12)] text-text-primary border border-brand-primary/20'
                      : 'bg-bg-elevated text-text-primary',
                  )}
                >
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                  ) : (
                    <div className="markdown-body break-words">
                      <MarkdownContent
                        text={msg.text}
                        mentionHighlight={msg.mentions?.length > 0 ? { mentions: msg.mentions, participants: groupInfo?.participants ?? [] } : undefined}
                      />
                    </div>
                  )}
                </div>
                {isUser && msg.timestamp > 0 && (
                  <div className="text-[10px] text-text-quaternary/60 px-1 text-right tabular-nums">{formatClockTime(msg.timestamp)}</div>
                )}
                {isUser ? (
                  <div className="flex justify-end">
                    <GroupMessageActions
                      text={msg.text}
                      onRetry={onRetry ? () => onRetry(msg.text, msg.mentions ?? []) : undefined}
                      retryDisabled={thinking}
                    />
                  </div>
                ) : (
                  <GroupMessageActions text={msg.text} model={msg.model} />
                )}
              </div>
            </div>
          )
        })}
        {/* Per-citizen typing indicators: show each composing citizen's avatar + animated dots */}
        {typingCitizens && typingCitizens.size > 0 && (() => {
          const typingList = Array.from(typingCitizens.entries())
          return typingList.map(([npcId, speakerName]) => {
            const agent = agents.find(a => a.id === npcId)
            const avatarUrl = agent?.avatarUrl
            const participant = groupInfo?.participants.find(p => p.npcId === npcId)
            return (
              <div key={`typing-${npcId}`} className="flex gap-2.5">
                {avatarUrl ? (
                  <img src={apiUrl(avatarUrl)} alt={speakerName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0"
                    style={{ background: '#4488CC' }}
                  >
                    {speakerName[0]}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-text-quaternary px-1 flex-wrap">
                    <span>{speakerName}{participant?.specialty && <span className="text-text-quaternary/70">（{participant.specialty}）</span>}</span>
                  </div>
                  <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-bg-elevated border border-border-subtle">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        })()}
        {/* Fallback generic thinking indicator (when no per-citizen typing info available) */}
        {thinking && (!typingCitizens || typingCitizens.size === 0) && (
          <div className="flex gap-2.5">
            <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-[11px] text-text-quaternary shrink-0">
              ...
            </div>
            <div className="rounded-2xl px-4 py-3 bg-bg-elevated text-text-tertiary text-[13px]">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Mention Picker ── */}
      {showMentionPicker && (
        <div
          ref={mentionPickerRef}
          className="absolute bottom-16 left-4 right-4 md:left-64 md:right-4 max-w-sm bg-bg-surface border border-border-subtle rounded-2xl shadow-2xl shadow-black/60 z-50 max-h-64 overflow-hidden flex flex-col"
        >
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-quaternary border-b border-border-subtle shrink-0">
            @提及
          </div>
          <div ref={mentionPickerListRef} className="overflow-y-auto styled-scrollbar">
          {filteredMentions.map((item, idx) => {
            const isAll = item === 'all'
            const citizen = item === 'all' ? null : item
            const isActive = idx === mentionIndex
            return (
              <button
                key={isAll ? 'all' : citizen!.npcId}
                ref={(el) => { mentionItemRefs.current[idx] = el }}
                onClick={() => insertMention(item)}
                onMouseEnter={() => setMentionIndex(idx)}
                className={cn(
                  'flex items-center gap-3 w-full px-3 py-2.5 cursor-pointer transition-colors duration-150 text-left',
                  isActive ? 'bg-[rgba(212,165,116,0.10)]' : 'hover:bg-bg-elevated',
                )}
              >
                {isAll ? (
                  <div className="w-8 h-8 rounded-full bg-[rgba(212,165,116,0.15)] flex items-center justify-center shrink-0">
                    <AtSign size={15} className="text-brand-secondary" />
                  </div>
                ) : citizen!.avatarUrl ? (
                  <img src={apiUrl(citizen!.avatarUrl)} alt={citizen!.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-[13px] font-bold text-text-secondary shrink-0">
                    {citizen!.name[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className={cn('text-[14px] font-medium', isActive ? 'text-brand-secondary' : 'text-text-primary')}>
                    {isAll ? '所有人' : citizen!.name}
                  </div>
                  {!isAll && citizen!.specialty && (
                    <div className="text-[11px] text-text-quaternary truncate">{citizen!.specialty}</div>
                  )}
                </div>
              </button>
            )
          })}
          {filteredMentions.length === 0 && (
            <div className="px-3 py-4 text-[13px] text-text-quaternary text-center">无匹配居民</div>
          )}
          </div>
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-4 pb-4 pt-1 w-full max-w-3xl mx-auto shrink-0">
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-elevated border border-border-subtle text-[12px] text-text-secondary"
              >
                {att.preview ? (
                  <img src={att.preview} className="w-8 h-8 rounded object-cover" alt="" />
                ) : att.file.type.startsWith('image/') ? (
                  <ImageIcon size={14} strokeWidth={1.5} />
                ) : att.file.type.startsWith('video/') ? (
                  <Film size={14} strokeWidth={1.5} />
                ) : att.file.type.startsWith('audio/') ? (
                  <Music size={14} strokeWidth={1.5} />
                ) : (
                  <FileText size={14} strokeWidth={1.5} />
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
          'flex gap-2 rounded-full px-3 items-center py-1.5',
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
            className="flex items-center justify-center w-9 h-9 rounded-full text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.1)] cursor-pointer transition-colors duration-150 shrink-0"
            aria-label="附件"
          >
            <Paperclip size={17} strokeWidth={1.5} />
          </button>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="群聊消息，输入@提及某人..."
            rows={1}
            className="flex-1 bg-transparent text-[16px] md:text-[14px] text-text-primary placeholder:text-text-quaternary resize-none outline-none leading-9 overflow-hidden styled-scrollbar"
            style={{ maxHeight: 200 }}
          />
          <button
            className="flex items-center justify-center w-9 h-9 rounded-full text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.1)] cursor-pointer transition-colors duration-150 shrink-0"
            aria-label="语音"
          >
            <Mic size={17} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleSend}
            disabled={!inputText.trim() && attachments.length === 0}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-full cursor-pointer shrink-0',
              'transition-all duration-150',
              (inputText.trim() || attachments.length > 0)
                ? 'bg-gradient-to-br from-[#C4915E] to-[#D4A574] text-white shadow-[0_4px_12px_rgba(212,165,116,0.3)] hover:shadow-[0_4px_16px_rgba(212,165,116,0.4)] hover:brightness-110 active:scale-92'
                : 'bg-[rgba(255,255,255,0.06)] text-text-quaternary cursor-default',
            )}
            aria-label="发送"
          >
            <SendHorizonal size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
