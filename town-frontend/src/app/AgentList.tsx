import { cn } from '@/lib/utils'
import { Bot, Users } from 'lucide-react'
import type { AgentInfo } from '@/hooks/useAgents'

interface AgentListProps {
  agents: AgentInfo[]
  selectedId: string | null
  onSelect: (agent: AgentInfo) => void
  className?: string
  groupChatActive?: boolean
  onGroupChatClick?: () => void
}

function AgentAvatar({ agent, size = 36, isSelected = false }: { agent: AgentInfo; size?: number; isSelected?: boolean }) {
  const dot = agent.online != null ? (
    <span
      className={cn(
        'absolute bottom-0 right-0 block rounded-full border-2',
        isSelected ? 'border-[#1f1e1d]' : 'border-bg-canvas',
        agent.online ? 'bg-status-success' : 'bg-text-tertiary',
      )}
      style={{ width: size * 0.28, height: size * 0.28 }}
    />
  ) : null

  if (agent.avatarUrl) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <img
          src={agent.avatarUrl}
          alt={agent.name}
          className={cn(
            'rounded-full object-cover w-full h-full',
            isSelected && 'ring-1 ring-brand-primary/30',
          )}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        {dot}
      </div>
    )
  }
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center w-full h-full',
          isSelected
            ? 'bg-[rgba(212,165,116,0.15)] ring-1 ring-brand-primary/30'
            : 'bg-bg-elevated',
        )}
      >
        <Bot size={size * 0.45} strokeWidth={1.5} className={cn(isSelected ? 'text-brand-primary' : 'text-text-quaternary')} />
      </div>
      {dot}
    </div>
  )
}

export function AgentList({ agents, selectedId, onSelect, className, groupChatActive, onGroupChatClick }: AgentListProps) {
  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-quaternary">
        Agents
      </div>
      {/* ── Group chat entry ── */}
      {onGroupChatClick && (
        <button
          onClick={onGroupChatClick}
          className={cn(
            'flex items-center gap-3 w-full px-4 py-3.5 cursor-pointer',
            'transition-colors duration-150 text-left',
            groupChatActive
              ? 'bg-[rgba(212,165,116,0.08)] text-text-primary'
              : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary',
          )}
        >
          <div className={cn(
            'relative shrink-0 rounded-full flex items-center justify-center w-10 h-10',
            groupChatActive ? 'bg-[rgba(212,165,116,0.15)] ring-1 ring-brand-primary/30' : 'bg-bg-elevated',
          )}>
            <Users size={18} strokeWidth={1.5} className={cn(groupChatActive ? 'text-brand-primary' : 'text-text-quaternary')} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={cn(
              'text-[16px] md:text-[13px] font-medium truncate',
              groupChatActive ? 'text-brand-secondary' : '',
            )}>小镇广场</div>
            <div className="text-[13px] md:text-[11px] text-text-tertiary truncate mt-0.5">群聊 · 全体居民</div>
          </div>
        </button>
      )}
      <div className="flex-1 overflow-y-auto styled-scrollbar">
        {agents.map((agent) => {
          const isSelected = selectedId === agent.id
          return (
            <button
              key={agent.id}
              onClick={() => onSelect(agent)}
              className={cn(
                'flex items-center gap-3 w-full px-4 py-3.5 cursor-pointer',
                'transition-colors duration-150 text-left',
                isSelected
                  ? 'bg-[rgba(212,165,116,0.08)] text-text-primary'
                  : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary',
              )}
            >
              <AgentAvatar agent={agent} isSelected={isSelected} size={40} />
              <div className="flex-1 min-w-0">
                <div className={cn(
                  'text-[16px] md:text-[13px] font-medium truncate',
                  isSelected ? 'text-brand-secondary' : '',
                )}>{agent.name}</div>
                {agent.specialty && (
                  <div className="text-[13px] md:text-[11px] text-text-tertiary truncate mt-0.5">{agent.specialty}</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { AgentAvatar }
