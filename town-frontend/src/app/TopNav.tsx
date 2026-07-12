import { useState, useRef, useEffect, useCallback } from 'react'
import { MoreHorizontal, Users, Palette, Star, Settings, X, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentInfo } from '@/hooks/useAgents'
import logoTitleUrl from '@/assets/logo-title.png'
import logoUrl from '@/assets/logo.png'
import { t } from '@/i18n'

export type AppTab = 'town' | 'chat' | 'claw'

interface TopNavProps {
  activeTab: AppTab
  onTabChange: (tab: AppTab) => void
  chatAgent?: AgentInfo | null
  chatConnected?: boolean
  onChatBack?: () => void
}

function getMenuItems() {
  return [
    { icon: Users, label: t('topnav.citizens'), action: 'citizen-editor' as const },
    { icon: Palette, label: t('topnav.town_editor'), action: 'town-editor' as const },
    { icon: Star, label: t('topnav.skill_store'), action: 'skill-store' as const },
    { icon: Settings, label: t('topnav.settings'), action: 'settings' as const },
  ]
}

export function TopNav({ activeTab, onTabChange, chatAgent, onChatBack }: TopNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleMenuAction = useCallback((action: string) => {
    setMenuOpen(false)
    if (action === 'citizen-editor') window.open('citizen-editor.html', '_blank')
    else if (action === 'town-editor') window.open('editor.html', '_blank')
    else if (action === 'skill-store') window.open('https://clawhub.ai/', '_blank', 'noopener,noreferrer')
    else if (action === 'settings') {
      import('@/ui/SettingsPanel').then(({ showSettingsPanel }) => {
        showSettingsPanel({
          onMusicChange: (enabled) => {
            document.dispatchEvent(new CustomEvent('agentshire:music', { detail: { enabled } }))
            // Forward to town iframe via postMessage (cross-document)
            const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Agentshire Town"]')
            iframe?.contentWindow?.postMessage({ type: 'agentshire:music', enabled }, '*')
          },
          onSoulModeChange: (enabled) => {
            document.dispatchEvent(new CustomEvent('agentshire:soulmode', { detail: { enabled } }))
            const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Agentshire Town"]')
            iframe?.contentWindow?.postMessage({ type: 'agentshire:soulmode', enabled }, '*')
          },
          onReset: () => {
            localStorage.removeItem('agentshire_config')
            location.reload()
          },
        })
      })
    }
  }, [])

  const inMobileChat = activeTab === 'chat' && chatAgent != null

  return (
    <nav className="relative z-40 flex items-center h-12 px-4 bg-bg-canvas border-b border-border-subtle shrink-0 select-none">

      {/* ── Left: Logo or Mobile back ── */}
      {inMobileChat ? (
        <button
          onClick={onChatBack}
          className="flex items-center justify-center w-8 h-8 -ml-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150 md:hidden shrink-0"
        >
          <ChevronLeft size={18} strokeWidth={1.8} />
        </button>
      ) : null}

      <div className={cn(
        'flex items-end shrink-0 self-end',
        inMobileChat ? 'hidden md:flex' : 'flex',
      )}>
        <img src={logoTitleUrl} alt="Agentshire" className="h-9 object-contain hidden md:block" />
        <img src={logoUrl} alt="Agentshire" className="h-8 w-8 object-contain md:hidden" />
      </div>

      {/* ── Center: Tabs (absolute centered) or Mobile agent name ── */}
      {inMobileChat ? (
        <div className="absolute inset-x-0 top-0 h-12 flex items-center justify-center gap-2 pointer-events-none md:hidden">
          <span className="text-[16px] md:text-[14px] font-medium text-text-primary">{chatAgent!.name}</span>
          <span className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            chatAgent!.online ? 'bg-status-success' : 'bg-text-quaternary',
          )} />
        </div>
      ) : null}

      <div className={cn(
        'absolute left-1/2 -translate-x-1/2 items-center gap-1',
        inMobileChat ? 'hidden md:flex' : 'flex',
      )}>
        {(['town', 'chat', 'claw'] as const).map((tab) => {
          const label = tab === 'town' ? 'Town' : tab === 'chat' ? 'Chat' : 'Claw'
          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                'flex h-8 items-center justify-center rounded-full px-6 text-[14px] md:text-[13px] cursor-pointer',
                'transition-colors duration-150',
                activeTab === tab
                  ? 'bg-[rgba(212,165,116,0.10)] text-brand-secondary'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
              style={{ fontFamily: "'Trap', sans-serif", fontWeight: 700 }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Right spacer ── */}
      <div className="flex-1" />

      {/* ── Right: Menu ── */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer',
            'transition-colors duration-150',
            menuOpen ? 'bg-bg-elevated text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/40',
          )}
          aria-label="菜单"
        >
          {menuOpen ? <X size={15} strokeWidth={1.8} /> : <MoreHorizontal size={15} strokeWidth={1.8} />}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-48 py-2 rounded-2xl bg-bg-surface border border-border-subtle shadow-2xl shadow-black/60 z-50">
            {getMenuItems().map(({ icon: Icon, label, action }) => (
              <button
                key={action}
                onClick={() => handleMenuAction(action)}
                className="flex items-center gap-3 w-full px-4 py-3 text-[14px] md:text-[13px] text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150"
              >
                <Icon size={16} strokeWidth={1.5} className="shrink-0 text-text-tertiary" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
