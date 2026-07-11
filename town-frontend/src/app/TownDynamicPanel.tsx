import { useRef, useEffect, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown, Clock, CloudSun, Users, MessageCircle } from 'lucide-react'
import type { AgentInfo } from '@/hooks/useAgents'
import { stripTags } from '../ui/ui-utils'
import { t } from '@/i18n'

export interface TownBubbleMessage {
  id: string
  npcId: string
  npcName: string
  text: string
  timestamp: number
  townHour?: number
  townMinute?: number
  townPeriod?: string
  townWeather?: string
}

export interface TownStatusInfo {
  hour: number
  minute: number
  period: string
  dayCount: number
  weather: string
  residentCount: number
  timestamp: number
}

interface TownDynamicPanelProps {
  messages: TownBubbleMessage[]
  status: TownStatusInfo | null
  agents: AgentInfo[]
  collapsed: boolean
  onToggleCollapse: () => void
}

export function formatTime(hour: number, minute: number): string {
  const h = String(hour).padStart(2, '0')
  const m = String(minute).padStart(2, '0')
  return `${h}:${m}`
}

export function getWeatherIcon(weather: string): string {
  // Map weather type to emoji for compact display
  const map: Record<string, string> = {
    clear: '☀️',
    cloudy: '☁️',
    drizzle: '🌦️',
    rain: '🌧️',
    heavyRain: '⛈️',
    storm: '⛈️',
    lightSnow: '🌨️',
    snow: '❄️',
    blizzard: '🌨️',
    fog: '🌫️',
    sandstorm: '🌪️',
    aurora: '🌌',
  }
  return map[weather] ?? '☀️'
}

export function TownDynamicPanel({ messages, status, agents, collapsed, onToggleCollapse }: TownDynamicPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Build npcId → agent lookup for avatar
  const agentMap = useMemo(() => {
    const m = new Map<string, AgentInfo>()
    for (const a of agents) m.set(a.id, a)
    return m
  }, [agents])

  // Auto-scroll to bottom when new messages arrive (if autoScroll enabled)
  useEffect(() => {
    if (!collapsed && autoScroll && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [messages, collapsed, autoScroll])

  // Detect manual scroll to pause auto-scroll
  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
    setAutoScroll(distanceFromBottom < 40)
  }

  const latestMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const periodLabel = status ? t(`period.${status.period}`) : ''
  const weatherLabel = status ? t(`weather.${status.weather}`) : ''
  const weatherIcon = status ? getWeatherIcon(status.weather) : ''

  return (
    <div className={cn(
      'bg-bg-canvas select-none',
      collapsed ? 'border-b border-border-subtle shrink-0' : 'flex-1 flex flex-col min-h-0',
    )}>
      {/* ── Header bar (always visible) ── */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 w-full px-4 py-2 cursor-pointer hover:bg-bg-elevated/40 transition-colors duration-150 shrink-0"
      >
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[rgba(212,165,116,0.12)] shrink-0">
          <MessageCircle size={12} strokeWidth={1.8} className="text-brand-secondary" />
        </div>
        <span className="text-[13px] font-semibold text-brand-secondary" style={{ fontFamily: "'Trap', sans-serif" }}>
          {t('town_dynamic.title')}
        </span>

        {/* ── Town status badges ── */}
        {status && (
          <div className="flex items-center gap-2 ml-1 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-1" title={t('town_dynamic.time')}>
              <Clock size={11} strokeWidth={1.6} className="text-text-quaternary" />
              <span className="text-text-secondary tabular-nums">{formatTime(status.hour, status.minute)}</span>
              <span className="text-text-quaternary">{periodLabel}</span>
            </span>
            <span className="flex items-center gap-1" title={t('town_dynamic.weather')}>
              <span>{weatherIcon}</span>
              <span className="text-text-secondary">{weatherLabel}</span>
            </span>
            <span className="flex items-center gap-1" title={t('town_dynamic.residents')}>
              <Users size={11} strokeWidth={1.6} className="text-text-quaternary" />
              <span className="text-text-secondary tabular-nums">{status.residentCount}</span>
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* ── Latest message preview (when collapsed) ── */}
        {collapsed && latestMsg && (
          <div className="hidden md:flex items-center gap-1.5 min-w-0 max-w-[40%]">
            {(() => {
              const latestAgent = agentMap.get(latestMsg.npcId)
              return (
                <span className="text-[11px] text-text-quaternary shrink-0">
                  {latestMsg.npcName}{latestAgent?.specialty && <span className="text-text-quaternary/70">（{latestAgent.specialty}）</span>}:
                </span>
              )
            })()}
            <span className="text-[11px] text-text-tertiary truncate">{stripTags(latestMsg.text)}</span>
          </div>
        )}

        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={cn('text-text-tertiary shrink-0 transition-transform duration-200', collapsed ? '' : 'rotate-180')}
        />
      </button>

      {/* ── Expanded message list (fills remaining height) ── */}
      {!collapsed && (
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto styled-scrollbar px-4 pb-3 space-y-2.5 min-h-0"
        >
          {messages.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-[12px] text-text-quaternary">
              {t('town_dynamic.empty')}
            </div>
          ) : (
            messages.map((msg) => {
              const agent = agentMap.get(msg.npcId)
              const avatarUrl = agent?.avatarUrl
              const bgColor = msg.npcId === 'user' ? '#D4A574' : '#4488CC'

              return (
                <div key={msg.id} className="flex gap-2.5">
                  {/* Avatar */}
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={msg.npcName} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0"
                      style={{ background: bgColor }}
                    >
                      {msg.npcName[0]}
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex flex-col gap-0.5 min-w-0 max-w-[80%]">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-quaternary px-0.5">
                      <span>{msg.npcName}{agent?.specialty && <span className="text-text-quaternary/70">（{agent.specialty}）</span>}</span>
                      {msg.townHour !== undefined && msg.townMinute !== undefined && (
                        <span className="flex items-center gap-0.5 text-text-quaternary/60">
                          <Clock size={9} strokeWidth={1.4} />
                          <span className="tabular-nums">{formatTime(msg.townHour, msg.townMinute)}</span>
                          {msg.townPeriod && (
                            <span className="text-text-quaternary/70">{t(`period.${msg.townPeriod}`)}</span>
                          )}
                        </span>
                      )}
                      {msg.townWeather && (
                        <span className="flex items-center gap-0.5 text-text-quaternary/60">
                          <span>{getWeatherIcon(msg.townWeather)}</span>
                          <span>{t(`weather.${msg.townWeather}`)}</span>
                        </span>
                      )}
                    </div>
                    <div
                      className="rounded-2xl rounded-tl-md px-3 py-2 text-[13px] leading-relaxed break-words bg-bg-elevated text-text-secondary border border-border-subtle"
                    >
                      <span className="whitespace-pre-wrap break-words">{stripTags(msg.text)}</span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  )
}
