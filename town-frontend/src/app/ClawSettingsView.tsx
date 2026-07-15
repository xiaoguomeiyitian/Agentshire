import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Save, Settings, MessageSquare, Cpu, Info,
  ChevronDown, ChevronRight, Plug, SlidersHorizontal,
  Trash2, Globe, Monitor, Download, Bug, ShieldAlert,
  Menu, X,
  Wrench, MessageCircle, Image, FileText, CheckSquare,
  Radio, Network, Webhook, Palette, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import { apiUrl } from '@/utils/api-base'
import { ModelPanel } from './ModelPanel'
import { AgentModelsPanel } from './AgentModelsPanel'

interface ClawSettingsViewProps {
  visible: boolean
}

// ── Types ──

interface ClawConfig {
  gateway: {
    mode: string
    port?: number
    bind?: string
    customBindHost?: string
    allowRealIpFallback?: boolean
    handshakeTimeoutMs?: number
    channelHealthCheckMinutes?: number
    channelStaleEventThresholdMinutes?: number
    channelMaxRestartsPerHour?: number
    auth?: { mode?: string; token?: string }
  }
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
    file?: string
    maxFileBytes?: number
  }
  browser?: {
    enabled?: boolean
    headless?: boolean
    noSandbox?: boolean
    cdpUrl?: string
    actionTimeoutMs?: number
    evaluateEnabled?: boolean
    executablePath?: string
    attachOnly?: boolean
    cdpPortRangeStart?: number
    defaultProfile?: string
    color?: string
  }
  update?: {
    channel?: string
    checkOnStart?: boolean
    auto?: { enabled?: boolean }
  }
  session?: {
    maxHistoryTurns?: number
    compactionThresholdTokens?: number
    scope?: string
    idleMinutes?: number
    dmScope?: string
    store?: string
    typingIntervalSeconds?: number
    typingMode?: string
    mainKey?: string
  }
  diagnostics?: {
    enabled?: boolean
    stuckSessionWarnMs?: number
    stuckSessionAbortMs?: number
    memoryPressureSnapshot?: boolean
  }
  messages?: {
    ackReactionScope?: string
    suppressToolErrors?: boolean
    messagePrefix?: string
    responsePrefix?: string
    ackReaction?: string
    removeAckAfterReply?: boolean
    visibleReplies?: string
    responseUsage?: string
  }
  commands?: {
    text?: boolean
    bash?: boolean
    config?: boolean
    restart?: boolean
    native?: boolean | string
    nativeSkills?: boolean | string
    bashForegroundMs?: number
    mcp?: boolean
    plugins?: boolean
    debug?: boolean
    useAccessGroups?: boolean
    ownerDisplay?: string
  }
  cron?: {
    enabled?: boolean
    maxConcurrentRuns?: number
    store?: string
    webhook?: string
    webhookToken?: string
  }
  memory?: {
    backend?: string
    citations?: string
  }
  proxy?: {
    enabled?: boolean
    proxyUrl?: string
    loopbackMode?: string
  }
  env?: {
    shellEnv?: { enabled?: boolean }
  }
  audit?: {
    enabled?: boolean
  }
  tools?: {
    profile?: string
    toolSearch?: boolean | object
    codeMode?: boolean | object
  }
  talk?: {
    provider?: string
    consultThinkingLevel?: string
    consultFastMode?: boolean
    speechLocale?: string
    interruptOnSpeech?: boolean
    silenceTimeoutMs?: number
  }
  web?: {
    enabled?: boolean
    heartbeatSeconds?: number
  }
  media?: {
    preserveFilenames?: boolean
    ttlHours?: number
  }
  mcp?: {
    sessionIdleTtlMs?: number
  }
  transcripts?: {
    enabled?: boolean
    maxUtterances?: number
  }
  commitments?: {
    enabled?: boolean
    maxPerDay?: number
  }
  broadcast?: {
    strategy?: string
  }
  models?: {
    mode?: string
  }
  plugins?: {
    enabled?: boolean
    bundledDiscovery?: string
  }
  acp?: {
    enabled?: boolean
    backend?: string
    defaultAgent?: string
    maxConcurrentSessions?: number
  }
  hooks?: {
    enabled?: boolean
    path?: string
    token?: string
    defaultSessionKey?: string
    allowRequestSessionKey?: boolean
    maxBodyBytes?: number
    transformsDir?: string
  }
  ui?: {
    seamColor?: string
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

type NavSection = 'general' | 'system' | 'messaging' | 'tools' | 'ai' | 'network' | 'providers' | 'models' | 'plugin' | 'sessions' | 'about'

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
  const [gatewayPort, setGatewayPort] = useState(0)
  const [gatewayBind, setGatewayBind] = useState('loopback')
  const [subagentsTimeout, setSubagentsTimeout] = useState(600)
  const [pluginEnabled, setPluginEnabled] = useState(true)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [allowConversationAccess, setAllowConversationAccess] = useState(false)

  // Extended config draft state
  const [loggingLevel, setLoggingLevel] = useState('info')
  const [loggingConsoleLevel, setLoggingConsoleLevel] = useState('info')
  const [loggingConsoleStyle, setLoggingConsoleStyle] = useState('pretty')
  const [loggingRedact, setLoggingRedact] = useState('off')
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
  const [sessionScope, setSessionScope] = useState('per-sender')
  const [sessionIdleMinutes, setSessionIdleMinutes] = useState(0)
  const [diagEnabled, setDiagEnabled] = useState(true)
  const [diagStuckWarn, setDiagStuckWarn] = useState(120000)
  const [diagStuckAbort, setDiagStuckAbort] = useState(600000)
  // Messages / Commands / Cron / Memory / Proxy / Env / Audit
  const [msgAckScope, setMsgAckScope] = useState('group-mentions')
  const [msgSuppressToolErrors, setMsgSuppressToolErrors] = useState(false)
  const [cmdText, setCmdText] = useState(true)
  const [cmdBash, setCmdBash] = useState(true)
  const [cmdConfig, setCmdConfig] = useState(true)
  const [cmdRestart, setCmdRestart] = useState(true)
  const [cronEnabled, setCronEnabled] = useState(false)
  const [cronMaxConcurrent, setCronMaxConcurrent] = useState(1)
  const [memoryBackend, setMemoryBackend] = useState('builtin')
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyLoopbackMode, setProxyLoopbackMode] = useState('gateway-only')
  const [envShellEnvEnabled, setEnvShellEnvEnabled] = useState(false)
  const [auditEnabled, setAuditEnabled] = useState(false)
  // Tools
  const [toolsProfile, setToolsProfile] = useState('full')
  const [toolsToolSearch, setToolsToolSearch] = useState(false)
  const [toolsCodeMode, setToolsCodeMode] = useState(false)
  // Talk
  const [talkProvider, setTalkProvider] = useState('')
  const [talkConsultThinkingLevel, setTalkConsultThinkingLevel] = useState('off')
  const [talkConsultFastMode, setTalkConsultFastMode] = useState(false)
  const [talkSpeechLocale, setTalkSpeechLocale] = useState('')
  const [talkInterruptOnSpeech, setTalkInterruptOnSpeech] = useState(true)
  const [talkSilenceTimeoutMs, setTalkSilenceTimeoutMs] = useState(0)
  // Web
  const [webEnabled, setWebEnabled] = useState(false)
  const [webHeartbeatSeconds, setWebHeartbeatSeconds] = useState(0)
  // Media
  const [mediaPreserveFilenames, setMediaPreserveFilenames] = useState(false)
  const [mediaTtlHours, setMediaTtlHours] = useState(0)
  // MCP
  const [mcpSessionIdleTtlMs, setMcpSessionIdleTtlMs] = useState(0)
  // Transcripts
  const [transcriptsEnabled, setTranscriptsEnabled] = useState(false)
  const [transcriptsMaxUtterances, setTranscriptsMaxUtterances] = useState(0)
  // Commitments
  const [commitmentsEnabled, setCommitmentsEnabled] = useState(false)
  const [commitmentsMaxPerDay, setCommitmentsMaxPerDay] = useState(0)
  // Broadcast
  const [broadcastStrategy, setBroadcastStrategy] = useState('parallel')
  // Models mode
  const [modelsMode, setModelsMode] = useState('merge')
  // Plugins global
  const [pluginsEnabled, setPluginsEnabled] = useState(true)
  const [pluginsBundledDiscovery, setPluginsBundledDiscovery] = useState('compat')
  // ACP
  const [acpEnabled, setAcpEnabled] = useState(false)
  const [acpBackend, setAcpBackend] = useState('')
  const [acpDefaultAgent, setAcpDefaultAgent] = useState('')
  const [acpMaxConcurrentSessions, setAcpMaxConcurrentSessions] = useState(0)
  // Hooks
  const [hooksEnabled, setHooksEnabled] = useState(false)
  const [hooksPath, setHooksPath] = useState('')
  const [hooksToken, setHooksToken] = useState('')
  const [hooksDefaultSessionKey, setHooksDefaultSessionKey] = useState('')
  const [hooksAllowRequestSessionKey, setHooksAllowRequestSessionKey] = useState(false)
  const [hooksMaxBodyBytes, setHooksMaxBodyBytes] = useState(0)
  const [hooksTransformsDir, setHooksTransformsDir] = useState('')
  // UI
  const [uiSeamColor, setUiSeamColor] = useState('')
  // Gateway extended
  const [gatewayCustomBindHost, setGatewayCustomBindHost] = useState('')
  const [gatewayAllowRealIpFallback, setGatewayAllowRealIpFallback] = useState(false)
  const [gatewayHandshakeTimeoutMs, setGatewayHandshakeTimeoutMs] = useState(0)
  const [gatewayChannelHealthCheckMinutes, setGatewayChannelHealthCheckMinutes] = useState(0)
  const [gatewayChannelStaleEventThresholdMinutes, setGatewayChannelStaleEventThresholdMinutes] = useState(0)
  const [gatewayChannelMaxRestartsPerHour, setGatewayChannelMaxRestartsPerHour] = useState(0)
  // Browser extended
  const [browserEvaluateEnabled, setBrowserEvaluateEnabled] = useState(false)
  const [browserExecutablePath, setBrowserExecutablePath] = useState('')
  const [browserAttachOnly, setBrowserAttachOnly] = useState(false)
  const [browserCdpPortRangeStart, setBrowserCdpPortRangeStart] = useState(0)
  const [browserDefaultProfile, setBrowserDefaultProfile] = useState('')
  const [browserColor, setBrowserColor] = useState('')
  // Logging extended
  const [loggingFile, setLoggingFile] = useState('')
  const [loggingMaxFileBytes, setLoggingMaxFileBytes] = useState(0)
  // Session extended
  const [sessionDmScope, setSessionDmScope] = useState('main')
  const [sessionStore, setSessionStore] = useState('')
  const [sessionTypingIntervalSeconds, setSessionTypingIntervalSeconds] = useState(0)
  const [sessionTypingMode, setSessionTypingMode] = useState('never')
  const [sessionMainKey, setSessionMainKey] = useState('')
  // Diagnostics extended
  const [diagMemoryPressureSnapshot, setDiagMemoryPressureSnapshot] = useState(false)
  // Messages extended
  const [msgMessagePrefix, setMsgMessagePrefix] = useState('')
  const [msgResponsePrefix, setMsgResponsePrefix] = useState('')
  const [msgAckReaction, setMsgAckReaction] = useState('')
  const [msgRemoveAckAfterReply, setMsgRemoveAckAfterReply] = useState(false)
  const [msgVisibleReplies, setMsgVisibleReplies] = useState('')
  const [msgResponseUsage, setMsgResponseUsage] = useState('off')
  // Commands extended
  const [cmdNative, setCmdNative] = useState<'auto' | boolean>('auto')
  const [cmdNativeSkills, setCmdNativeSkills] = useState<'auto' | boolean>('auto')
  const [cmdBashForegroundMs, setCmdBashForegroundMs] = useState(2000)
  const [cmdMcp, setCmdMcp] = useState(true)
  const [cmdPlugins, setCmdPlugins] = useState(true)
  const [cmdDebug, setCmdDebug] = useState(false)
  const [cmdUseAccessGroups, setCmdUseAccessGroups] = useState(false)
  const [cmdOwnerDisplay, setCmdOwnerDisplay] = useState('raw')
  // Cron extended
  const [cronStore, setCronStore] = useState('')
  const [cronWebhook, setCronWebhook] = useState('')
  const [cronWebhookToken, setCronWebhookToken] = useState('')
  // Memory extended
  const [memoryCitations, setMemoryCitations] = useState('auto')

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
        setGatewayPort(data.config.gateway?.port ?? 0)
        setGatewayBind(data.config.gateway?.bind ?? 'auto')
        setSubagentsTimeout(data.config.agents?.defaults?.subagents?.runTimeoutSeconds ?? 600)
        setPluginEnabled(data.config.plugin?.enabled ?? true)
        setAutoLaunch(data.config.plugin?.autoLaunch ?? false)
        setAllowConversationAccess(data.config.plugin?.allowConversationAccess ?? false)
        // Extended config
        setLoggingLevel(data.config.logging?.level ?? 'info')
        setLoggingConsoleLevel(data.config.logging?.consoleLevel ?? 'info')
        setLoggingConsoleStyle(data.config.logging?.consoleStyle ?? 'pretty')
        setLoggingRedact(data.config.logging?.redactSensitive ?? 'off')
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
        setSessionScope(data.config.session?.scope ?? 'per-sender')
        setSessionIdleMinutes(data.config.session?.idleMinutes ?? 0)
        setDiagEnabled(data.config.diagnostics?.enabled ?? true)
        setDiagStuckWarn(data.config.diagnostics?.stuckSessionWarnMs ?? 120000)
        setDiagStuckAbort(data.config.diagnostics?.stuckSessionAbortMs ?? 600000)
        setMsgAckScope(data.config.messages?.ackReactionScope ?? 'group-mentions')
        setMsgSuppressToolErrors(data.config.messages?.suppressToolErrors ?? false)
        setCmdText(data.config.commands?.text ?? true)
        setCmdBash(data.config.commands?.bash ?? true)
        setCmdConfig(data.config.commands?.config ?? true)
        setCmdRestart(data.config.commands?.restart ?? true)
        setCronEnabled(data.config.cron?.enabled ?? false)
        setCronMaxConcurrent(data.config.cron?.maxConcurrentRuns ?? 1)
        setMemoryBackend(data.config.memory?.backend ?? 'builtin')
        setProxyEnabled(data.config.proxy?.enabled ?? false)
        setProxyUrl(data.config.proxy?.proxyUrl ?? '')
        setProxyLoopbackMode(data.config.proxy?.loopbackMode ?? 'gateway-only')
        setEnvShellEnvEnabled(data.config.env?.shellEnv?.enabled ?? false)
        setAuditEnabled(data.config.audit?.enabled ?? false)
        // Tools
        setToolsProfile(data.config.tools?.profile ?? 'full')
        setToolsToolSearch(Boolean(data.config.tools?.toolSearch))
        setToolsCodeMode(Boolean(data.config.tools?.codeMode))
        // Talk
        setTalkProvider(data.config.talk?.provider ?? '')
        setTalkConsultThinkingLevel(data.config.talk?.consultThinkingLevel ?? 'off')
        setTalkConsultFastMode(data.config.talk?.consultFastMode ?? false)
        setTalkSpeechLocale(data.config.talk?.speechLocale ?? '')
        setTalkInterruptOnSpeech(data.config.talk?.interruptOnSpeech ?? true)
        setTalkSilenceTimeoutMs(data.config.talk?.silenceTimeoutMs ?? 0)
        // Web
        setWebEnabled(data.config.web?.enabled ?? false)
        setWebHeartbeatSeconds(data.config.web?.heartbeatSeconds ?? 0)
        // Media
        setMediaPreserveFilenames(data.config.media?.preserveFilenames ?? false)
        setMediaTtlHours(data.config.media?.ttlHours ?? 0)
        // MCP
        setMcpSessionIdleTtlMs(data.config.mcp?.sessionIdleTtlMs ?? 0)
        // Transcripts
        setTranscriptsEnabled(data.config.transcripts?.enabled ?? false)
        setTranscriptsMaxUtterances(data.config.transcripts?.maxUtterances ?? 0)
        // Commitments
        setCommitmentsEnabled(data.config.commitments?.enabled ?? false)
        setCommitmentsMaxPerDay(data.config.commitments?.maxPerDay ?? 0)
        // Broadcast
        setBroadcastStrategy(data.config.broadcast?.strategy ?? 'parallel')
        // Models mode
        setModelsMode(data.config.models?.mode ?? 'merge')
        // Plugins global
        setPluginsEnabled(data.config.plugins?.enabled ?? true)
        setPluginsBundledDiscovery(data.config.plugins?.bundledDiscovery ?? 'compat')
        // ACP
        setAcpEnabled(data.config.acp?.enabled ?? false)
        setAcpBackend(data.config.acp?.backend ?? '')
        setAcpDefaultAgent(data.config.acp?.defaultAgent ?? '')
        setAcpMaxConcurrentSessions(data.config.acp?.maxConcurrentSessions ?? 0)
        // Hooks
        setHooksEnabled(data.config.hooks?.enabled ?? false)
        setHooksPath(data.config.hooks?.path ?? '')
        setHooksToken(data.config.hooks?.token ?? '')
        setHooksDefaultSessionKey(data.config.hooks?.defaultSessionKey ?? '')
        setHooksAllowRequestSessionKey(data.config.hooks?.allowRequestSessionKey ?? false)
        setHooksMaxBodyBytes(data.config.hooks?.maxBodyBytes ?? 0)
        setHooksTransformsDir(data.config.hooks?.transformsDir ?? '')
        // UI
        setUiSeamColor(data.config.ui?.seamColor ?? '')
        // Gateway extended
        setGatewayCustomBindHost(data.config.gateway?.customBindHost ?? '')
        setGatewayAllowRealIpFallback(data.config.gateway?.allowRealIpFallback ?? false)
        setGatewayHandshakeTimeoutMs(data.config.gateway?.handshakeTimeoutMs ?? 0)
        setGatewayChannelHealthCheckMinutes(data.config.gateway?.channelHealthCheckMinutes ?? 0)
        setGatewayChannelStaleEventThresholdMinutes(data.config.gateway?.channelStaleEventThresholdMinutes ?? 0)
        setGatewayChannelMaxRestartsPerHour(data.config.gateway?.channelMaxRestartsPerHour ?? 0)
        // Browser extended
        setBrowserEvaluateEnabled(data.config.browser?.evaluateEnabled ?? false)
        setBrowserExecutablePath(data.config.browser?.executablePath ?? '')
        setBrowserAttachOnly(data.config.browser?.attachOnly ?? false)
        setBrowserCdpPortRangeStart(data.config.browser?.cdpPortRangeStart ?? 0)
        setBrowserDefaultProfile(data.config.browser?.defaultProfile ?? '')
        setBrowserColor(data.config.browser?.color ?? '')
        // Logging extended
        setLoggingFile(data.config.logging?.file ?? '')
        setLoggingMaxFileBytes(data.config.logging?.maxFileBytes ?? 0)
        // Session extended
        setSessionDmScope(data.config.session?.dmScope ?? 'main')
        setSessionStore(data.config.session?.store ?? '')
        setSessionTypingIntervalSeconds(data.config.session?.typingIntervalSeconds ?? 0)
        setSessionTypingMode(data.config.session?.typingMode ?? 'never')
        setSessionMainKey(data.config.session?.mainKey ?? '')
        // Diagnostics extended
        setDiagMemoryPressureSnapshot(data.config.diagnostics?.memoryPressureSnapshot ?? false)
        // Messages extended
        setMsgMessagePrefix(data.config.messages?.messagePrefix ?? '')
        setMsgResponsePrefix(data.config.messages?.responsePrefix ?? '')
        setMsgAckReaction(data.config.messages?.ackReaction ?? '')
        setMsgRemoveAckAfterReply(data.config.messages?.removeAckAfterReply ?? false)
        setMsgVisibleReplies(data.config.messages?.visibleReplies ?? '')
        setMsgResponseUsage(data.config.messages?.responseUsage ?? 'off')
        // Commands extended
        setCmdNative(data.config.commands?.native ?? 'auto')
        setCmdNativeSkills(data.config.commands?.nativeSkills ?? 'auto')
        setCmdBashForegroundMs(data.config.commands?.bashForegroundMs ?? 2000)
        setCmdMcp(data.config.commands?.mcp ?? true)
        setCmdPlugins(data.config.commands?.plugins ?? true)
        setCmdDebug(data.config.commands?.debug ?? false)
        setCmdUseAccessGroups(data.config.commands?.useAccessGroups ?? false)
        setCmdOwnerDisplay(data.config.commands?.ownerDisplay ?? 'raw')
        // Cron extended
        setCronStore(data.config.cron?.store ?? '')
        setCronWebhook(data.config.cron?.webhook ?? '')
        setCronWebhookToken(data.config.cron?.webhookToken ?? '')
        // Memory extended
        setMemoryCitations(data.config.memory?.citations ?? 'auto')
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
          subagentsTimeoutSeconds: subagentsTimeout,
          pluginEnabled,
          autoLaunch,
          allowConversationAccess,
          logging: {
            level: loggingLevel,
            consoleLevel: loggingConsoleLevel,
            consoleStyle: loggingConsoleStyle,
            redactSensitive: loggingRedact,
            file: loggingFile || undefined,
            maxFileBytes: loggingMaxFileBytes || undefined,
          },
          browser: {
            enabled: browserEnabled,
            headless: browserHeadless,
            noSandbox: browserNoSandbox,
            cdpUrl: browserCdpUrl || undefined,
            actionTimeoutMs: browserActionTimeout,
            evaluateEnabled: browserEvaluateEnabled,
            executablePath: browserExecutablePath || undefined,
            attachOnly: browserAttachOnly,
            cdpPortRangeStart: browserCdpPortRangeStart || undefined,
            defaultProfile: browserDefaultProfile || undefined,
            color: browserColor || undefined,
          },
          update: {
            channel: updateChannel,
            checkOnStart: updateCheckOnStart,
            auto: { enabled: updateAutoEnabled },
          },
          session: {
            scope: sessionScope,
            idleMinutes: sessionIdleMinutes || undefined,
            dmScope: sessionDmScope,
            store: sessionStore || undefined,
            typingIntervalSeconds: sessionTypingIntervalSeconds || undefined,
            typingMode: sessionTypingMode,
            mainKey: sessionMainKey || undefined,
          },
          diagnostics: {
            enabled: diagEnabled,
            stuckSessionWarnMs: diagStuckWarn,
            stuckSessionAbortMs: diagStuckAbort,
            memoryPressureSnapshot: diagMemoryPressureSnapshot,
          },
          messages: {
            ackReactionScope: msgAckScope,
            suppressToolErrors: msgSuppressToolErrors,
            messagePrefix: msgMessagePrefix || undefined,
            responsePrefix: msgResponsePrefix || undefined,
            ackReaction: msgAckReaction || undefined,
            removeAckAfterReply: msgRemoveAckAfterReply,
            visibleReplies: msgVisibleReplies || undefined,
            responseUsage: msgResponseUsage,
          },
          commands: {
            text: cmdText,
            bash: cmdBash,
            config: cmdConfig,
            restart: cmdRestart,
            native: cmdNative,
            nativeSkills: cmdNativeSkills,
            bashForegroundMs: cmdBashForegroundMs,
            mcp: cmdMcp,
            plugins: cmdPlugins,
            debug: cmdDebug,
            useAccessGroups: cmdUseAccessGroups,
            ownerDisplay: cmdOwnerDisplay,
          },
          cron: {
            enabled: cronEnabled,
            maxConcurrentRuns: cronMaxConcurrent,
            store: cronStore || undefined,
            webhook: cronWebhook || undefined,
            webhookToken: cronWebhookToken || undefined,
          },
          memory: { backend: memoryBackend, citations: memoryCitations },
          proxy: {
            enabled: proxyEnabled,
            proxyUrl: proxyUrl || undefined,
            loopbackMode: proxyLoopbackMode,
          },
          env: { shellEnv: { enabled: envShellEnvEnabled } },
          audit: { enabled: auditEnabled },
          tools: {
            profile: toolsProfile,
            toolSearch: toolsToolSearch,
            codeMode: toolsCodeMode,
          },
          talk: {
            provider: talkProvider || undefined,
            consultThinkingLevel: talkConsultThinkingLevel,
            consultFastMode: talkConsultFastMode,
            speechLocale: talkSpeechLocale || undefined,
            interruptOnSpeech: talkInterruptOnSpeech,
            silenceTimeoutMs: talkSilenceTimeoutMs || undefined,
          },
          web: {
            enabled: webEnabled,
            heartbeatSeconds: webHeartbeatSeconds || undefined,
          },
          media: {
            preserveFilenames: mediaPreserveFilenames,
            ttlHours: mediaTtlHours || undefined,
          },
          mcp: { sessionIdleTtlMs: mcpSessionIdleTtlMs || undefined },
          transcripts: {
            enabled: transcriptsEnabled,
            maxUtterances: transcriptsMaxUtterances || undefined,
          },
          commitments: {
            enabled: commitmentsEnabled,
            maxPerDay: commitmentsMaxPerDay || undefined,
          },
          broadcast: { strategy: broadcastStrategy },
          models: { mode: modelsMode },
          plugins: {
            enabled: pluginsEnabled,
            bundledDiscovery: pluginsBundledDiscovery,
          },
          acp: {
            enabled: acpEnabled,
            backend: acpBackend || undefined,
            defaultAgent: acpDefaultAgent || undefined,
            maxConcurrentSessions: acpMaxConcurrentSessions || undefined,
          },
          hooks: {
            enabled: hooksEnabled,
            path: hooksPath || undefined,
            token: hooksToken || undefined,
            defaultSessionKey: hooksDefaultSessionKey || undefined,
            allowRequestSessionKey: hooksAllowRequestSessionKey,
            maxBodyBytes: hooksMaxBodyBytes || undefined,
            transformsDir: hooksTransformsDir || undefined,
          },
          ui: { seamColor: uiSeamColor || undefined },
          gateway: {
            mode: gatewayMode,
            port: gatewayPort || undefined,
            bind: gatewayBind,
            customBindHost: gatewayCustomBindHost || undefined,
            allowRealIpFallback: gatewayAllowRealIpFallback,
            handshakeTimeoutMs: gatewayHandshakeTimeoutMs || undefined,
            channelHealthCheckMinutes: gatewayChannelHealthCheckMinutes || undefined,
            channelStaleEventThresholdMinutes: gatewayChannelStaleEventThresholdMinutes || undefined,
            channelMaxRestartsPerHour: gatewayChannelMaxRestartsPerHour || undefined,
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

  // Delete a single session
  const handleDeleteSession = useCallback(async (agentId: string, sessionKey: string) => {
    try {
      const resp = await fetch(apiUrl('/claw/_api/sessions/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, sessionKey }),
      })
      const data = await resp.json()
      if (data.success) {
        await loadSessions()
      } else {
        setError(data.error ?? 'Delete failed')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error')
    }
  }, [loadSessions])

  // ── Nav items ──
  const navItems: Array<{ key: NavSection; label: string; icon: any }> = [
    { key: 'general', label: t('claw.nav_general'), icon: SlidersHorizontal },
    { key: 'system', label: t('claw.nav_system'), icon: Bug },
    { key: 'messaging', label: t('claw.nav_messaging'), icon: MessageSquare },
    { key: 'tools', label: t('claw.nav_tools'), icon: Wrench },
    { key: 'ai', label: t('claw.nav_ai'), icon: MessageCircle },
    { key: 'network', label: t('claw.nav_network'), icon: Globe },
    { key: 'providers', label: t('claw.nav_providers'), icon: Cpu },
    { key: 'models', label: t('claw.nav_models'), icon: Cpu },
    { key: 'plugin', label: t('claw.nav_plugin'), icon: Plug },
    { key: 'sessions', label: t('claw.nav_sessions'), icon: MessageSquare },
    { key: 'about', label: t('claw.nav_about'), icon: Info },
  ]

  // Mobile nav drawer open state
  const [navOpen, setNavOpen] = useState(false)

  // Sections that have their own save / are read-only — disable the global save button.
  const noSaveSections: NavSection[] = ['sessions', 'about', 'models', 'providers']

  // Shared props for AdvancedPanel (all 5 groups use the same props, differentiated by `group`)
  const advProps = {
    config, loading,
    loggingLevel, setLoggingLevel,
    loggingConsoleLevel, setLoggingConsoleLevel,
    loggingConsoleStyle, setLoggingConsoleStyle,
    loggingRedact, setLoggingRedact,
    loggingFile, setLoggingFile,
    loggingMaxFileBytes, setLoggingMaxFileBytes,
    updateChannel, setUpdateChannel,
    updateCheckOnStart, setUpdateCheckOnStart,
    updateAutoEnabled, setUpdateAutoEnabled,
    modelsMode, setModelsMode,
    pluginsEnabled, setPluginsEnabled,
    pluginsBundledDiscovery, setPluginsBundledDiscovery,
    browserEnabled, setBrowserEnabled,
    browserHeadless, setBrowserHeadless,
    browserNoSandbox, setBrowserNoSandbox,
    browserCdpUrl, setBrowserCdpUrl,
    browserActionTimeout, setBrowserActionTimeout,
    browserEvaluateEnabled, setBrowserEvaluateEnabled,
    browserExecutablePath, setBrowserExecutablePath,
    browserAttachOnly, setBrowserAttachOnly,
    browserCdpPortRangeStart, setBrowserCdpPortRangeStart,
    browserDefaultProfile, setBrowserDefaultProfile,
    browserColor, setBrowserColor,
    sessionMaxHistory, setSessionMaxHistory,
    sessionCompactionThreshold, setSessionCompactionThreshold,
    sessionScope, setSessionScope,
    sessionIdleMinutes, setSessionIdleMinutes,
    sessionDmScope, setSessionDmScope,
    sessionStore, setSessionStore,
    sessionTypingIntervalSeconds, setSessionTypingIntervalSeconds,
    sessionTypingMode, setSessionTypingMode,
    sessionMainKey, setSessionMainKey,
    diagEnabled, setDiagEnabled,
    diagStuckWarn, setDiagStuckWarn,
    diagStuckAbort, setDiagStuckAbort,
    diagMemoryPressureSnapshot, setDiagMemoryPressureSnapshot,
    msgAckScope, setMsgAckScope,
    msgSuppressToolErrors, setMsgSuppressToolErrors,
    msgMessagePrefix, setMsgMessagePrefix,
    msgResponsePrefix, setMsgResponsePrefix,
    msgAckReaction, setMsgAckReaction,
    msgRemoveAckAfterReply, setMsgRemoveAckAfterReply,
    msgVisibleReplies, setMsgVisibleReplies,
    msgResponseUsage, setMsgResponseUsage,
    cmdText, setCmdText,
    cmdBash, setCmdBash,
    cmdConfig, setCmdConfig,
    cmdRestart, setCmdRestart,
    cmdNative, setCmdNative,
    cmdNativeSkills, setCmdNativeSkills,
    cmdBashForegroundMs, setCmdBashForegroundMs,
    cmdMcp, setCmdMcp,
    cmdPlugins, setCmdPlugins,
    cmdDebug, setCmdDebug,
    cmdUseAccessGroups, setCmdUseAccessGroups,
    cmdOwnerDisplay, setCmdOwnerDisplay,
    cronEnabled, setCronEnabled,
    cronMaxConcurrent, setCronMaxConcurrent,
    cronStore, setCronStore,
    cronWebhook, setCronWebhook,
    cronWebhookToken, setCronWebhookToken,
    memoryBackend, setMemoryBackend,
    memoryCitations, setMemoryCitations,
    proxyEnabled, setProxyEnabled,
    proxyUrl, setProxyUrl,
    proxyLoopbackMode, setProxyLoopbackMode,
    envShellEnvEnabled, setEnvShellEnvEnabled,
    auditEnabled, setAuditEnabled,
    toolsProfile, setToolsProfile,
    toolsToolSearch, setToolsToolSearch,
    toolsCodeMode, setToolsCodeMode,
    talkProvider, setTalkProvider,
    talkConsultThinkingLevel, setTalkConsultThinkingLevel,
    talkConsultFastMode, setTalkConsultFastMode,
    talkSpeechLocale, setTalkSpeechLocale,
    talkInterruptOnSpeech, setTalkInterruptOnSpeech,
    talkSilenceTimeoutMs, setTalkSilenceTimeoutMs,
    webEnabled, setWebEnabled,
    webHeartbeatSeconds, setWebHeartbeatSeconds,
    mediaPreserveFilenames, setMediaPreserveFilenames,
    mediaTtlHours, setMediaTtlHours,
    mcpSessionIdleTtlMs, setMcpSessionIdleTtlMs,
    transcriptsEnabled, setTranscriptsEnabled,
    transcriptsMaxUtterances, setTranscriptsMaxUtterances,
    commitmentsEnabled, setCommitmentsEnabled,
    commitmentsMaxPerDay, setCommitmentsMaxPerDay,
    broadcastStrategy, setBroadcastStrategy,
    acpEnabled, setAcpEnabled,
    acpBackend, setAcpBackend,
    acpDefaultAgent, setAcpDefaultAgent,
    acpMaxConcurrentSessions, setAcpMaxConcurrentSessions,
    hooksEnabled, setHooksEnabled,
    hooksPath, setHooksPath,
    hooksToken, setHooksToken,
    hooksDefaultSessionKey, setHooksDefaultSessionKey,
    hooksAllowRequestSessionKey, setHooksAllowRequestSessionKey,
    hooksMaxBodyBytes, setHooksMaxBodyBytes,
    hooksTransformsDir, setHooksTransformsDir,
    uiSeamColor, setUiSeamColor,
  }

  return (
    <div className="absolute inset-0 flex bg-bg-base" style={{ display: visible ? undefined : 'none' }}>
      {/* ── Mobile nav toggle (visible only on mobile) ── */}
      <button
        onClick={() => setNavOpen(true)}
        className="md:hidden absolute top-3 left-3 z-30 flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors"
        aria-label="menu"
      >
        <Menu size={18} strokeWidth={1.8} />
      </button>

      {/* ── Mobile nav backdrop ── */}
      {navOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/55 z-40"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* ── Left: Nav tree ── */}
      <div className={cn(
        'w-[160px] shrink-0 border-r border-border-subtle flex flex-col bg-bg-canvas',
        // Mobile: slide-in drawer; Desktop: always visible
        'fixed md:relative inset-y-0 left-0 z-50 transition-transform duration-200',
        navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-4 border-b border-border-subtle whitespace-nowrap">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-brand-secondary shrink-0" strokeWidth={1.8} />
            <span className="text-[13px] font-semibold text-text-primary">{t('claw.title')}</span>
          </div>
          {/* Close button (mobile only) */}
          <button
            onClick={() => setNavOpen(false)}
            className="md:hidden text-text-tertiary hover:text-text-primary cursor-pointer shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-1 overflow-y-auto styled-scrollbar py-2">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActiveSection(key); setNavOpen(false) }}
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
        <div className="flex items-center justify-between px-5 py-3 pl-14 md:pl-5 border-b border-border-subtle bg-bg-canvas">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[15px] font-semibold text-text-primary truncate">
              {navItems.find((n) => n.key === activeSection)?.label}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => { loadConfig(); loadSessions() }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors duration-150 disabled:opacity-50"
            >
              <RefreshCw size={13} strokeWidth={1.8} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{t('claw.refresh')}</span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving || noSaveSections.includes(activeSection)}
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
        ) : activeSection === 'providers' ? (
          <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
            <AgentModelsPanel />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto styled-scrollbar">
          {activeSection === 'general' && (
            <GeneralPanel
              config={config}
              loading={loading}
              gatewayMode={gatewayMode}
              setGatewayMode={setGatewayMode}
              gatewayPort={gatewayPort}
              setGatewayPort={setGatewayPort}
              gatewayBind={gatewayBind}
              setGatewayBind={setGatewayBind}
              gatewayCustomBindHost={gatewayCustomBindHost} setGatewayCustomBindHost={setGatewayCustomBindHost}
              gatewayAllowRealIpFallback={gatewayAllowRealIpFallback} setGatewayAllowRealIpFallback={setGatewayAllowRealIpFallback}
              gatewayHandshakeTimeoutMs={gatewayHandshakeTimeoutMs} setGatewayHandshakeTimeoutMs={setGatewayHandshakeTimeoutMs}
              gatewayChannelHealthCheckMinutes={gatewayChannelHealthCheckMinutes} setGatewayChannelHealthCheckMinutes={setGatewayChannelHealthCheckMinutes}
              gatewayChannelStaleEventThresholdMinutes={gatewayChannelStaleEventThresholdMinutes} setGatewayChannelStaleEventThresholdMinutes={setGatewayChannelStaleEventThresholdMinutes}
              gatewayChannelMaxRestartsPerHour={gatewayChannelMaxRestartsPerHour} setGatewayChannelMaxRestartsPerHour={setGatewayChannelMaxRestartsPerHour}
              subagentsTimeout={subagentsTimeout}
              setSubagentsTimeout={setSubagentsTimeout}
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
              onDeleteSession={handleDeleteSession}
            />
          )}
          {activeSection === 'system' && (
            <AdvancedPanel {...advProps} group="system" />
          )}
          {activeSection === 'messaging' && (
            <AdvancedPanel {...advProps} group="messaging" />
          )}
          {activeSection === 'tools' && (
            <AdvancedPanel {...advProps} group="tools" />
          )}
          {activeSection === 'ai' && (
            <AdvancedPanel {...advProps} group="ai" />
          )}
          {activeSection === 'network' && (
            <AdvancedPanel {...advProps} group="network" />
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
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-brand-secondary">{icon}</span>
        <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="rounded-2xl bg-bg-surface border border-border-subtle p-4 md:p-5">
        {children}
      </div>
    </div>
  )
}

function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 py-3">
      <div className="flex-1 min-w-0 sm:pr-4">
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
  config, loading, gatewayMode, setGatewayMode,
  gatewayPort, setGatewayPort, gatewayBind, setGatewayBind,
  gatewayCustomBindHost, setGatewayCustomBindHost,
  gatewayAllowRealIpFallback, setGatewayAllowRealIpFallback,
  gatewayHandshakeTimeoutMs, setGatewayHandshakeTimeoutMs,
  gatewayChannelHealthCheckMinutes, setGatewayChannelHealthCheckMinutes,
  gatewayChannelStaleEventThresholdMinutes, setGatewayChannelStaleEventThresholdMinutes,
  gatewayChannelMaxRestartsPerHour, setGatewayChannelMaxRestartsPerHour,
  subagentsTimeout, setSubagentsTimeout,
}: {
  config: ClawConfig | null
  loading: boolean
  gatewayMode: string
  setGatewayMode: (v: string) => void
  gatewayPort: number
  setGatewayPort: (v: number) => void
  gatewayBind: string
  setGatewayBind: (v: string) => void
  gatewayCustomBindHost: string; setGatewayCustomBindHost: (v: string) => void
  gatewayAllowRealIpFallback: boolean; setGatewayAllowRealIpFallback: (v: boolean) => void
  gatewayHandshakeTimeoutMs: number; setGatewayHandshakeTimeoutMs: (v: number) => void
  gatewayChannelHealthCheckMinutes: number; setGatewayChannelHealthCheckMinutes: (v: number) => void
  gatewayChannelStaleEventThresholdMinutes: number; setGatewayChannelStaleEventThresholdMinutes: (v: number) => void
  gatewayChannelMaxRestartsPerHour: number; setGatewayChannelMaxRestartsPerHour: (v: number) => void
  subagentsTimeout: number
  setSubagentsTimeout: (v: number) => void
}) {
  if (loading && !config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-5 md:py-6 space-y-6">
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

          <SettingRow label={t('claw.gateway_port')} desc={t('claw.gateway_port_desc')}>
            <input
              type="number"
              min={0}
              max={65535}
              value={gatewayPort}
              onChange={(e) => setGatewayPort(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right font-mono"
            />
          </SettingRow>

          <SettingRow label={t('claw.gateway_bind')} desc={t('claw.gateway_bind_desc')}>
            <select
              value={gatewayBind}
              onChange={(e) => setGatewayBind(e.target.value)}
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
            >
              {['auto','lan','loopback','custom','tailnet'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </SettingRow>

          <SettingRow label={t('claw.gateway_auth_mode')}>
            <span className="text-[13px] text-text-secondary font-mono">
              {config?.gateway?.auth?.mode ?? '-'}
            </span>
          </SettingRow>

          {gatewayBind === 'custom' && (
            <SettingRow label={t('claw.gateway_custom_bind')} desc={t('claw.gateway_custom_bind_desc')}>
              <input
                type="text"
                value={gatewayCustomBindHost}
                onChange={(e) => setGatewayCustomBindHost(e.target.value)}
                placeholder="0.0.0.0"
                className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
              />
            </SettingRow>
          )}

          <SettingRow label={t('claw.gateway_real_ip')} desc={t('claw.gateway_real_ip_desc')}>
            <Toggle on={gatewayAllowRealIpFallback} onChange={setGatewayAllowRealIpFallback} />
          </SettingRow>

          <SettingRow label={t('claw.gateway_handshake_timeout')} desc={t('claw.gateway_handshake_timeout_desc')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={gatewayHandshakeTimeoutMs}
                onChange={(e) => setGatewayHandshakeTimeoutMs(Number(e.target.value) || 0)}
                className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
              />
              <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
            </div>
          </SettingRow>

          <SettingRow label={t('claw.gateway_health_check')} desc={t('claw.gateway_health_check_desc')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={gatewayChannelHealthCheckMinutes}
                onChange={(e) => setGatewayChannelHealthCheckMinutes(Number(e.target.value) || 0)}
                className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
              />
              <span className="text-[12px] text-text-tertiary">{t('claw.minutes')}</span>
            </div>
          </SettingRow>

          <SettingRow label={t('claw.gateway_stale_threshold')} desc={t('claw.gateway_stale_threshold_desc')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={gatewayChannelStaleEventThresholdMinutes}
                onChange={(e) => setGatewayChannelStaleEventThresholdMinutes(Number(e.target.value) || 0)}
                className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
              />
              <span className="text-[12px] text-text-tertiary">{t('claw.minutes')}</span>
            </div>
          </SettingRow>

          <SettingRow label={t('claw.gateway_max_restarts')} desc={t('claw.gateway_max_restarts_desc')}>
            <input
              type="number"
              min={0}
              value={gatewayChannelMaxRestartsPerHour}
              onChange={(e) => setGatewayChannelMaxRestartsPerHour(Number(e.target.value) || 0)}
              className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
          </SettingRow>

          <Divider />

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
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-5 md:py-6">
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
    </div>
  )
}

// ── Sessions panel ──

function SessionsPanel({
  sessions, totals, sessionsByAgent, expandedAgents, toggleAgent,
  clearing, clearConfirm, setClearConfirm, onClear, clearResult, onDeleteSession,
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
  onDeleteSession: (agentId: string, sessionKey: string) => void
}) {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-5 md:py-6">
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
                      <SessionRow key={s.sessionKey} session={s} onDelete={() => onDeleteSession(agentId, s.sessionKey)} />
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

function SessionRow({ session, onDelete }: { session: SessionSummary; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const statusColor = session.status === 'done' ? 'text-status-success'
    : session.status === 'error' || session.status === 'failed' ? 'text-red-400'
    : session.status === 'running' ? 'text-brand-primary'
    : 'text-text-tertiary'

  const dotColor = session.status === 'done' ? 'bg-status-success'
    : session.status === 'error' || session.status === 'failed' ? 'bg-red-400'
    : session.status === 'running' ? 'bg-brand-primary'
    : 'bg-text-quaternary'

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      onDelete()
    } finally {
      setDeleting(false)
      setConfirmDel(false)
    }
  }, [onDelete])

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-bg-elevated/30 transition-colors duration-100 text-left">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer text-left"
        >
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
          <span className="text-[12px] text-text-secondary truncate flex-1 font-mono">{session.sessionId.slice(0, 8)}</span>
          <span className={cn('text-[11px] shrink-0', statusColor)}>{session.status}</span>
          <span className="text-[11px] text-text-tertiary shrink-0 hidden md:inline">{formatTime(session.updatedAt)}</span>
          <span className="text-[12px] text-brand-secondary font-mono shrink-0">{formatTokens(session.totalTokens)}</span>
        </button>
        {/* Delete single session */}
        {confirmDel ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-[11px] text-red-400 hover:text-red-300 cursor-pointer px-1.5 py-0.5 rounded border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {deleting ? '...' : t('claw.mm_confirm')}
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              className="text-[11px] text-text-tertiary hover:text-text-primary cursor-pointer px-1.5 py-0.5 rounded transition-colors"
            >
              {t('claw.mm_cancel')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-text-tertiary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
            title={t('claw.delete_session')}
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        )}
      </div>

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
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-5 md:py-6">
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
    </div>
  )
}

// ── Advanced panel (logging / browser / update / session / diagnostics) ──

function AdvancedPanel(props: {
  config: ClawConfig | null
  loading: boolean
  group: 'system' | 'messaging' | 'tools' | 'ai' | 'network'
  // Logging + Update + Models Mode + Plugins (from GeneralPanel, for system/network groups)
  loggingLevel: string; setLoggingLevel: (v: string) => void
  loggingConsoleLevel: string; setLoggingConsoleLevel: (v: string) => void
  loggingConsoleStyle: string; setLoggingConsoleStyle: (v: string) => void
  loggingRedact: string; setLoggingRedact: (v: string) => void
  loggingFile: string; setLoggingFile: (v: string) => void
  loggingMaxFileBytes: number; setLoggingMaxFileBytes: (v: number) => void
  updateChannel: string; setUpdateChannel: (v: string) => void
  updateCheckOnStart: boolean; setUpdateCheckOnStart: (v: boolean) => void
  updateAutoEnabled: boolean; setUpdateAutoEnabled: (v: boolean) => void
  modelsMode: string; setModelsMode: (v: string) => void
  pluginsEnabled: boolean; setPluginsEnabled: (v: boolean) => void
  pluginsBundledDiscovery: string; setPluginsBundledDiscovery: (v: string) => void
  browserEnabled: boolean; setBrowserEnabled: (v: boolean) => void
  browserHeadless: boolean; setBrowserHeadless: (v: boolean) => void
  browserNoSandbox: boolean; setBrowserNoSandbox: (v: boolean) => void
  browserCdpUrl: string; setBrowserCdpUrl: (v: string) => void
  browserActionTimeout: number; setBrowserActionTimeout: (v: number) => void
  browserEvaluateEnabled: boolean; setBrowserEvaluateEnabled: (v: boolean) => void
  browserExecutablePath: string; setBrowserExecutablePath: (v: string) => void
  browserAttachOnly: boolean; setBrowserAttachOnly: (v: boolean) => void
  browserCdpPortRangeStart: number; setBrowserCdpPortRangeStart: (v: number) => void
  browserDefaultProfile: string; setBrowserDefaultProfile: (v: string) => void
  browserColor: string; setBrowserColor: (v: string) => void
  sessionMaxHistory: number; setSessionMaxHistory: (v: number) => void
  sessionCompactionThreshold: number; setSessionCompactionThreshold: (v: number) => void
  sessionScope: string; setSessionScope: (v: string) => void
  sessionIdleMinutes: number; setSessionIdleMinutes: (v: number) => void
  sessionDmScope: string; setSessionDmScope: (v: string) => void
  sessionStore: string; setSessionStore: (v: string) => void
  sessionTypingIntervalSeconds: number; setSessionTypingIntervalSeconds: (v: number) => void
  sessionTypingMode: string; setSessionTypingMode: (v: string) => void
  sessionMainKey: string; setSessionMainKey: (v: string) => void
  diagEnabled: boolean; setDiagEnabled: (v: boolean) => void
  diagStuckWarn: number; setDiagStuckWarn: (v: number) => void
  diagStuckAbort: number; setDiagStuckAbort: (v: number) => void
  diagMemoryPressureSnapshot: boolean; setDiagMemoryPressureSnapshot: (v: boolean) => void
  msgAckScope: string; setMsgAckScope: (v: string) => void
  msgSuppressToolErrors: boolean; setMsgSuppressToolErrors: (v: boolean) => void
  msgMessagePrefix: string; setMsgMessagePrefix: (v: string) => void
  msgResponsePrefix: string; setMsgResponsePrefix: (v: string) => void
  msgAckReaction: string; setMsgAckReaction: (v: string) => void
  msgRemoveAckAfterReply: boolean; setMsgRemoveAckAfterReply: (v: boolean) => void
  msgVisibleReplies: string; setMsgVisibleReplies: (v: string) => void
  msgResponseUsage: string; setMsgResponseUsage: (v: string) => void
  cmdText: boolean; setCmdText: (v: boolean) => void
  cmdBash: boolean; setCmdBash: (v: boolean) => void
  cmdConfig: boolean; setCmdConfig: (v: boolean) => void
  cmdRestart: boolean; setCmdRestart: (v: boolean) => void
  cmdNative: 'auto' | boolean; setCmdNative: (v: 'auto' | boolean) => void
  cmdNativeSkills: 'auto' | boolean; setCmdNativeSkills: (v: 'auto' | boolean) => void
  cmdBashForegroundMs: number; setCmdBashForegroundMs: (v: number) => void
  cmdMcp: boolean; setCmdMcp: (v: boolean) => void
  cmdPlugins: boolean; setCmdPlugins: (v: boolean) => void
  cmdDebug: boolean; setCmdDebug: (v: boolean) => void
  cmdUseAccessGroups: boolean; setCmdUseAccessGroups: (v: boolean) => void
  cmdOwnerDisplay: string; setCmdOwnerDisplay: (v: string) => void
  cronEnabled: boolean; setCronEnabled: (v: boolean) => void
  cronMaxConcurrent: number; setCronMaxConcurrent: (v: number) => void
  cronStore: string; setCronStore: (v: string) => void
  cronWebhook: string; setCronWebhook: (v: string) => void
  cronWebhookToken: string; setCronWebhookToken: (v: string) => void
  memoryBackend: string; setMemoryBackend: (v: string) => void
  memoryCitations: string; setMemoryCitations: (v: string) => void
  proxyEnabled: boolean; setProxyEnabled: (v: boolean) => void
  proxyUrl: string; setProxyUrl: (v: string) => void
  proxyLoopbackMode: string; setProxyLoopbackMode: (v: string) => void
  envShellEnvEnabled: boolean; setEnvShellEnvEnabled: (v: boolean) => void
  auditEnabled: boolean; setAuditEnabled: (v: boolean) => void
  toolsProfile: string; setToolsProfile: (v: string) => void
  toolsToolSearch: boolean; setToolsToolSearch: (v: boolean) => void
  toolsCodeMode: boolean; setToolsCodeMode: (v: boolean) => void
  talkProvider: string; setTalkProvider: (v: string) => void
  talkConsultThinkingLevel: string; setTalkConsultThinkingLevel: (v: string) => void
  talkConsultFastMode: boolean; setTalkConsultFastMode: (v: boolean) => void
  talkSpeechLocale: string; setTalkSpeechLocale: (v: string) => void
  talkInterruptOnSpeech: boolean; setTalkInterruptOnSpeech: (v: boolean) => void
  talkSilenceTimeoutMs: number; setTalkSilenceTimeoutMs: (v: number) => void
  webEnabled: boolean; setWebEnabled: (v: boolean) => void
  webHeartbeatSeconds: number; setWebHeartbeatSeconds: (v: number) => void
  mediaPreserveFilenames: boolean; setMediaPreserveFilenames: (v: boolean) => void
  mediaTtlHours: number; setMediaTtlHours: (v: number) => void
  mcpSessionIdleTtlMs: number; setMcpSessionIdleTtlMs: (v: number) => void
  transcriptsEnabled: boolean; setTranscriptsEnabled: (v: boolean) => void
  transcriptsMaxUtterances: number; setTranscriptsMaxUtterances: (v: number) => void
  commitmentsEnabled: boolean; setCommitmentsEnabled: (v: boolean) => void
  commitmentsMaxPerDay: number; setCommitmentsMaxPerDay: (v: number) => void
  broadcastStrategy: string; setBroadcastStrategy: (v: string) => void
  acpEnabled: boolean; setAcpEnabled: (v: boolean) => void
  acpBackend: string; setAcpBackend: (v: string) => void
  acpDefaultAgent: string; setAcpDefaultAgent: (v: string) => void
  acpMaxConcurrentSessions: number; setAcpMaxConcurrentSessions: (v: number) => void
  hooksEnabled: boolean; setHooksEnabled: (v: boolean) => void
  hooksPath: string; setHooksPath: (v: string) => void
  hooksToken: string; setHooksToken: (v: string) => void
  hooksDefaultSessionKey: string; setHooksDefaultSessionKey: (v: string) => void
  hooksAllowRequestSessionKey: boolean; setHooksAllowRequestSessionKey: (v: boolean) => void
  hooksMaxBodyBytes: number; setHooksMaxBodyBytes: (v: number) => void
  hooksTransformsDir: string; setHooksTransformsDir: (v: string) => void
  uiSeamColor: string; setUiSeamColor: (v: string) => void
}) {
  if (props.loading && !props.config) {
    return <div className="py-20 text-center text-[13px] text-text-tertiary">{t('claw.loading')}</div>
  }
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-5 md:py-6 space-y-6">
      {/* ── system group: Logging, Update, Diagnostics, Audit ── */}
      {props.group === 'system' && (<>
      {/* Logging */}
      <AdvancedSection icon={<Bug size={16} />} title={t('claw.adv_logging')}>
        <SettingRow label={t('claw.adv_log_level')} desc={t('claw.adv_log_level_desc')}>
          <select
            value={props.loggingLevel}
            onChange={(e) => props.setLoggingLevel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['silent','fatal','error','warn','info','debug','trace'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_console_level')}>
          <select
            value={props.loggingConsoleLevel}
            onChange={(e) => props.setLoggingConsoleLevel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['silent','fatal','error','warn','info','debug','trace'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_console_style')}>
          <select
            value={props.loggingConsoleStyle}
            onChange={(e) => props.setLoggingConsoleStyle(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['pretty','compact','json'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_redact')} desc={t('claw.adv_redact_desc')}>
          <select
            value={props.loggingRedact}
            onChange={(e) => props.setLoggingRedact(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['off','tools'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_log_file')} desc={t('claw.adv_log_file_desc')}>
          <input
            type="text"
            value={props.loggingFile}
            onChange={(e) => props.setLoggingFile(e.target.value)}
            placeholder="/var/log/openclaw.log"
            className="w-48 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_log_max_file')} desc={t('claw.adv_log_max_file_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.loggingMaxFileBytes}
              onChange={(e) => props.setLoggingMaxFileBytes(Number(e.target.value) || 0)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.bytes')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>

      {/* Update */}
      <AdvancedSection icon={<Download size={16} />} title={t('claw.adv_update')}>
        <SettingRow label={t('claw.adv_update_channel')}>
          <select
            value={props.updateChannel}
            onChange={(e) => props.setUpdateChannel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['stable','extended-stable','beta','dev'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_update_checkonstart')}>
          <Toggle on={props.updateCheckOnStart} onChange={props.setUpdateCheckOnStart} />
        </SettingRow>
        <SettingRow label={t('claw.adv_update_auto')} desc={t('claw.adv_update_auto_desc')}>
          <Toggle on={props.updateAutoEnabled} onChange={props.setUpdateAutoEnabled} />
        </SettingRow>
      </AdvancedSection>

      {/* Diagnostics */}
      <AdvancedSection icon={<Bug size={16} />} title={t('claw.adv_diagnostics')}>
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
        <SettingRow label={t('claw.adv_diag_mem_pressure')} desc={t('claw.adv_diag_mem_pressure_desc')}>
          <Toggle on={props.diagMemoryPressureSnapshot} onChange={props.setDiagMemoryPressureSnapshot} />
        </SettingRow>
      </AdvancedSection>

      {/* Audit */}
      <AdvancedSection icon={<ShieldAlert size={16} />} title={t('claw.adv_audit')}>
        <SettingRow label={t('claw.adv_audit_enabled')} desc={t('claw.adv_audit_enabled_desc')}>
          <Toggle on={props.auditEnabled} onChange={props.setAuditEnabled} />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── tools group: Browser, Tools, Web, Media, MCP ── */}
      {props.group === 'tools' && (<>

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
        <SettingRow label={t('claw.adv_browser_evaluate')} desc={t('claw.adv_browser_evaluate_desc')}>
          <Toggle on={props.browserEvaluateEnabled} onChange={props.setBrowserEvaluateEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_executable')} desc={t('claw.adv_browser_executable_desc')}>
          <input
            type="text"
            value={props.browserExecutablePath}
            onChange={(e) => props.setBrowserExecutablePath(e.target.value)}
            placeholder="/usr/bin/chromium"
            className="w-48 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_attach_only')} desc={t('claw.adv_browser_attach_only_desc')}>
          <Toggle on={props.browserAttachOnly} onChange={props.setBrowserAttachOnly} />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_cdp_port')} desc={t('claw.adv_browser_cdp_port_desc')}>
          <input
            type="number"
            min={0}
            value={props.browserCdpPortRangeStart}
            onChange={(e) => props.setBrowserCdpPortRangeStart(Number(e.target.value) || 0)}
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_default_profile')} desc={t('claw.adv_browser_default_profile_desc')}>
          <input
            type="text"
            value={props.browserDefaultProfile}
            onChange={(e) => props.setBrowserDefaultProfile(e.target.value)}
            placeholder="default"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_browser_color')} desc={t('claw.adv_browser_color_desc')}>
          <input
            type="text"
            value={props.browserColor}
            onChange={(e) => props.setBrowserColor(e.target.value)}
            placeholder="#C4915E"
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── messaging group: Session, Messages, Commands, Cron ── */}
      {props.group === 'messaging' && (<>

      {/* Session */}
      <AdvancedSection icon={<Clock size={16} />} title={t('claw.adv_session')}>
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
        <SettingRow label={t('claw.adv_session_scope')} desc={t('claw.adv_session_scope_desc')}>
          <select
            value={props.sessionScope}
            onChange={(e) => props.setSessionScope(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            <option value="per-sender">per-sender</option>
            <option value="global">global</option>
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_session_idle')} desc={t('claw.adv_session_idle_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.sessionIdleMinutes}
              onChange={(e) => props.setSessionIdleMinutes(Number(e.target.value) || 0)}
              className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.minutes')}</span>
          </div>
        </SettingRow>
        <SettingRow label={t('claw.adv_session_dm_scope')} desc={t('claw.adv_session_dm_scope_desc')}>
          <select
            value={props.sessionDmScope}
            onChange={(e) => props.setSessionDmScope(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['main','per-peer','per-channel-peer','per-account-channel-peer'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_session_store')} desc={t('claw.adv_session_store_desc')}>
          <input
            type="text"
            value={props.sessionStore}
            onChange={(e) => props.setSessionStore(e.target.value)}
            placeholder="sessions.json"
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_session_typing_mode')} desc={t('claw.adv_session_typing_mode_desc')}>
          <select
            value={props.sessionTypingMode}
            onChange={(e) => props.setSessionTypingMode(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['never','instant','thinking','message'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_session_typing_interval')} desc={t('claw.adv_session_typing_interval_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.sessionTypingIntervalSeconds}
              onChange={(e) => props.setSessionTypingIntervalSeconds(Number(e.target.value) || 0)}
              className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.seconds')}</span>
          </div>
        </SettingRow>
        <SettingRow label={t('claw.adv_session_main_key')} desc={t('claw.adv_session_main_key_desc')}>
          <input
            type="text"
            value={props.sessionMainKey}
            onChange={(e) => props.setSessionMainKey(e.target.value)}
            placeholder="main"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
      </AdvancedSection>

      {/* Messages */}
      <AdvancedSection icon={<MessageSquare size={16} />} title={t('claw.adv_messages')}>
        <SettingRow label={t('claw.adv_msg_ack_scope')} desc={t('claw.adv_msg_ack_scope_desc')}>
          <select
            value={props.msgAckScope}
            onChange={(e) => props.setMsgAckScope(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            <option value="group-mentions">group-mentions</option>
            <option value="group-all">group-all</option>
            <option value="direct">direct</option>
            <option value="all">all</option>
            <option value="off">off</option>
            <option value="none">none</option>
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_suppress_tool_errors')} desc={t('claw.adv_msg_suppress_tool_errors_desc')}>
          <Toggle on={props.msgSuppressToolErrors} onChange={props.setMsgSuppressToolErrors} />
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_prefix')} desc={t('claw.adv_msg_prefix_desc')}>
          <input
            type="text"
            value={props.msgMessagePrefix}
            onChange={(e) => props.setMsgMessagePrefix(e.target.value)}
            placeholder=""
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_response_prefix')} desc={t('claw.adv_msg_response_prefix_desc')}>
          <input
            type="text"
            value={props.msgResponsePrefix}
            onChange={(e) => props.setMsgResponsePrefix(e.target.value)}
            placeholder=""
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_ack_reaction')} desc={t('claw.adv_msg_ack_reaction_desc')}>
          <input
            type="text"
            value={props.msgAckReaction}
            onChange={(e) => props.setMsgAckReaction(e.target.value)}
            placeholder="👀"
            className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_remove_ack')} desc={t('claw.adv_msg_remove_ack_desc')}>
          <Toggle on={props.msgRemoveAckAfterReply} onChange={props.setMsgRemoveAckAfterReply} />
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_visible_replies')} desc={t('claw.adv_msg_visible_replies_desc')}>
          <select
            value={props.msgVisibleReplies}
            onChange={(e) => props.setMsgVisibleReplies(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['automatic','message_tool','true','false'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_msg_response_usage')} desc={t('claw.adv_msg_response_usage_desc')}>
          <select
            value={props.msgResponseUsage}
            onChange={(e) => props.setMsgResponseUsage(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['off','on','tokens','full'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* Commands */}
      <AdvancedSection icon={<SlidersHorizontal size={16} />} title={t('claw.adv_commands')}>
        <SettingRow label={t('claw.adv_cmd_text')} desc={t('claw.adv_cmd_text_desc')}>
          <Toggle on={props.cmdText} onChange={props.setCmdText} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_bash')} desc={t('claw.adv_cmd_bash_desc')}>
          <Toggle on={props.cmdBash} onChange={props.setCmdBash} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_config')} desc={t('claw.adv_cmd_config_desc')}>
          <Toggle on={props.cmdConfig} onChange={props.setCmdConfig} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_restart')} desc={t('claw.adv_cmd_restart_desc')}>
          <Toggle on={props.cmdRestart} onChange={props.setCmdRestart} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_native')} desc={t('claw.adv_cmd_native_desc')}>
          <select
            value={String(props.cmdNative)}
            onChange={(e) => props.setCmdNative(e.target.value === 'auto' ? 'auto' : e.target.value === 'true')}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            <option value="auto">auto</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_native_skills')} desc={t('claw.adv_cmd_native_skills_desc')}>
          <select
            value={String(props.cmdNativeSkills)}
            onChange={(e) => props.setCmdNativeSkills(e.target.value === 'auto' ? 'auto' : e.target.value === 'true')}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            <option value="auto">auto</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_bash_fg')} desc={t('claw.adv_cmd_bash_fg_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.cmdBashForegroundMs}
              onChange={(e) => props.setCmdBashForegroundMs(Number(e.target.value) || 0)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_mcp')} desc={t('claw.adv_cmd_mcp_desc')}>
          <Toggle on={props.cmdMcp} onChange={props.setCmdMcp} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_plugins')} desc={t('claw.adv_cmd_plugins_desc')}>
          <Toggle on={props.cmdPlugins} onChange={props.setCmdPlugins} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_debug')} desc={t('claw.adv_cmd_debug_desc')}>
          <Toggle on={props.cmdDebug} onChange={props.setCmdDebug} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_access_groups')} desc={t('claw.adv_cmd_access_groups_desc')}>
          <Toggle on={props.cmdUseAccessGroups} onChange={props.setCmdUseAccessGroups} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cmd_owner_display')} desc={t('claw.adv_cmd_owner_display_desc')}>
          <select
            value={props.cmdOwnerDisplay}
            onChange={(e) => props.setCmdOwnerDisplay(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['raw','hash'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* Cron */}
      <AdvancedSection icon={<RefreshCw size={16} />} title={t('claw.adv_cron')}>
        <SettingRow label={t('claw.adv_cron_enabled')} desc={t('claw.adv_cron_enabled_desc')}>
          <Toggle on={props.cronEnabled} onChange={props.setCronEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_cron_max_concurrent')} desc={t('claw.adv_cron_max_concurrent_desc')}>
          <input
            type="number"
            min={1}
            value={props.cronMaxConcurrent}
            onChange={(e) => props.setCronMaxConcurrent(Number(e.target.value) || 1)}
            className="w-20 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_cron_store')} desc={t('claw.adv_cron_store_desc')}>
          <input
            type="text"
            value={props.cronStore}
            onChange={(e) => props.setCronStore(e.target.value)}
            placeholder="cron.json"
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_cron_webhook')} desc={t('claw.adv_cron_webhook_desc')}>
          <input
            type="text"
            value={props.cronWebhook}
            onChange={(e) => props.setCronWebhook(e.target.value)}
            placeholder="https://..."
            className="w-48 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_cron_webhook_token')} desc={t('claw.adv_cron_webhook_token_desc')}>
          <input
            type="password"
            value={props.cronWebhookToken}
            onChange={(e) => props.setCronWebhookToken(e.target.value)}
            placeholder="••••"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── network group: Memory, Proxy, Env, Hooks, UI ── */}
      {props.group === 'network' && (<>

      {/* Memory */}
      <AdvancedSection icon={<Cpu size={16} />} title={t('claw.adv_memory')}>
        <SettingRow label={t('claw.adv_memory_backend')} desc={t('claw.adv_memory_backend_desc')}>
          <select
            value={props.memoryBackend}
            onChange={(e) => props.setMemoryBackend(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            <option value="builtin">builtin</option>
            <option value="qmd">qmd</option>
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_memory_citations')} desc={t('claw.adv_memory_citations_desc')}>
          <select
            value={props.memoryCitations}
            onChange={(e) => props.setMemoryCitations(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['auto','on','off'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* Proxy */}
      <AdvancedSection icon={<Globe size={16} />} title={t('claw.adv_proxy')}>
        <SettingRow label={t('claw.adv_proxy_enabled')} desc={t('claw.adv_proxy_enabled_desc')}>
          <Toggle on={props.proxyEnabled} onChange={props.setProxyEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_proxy_url')} desc={t('claw.adv_proxy_url_desc')}>
          <input
            type="text"
            value={props.proxyUrl}
            onChange={(e) => props.setProxyUrl(e.target.value)}
            placeholder="http://proxy:8080"
            className="w-48 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_proxy_loopback')} desc={t('claw.adv_proxy_loopback_desc')}>
          <select
            value={props.proxyLoopbackMode}
            onChange={(e) => props.setProxyLoopbackMode(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['gateway-only','proxy','block'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* Env */}
      <AdvancedSection icon={<SlidersHorizontal size={16} />} title={t('claw.adv_env')}>
        <SettingRow label={t('claw.adv_env_shell_env')} desc={t('claw.adv_env_shell_env_desc')}>
          <Toggle on={props.envShellEnvEnabled} onChange={props.setEnvShellEnvEnabled} />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── tools group (cont): Tools, Web, Media, MCP ── */}
      {props.group === 'tools' && (<>

      {/* Tools */}
      <AdvancedSection icon={<Wrench size={16} />} title={t('claw.adv_tools')}>
        <SettingRow label={t('claw.adv_tools_profile')} desc={t('claw.adv_tools_profile_desc')}>
          <select
            value={props.toolsProfile}
            onChange={(e) => props.setToolsProfile(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['minimal','coding','messaging','full'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_tools_search')} desc={t('claw.adv_tools_search_desc')}>
          <Toggle on={props.toolsToolSearch} onChange={props.setToolsToolSearch} />
        </SettingRow>
        <SettingRow label={t('claw.adv_tools_code_mode')} desc={t('claw.adv_tools_code_mode_desc')}>
          <Toggle on={props.toolsCodeMode} onChange={props.setToolsCodeMode} />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── ai group: Talk, Transcripts, Commitments, Broadcast, ACP ── */}
      {props.group === 'ai' && (<>

      {/* Talk */}
      <AdvancedSection icon={<MessageCircle size={16} />} title={t('claw.adv_talk')}>
        <SettingRow label={t('claw.adv_talk_provider')} desc={t('claw.adv_talk_provider_desc')}>
          <input
            type="text"
            value={props.talkProvider}
            onChange={(e) => props.setTalkProvider(e.target.value)}
            placeholder="openai"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_talk_consult_thinking')} desc={t('claw.adv_talk_consult_thinking_desc')}>
          <select
            value={props.talkConsultThinkingLevel}
            onChange={(e) => props.setTalkConsultThinkingLevel(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['off','minimal','low','medium','high','xhigh','adaptive','max','ultra'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
        <SettingRow label={t('claw.adv_talk_consult_fast')} desc={t('claw.adv_talk_consult_fast_desc')}>
          <Toggle on={props.talkConsultFastMode} onChange={props.setTalkConsultFastMode} />
        </SettingRow>
        <SettingRow label={t('claw.adv_talk_speech_locale')} desc={t('claw.adv_talk_speech_locale_desc')}>
          <input
            type="text"
            value={props.talkSpeechLocale}
            onChange={(e) => props.setTalkSpeechLocale(e.target.value)}
            placeholder="en-US"
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_talk_interrupt')} desc={t('claw.adv_talk_interrupt_desc')}>
          <Toggle on={props.talkInterruptOnSpeech} onChange={props.setTalkInterruptOnSpeech} />
        </SettingRow>
        <SettingRow label={t('claw.adv_talk_silence_timeout')} desc={t('claw.adv_talk_silence_timeout_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.talkSilenceTimeoutMs}
              onChange={(e) => props.setTalkSilenceTimeoutMs(Number(e.target.value) || 0)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── tools group (cont): Web, Media, MCP ── */}
      {props.group === 'tools' && (<>

      {/* Web */}
      <AdvancedSection icon={<Globe size={16} />} title={t('claw.adv_web')}>
        <SettingRow label={t('claw.adv_web_enabled')} desc={t('claw.adv_web_enabled_desc')}>
          <Toggle on={props.webEnabled} onChange={props.setWebEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_web_heartbeat')} desc={t('claw.adv_web_heartbeat_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.webHeartbeatSeconds}
              onChange={(e) => props.setWebHeartbeatSeconds(Number(e.target.value) || 0)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.s')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>

      {/* Media */}
      <AdvancedSection icon={<Image size={16} />} title={t('claw.adv_media')}>
        <SettingRow label={t('claw.adv_media_preserve_filenames')} desc={t('claw.adv_media_preserve_filenames_desc')}>
          <Toggle on={props.mediaPreserveFilenames} onChange={props.setMediaPreserveFilenames} />
        </SettingRow>
        <SettingRow label={t('claw.adv_media_ttl')} desc={t('claw.adv_media_ttl_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.mediaTtlHours}
              onChange={(e) => props.setMediaTtlHours(Number(e.target.value) || 0)}
              className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.hours')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>

      {/* MCP */}
      <AdvancedSection icon={<Plug size={16} />} title={t('claw.adv_mcp')}>
        <SettingRow label={t('claw.adv_mcp_idle_ttl')} desc={t('claw.adv_mcp_idle_ttl_desc')}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={props.mcpSessionIdleTtlMs}
              onChange={(e) => props.setMcpSessionIdleTtlMs(Number(e.target.value) || 0)}
              className="w-28 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
            />
            <span className="text-[12px] text-text-tertiary">{t('claw.ms')}</span>
          </div>
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── ai group (cont): Transcripts, Commitments, Broadcast, ACP ── */}
      {props.group === 'ai' && (<>

      {/* Transcripts */}
      <AdvancedSection icon={<FileText size={16} />} title={t('claw.adv_transcripts')}>
        <SettingRow label={t('claw.adv_transcripts_enabled')} desc={t('claw.adv_transcripts_enabled_desc')}>
          <Toggle on={props.transcriptsEnabled} onChange={props.setTranscriptsEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_transcripts_max_utterances')} desc={t('claw.adv_transcripts_max_utterances_desc')}>
          <input
            type="number"
            min={0}
            value={props.transcriptsMaxUtterances}
            onChange={(e) => props.setTranscriptsMaxUtterances(Number(e.target.value) || 0)}
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
      </AdvancedSection>

      {/* Commitments */}
      <AdvancedSection icon={<CheckSquare size={16} />} title={t('claw.adv_commitments')}>
        <SettingRow label={t('claw.adv_commitments_enabled')} desc={t('claw.adv_commitments_enabled_desc')}>
          <Toggle on={props.commitmentsEnabled} onChange={props.setCommitmentsEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_commitments_max_per_day')} desc={t('claw.adv_commitments_max_per_day_desc')}>
          <input
            type="number"
            min={0}
            value={props.commitmentsMaxPerDay}
            onChange={(e) => props.setCommitmentsMaxPerDay(Number(e.target.value) || 0)}
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
      </AdvancedSection>

      {/* Broadcast */}
      <AdvancedSection icon={<Radio size={16} />} title={t('claw.adv_broadcast')}>
        <SettingRow label={t('claw.adv_broadcast_strategy')} desc={t('claw.adv_broadcast_strategy_desc')}>
          <select
            value={props.broadcastStrategy}
            onChange={(e) => props.setBroadcastStrategy(e.target.value)}
            className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none focus:border-brand-primary"
          >
            {['parallel','sequential'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </SettingRow>
      </AdvancedSection>

      {/* ACP */}
      <AdvancedSection icon={<Network size={16} />} title={t('claw.adv_acp')}>
        <SettingRow label={t('claw.adv_acp_enabled')} desc={t('claw.adv_acp_enabled_desc')}>
          <Toggle on={props.acpEnabled} onChange={props.setAcpEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_acp_backend')} desc={t('claw.adv_acp_backend_desc')}>
          <input
            type="text"
            value={props.acpBackend}
            onChange={(e) => props.setAcpBackend(e.target.value)}
            placeholder="openclaw"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_acp_default_agent')} desc={t('claw.adv_acp_default_agent_desc')}>
          <input
            type="text"
            value={props.acpDefaultAgent}
            onChange={(e) => props.setAcpDefaultAgent(e.target.value)}
            placeholder=""
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_acp_max_sessions')} desc={t('claw.adv_acp_max_sessions_desc')}>
          <input
            type="number"
            min={0}
            value={props.acpMaxConcurrentSessions}
            onChange={(e) => props.setAcpMaxConcurrentSessions(Number(e.target.value) || 0)}
            className="w-24 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
      </AdvancedSection>
      </>)}

      {/* ── network group (cont): Hooks, UI ── */}
      {props.group === 'network' && (<>

      {/* Hooks */}
      <AdvancedSection icon={<Webhook size={16} />} title={t('claw.adv_hooks')}>
        <SettingRow label={t('claw.adv_hooks_enabled')} desc={t('claw.adv_hooks_enabled_desc')}>
          <Toggle on={props.hooksEnabled} onChange={props.setHooksEnabled} />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_path')} desc={t('claw.adv_hooks_path_desc')}>
          <input
            type="text"
            value={props.hooksPath}
            onChange={(e) => props.setHooksPath(e.target.value)}
            placeholder="hooks"
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_token')} desc={t('claw.adv_hooks_token_desc')}>
          <input
            type="password"
            value={props.hooksToken}
            onChange={(e) => props.setHooksToken(e.target.value)}
            placeholder="••••"
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_default_session_key')} desc={t('claw.adv_hooks_default_session_key_desc')}>
          <input
            type="text"
            value={props.hooksDefaultSessionKey}
            onChange={(e) => props.setHooksDefaultSessionKey(e.target.value)}
            placeholder=""
            className="w-32 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_allow_request_session_key')} desc={t('claw.adv_hooks_allow_request_session_key_desc')}>
          <Toggle on={props.hooksAllowRequestSessionKey} onChange={props.setHooksAllowRequestSessionKey} />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_max_body_bytes')} desc={t('claw.adv_hooks_max_body_bytes_desc')}>
          <input
            type="number"
            min={0}
            value={props.hooksMaxBodyBytes}
            onChange={(e) => props.setHooksMaxBodyBytes(Number(e.target.value) || 0)}
            className="w-28 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary text-right"
          />
        </SettingRow>
        <SettingRow label={t('claw.adv_hooks_transforms_dir')} desc={t('claw.adv_hooks_transforms_dir_desc')}>
          <input
            type="text"
            value={props.hooksTransformsDir}
            onChange={(e) => props.setHooksTransformsDir(e.target.value)}
            placeholder="transforms"
            className="w-40 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
      </AdvancedSection>

      {/* UI */}
      <AdvancedSection icon={<Palette size={16} />} title={t('claw.adv_ui')}>
        <SettingRow label={t('claw.adv_ui_seam_color')} desc={t('claw.adv_ui_seam_color_desc')}>
          <input
            type="text"
            value={props.uiSeamColor}
            onChange={(e) => props.setUiSeamColor(e.target.value)}
            placeholder="#000000"
            className="w-28 bg-bg-elevated border border-border-subtle rounded-lg px-3 py-1.5 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
          />
        </SettingRow>
      </AdvancedSection>
      </>)}
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
