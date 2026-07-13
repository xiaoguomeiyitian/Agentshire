import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, FileCode2, FileText, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/utils/api-base'

interface RichAttachmentCardProps {
  fileUrl: string
  fileName?: string
  mimeType?: string
  displayTitle?: string
  className?: string
}

type AttachmentMode = 'markdown' | 'code' | 'app' | 'unsupported'

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'py', 'css', 'scss', 'html', 'xml', 'yaml', 'yml', 'sh', 'java', 'go', 'rs',
])

function fileExt(fileName?: string, fileUrl?: string): string {
  const source = fileName || fileUrl || ''
  const clean = source.split('?')[0]
  return clean.split('.').pop()?.toLowerCase() ?? ''
}

function modeFor(fileName?: string, fileUrl?: string, mimeType?: string): AttachmentMode {
  const ext = fileExt(fileName, fileUrl)
  if (ext === 'md' || mimeType === 'text/markdown') return 'markdown'
  if (ext === 'html' || mimeType === 'text/html') return 'app'
  if (CODE_EXTS.has(ext)) return 'code'
  return 'unsupported'
}

function buildOpenUrl(fileUrl: string, fileName?: string, mimeType?: string): string {
  const ext = fileExt(fileName, fileUrl)
  if (ext === 'md' || mimeType === 'text/markdown') {
    return apiUrl(`/viewer.html?file=${encodeURIComponent(fileUrl)}`)
  }
  return apiUrl(fileUrl)
}

function deriveProjectTitle(fileUrl: string, fileName?: string): string {
  const url = fileUrl || ''
  const projectMatch = url.match(/\/(?:projects|tasks)\/([^/]+)/)
  if (projectMatch) {
    const slug = projectMatch[1]
    const cleaned = slug
      .replace(/-[a-z0-9]{6,10}$/, '')
      .replace(/[-_]/g, ' ')
    if (cleaned.length > 2) {
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    }
  }
  const name = fileName || url.split('/').pop() || ''
  if (name === 'index.html') return '应用 / 游戏'
  return name
}

export function RichAttachmentCard({
  fileUrl, fileName, mimeType, displayTitle, className,
}: RichAttachmentCardProps) {
  const mode = useMemo(() => modeFor(fileName, fileUrl, mimeType), [fileName, fileUrl, mimeType])
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(mode === 'markdown' || mode === 'code')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (mode !== 'markdown' && mode !== 'code') return
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(apiUrl(fileUrl))
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.text()
      })
      .then((text) => {
        if (cancelled) return
        setContent(text)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [fileUrl, mode])

  const openUrl = buildOpenUrl(fileUrl, fileName, mimeType)

  if (mode === 'unsupported') return null

  /* ── App / Game card ── */
  if (mode === 'app') {
    const title = displayTitle || deriveProjectTitle(fileUrl, fileName)
    return (
      <div
        className={cn(
          'group rounded-xl overflow-hidden max-w-[340px]',
          'bg-bg-elevated border border-border-subtle',
          'hover:border-border-default transition-colors',
          className,
        )}
      >
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-primary/12 flex items-center justify-center shrink-0 mt-0.5">
              <Play size={14} strokeWidth={2.2} className="text-brand-primary ml-0.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-text-primary leading-snug truncate">
                {title}
              </div>
              <div className="text-[11px] text-text-quaternary mt-0.5">
                可在新窗口中体验
              </div>
            </div>
          </div>
        </div>
        <div className="px-4 pb-3.5">
          <button
            type="button"
            onClick={() => window.open(openUrl, '_blank', 'noopener')}
            className={cn(
              'w-full flex items-center justify-center gap-1.5',
              'rounded-lg px-4 py-2',
              'text-[13px] font-medium',
              'bg-brand-primary/12 text-brand-primary',
              'border border-brand-primary/15',
              'hover:bg-brand-primary/20 active:bg-brand-primary/25',
              'transition-colors cursor-pointer',
            )}
          >
            <ExternalLink size={13} strokeWidth={2} className="shrink-0" />
            立即体验
          </button>
        </div>
      </div>
    )
  }

  /* ── Markdown / Code card ── */
  const titleIcon = mode === 'markdown'
    ? <FileText size={15} strokeWidth={1.7} />
    : <FileCode2 size={15} strokeWidth={1.7} />

  const displayName = displayTitle || fileName || (mode === 'markdown' ? 'Markdown 文档' : '代码文件')

  return (
    <div
      className={cn(
        'rounded-xl border border-border-subtle bg-bg-elevated overflow-hidden max-w-[480px]',
        'hover:border-border-default transition-colors',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-text-tertiary shrink-0">{titleIcon}</div>
          <span className="text-[12px] font-medium text-text-secondary truncate">{displayName}</span>
        </div>
        <button
          type="button"
          onClick={() => window.open(openUrl, '_blank', 'noopener')}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
        >
          <ExternalLink size={12} strokeWidth={1.7} />
          新窗口
        </button>
      </div>

      <div className="max-h-[360px] overflow-y-auto overflow-x-hidden styled-scrollbar px-3.5 py-3">
        {loading ? (
          <div className="text-[12px] text-text-quaternary">加载中...</div>
        ) : error ? (
          <div className="text-[12px] text-status-error">内容加载失败：{error}</div>
        ) : mode === 'markdown' ? (
          <div className="markdown-body break-words text-[13px] leading-relaxed text-text-secondary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-cyan hover:underline">{children}</a>
                ),
                code: ({ className: codeClassName, children, ...props }) => {
                  const isBlock = codeClassName?.startsWith('language-')
                  if (isBlock) {
                    return (
                      <div className="my-2 rounded-lg bg-bg-base border border-border-subtle overflow-hidden">
                        <div className="flex items-center px-3 py-1.5 bg-bg-canvas border-b border-border-subtle">
                          <span className="text-[10px] text-text-quaternary">{codeClassName?.replace('language-', '') || 'code'}</span>
                        </div>
                        <pre className="p-3 overflow-x-auto styled-scrollbar">
                          <code className="text-[12px] leading-relaxed text-text-secondary">{children}</code>
                        </pre>
                      </div>
                    )
                  }
                  return <code className="px-1.5 py-0.5 rounded bg-bg-base text-[12px] text-brand-secondary" {...props}>{children}</code>
                },
                pre: ({ children }) => <>{children}</>,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-mono">
            <code>{content}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
