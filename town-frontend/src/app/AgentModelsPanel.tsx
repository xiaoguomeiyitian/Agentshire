// Agent Models panel — manage each resident (Agent) and its LLM model proxy.
// Supports editing: model (primary + fallbacks), identity (name, emoji),
// thinkingDefault, reasoningDefault, contextTokens, subagents (runTimeoutSeconds),
// groupChat (historyLimit). All fields map to openclaw.json agents.list[] entries.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Cpu, ChevronDown, ChevronRight, User, Brain, MessageSquare, Zap, Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/utils/api-base'
import { t } from '@/i18n'
import { useAgents, type AgentInfo } from '@/hooks/useAgents'

interface ModelOption {
  value: string
  label: string
  contextWindow?: number
}

// Agent config as stored in openclaw.json agents.list[]
interface AgentConfig {
  id: string
  name?: string
  model?: string | { primary?: string; fallbacks?: string[] }
  identity?: { name?: string; emoji?: string; theme?: string; avatar?: string }
  thinkingDefault?: string
  reasoningDefault?: string
  contextTokens?: number
  subagents?: { runTimeoutSeconds?: number; delegationMode?: string; model?: string | { primary?: string; fallbacks?: string[] } }
  groupChat?: { historyLimit?: number }
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max']
const REASONING_LEVELS = ['on', 'off', 'stream']
const DELEGATION_MODES = ['off', 'suggest', 'auto']

export function AgentModelsPanel() {
  const { agents, loading: agentsLoading } = useAgents()
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [loaded, setLoaded] = useState(false)
  // Per-agent config loaded from openclaw.json
  const [agentConfigs, setAgentConfigs] = useState<Record<string, AgentConfig>>({})
  // Expanded agent cards
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Per-agent override map for model (optimistic updates, backward compat)
  const [override, setOverride] = useState<Map<string, string | undefined>>(new Map())
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Toast
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  // Fetch model options
  useEffect(() => {
    let cancelled = false
    async function loadModels() {
      try {
        const resp = await fetch(apiUrl('/citizen-workshop/_api/models'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const data = await resp.json()
        if (cancelled || !data.options) return
        setModelOptions(data.options)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    loadModels()
    return () => { cancelled = true }
  }, [])

  // Fetch agent configs from openclaw.json
  const loadAgentConfigs = useCallback(async () => {
    try {
      const resp = await fetch(apiUrl('/claw/_api/config/load'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await resp.json()
      if (data.success && data.config?.agents?.list) {
        const map: Record<string, AgentConfig> = {}
        for (const a of data.config.agents.list) {
          map[a.id] = a
        }
        setAgentConfigs(map)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { loadAgentConfigs() }, [loadAgentConfigs])

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const getAgentId = useCallback((agent: AgentInfo): string => {
    return agent.type === 'steward' ? 'town-steward' : (agent.agentId ?? agent.id)
  }, [])

  const getModelRef = useCallback((agent: AgentInfo): string | undefined => {
    const id = getAgentId(agent)
    if (override.has(id)) return override.get(id)
    const cfg = agentConfigs[id]
    if (cfg?.model) {
      return typeof cfg.model === 'string' ? cfg.model : cfg.model.primary
    }
    return agent.modelRef
  }, [override, getAgentId, agentConfigs])

  const getFallbacks = useCallback((agent: AgentInfo): string[] => {
    const id = getAgentId(agent)
    const cfg = agentConfigs[id]
    if (cfg?.model && typeof cfg.model === 'object') return cfg.model.fallbacks ?? []
    return []
  }, [getAgentId, agentConfigs])

  // Update agent config via backend API
  const updateConfig = useCallback(async (agent: AgentInfo, patch: Record<string, any>) => {
    const agentId = getAgentId(agent)
    setUpdatingId(agentId)
    try {
      const resp = await fetch(apiUrl('/citizen-workshop/_api/update-agent-config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, patch }),
      })
      const data = await resp.json()
      if (data.success) {
        // Update local config
        setAgentConfigs(prev => {
          const next = { ...prev }
          const existing = next[agentId] ?? { id: agentId }
          // Deep merge for objects
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
              delete (existing as any)[key]
            } else if (value && typeof value === 'object' && !Array.isArray(value) && (existing as any)[key] && typeof (existing as any)[key] === 'object') {
              (existing as any)[key] = { ...(existing as any)[key], ...value }
            } else {
              (existing as any)[key] = value
            }
          }
          next[agentId] = existing
          return next
        })
        showToast(t('claw.am_model_updated'))
      } else {
        showToast(t('claw.am_model_update_failed'), true)
      }
    } catch {
      showToast(t('claw.am_model_update_failed'), true)
    } finally {
      setUpdatingId(null)
    }
  }, [getAgentId, showToast])

  // Update model (backward compat with optimistic override)
  const handleUpdateModel = useCallback(async (agent: AgentInfo, modelRef: string | undefined) => {
    const agentId = getAgentId(agent)
    setOpenMenu(null)
    setOverride(prev => {
      const next = new Map(prev)
      if (modelRef === undefined) next.delete(agentId)
      else next.set(agentId, modelRef)
      return next
    })
    await updateConfig(agent, { model: modelRef ?? null })
  }, [getAgentId, updateConfig])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-5 md:py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-brand-secondary"><Cpu size={16} /></span>
        <h3 className="text-[15px] font-semibold text-text-primary">{t('claw.am_title')}</h3>
      </div>
      <p className="text-[12px] text-text-tertiary mb-4 leading-relaxed">{t('claw.am_desc')}</p>

      {/* Agent list */}
      {agentsLoading ? (
        <div className="py-12 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
      ) : agents.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-text-tertiary">{t('claw.am_no_agents')}</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {agents.map((agent) => {
            const agentId = getAgentId(agent)
            const cfg = agentConfigs[agentId]
            const isOpen = expanded.has(agentId)
            const effectiveRef = getModelRef(agent)
            const fallbacks = getFallbacks(agent)
            const isUpdating = updatingId === agentId
            const isMenuOpen = openMenu === agentId
            const modelLabel = effectiveRef
              ? (effectiveRef.split('/').slice(1).join('/') || effectiveRef)
              : t('claw.am_default_model')
            return (
              <div key={agent.id} className="rounded-2xl bg-bg-surface border border-border-subtle overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  {agent.avatarUrl ? (
                    <img src={agent.avatarUrl} alt={agent.name} className="w-9 h-9 rounded-full object-cover shrink-0 border border-border-subtle" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-bg-elevated flex items-center justify-center shrink-0 text-[14px] font-bold text-brand-secondary">
                      {agent.name.charAt(0)}
                    </div>
                  )}

                  {/* Name + specialty */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px] font-semibold text-text-primary truncate">{agent.name}</span>
                      {agent.type === 'steward' && (
                        <span className="text-[10px] text-brand-secondary border border-[rgba(212,165,116,0.3)] px-1 py-0.5 rounded-md shrink-0">
                          {t('claw.am_steward')}
                        </span>
                      )}
                    </div>
                    {agent.specialty && <div className="text-[11px] text-text-tertiary truncate mt-0.5">{agent.specialty}</div>}
                  </div>

                  {/* Model selector */}
                  {modelOptions.length > 0 ? (
                    <div className="relative shrink-0" ref={isMenuOpen ? menuRef : undefined}>
                      <button
                        onClick={() => setOpenMenu(isMenuOpen ? null : agentId)}
                        disabled={isUpdating}
                        className={cn(
                          'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap',
                          'transition-colors duration-150 cursor-pointer border border-border-subtle',
                          isMenuOpen ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/40',
                          isUpdating && 'opacity-50 cursor-default',
                        )}
                        title={effectiveRef ?? t('claw.am_default_model')}
                      >
                        <Cpu size={12} strokeWidth={1.8} className="shrink-0 text-brand-secondary" />
                        <span className="max-w-[100px] md:max-w-[180px] truncate">{modelLabel}</span>
                        <ChevronDown size={11} strokeWidth={1.8} className="shrink-0" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1.5 min-w-[200px] max-h-[240px] overflow-y-auto styled-scrollbar py-2 rounded-2xl bg-bg-surface border border-border-subtle shadow-2xl shadow-black/60 z-50">
                          <button
                            onClick={() => handleUpdateModel(agent, undefined)}
                            className={cn(
                              'flex items-center w-full px-4 py-2 text-[12px] cursor-pointer transition-colors duration-150',
                              !effectiveRef ? 'text-brand-primary font-medium bg-bg-elevated/40' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                            )}
                          >
                            {t('claw.am_default_model')}
                          </button>
                          {modelOptions.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => handleUpdateModel(agent, opt.value)}
                              className={cn(
                                'flex items-center w-full px-4 py-2 text-[12px] cursor-pointer transition-colors duration-150',
                                effectiveRef === opt.value ? 'text-brand-primary font-medium bg-bg-elevated/40' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated',
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-text-tertiary shrink-0">
                      {loaded ? t('claw.am_no_models') : t('claw.loading')}
                    </span>
                  )}

                  {/* Expand button */}
                  <button
                    onClick={() => toggleExpand(agentId)}
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-elevated/40 cursor-pointer transition-colors"
                    title={t('claw.am_advanced')}
                  >
                    {isOpen ? <ChevronDown size={14} strokeWidth={1.8} /> : <ChevronRight size={14} strokeWidth={1.8} />}
                  </button>
                </div>

                {/* Expanded config */}
                {isOpen && cfg && (
                  <AgentConfigEditor
                    agent={agent}
                    config={cfg}
                    modelOptions={modelOptions}
                    fallbacks={fallbacks}
                    updating={isUpdating}
                    onUpdate={updateConfig}
                  />
                )}
                {isOpen && !cfg && (
                  <div className="border-t border-border-subtle px-4 py-3 text-[12px] text-text-tertiary">
                    {t('claw.loading')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-7 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-[13px] z-[1200] border shadow-lg transition-all',
            toast.error ? 'border-red-500/50 text-red-400 bg-bg-surface' : 'border-[rgba(212,165,116,0.45)] text-text-primary bg-bg-surface',
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ── Agent config editor (expanded section) ──

function AgentConfigEditor({
  agent, config, modelOptions, fallbacks, updating, onUpdate,
}: {
  agent: AgentInfo
  config: AgentConfig
  modelOptions: ModelOption[]
  fallbacks: string[]
  updating: boolean
  onUpdate: (agent: AgentInfo, patch: Record<string, any>) => void
}) {
  const identity = config.identity ?? {}
  const subagents = config.subagents ?? {}
  const groupChat = config.groupChat ?? {}

  return (
    <div className="border-t border-border-subtle px-4 py-3 space-y-4">
      {/* Identity section */}
      <ConfigSection icon={<User size={13} />} title={t('claw.am_identity')}>
        <ConfigRow label={t('claw.am_display_name')}>
          <input
            type="text"
            value={identity.name ?? ''}
            placeholder={agent.name}
            onChange={(e) => onUpdate(agent, { identity: { name: e.target.value || null } })}
            className="w-full sm:w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary"
          />
        </ConfigRow>
        <ConfigRow label={t('claw.am_emoji')}>
          <input
            type="text"
            value={identity.emoji ?? ''}
            placeholder="🏘️"
            onChange={(e) => onUpdate(agent, { identity: { emoji: e.target.value || null } })}
            className="w-16 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary text-center"
          />
        </ConfigRow>
      </ConfigSection>

      {/* Model fallbacks */}
      {fallbacks.length > 0 && (
        <ConfigSection icon={<Cpu size={13} />} title={t('claw.am_fallbacks')}>
          <div className="flex flex-wrap gap-1.5">
            {fallbacks.map((ref, i) => (
              <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-elevated border border-border-subtle text-[11px] text-text-secondary font-mono">
                <span>{ref}</span>
                <button
                  onClick={() => {
                    const next = fallbacks.filter((_, j) => j !== i)
                    onUpdate(agent, { model: { fallbacks: next.length > 0 ? next : null } })
                  }}
                  className="text-text-tertiary hover:text-red-400 cursor-pointer"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </ConfigSection>
      )}

      {/* Thinking & reasoning */}
      <ConfigSection icon={<Brain size={13} />} title={t('claw.am_thinking')}>
        <ConfigRow label={t('claw.am_thinking_default')}>
          <select
            value={config.thinkingDefault ?? ''}
            onChange={(e) => onUpdate(agent, { thinkingDefault: e.target.value || null })}
            className="w-full sm:w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
          >
            <option value="">{t('claw.am_inherit')}</option>
            {THINKING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </ConfigRow>
        <ConfigRow label={t('claw.am_reasoning_default')}>
          <select
            value={config.reasoningDefault ?? ''}
            onChange={(e) => onUpdate(agent, { reasoningDefault: e.target.value || null })}
            className="w-full sm:w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
          >
            <option value="">{t('claw.am_inherit')}</option>
            {REASONING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </ConfigRow>
      </ConfigSection>

      {/* Context tokens */}
      <ConfigSection icon={<Zap size={13} />} title={t('claw.am_context')}>
        <ConfigRow label={t('claw.am_context_tokens')}>
          <input
            type="number"
            value={config.contextTokens ?? ''}
            placeholder={t('claw.am_inherit')}
            onChange={(e) => onUpdate(agent, { contextTokens: e.target.value ? Number(e.target.value) : null })}
            className="w-full sm:w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </ConfigRow>
      </ConfigSection>

      {/* Subagents */}
      <ConfigSection icon={<Zap size={13} />} title={t('claw.am_subagents')}>
        <ConfigRow label={t('claw.am_subagent_timeout')}>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={subagents.runTimeoutSeconds ?? ''}
              placeholder={t('claw.am_inherit')}
              onChange={(e) => onUpdate(agent, { subagents: { runTimeoutSeconds: e.target.value ? Number(e.target.value) : null } })}
              className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[11px] text-text-tertiary">{t('claw.seconds')}</span>
          </div>
        </ConfigRow>
        <ConfigRow label={t('claw.am_delegation_mode')}>
          <select
            value={subagents.delegationMode ?? ''}
            onChange={(e) => onUpdate(agent, { subagents: { delegationMode: e.target.value || null } })}
            className="w-full sm:w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
          >
            <option value="">{t('claw.am_inherit')}</option>
            {DELEGATION_MODES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </ConfigRow>
      </ConfigSection>

      {/* Group chat */}
      <ConfigSection icon={<MessageSquare size={13} />} title={t('claw.am_group_chat')}>
        <ConfigRow label={t('claw.am_history_limit')}>
          <input
            type="number"
            value={groupChat.historyLimit ?? ''}
            placeholder={t('claw.am_inherit')}
            onChange={(e) => onUpdate(agent, { groupChat: { historyLimit: e.target.value ? Number(e.target.value) : null } })}
            className="w-full sm:w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[12px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </ConfigRow>
      </ConfigSection>
    </div>
  )
}

function ConfigSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-text-secondary">
        <span className="text-brand-secondary">{icon}</span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      <div className="flex flex-col gap-2 pl-5">
        {children}
      </div>
    </div>
  )
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-text-tertiary shrink-0">{label}</span>
      {children}
    </div>
  )
}
