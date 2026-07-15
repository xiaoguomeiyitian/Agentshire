import { useState, useCallback, useEffect } from 'react'
import { TopNav, type AppTab } from './TopNav'
import { TownView } from './TownView'
import { ChatView } from './ChatView'
import { ClawSettingsView } from './ClawSettingsView'
import type { AgentInfo } from '@/hooks/useAgents'

const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'

function getTabFromHash(): AppTab {
  if (window.location.hash === '#town') return 'town'
  if (window.location.hash === '#claw') return 'claw'
  return 'chat'
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(getTabFromHash)
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null)
  const [chatConnected, setChatConnected] = useState(false)
  const [groupChatActive, setGroupChatActive] = useState(false)
  // Bumped on mobile back press; ChatView watches it to reset groupChatActive
  // (selectedAgent is already null in group chat, so the selectedAgent effect can't detect back press)
  const [chatExitNonce, setChatExitNonce] = useState(0)

  const handleTabChange = useCallback((tab: AppTab) => {
    setActiveTab(tab)
    window.location.hash = tab === 'chat' ? '#chat' : tab === 'claw' ? '#claw' : '#town'
  }, [])

  useEffect(() => {
    const onHash = () => setActiveTab(getTabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const handleChatBack = useCallback(() => {
    setChatAgent(null)
    setGroupChatActive(false)
    // Bump nonce so ChatView resets its groupChatActive (selectedAgent is null in group chat)
    setChatExitNonce((n) => n + 1)
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
        groupChatActive={groupChatActive}
      />

      <div className="relative flex-1 overflow-hidden">
        <TownView visible={activeTab === 'town'} />
        <ClawSettingsView visible={activeTab === 'claw'} />
        <ChatView
          visible={activeTab === 'chat'}
          selectedAgent={chatAgent}
          onAgentChange={setChatAgent}
          onConnectedChange={setChatConnected}
          onGroupChatActiveChange={setGroupChatActive}
          exitNonce={chatExitNonce}
        />
      </div>
    </div>
  )
}
