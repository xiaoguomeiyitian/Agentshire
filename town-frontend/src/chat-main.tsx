import { initLocale } from './i18n'
initLocale()

import './app/app.css'
import { createRoot } from 'react-dom/client'
import { useState, useCallback } from 'react'
import { ChatView } from './app/ChatView'
import type { AgentInfo } from './hooks/useAgents'

const CHAT_AGENT_STORAGE_KEY = 'agentshire_chat_agent'

function ChatApp() {
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null)
  const [chatConnected, setChatConnected] = useState(false)
  const [groupChatActive, setGroupChatActive] = useState(false)
  const [chatExitNonce, setChatExitNonce] = useState(0)

  const handleChatBack = useCallback(() => {
    setChatAgent(null)
    setGroupChatActive(false)
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
      <div className="relative flex-1 overflow-hidden">
        <ChatView
          visible={true}
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

const appRoot = document.getElementById('app-root')
if (!appRoot) throw new Error('#app-root not found')

createRoot(appRoot).render(<ChatApp />)
