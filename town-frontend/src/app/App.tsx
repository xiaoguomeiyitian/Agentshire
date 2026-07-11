import { useState, useCallback, useEffect } from 'react'
import { TopNav, type AppTab } from './TopNav'
import { TownView } from './TownView'
import { ChatView } from './ChatView'
import type { AgentInfo } from '@/hooks/useAgents'

const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'

function getTabFromHash(): AppTab {
  return window.location.hash === '#chat' ? 'chat' : 'town'
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(getTabFromHash)
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null)
  const [chatConnected, setChatConnected] = useState(false)

  const handleTabChange = useCallback((tab: AppTab) => {
    setActiveTab(tab)
    window.location.hash = tab === 'chat' ? '#chat' : ''
  }, [])

  useEffect(() => {
    const onHash = () => setActiveTab(getTabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
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
        />
      </div>
    </div>
  )
}
