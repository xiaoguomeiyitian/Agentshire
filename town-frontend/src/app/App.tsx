import { useState, useCallback, useEffect, useRef } from 'react'
import { TopNav, type AppTab } from './TopNav'
import { TownView } from './TownView'
import { ChatView } from './ChatView'
import type { AgentInfo } from '@/hooks/useAgents'
import type { TownBubbleMessage, TownStatusInfo } from './TownDynamicPanel'

const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'
const TOWN_DYNAMIC_COLLAPSED_KEY = 'agentshire_town_dynamic_collapsed'
const MAX_BUBBLE_MESSAGES = 200

function getTabFromHash(): AppTab {
  return window.location.hash === '#chat' ? 'chat' : 'town'
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(getTabFromHash)
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null)
  const [chatConnected, setChatConnected] = useState(false)
  const [bubbleMessages, setBubbleMessages] = useState<TownBubbleMessage[]>([])
  const [townStatus, setTownStatus] = useState<TownStatusInfo | null>(null)
  const [dynamicCollapsed, setDynamicCollapsed] = useState(() => {
    try { return localStorage.getItem(TOWN_DYNAMIC_COLLAPSED_KEY) !== 'false' } catch { return true }
  })
  const dedupeRef = useRef<Map<string, number>>(new Map())

  const handleTabChange = useCallback((tab: AppTab) => {
    setActiveTab(tab)
    window.location.hash = tab === 'chat' ? '#chat' : ''
  }, [])

  useEffect(() => {
    const onHash = () => setActiveTab(getTabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // ── Listen for postMessage from Town iframe (bubble content + town status) ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data.type !== 'string') return

      if (data.type === 'town_bubble') {
        const { npcId, npcName, text, timestamp, townHour, townMinute, townPeriod, townWeather } = data as { npcId: string; npcName: string; text: string; timestamp: number; townHour?: number; townMinute?: number; townPeriod?: string; townWeather?: string }
        if (!npcId || !text) return

        // Deduplicate: same npcId + same text prefix within 5s window
        const dedupeKey = `${npcId}:${text.slice(0, 50)}`
        const now = timestamp || Date.now()
        const lastTime = dedupeRef.current.get(dedupeKey)
        if (lastTime !== undefined && now - lastTime < 5000) return
        dedupeRef.current.set(dedupeKey, now)

        // Clean old dedupe entries
        if (dedupeRef.current.size > 500) {
          for (const [k, t] of dedupeRef.current) {
            if (now - t > 30000) dedupeRef.current.delete(k)
          }
        }

        const msgId = `${dedupeKey}:${now}`
        setBubbleMessages(prev => {
          const next = [...prev, { id: msgId, npcId, npcName, text, timestamp: now, townHour, townMinute, townPeriod, townWeather }]
          return next.slice(-MAX_BUBBLE_MESSAGES)
        })
      } else if (data.type === 'town_status') {
        const s = data as Partial<TownStatusInfo>
        if (typeof s.hour === 'number' && typeof s.weather === 'string') {
          setTownStatus({
            hour: s.hour,
            minute: s.minute ?? 0,
            period: s.period ?? '',
            dayCount: s.dayCount ?? 0,
            weather: s.weather,
            residentCount: s.residentCount ?? 0,
            timestamp: s.timestamp ?? Date.now(),
          })
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleToggleDynamic = useCallback(() => {
    setDynamicCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(TOWN_DYNAMIC_COLLAPSED_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const handleChatBack = useCallback(() => {
    setChatAgent(null)
    try {
      localStorage.removeItem(CHAT_AGENT_STORAGE_KEY)
      localStorage.removeItem('agentshire_chat_view_mode')
    } catch {
      // ignore storage failures
    }
  }, [])

  return (
    <div className="flex flex-col w-full h-dvh bg-bg-base text-text-primary overflow-hidden">
      <TopNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        chatAgent={chatAgent}
        chatConnected={activeTab === 'chat' ? chatConnected : undefined}
        onChatBack={handleChatBack}
      />

      <div className="relative flex-1 overflow-hidden">
        <TownView visible={activeTab === 'town'} />
        <ChatView
          visible={activeTab === 'chat'}
          selectedAgent={chatAgent}
          onAgentChange={setChatAgent}
          onConnectedChange={setChatConnected}
          bubbleMessages={bubbleMessages}
          townStatus={townStatus}
          dynamicCollapsed={dynamicCollapsed}
          onToggleDynamicCollapse={handleToggleDynamic}
        />
      </div>
    </div>
  )
}
