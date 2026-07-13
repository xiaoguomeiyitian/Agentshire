import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Save, Settings, MessageSquare, Cpu, Info,
  ChevronDown, ChevronRight, Plug, SlidersHorizontal,
  Trash2, Globe, Monitor, Download, Bug, ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { apiUrl } from '@/utils/api-base'
import { ModelPanel } from './ModelPanel'

interface ClawSettingsViewProps {
  visible: boolean
}

// ── Types ──

interface ClawConfig {
  gateway: { mode: string; port?: number }
  agents: {
    defaults: {
      subagents?: { runTimeoutSeconds?: number }
      model?: { primary?: string }
    }
    count: number
    list: Array<{ id: string; name: string; emoji?: string }>
  }
  plugin: {
    enabled: boolean
    autoLaunch: boolean
    allowConversationAccess: boolean
  }
  bindings: Array<{ type?: string; agentId?: string; comment?: string }>
  meta: { lastTouchedVersion?: string; lastTouchedAt?: string }
  defaultModel?: string
  // Extended config sections
  logging?: {
    level?: string
    consoleLevel?: string
    consoleStyle?: string
    redactSensitive?: string
  }
  browser?: {
    enabled?: boolean
    headless?: boolean
    noSandbox?: boolean
    cdpUrl?: string
    actionTimeoutMs?: number
  }
  update?: {
    channel?: string
    checkOnStart?: boolean
    auto?: { enabled?: boolean }
  }
  session?: {
    maxHistoryTurns?: number
    compactionThresholdTokens?: number
  }
  diagnostics?: {
    enabled?: boolean
    stuckSessionWarnMs?: number
    stuckSessionAbortMs?: number
  }
}

interface SessionSummary {
  sessionKey: string
  sessionId: string
  agentId: string
  agentName: string
  chatType: string
  status: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  reasoningTokens: number
  estimatedCostUsd: number
  modelProvider: string
  model: string
  contextTokens: number
  updatedAt: number
  startedAt: number
  endedAt: number
  runtimeMs: number
  compactionCount: number
}

interface SessionTotals {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheRead: number
  estimatedCostUsd: number
  count: number
}

type NavSection = 'general' | 'models' | 'plugin' | 'sessions' | 'advanced' | 'about'

// ── Helpers ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd >= 0.01) return `$${usd.toFixed(2)}`
  if (usd > 0) return `$${usd.toFixed(4)}`
  return '$0'
}

function formatTime(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatRuntime(ms: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

// ── Component ──

export function ClawSettingsView({ visible }: ClawSettingsViewProps) {
  const [config, setConfig] = useState<ClawConfig | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [totals, setTotals] = useState<SessionTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [activeSection, setActiveSection] = useState<NavSection>('general')

  // Draft state for editable fields
  const [gatewayMode, setGatewayMode] = useState('local')
  const [subagentsTimeout, setSubagentsTimeout] = useState(600)
  const [pluginEnabled, setPluginEnabled] = useState(true)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [allowConversationAccess, setAllowConversationAccess] = useState(false)

  // Extended config draft state
  const [loggingLevel, setLoggingLevel] = useState('info')
  const [loggingConsoleLevel, setLoggingConsoleLevel] = useState('info')
  const [loggingConsoleStyle, setLoggingConsoleStyle] = useState('pretty')
  const [loggingRedact, setLoggingRedact] = useState('auto')
  const [browserEnabled, setBrowserEnabled] = useState(true)
  const [browserHeadless, setBrowserHeadless] = useState(false)
  const [browserNoSandbox, setBrowserNoSandbox] = useState(false)
  const [browserCdpUrl, setBrowserCdpUrl] = useState('')
  const [browserActionTimeout, setBrowserActionTimeout] = useState(30000)
  const [updateChannel, setUpdateChannel] = useState('stable')
  const [updateCheckOnStart, setUpdateCheckOnStart] = useState(true)
  const [updateAutoEnabled, setUpdateAutoEnabled] = useState(false)
  const [sessionMaxHistory, setSessionMaxHistory] = useState(50)
  const [sessionCompactionThreshold, setSessionCompactionThreshold] = useState(100000)
  const [diagEnabled, setDiagEnabled] = useState(true)
  const [diagStuckWarn, setDiagStuckWarn] = useState(120000)
  const [diagStuckAbort, setDiagStuckAbort] = useState(600000)

  // Collapsible agent groups in sessions list
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  // Clear sessions confirm + progress
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearResult, setClearResult] = useState<number | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(apiUrl('/claw/_api/config/load'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await resp.json()
      if (data.success && data.config) {
        setConfig(data.config)
        setGatewayMode(data.config.gateway?.mode ?? 'local')
        setSubagentsTimeout(data.config.agents?.defaults?.subagents?.runTimeoutSeconds ?? 600)
        setPluginEnabled(data.config.plugin?.enabled ?? true)
        setAutoLaunch(data.config.plugin?.autoLaunch ?? false)
        setAllowConversationAccess(data.config.plugin?.allowConversationAccess ?? false)
        // Extended config
        setLoggingLevel(data.config.logging?.level ?? 'info')
        setLoggingConsoleLevel(data.config.logging?.consoleLevel ?? 'info')
        setLoggingConsoleStyle(data.config.logging?.consoleStyle ?? 'pretty')
        setLoggingRedact(data.config.logging?.redactSensitive ?? 'auto')
        setBrowserEnabled(data.config.browser?.enabled ?? true)
        setBrowserHeadless(data.config.browser?.headless ?? false)
        setBrowserNoSandbox(data.config.browser?.noSandbox ?? false)
        setBrowserCdpUrl(data.config.browser?.cdpUrl ?? '')
        setBrowserActionTimeout(data.config.browser?.actionTimeoutMs ?? 30000)
        setUpdateChannel(data.config.update?.channel ?? 'stable')
        setUpdateCheckOnStart(data.config.update?.checkOnStart ?? true)
        setUpdateAutoEnabled(data.config.update?.auto?.enabled ?? false)
        setSessionMaxHistory(data.config.session?.maxHistoryTurns ?? 50)
        setSessionCompactionThreshold(data.config.session?.compactionThresholdTokens ?? 100000)
        setDiagEnabled(data.config.diagnostics?.enabled ?? true)
        setDiagStuckWarn(data.config.diagnostics?.stuckSessionWarnMs ?? 120000)
        setDiagStuckAbort(data.config.diagnostics?.stuckSessionAbortMs ?? 600000)
      } else {
        setError(data.error ?? 'Failed to load config')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const resp = await fetch(apiUrl('/claw/_api/sessions/list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await resp.json()
      if (data.success) {
        setSessions(data.sessions ?? [])
        setTotals(data.totals ?? null)
      }
    } catch {
      // silent — sessions are best-effort
    }
  }, [])

  useEffect(() => {
    if (visible) {
      loadConfig()
      loadSessions()
    }
  }, [visible, loadConfig, loadSessions])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const resp = await fetch(apiUrl('/claw/_api/config/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway: { mode: gatewayMode },
          subagentsTimeoutSeconds: subagentsTimeout,
          pluginEnabled,
          autoLaunch,
          allowConversationAccess,
          logging: {
            level: loggingLevel,
            consoleLevel: loggingConsoleLevel,
            consoleStyle: loggingConsoleStyle,
            redactSensitive: loggingRedact,
          },
          browser: {
            enabled: browserEnabled,
            headless: browserHeadless,
            noSandbox: browserNoSandbox,
            cdpUrl: browserCdpUrl,
            actionTimeoutMs: browserActionTimeout,
          },
          update: {
            channel: updateChannel,
            checkOnStart: updateCheckOnStart,
            auto: { enabled: updateAutoEnabled },
          },
          session: {
            maxHistoryTurns: sessionMaxHistory,
            compactionThresholdTokens: sessionCompactionThreshold,
          },
          diagnostics: {
            enabled: diagEnabled,
            stuckSessionWarnMs: diagStuckWarn,
            stuckSessionAbortMs: diagStuckAbort,
          },
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        setError(data.error ?? 'Save failed')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    } finally {
      setSaving(false)
    }
  }, [gatewayMode, subagentsTimeout, pluginEnabled, autoLaunch, allowConversationAccess,
    loggingLevel, loggingConsoleLevel, loggingConsoleStyle, loggingRedact,
    browserEnabled, browserHeadless, browserNoSandbox, browserCdpUrl, browserActionTimeout,
    updateChannel, updateCheckOnStart, updateAutoEnabled,
    sessionMaxHistory, sessionCompactionThreshold,
    diagEnabled, diagStuckWarn, diagStuckAbort])

  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  // Clear all sessions except the current one (agent:town-steward:main)
  const handleClearSessions = useCallback(async () => {
    setClearing(true)
    setClearResult(null)
    try {
      const resp = await fetch(apiUrl('/claw/_api/sessions/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepSessionKey: 'agent:town-steward:main',
          keepAgentId: 'town-steward',
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setClearResult(data.cleared ?? 0)
        // Reload sessions list
        await loadSessions()
      } else {
        setError(data.error ?? 'Clear failed')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    } finally {
      setClearing(false)
      setClearConfirm(false)
    }
  }, [loadSessions])

  // Group sessions by agentId
  const sessionsByAgent = sessions.reduce<Record<string, SessionSummary[]>>((acc, s) => {
    if (!acc[s.agentId]) acc[s.agentId] = []
    acc[s.agentId].push(s)
    return acc
  }, {})

  if (!visible) return null

  // ── Nav items ──
  const navItems: Array<{ key: NavSection; label: string; icon: any }> = [
    { key: 'general', label: t('claw.nav_general'), icon: SlidersHorizontal },
    { key: 'models', label: t('claw.nav_models'), icon: Cpu },
    { key: 'plugin', label: t('claw.nav_plugin'), icon: Plug },
    { key: 'sessions', label: t('claw.nav_sessions'), icon: MessageSquare },
    { key: 'advanced', label: t('claw.nav_advanced'), icon: Settings },
    { key: 'about', label: t('claw.nav_about'), icon: Info },
  ]

  return (
    <div className="absolute inset-0 flex bg-bg-base">
      {/* ── Left: Nav tree ── */}
      <div className="w-[140px] shrink-0 border-r border-border-subtle flex flex-col bg-bg-canvas">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-4 border-b border-border-subtle whitespace-nowrap">
          <Settings size={16} className="text-brand-secondary shrink-0" strokeWidth={1.8} />
          <span className="text-[13px] font-semibold text-text-primary">{t('claw.title')}</span>
        </div>

        {/* Nav items */}
        <div className="flex-1 overflow-y-auto styled-scrollbar py-2">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2.5 text-[13px] cursor-pointer whitespace-nowrap',
                'transition-colors duration-150 border-l-2',
                activeSection === key
                  ? 'bg-[rgba(212,165,116,0.08)] text-brand-secondary border-brand-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/40 border-transparent',
              )}
            >
              <Icon size={15} strokeWidth={1.8} className="shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: Detail panel ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top toolbar: refresh + save ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-bg-canvas">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-text-primary">
              {navItems.find((n) => n.key === activeSection)?.label}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { loadConfig(); loadSessions() }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150 disabled:opacity-50"
            >
              <RefreshCw size={13} strokeWidth={1.8} className={loading ? 'animate-spin' : ''} />
              {t('claw.refresh')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || activeSection === 'sessions' || activeSection === 'about' || activeSection === 'models'}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer',
                'transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed',
                saved
                  ? 'bg-status-success/20 text-status-success border border-status-success/30'
                  : 'bg-gradient-to-br from-[#C4915E] to-[#D4A574] text-black hover:brightness-110',
              )}
            >
              {saving ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : saved ? (
                <span className="text-[13px]">✓</span>
              ) : (
                <Save size={13} strokeWidth={2} />
              )}
              {saved ? t('claw.saved') : t('claw.save')}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[13px] text-red-400">
            {error}
          </div>
        )}

        {/* ── Content area ── */}
        {activeSection === 'models' ? (
          <div className="flex-1 min-h-0">
            <ModelPanel />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto styled-scrollbar">
          {activeSection === 'general' && (
            <GeneralPanel
              config={config}
              loading={loading}
              gatewayMode={gatewayMode}
              setGatewayMode={setGatewayMode}
              subagentsTimeout={subagentsTimeout}
              setSubagentsTimeout={setSubagentsTimeout}
              loggingLevel={loggingLevel} setLoggingLevel={setLoggingLevel}
              loggingConsoleLevel={loggingConsoleLevel} setLoggingConsoleLevel={setLoggingConsoleLevel}
              loggingConsoleStyle={loggingConsoleStyle} setLoggingConsoleStyle={setLoggingConsoleStyle}
              loggingRedact={loggingRedact} setLoggingRedact={setLoggingRedact}
              updateChannel={updateChannel} setUpdateChannel={setUpdateChannel}
              updateCheckOnStart={updateCheckOnStart} setUpdateCheckOnStart={setUpdateCheckOnStart}
              updateAutoEnabled={updateAutoEnabled} setUpdateAutoEnabled={setUpdateAutoEnabled}
            />
          )}
          {activeSection === 'plugin' && (
            <PluginPanel
              config={config}
              loading={loading}
              pluginEnabled={pluginEnabled}
              setPluginEnabled={setPluginEnabled}
              autoLaunch={autoLaunch}
              setAutoLaunch={setAutoLaunch}
              allowConversationAccess={allowConversationAccess}
              setAllowConversationAccess={setAllowConversationAccess}
            />
          )}
          {activeSection === 'sessions' && (
            <SessionsPanel
              sessions={sessions}
              totals={totals}
              sessionsByAgent={sessionsByAgent}
              expandedAgents={expandedAgents}
              toggleAgent={toggleAgent}
              clearing={clearing}
              clearConfirm={clearConfirm}
              setClearConfirm={setClearConfirm}
              onClear={handleClearSessions}
              clearResult={clearResult}
            />
          )}
          {activeSection === 'advanced' && (
            <AdvancedPanel
              config={config}
              loading={loading}
              browserEnabled={browserEnabled} setBrowserEnabled={setBrowserEnabled}
              browserHeadless={browserHeadless} setBrowserHeadless={setBrowserHeadless}
              browserNoSandbox={browserNoSandbox} setBrowserNoSandbox={setBrowserNoSandbox}
              browserCdpUrl={browserCdpUrl} setBrowserCdpUrl={setBrowserCdpUrl}
              browserActionTimeout={browserActionTimeout} setBrowserActionTimeout={setBrowserActionTimeout}
              sessionMaxHistory={sessionMaxHistory} setSessionMaxHistory={setSessionMaxHistory}
              sessionCompactionThreshold={sessionCompactionThreshold} setSessionCompactionThreshold={setSessionCompactionThreshold}
              diagEnabled={diagEnabled} setDiagEnabled={setDiagEnabled}
              diagStuckWarn={diagStuckWarn} setDiagStuckWarn={setDiagStuckWarn}
              diagStuckAbort={diagStuckAbort} setDiagStuckAbort={setDiagStuckAbort}
            />
          )}
          {activeSection === 'about' && (
            <AboutPanel config={config} loading={loading} />
          )}
        </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════
// Sub-panels
// ════════════════════════════════════════════

function PanelWrapper({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-brand-secondary">{icon}</span>
        <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="rounded-2xl bg-bg-surface border border-border-subtle p-5">
        {children}
      </div>
    </div>
  )
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <div className="text-[13px] text-text-secondary">{label}</div>
        {desc && <div className="text-[11px] text-text-tertiary mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-border-subtle my-1" />
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer shrink-0',
        on ? 'bg-brand-primary' : 'bg-white/15',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200',
          on ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

// ── General panel ──

function GeneralPanel({
  config, loading, gatewayMode, setGatewayMode, subagentsTimeout, setSubagentsTimeout,
  loggingLevel, setLoggingLevel,
  loggingConsoleLevel, setLoggingConsoleLevel,
  loggingConsoleStyle, setLoggingConsoleStyle,
  loggingRedact, setLoggingRedact,
  updateChannel, setUpdateChannel,
  updateCheckOnStart, setUpdateCheckOnStart,
  updateAutoEnabled, setUpdateAutoEnabled,
}: {
  config: ClawConfig | null
  loading: boolean
  gatewayMode: string
  setGatewayMode: (v: string) => void
  subagentsTimeout: number
  setSubagentsTimeout: (v: number) => void
  loggingLevel: string; setLoggingLevel: (v: string) => void
  loggingConsoleLevel: string; setLoggingConsoleLevel: (v: string) => void
  loggingConsoleStyle: string; setLoggingConsoleStyle: (v: string) => void
  loggingRedact: string; setLoggingRedact: (v: string) => void
  updateChannel: string; setUpdateChannel: (v: string) => void
  updateCheckOnStart: boolean; setUpdateCheckOnStart: (v: boolean) => void
  updateAutoEnabled: boolean; setUpdateAutoEnabled: (v: boolean) => void
}) {
  if (loading && !config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <PanelWrapper icon={<Cpu size={16} />} title={t('claw.section_settings')}>
        <div className="space-y-1">
          <SettingRow label={t('claw.gateway_mode')}>
            <select
              value={gatewayMode}
              onChange={(e) => setGatewayMode(e.target.value)}
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
            >
              <option value="local">{t('claw.gateway_local')}</option>
              <option value="remote">{t('claw.gateway_remote')}</option>
            </select>
          </SettingRow>

          <SettingRow label={t('claw.subagent_timeout')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={30}
                max={3600}
                value={subagentsTimeout}
                onChange={(e) => setSubagentsTimeout(Number(e.target.value) || 600)}
                className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
              />
              <span className="text-[12px] text-text-tertiary">{t('claw.seconds')}</span>
            </div>
          </SettingRow>

          <Divider />

          <SettingRow label={t('claw.default_model')}>
            <span className="text-[13px] text-text-secondary font-mono">
              {config?.defaultModel || t('claw.not_set')}
            </span>
          </SettingRow>

          <SettingRow label={t('claw.agent_count')}>
            <span className="text-[13px] text-text-secondary">{config?.agents.count ?? '-'}</span>
          </SettingRow>
        </div>
      </PanelWrapper>

      {/* Logging settings */}
      <AdvancedSection icon={<Bug size={16} />} title={t('claw.adv_logging')}>
        <SettingRow label={t('claw.adv_log_level')} desc={t('claw.adv_log_level_desc')}>
          <select
            value={loggingLevel}
            onChange={(e) => setLoggingLevel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['silent','fatal','error','warn','info','debug','trace'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_console_level')}>
          <select
            value={loggingConsoleLevel}
            onChange={(e) => setLoggingConsoleLevel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['silent','fatal','error','warn','info','debug','trace'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_console_style')}>
          <select
            value={loggingConsoleStyle}
            onChange={(e) => setLoggingConsoleStyle(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['pretty','compact','json'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_redact')} desc={t('claw.adv_redact_desc')}>
          <select
            value={loggingRedact}
            onChange={(e) => setLoggingRedact(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['off','auto','strict'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* Update settings */}
      <AdvancedSection icon={<Download size={16} />} title={t('claw.adv_update')}>
        <SettingRow label={t('claw.adv_update_channel')}>
          <select
            value={updateChannel}
            onChange={(e) => setUpdateChannel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['stable','beta'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_update_checkonstart')}>
          <Toggle on={updateCheckOnStart} onChange={setUpdateCheckOnStart} />
        </SettingRow>
        <SettingRow label={t('claw.adv_update_auto')} desc={t('claw.adv_update_auto_desc')}>
          <Toggle on={updateAutoEnabled} onChange={setUpdateAutoEnabled} />
        </SettingRow>
      </AdvancedSection>
    </div>
  )
}

// ── Plugin panel ──

function PluginPanel({
  config, loading, pluginEnabled, setPluginEnabled, autoLaunch, setAutoLaunch,
  allowConversationAccess, setAllowConversationAccess,
}: {
  config: ClawConfig | null
  loading: boolean
  pluginEnabled: boolean
  setPluginEnabled: (v: boolean) => void
  autoLaunch: boolean
  setAutoLaunch: (v: boolean) => void
  allowConversationAccess: boolean
  setAllowConversationAccess: (v: boolean) => void
}) {
  if (loading && !config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <PanelWrapper icon={<Plug size={16} />} title={t('claw.nav_plugin')}>
      <div className="space-y-1">
        <SettingRow label={t('claw.plugin_enabled')} desc={t('claw.plugin_enabled_desc')}>
          <Toggle on={pluginEnabled} onChange={setPluginEnabled} />
        </SettingRow>

        <SettingRow label={t('claw.auto_launch')} desc={t('claw.auto_launch_desc')}>
          <Toggle on={autoLaunch} onChange={setAutoLaunch} />
        </SettingRow>

        <SettingRow label={t('claw.allow_conv_access')} desc={t('claw.allow_conv_access_desc')}>
          <Toggle on={allowConversationAccess} onChange={setAllowConversationAccess} />
        </SettingRow>
      </div>
    </PanelWrapper>
  )
}

// ── Sessions panel ──

function SessionsPanel({
  sessions, totals, sessionsByAgent, expandedAgents, toggleAgent,
  clearing, clearConfirm, setClearConfirm, onClear, clearResult,
}: {
  sessions: SessionSummary[]
  totals: SessionTotals | null
  sessionsByAgent: Record<string, SessionSummary[]>
  expandedAgents: Set<string>
  toggleAgent: (id: string) => void
  clearing: boolean
  clearConfirm: boolean
  setClearConfirm: (v: boolean) => void
  onClear: () => void
  clearResult: number | null
}) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-brand-secondary"><MessageSquare size={16} /></span>
          <h3 className="text-[15px] font-semibold text-text-primary">{t('claw.section_sessions')}</h3>
        </div>
        {/* Clear sessions button */}
        {Object.keys(sessionsByAgent).length > 0 && (
          <button
            onClick={() => setClearConfirm(true)}
            disabled={clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer transition-colors disabled:opacity-50"
          >
            <Trash2 size={13} strokeWidth={1.8} />
            {t('claw.clear_sessions')}
          </button>
        )}
      </div>

      {/* Clear confirm dialog */}
      {clearConfirm && (
        <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1100]">
          <div className="w-[380px] max-w-[90vw] bg-bg-surface border border-border-subtle rounded-2xl p-5 shadow-2xl">
            <h3 className="text-[16px] text-text-primary font-semibold mb-2.5">{t('claw.clear_sessions_title')}</h3>
            <p className="text-[13px] text-text-secondary mb-4 leading-relaxed">{t('claw.clear_sessions_confirm')}</p>
            <div className="flex justify-end gap-2.5">
              <button onClick={() => setClearConfirm(false)} className="px-4 py-1.5 rounded-lg text-[13px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer border border-border-subtle">
                {t('claw.mm_cancel')}
              </button>
              <button onClick={onClear} disabled={clearing} className="px-4 py-1.5 rounded-lg text-[13px] text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer transition-colors disabled:opacity-50">
                {clearing ? t('claw.clearing') : t('claw.mm_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear result toast */}
      {clearResult !== null && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-status-success/10 border border-status-success/30 text-[13px] text-status-success">
          {t('claw.clear_result').replace('{n}', String(clearResult))}
        </div>
      )}

      {/* Totals bar */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <StatCard label={t('claw.total_sessions')} value={String(totals.count)} />
          <StatCard label={t('claw.total_tokens')} value={formatTokens(totals.totalTokens)} />
          <StatCard label={t('claw.input_tokens')} value={formatTokens(totals.inputTokens)} />
          <StatCard label={t('claw.total_cost')} value={formatCost(totals.estimatedCostUsd)} />
        </div>
      )}

      {/* Sessions grouped by agent */}
      {Object.keys(sessionsByAgent).length === 0 ? (
        <div className="py-16 text-center text-[13px] text-text-tertiary">{t('claw.no_sessions')}</div>
      ) : (
        <div className="space-y-2">
          {Object.entries(sessionsByAgent).map(([agentId, agentSessions]) => {
            const expanded = expandedAgents.has(agentId)
            const agentTotal = agentSessions.reduce((sum, s) => sum + s.totalTokens, 0)
            const agentName = agentSessions[0]?.agentName ?? agentId
            return (
              <div key={agentId} className="rounded-xl bg-bg-surface border border-border-subtle overflow-hidden">
                <button
                  onClick={() => toggleAgent(agentId)}
                  className="flex items-center gap-3 w-full px-4 py-3 hover:bg-bg-elevated/40 transition-colors duration-150 cursor-pointer"
                >
                  {expanded ? (
                    <ChevronDown size={16} className="text-text-tertiary shrink-0" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight size={16} className="text-text-tertiary shrink-0" strokeWidth={1.8} />
                  )}
                  <span className="text-[14px] font-medium text-text-primary flex-1 text-left">{agentName}</span>
                  <span className="text-[12px] text-text-tertiary">{agentSessions.length} {t('claw.sessions_unit')}</span>
                  <span className="text-[12px] text-brand-secondary font-mono">{formatTokens(agentTotal)}</span>
                </button>

                {expanded && (
                  <div className="border-t border-border-subtle">
                    {agentSessions.map((s) => (
                      <SessionRow key={s.sessionKey} session={s} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-3 py-2.5">
      <div className="text-[11px] text-text-tertiary mb-1">{label}</div>
      <div className="text-[16px] font-bold text-text-primary font-mono">{value}</div>
    </div>
  )
}

function SessionRow({ session }: { session: SessionSummary }) {
  const [expanded, setExpanded] = useState(false)

  const statusColor = session.status === 'done' ? 'text-status-success'
    : session.status === 'error' || session.status === 'failed' ? 'text-red-400'
    : session.status === 'running' ? 'text-brand-primary'
    : 'text-text-tertiary'

  const dotColor = session.status === 'done' ? 'bg-status-success'
    : session.status === 'error' || session.status === 'failed' ? 'bg-red-400'
    : session.status === 'running' ? 'bg-brand-primary'
    : 'bg-text-quaternary'

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-bg-elevated/30 transition-colors duration-100 cursor-pointer text-left"
      >
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
        <span className="text-[12px] text-text-secondary truncate flex-1 font-mono">{session.sessionId.slice(0, 8)}</span>
        <span className={cn('text-[11px] shrink-0', statusColor)}>{session.status}</span>
        <span className="text-[11px] text-text-tertiary shrink-0 hidden md:inline">{formatTime(session.updatedAt)}</span>
        <span className="text-[12px] text-brand-secondary font-mono shrink-0">{formatTokens(session.totalTokens)}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px]">
          <DetailItem label={t('claw.input_tokens')} value={formatTokens(session.inputTokens)} />
          <DetailItem label={t('claw.output_tokens')} value={formatTokens(session.outputTokens)} />
          <DetailItem label={t('claw.cache_read')} value={formatTokens(session.cacheRead)} />
          <DetailItem label={t('claw.reasoning_tokens')} value={formatTokens(session.reasoningTokens)} />
          <DetailItem label={t('claw.cost')} value={formatCost(session.estimatedCostUsd)} />
          <DetailItem label={t('claw.runtime')} value={formatRuntime(session.runtimeMs)} />
          <DetailItem label={t('claw.model')} value={session.model || '-'} mono />
          <DetailItem label={t('claw.context_window')} value={session.contextTokens ? formatTokens(session.contextTokens) : '-'} />
          <DetailItem label={t('claw.compaction')} value={String(session.compactionCount)} />
          <DetailItem label={t('claw.chat_type')} value={session.chatType} />
          <DetailItem label={t('claw.updated')} value={formatTime(session.updatedAt)} />
          <DetailItem label={t('claw.started')} value={formatTime(session.startedAt)} />
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <span className="text-text-tertiary shrink-0">{label}</span>
      <span className={cn('text-text-secondary truncate text-right', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// ── About panel ──

function AboutPanel({ config, loading }: { config: ClawConfig | null; loading: boolean }) {
  if (loading && !config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <PanelWrapper icon={<Info size={16} />} title={t('claw.nav_about')}>
      <div className="space-y-1">
        <SettingRow label={t('claw.version')}>
          <span className="text-[13px] text-text-tertiary font-mono">{config?.meta?.lastTouchedVersion ?? '-'}</span>
        </SettingRow>
        <Divider />
        <SettingRow label={t('claw.agent_count')}>
          <span className="text-[13px] text-text-secondary">{config?.agents.count ?? '-'}</span>
        </SettingRow>
        <SettingRow label={t('claw.default_model')}>
          <span className="text-[13px] text-text-secondary font-mono">{config?.defaultModel || t('claw.not_set')}</span>
        </SettingRow>
        <Divider />
        <div className="py-3">
          <div className="text-[11px] text-text-tertiary mb-2">{t('claw.about_desc')}</div>
          <div className="flex flex-wrap gap-1.5">
            {config?.agents.list?.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg-elevated text-[11px] text-text-secondary">
                {a.emoji && <span>{a.emoji}</span>}
                {a.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </PanelWrapper>
  )
}

// ── Advanced panel (logging / browser / update / session / diagnostics) ──

function AdvancedPanel(props: {
  config: ClawConfig | null
  loading: boolean
  browserEnabled: boolean; setBrowserEnabled: (v: boolean) => void
  browserHeadless: boolean; setBrowserHeadless: (v: boolean) => void
  browserNoSandbox: boolean; setBrowserNoSandbox: (v: boolean) => void
  browserCdpUrl: string; setBrowserCdpUrl: (v: string) => void
  browserActionTimeout: number; setBrowserActionTimeout: (v: number) => void
  sessionMaxHistory: number; setSessionMaxHistory: (v: number) => void
  sessionCompactionThreshold: number; setSessionCompactionThreshold: (v: number) => void
  diagEnabled: boolean; setDiagEnabled: (v: boolean) => void
  diagStuckWarn: number; setDiagStuckWarn: (v: number) => void
  diagStuckAbort: number; setDiagStuckAbort: (v: number) => void
}) {
  if (props.loading && !props.config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      {/* Browser */}
      <AdvancedSection icon={<Monitor size={16} />} title={t('claw.adv_browser')}>
        <SettingRow label={t('claw.adv_browser_enabled')} desc={t('claw.adv_browser_enabled_desc')}>
          <Toggle on={props.browserEnabled} onChange={props.setBrowserEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_headless')}>
          <Toggle on={props.browserHeadless} onChange={props.setBrowserHeadless} />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_nosandbox')} desc={t('claw.adv_browser_nosandbox_desc')}>
          <Toggle on={props.browserNoSandbox} onChange={props.setBrowserNoSandbox} />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_cdpurl')}>
          <input
            type="text"
            value={props.browserCdpUrl}
            onChange={(e) => props.setBrowserCdpUrl(e.target.value)}
            placeholder="ws://localhost:9222"
            className="w-48 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_timeout')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1000}
              value={props.browserActionTimeout}
              onChange={(e) => props.setBrowserActionTimeout(Number(e.target.value) || 30000)}
              className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>

      {/* Session */}
      <AdvancedSection icon={<Globe size={16} />} title={t('claw.adv_session')}>
        <SettingRow label={t('claw.adv_session_maxhistory')} desc={t('claw.adv_session_maxhistory_desc')}>
          <input
            type="number"
            min={1}
            value={props.sessionMaxHistory}
            onChange={(e) => props.setSessionMaxHistory(Number(e.target.value) || 50)}
            className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_session_compaction')} desc={t('claw.adv_session_compaction_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1000}
              step={1000}
              value={props.sessionCompactionThreshold}
              onChange={(e) => props.setSessionCompactionThreshold(Number(e.target.value) || 100000)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.tokens')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>

      {/* Diagnostics */}
      <AdvancedSection icon={<ShieldAlert size={16} />} title={t('claw.adv_diagnostics')}>
        <SettingRow label={t('claw.adv_diag_enabled')} desc={t('claw.adv_diag_enabled_desc')}>
          <Toggle on={props.diagEnabled} onChange={props.setDiagEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_diag_warn')} desc={t('claw.adv_diag_warn_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1000}
              step={1000}
              value={props.diagStuckWarn}
              onChange={(e) => props.setDiagStuckWarn(Number(e.target.value) || 120000)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
        <SettingRow label={t('claw.adv_diag_abort')} desc={t('claw.adv_diag_abort_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1000}
              step={1000}
              value={props.diagStuckAbort}
              onChange={(e) => props.setDiagStuckAbort(Number(e.target.value) || 600000)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>
    </div>
  )
}

function AdvancedSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-brand-secondary">{icon}</span>
        <h3 className="text-[14px] font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="rounded-2xl bg-bg-surface border border-border-subtle p-5">
        <div className="space-y-1">{children}</div>
      </div>
    </div>
  )
}
