// React-native model (LLM provider) management panel embedded in ClawSettingsView.
// Replaces the iframe-based model-manager.html with a first-class React component.
// Talks to the same /models/_api/* backend endpoints.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Edit3, Trash2, Download, Upload, X, Cpu,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiUrl } from '@/utils/api-base'
import { t } from '@/i18n'

// ── Types (mirror editor/model/types.ts) ──

interface ModelCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

interface ModelConfig {
  id: string
  name?: string
  input?: string[]
  cost?: ModelCost
  contextWindow?: number
  maxTokens?: number
  api?: string
}

interface ProviderConfig {
  baseUrl: string
  apiKey?: string
  api?: string
  models?: ModelConfig[]
}

type ProvidersMap = Record<string, ProviderConfig>
type ImportMode = 'append' | 'new' | 'replace'

interface ApiResult {
  success?: boolean
  providers?: ProvidersMap
  defaultModel?: string
  file?: { providers: ProvidersMap }
  error?: string
  code?: string
}

const PROVIDER_ID_PATTERN = /^[a-z0-9_-]+$/

const API_TYPES = [
  'openai-completions',
  'openai-responses',
  'openai-chatgpt-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'bedrock-converse-stream',
  'ollama',
  'cerebras-native',
  'deepseek-native',
  'chutes-native',
]

// ── API helper ──

async function apiPost(route: string, body: unknown): Promise<ApiResult> {
  const resp = await fetch(apiUrl(`/models/_api/${route}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return (await resp.json()) as ApiResult
}

function maskKey(key: string): string {
  if (!key) return '—'
  if (key.startsWith('${')) return key
  if (key.length <= 8) return '•'.repeat(key.length)
  return key.slice(0, 4) + '•'.repeat(Math.max(4, key.length - 8)) + key.slice(-4)
}

// ── Main component ──

export function ModelPanel() {
  const [providers, setProviders] = useState<ProvidersMap>({})
  const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Modals
  const [providerModal, setProviderModal] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null })
  const [modelModal, setModelModal] = useState<{ open: boolean; modelId: string | null }>({ open: false, modelId: null })
  const [importModal, setImportModal] = useState(false)
  const [confirm, setConfirm] = useState<{ title: string; message: string; onOk: () => void } | null>(null)

  // Toast
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  // Load
  const load = useCallback(async () => {
    const res = await apiPost('load', {})
    if (res.providers) {
      setProviders(res.providers)
      setDefaultModel(res.defaultModel)
      const ids = Object.keys(res.providers)
      if (!activeProviderId || !res.providers[activeProviderId]) {
        setActiveProviderId(ids[0] ?? null)
      }
    }
    setLoaded(true)
  }, [activeProviderId])

  useEffect(() => { load() }, [load])

  // ── Actions ──

  const getAllModelRefs = useCallback(() => {
    const refs: string[] = []
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of p.models ?? []) refs.push(`${pid}/${m.id}`)
    }
    return refs
  }, [providers])

  const handleSetDefaultModel = useCallback(async (ref: string | undefined) => {
    const res = await apiPost('set-default', { modelRef: ref ?? '' })
    if (res.success) {
      setDefaultModel(res.defaultModel)
      showToast(t('claw.mm_default_updated'))
    } else {
      showToast(t('claw.mm_default_failed'), true)
    }
  }, [showToast])

  const handleSaveProvider = useCallback(async (id: string, provider: ProviderConfig, editId: string | null) => {
    if (!id) { showToast(t('claw.mm_id_empty'), true); return false }
    if (!PROVIDER_ID_PATTERN.test(id)) { showToast(t('claw.mm_id_invalid'), true); return false }
    if (!provider.baseUrl) { showToast(t('claw.mm_url_empty'), true); return false }
    let res: ApiResult
    if (editId) {
      res = await apiPost('update-provider', { id: editId, provider })
    } else {
      res = await apiPost('add-provider', { id, provider })
    }
    if (res.success && res.providers) {
      setProviders(res.providers)
      if (!editId) setActiveProviderId(id)
      showToast(editId ? t('claw.mm_saved') : t('claw.mm_added'))
      return true
    }
    showToast(t('claw.mm_op_failed'), true)
    return false
  }, [showToast])

  const handleDeleteProvider = useCallback((id: string) => {
    setConfirm({
      title: t('claw.mm_delete_provider'),
      message: t('claw.mm_delete_provider_confirm').replace('{id}', id),
      onOk: async () => {
        const res = await apiPost('delete-provider', { id })
        if (res.success && res.providers) {
          setProviders(res.providers)
          if (activeProviderId === id) {
            setActiveProviderId(Object.keys(res.providers)[0] ?? null)
          }
          showToast(t('claw.mm_deleted'))
        } else {
          showToast(t('claw.mm_delete_failed'), true)
        }
        setConfirm(null)
      },
    })
  }, [activeProviderId, showToast])

  const handleSaveModel = useCallback(async (providerId: string, model: ModelConfig, editModelId: string | null) => {
    if (!model.id) { showToast(t('claw.mm_model_id_empty'), true); return false }
    let res: ApiResult
    if (editModelId) {
      res = await apiPost('update-model', { providerId, modelId: editModelId, model })
    } else {
      res = await apiPost('add-model', { providerId, model })
    }
    if (res.success && res.providers) {
      setProviders(res.providers)
      showToast(editModelId ? t('claw.mm_saved') : t('claw.mm_added'))
      return true
    }
    showToast(t('claw.mm_op_failed'), true)
    return false
  }, [showToast])

  const handleDeleteModel = useCallback((providerId: string, modelId: string) => {
    setConfirm({
      title: t('claw.mm_delete_model'),
      message: t('claw.mm_delete_model_confirm').replace('{id}', modelId),
      onOk: async () => {
        const res = await apiPost('delete-model', { providerId, modelId })
        if (res.success && res.providers) {
          setProviders(res.providers)
          showToast(t('claw.mm_deleted'))
        } else {
          showToast(t('claw.mm_delete_failed'), true)
        }
        setConfirm(null)
      },
    })
  }, [showToast])

  const handleImport = useCallback(async (jsonText: string, mode: ImportMode) => {
    let file: { providers: ProvidersMap }
    try {
      file = JSON.parse(jsonText)
    } catch {
      showToast(t('claw.mm_json_parse_failed'), true)
      return false
    }
    if (!file.providers || typeof file.providers !== 'object') {
      showToast(t('claw.mm_no_providers'), true)
      return false
    }
    const res = await apiPost('import', { file, mode })
    if (res.success && res.providers) {
      setProviders(res.providers)
      showToast(t('claw.mm_import_success'))
      return true
    }
    showToast(t('claw.mm_import_failed'), true)
    return false
  }, [showToast])

  const handleExport = useCallback(async () => {
    const res = await apiPost('export', {})
    if (!res.file) { showToast(t('claw.mm_export_failed'), true); return }
    const blob = new Blob([JSON.stringify(res.file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'openclaw-models.json'
    a.click()
    URL.revokeObjectURL(url)
    showToast(t('claw.mm_exported'))
  }, [showToast])

  const providerIds = Object.keys(providers)
  const activeProvider = activeProviderId ? providers[activeProviderId] : null

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left: Provider list (width fits content: title + add button) ── */}
      <div className="w-fit shrink-0 border-r border-border-subtle flex flex-col bg-bg-canvas">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-subtle whitespace-nowrap">
          <span className="text-[13px] font-semibold text-text-primary">{t('claw.mm_provider_list')}</span>
          <button
            onClick={() => setProviderModal({ open: true, editId: null })}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-gradient-to-br from-[#C4915E] to-[#D4A574] text-black hover:brightness-110 cursor-pointer transition-all whitespace-nowrap"
          >
            <Plus size={12} strokeWidth={2.5} />
            {t('claw.mm_add')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto styled-scrollbar p-2">
          {providerIds.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-text-tertiary">{t('claw.mm_no_providers')}</div>
          ) : (
            providerIds.map((id) => {
              const p = providers[id]
              const count = p.models?.length ?? 0
              return (
                <button
                  key={id}
                  onClick={() => setActiveProviderId(id)}
                  className={cn(
                    'block w-full text-left px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors duration-100 border whitespace-nowrap',
                    activeProviderId === id
                      ? 'bg-[rgba(212,165,116,0.10)] border-[rgba(212,165,116,0.45)]'
                      : 'border-transparent hover:bg-bg-elevated/40',
                  )}
                >
                  <div className="text-[13px] text-text-primary font-medium">{id}</div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-text-tertiary font-mono">{id}</span>
                    <span className="text-[10px] text-text-tertiary bg-bg-elevated rounded-full px-1.5 min-w-[18px] text-center">{count}</span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: Detail ── */}
      <div className="flex-1 min-w-0 overflow-y-auto styled-scrollbar px-6 py-5">
        {/* Default model selector + Import/Export buttons in one row */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 mb-5 bg-bg-surface border border-[rgba(212,165,116,0.3)] rounded-xl">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-text-primary">{t('claw.mm_default_model')}</span>
            <span className="text-[11px] text-text-tertiary">{t('claw.mm_default_model_hint')}</span>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={defaultModel ?? ''}
              onChange={(e) => handleSetDefaultModel(e.target.value || undefined)}
              className="min-w-[240px] bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary font-mono cursor-pointer outline-none focus:border-brand-primary"
            >
              <option value="">{t('claw.mm_not_set')}</option>
              {getAllModelRefs().map((ref) => (
                <option key={ref} value={ref}>{ref}</option>
              ))}
            </select>
            <button
              onClick={() => setImportModal(true)}
              title={t('claw.mm_import')}
              className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors border border-border-subtle"
            >
              <Upload size={14} strokeWidth={1.8} />
            </button>
            <button
              onClick={handleExport}
              title={t('claw.mm_export')}
              className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-colors border border-border-subtle"
            >
              <Download size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* Provider detail or empty */}
        {!activeProvider || !activeProviderId ? (
          <div className="flex items-center justify-center py-20 text-[13px] text-text-tertiary">
            {loaded ? t('claw.mm_empty_hint') : t('claw.loading')}
          </div>
        ) : (
          <div>
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[20px] font-bold text-text-primary">{activeProviderId}</span>
                <span className="text-[11px] text-text-tertiary font-mono bg-bg-elevated px-2 py-0.5 rounded-md">{activeProviderId}</span>
                <span className="text-[11px] text-brand-secondary border border-[rgba(212,165,116,0.3)] px-2 py-0.5 rounded-md">
                  {activeProvider.api || '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setProviderModal({ open: true, editId: activeProviderId })}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer transition-colors border border-border-subtle"
                >
                  <Edit3 size={12} strokeWidth={1.8} />
                  {t('claw.mm_edit')}
                </button>
                <button
                  onClick={() => handleDeleteProvider(activeProviderId)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer transition-colors"
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                  {t('claw.mm_delete')}
                </button>
                <button
                  onClick={() => setModelModal({ open: true, modelId: null })}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-black bg-gradient-to-br from-[#C4915E] to-[#D4A574] hover:brightness-110 cursor-pointer transition-all"
                >
                  <Plus size={12} strokeWidth={2.5} />
                  {t('claw.mm_add_model')}
                </button>
              </div>
            </div>

            {/* Meta */}
            <div className="bg-bg-surface border border-border-subtle rounded-xl px-4 py-3 mb-6">
              <div className="flex gap-3 py-1 text-[13px]">
                <span className="text-text-tertiary w-[90px] shrink-0">Base URL</span>
                <span className="text-text-primary font-mono break-all">{activeProvider.baseUrl || '—'}</span>
              </div>
              <div className="flex gap-3 py-1 text-[13px]">
                <span className="text-text-tertiary w-[90px] shrink-0">API Key</span>
                <span className="text-text-primary font-mono break-all">{maskKey(activeProvider.apiKey || '')}</span>
              </div>
            </div>

            {/* Model list */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[14px] font-semibold text-text-primary">{t('claw.mm_model_list')}</span>
              <span className="text-[11px] text-text-tertiary bg-bg-elevated rounded-full px-2 min-w-[18px] text-center">
                {activeProvider.models?.length ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {(activeProvider.models ?? []).length === 0 ? (
                <div className="py-8 text-center text-[12px] text-text-tertiary">{t('claw.mm_no_models')}</div>
              ) : (
                (activeProvider.models ?? []).map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-bg-surface border border-border-subtle rounded-xl hover:border-border-default transition-colors">
                    <div>
                      <div className="text-[14px] text-text-primary font-mono font-medium">{m.id}</div>
                      <div className="text-[12px] text-text-tertiary mt-0.5">
                        {m.name || ''}
                        {m.contextWindow ? ` · ${m.contextWindow} ctx` : ''}
                        {m.maxTokens ? ` · ${m.maxTokens} out` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModelModal({ open: true, modelId: m.id })}
                        className="w-[30px] h-[30px] flex items-center justify-center rounded-md border border-border-subtle text-text-tertiary hover:bg-bg-elevated hover:text-text-primary cursor-pointer transition-colors"
                      >
                        <Edit3 size={13} strokeWidth={1.8} />
                      </button>
                      <button
                        onClick={() => handleDeleteModel(activeProviderId, m.id)}
                        className="w-[30px] h-[30px] flex items-center justify-center rounded-md border border-red-500/30 text-text-tertiary hover:bg-red-500/10 hover:text-red-400 cursor-pointer transition-colors"
                      >
                        <Trash2 size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Provider modal ── */}
      {providerModal.open && (
        <ProviderModal
          editId={providerModal.editId}
          provider={providerModal.editId ? providers[providerModal.editId] : null}
          onClose={() => setProviderModal({ open: false, editId: null })}
          onSave={async (id, provider) => {
            const ok = await handleSaveProvider(id, provider, providerModal.editId)
            if (ok) setProviderModal({ open: false, editId: null })
          }}
        />
      )}

      {/* ── Model modal ── */}
      {modelModal.open && activeProviderId && (
        <ModelModal
          modelId={modelModal.modelId}
          model={modelModal.modelId && activeProvider ? (activeProvider.models ?? []).find((m) => m.id === modelModal.modelId) ?? null : null}
          onClose={() => setModelModal({ open: false, modelId: null })}
          onSave={async (model) => {
            const ok = await handleSaveModel(activeProviderId, model, modelModal.modelId)
            if (ok) setModelModal({ open: false, modelId: null })
          }}
        />
      )}

      {/* ── Import modal ── */}
      {importModal && (
        <ImportModal
          onClose={() => setImportModal(false)}
          onImport={async (json, mode) => {
            const ok = await handleImport(json, mode)
            if (ok) setImportModal(false)
          }}
        />
      )}

      {/* ── Confirm dialog ── */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onOk={confirm.onOk}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-7 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-[13px] z-[1200] border shadow-lg transition-all',
            toast.error
              ? 'border-red-500/50 text-red-400 bg-bg-surface'
              : 'border-[rgba(212,165,116,0.45)] text-text-primary bg-bg-surface',
          )}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ── Provider modal ──

function ProviderModal({
  editId, provider, onClose, onSave,
}: {
  editId: string | null
  provider: ProviderConfig | null
  onClose: () => void
  onSave: (id: string, provider: ProviderConfig) => void
}) {
  const [id, setId] = useState(editId ?? '')
  const [api, setApi] = useState(provider?.api ?? 'openai-completions')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? '')

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1000]">
      <div className="w-[480px] max-w-[92vw] max-h-[88vh] overflow-y-auto bg-bg-surface border border-border-subtle rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <span className="text-[15px] font-semibold text-text-primary">
            {editId ? t('claw.mm_edit_provider') : t('claw.mm_add_provider')}
          </span>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_provider_id')}</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              disabled={!!editId}
              placeholder="openai / ollama / my-provider"
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary disabled:opacity-50"
            />
            <small className="text-text-tertiary text-[11px]">{t('claw.mm_provider_id_hint')}</small>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_api_type')}</span>
            <select
              value={api}
              onChange={(e) => setApi(e.target.value)}
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
            >
              {API_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">API Key</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="${API_KEY} 或 ${input:secret-name}"
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
            />
            <small className="text-text-tertiary text-[11px]">{t('claw.mm_api_key_hint')}</small>
          </label>
        </div>
        <div className="flex justify-end gap-2.5 px-5 py-4 border-t border-border-subtle">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer border border-border-subtle">
            {t('claw.mm_cancel')}
          </button>
          <button
            onClick={() => onSave(id.trim(), { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), api })}
            className="px-4 py-1.5 rounded-lg text-[13px] font-semibold text-black bg-gradient-to-br from-[#C4915E] to-[#D4A574] hover:brightness-110 cursor-pointer transition-all"
          >
            {t('claw.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Model modal ──

function ModelModal({
  modelId, model, onClose, onSave,
}: {
  modelId: string | null
  model: ModelConfig | null
  onClose: () => void
  onSave: (model: ModelConfig) => void
}) {
  const [id, setId] = useState(model?.id ?? '')
  const [name, setName] = useState(model?.name ?? '')
  const [maxIn, setMaxIn] = useState(model?.contextWindow != null ? String(model.contextWindow) : '256000')
  const [maxOut, setMaxOut] = useState(model?.maxTokens != null ? String(model.maxTokens) : '16384')
  // Advanced (optional) fields
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [inputTypes, setInputTypes] = useState(model?.input?.join(',') ?? '')
  const [costInput, setCostInput] = useState(model?.cost?.input != null ? String(model.cost.input) : '')
  const [costOutput, setCostOutput] = useState(model?.cost?.output != null ? String(model.cost.output) : '')
  const [costCacheRead, setCostCacheRead] = useState(model?.cost?.cacheRead != null ? String(model.cost.cacheRead) : '')
  const [costCacheWrite, setCostCacheWrite] = useState(model?.cost?.cacheWrite != null ? String(model.cost.cacheWrite) : '')
  const [modelApi, setModelApi] = useState(model?.api ?? '')

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1000]">
      <div className="w-[480px] max-w-[92vw] max-h-[88vh] overflow-hidden bg-bg-surface border border-border-subtle rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <span className="text-[15px] font-semibold text-text-primary">
            {modelId ? t('claw.mm_edit_model') : t('claw.mm_add_model')}
          </span>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4 overflow-y-auto styled-scrollbar">
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_model_id')}</span>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="gpt-4o"
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_display_name')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GPT-4o"
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] flex-1">
              <span className="text-text-primary font-medium">{t('claw.mm_max_input')}</span>
              <input
                type="number"
                value={maxIn}
                onChange={(e) => setMaxIn(e.target.value)}
                placeholder="256000"
                className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] flex-1">
              <span className="text-text-primary font-medium">{t('claw.mm_max_output')}</span>
              <input
                type="number"
                value={maxOut}
                onChange={(e) => setMaxOut(e.target.value)}
                placeholder="16384"
                className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary"
              />
            </label>
          </div>

          {/* Advanced (optional) — collapsed by default */}
          <div className="border border-border-subtle rounded-lg">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center justify-between w-full px-3 py-2.5 text-[13px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-medium">{t('claw.mm_advanced')}</span>
              </span>
              <span className="text-[11px] text-text-tertiary">{t('claw.mm_advanced_hint')}</span>
            </button>
            {advancedOpen && (
              <div className="px-3 pb-3 pt-1 flex flex-col gap-3 border-t border-border-subtle">
                <label className="flex flex-col gap-1.5 text-[13px]">
                  <span className="text-text-primary font-medium">{t('claw.mm_input_types')}</span>
                  <input
                    type="text"
                    value={inputTypes}
                    onChange={(e) => setInputTypes(e.target.value)}
                    placeholder="text,image,audio"
                    className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
                  />
                  <small className="text-text-tertiary text-[11px]">{t('claw.mm_input_types_hint')}</small>
                </label>
                <label className="flex flex-col gap-1.5 text-[13px]">
                  <span className="text-text-primary font-medium">{t('claw.mm_model_api')}</span>
                  <select
                    value={modelApi}
                    onChange={(e) => setModelApi(e.target.value)}
                    className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
                  >
                    <option value="">{t('claw.mm_model_api_hint')}</option>
                    {API_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <div>
                  <span className="text-text-primary font-medium text-[13px]">{t('claw.mm_cost_input')} (Cost)</span>
                  <small className="block text-text-tertiary text-[11px] mb-2">{t('claw.mm_cost_hint')}</small>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-[12px]">
                      <span className="text-text-secondary">{t('claw.mm_cost_input')}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={costInput}
                        onChange={(e) => setCostInput(e.target.value)}
                        placeholder="0.00"
                        className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px]">
                      <span className="text-text-secondary">{t('claw.mm_cost_output')}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={costOutput}
                        onChange={(e) => setCostOutput(e.target.value)}
                        placeholder="0.00"
                        className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px]">
                      <span className="text-text-secondary">{t('claw.mm_cost_cache_read')}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={costCacheRead}
                        onChange={(e) => setCostCacheRead(e.target.value)}
                        placeholder="0.00"
                        className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px]">
                      <span className="text-text-secondary">{t('claw.mm_cost_cache_write')}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={costCacheWrite}
                        onChange={(e) => setCostCacheWrite(e.target.value)}
                        placeholder="0.00"
                        className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary font-mono"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-5 py-4 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer border border-border-subtle">
            {t('claw.mm_cancel')}
          </button>
          <button
            onClick={() => {
              const m: ModelConfig = { id: id.trim() }
              if (name.trim()) m.name = name.trim()
              if (maxIn) m.contextWindow = parseInt(maxIn, 10)
              if (maxOut) m.maxTokens = parseInt(maxOut, 10)
              // Optional advanced fields — only set when non-empty
              const types = inputTypes.trim()
              if (types) m.input = types.split(',').map((s) => s.trim()).filter(Boolean)
              if (modelApi) m.api = modelApi
              const ci = costInput.trim()
              const co = costOutput.trim()
              const cr = costCacheRead.trim()
              const cw = costCacheWrite.trim()
              if (ci || co || cr || cw) {
                m.cost = {}
                if (ci) m.cost.input = parseFloat(ci)
                if (co) m.cost.output = parseFloat(co)
                if (cr) m.cost.cacheRead = parseFloat(cr)
                if (cw) m.cost.cacheWrite = parseFloat(cw)
              }
              onSave(m)
            }}
            className="px-4 py-1.5 rounded-lg text-[13px] font-semibold text-black bg-gradient-to-br from-[#C4915E] to-[#D4A574] hover:brightness-110 cursor-pointer transition-all"
          >
            {t('claw.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Import modal ──

function ImportModal({
  onClose, onImport,
}: {
  onClose: () => void
  onImport: (json: string, mode: ImportMode) => void
}) {
  const [mode, setMode] = useState<ImportMode>('replace')
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [readError, setReadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setFileName('')
      setFileContent('')
      setReadError('')
      return
    }
    setFileName(file.name)
    setReadError('')
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setFileContent(text)
    }
    reader.onerror = () => {
      setReadError(t('claw.mm_file_read_failed'))
      setFileContent('')
    }
    reader.readAsText(file)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1000]">
      <div className="w-[480px] max-w-[92vw] max-h-[88vh] overflow-hidden bg-bg-surface border border-border-subtle rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <span className="text-[15px] font-semibold text-text-primary">{t('claw.mm_import_models')}</span>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-4 overflow-y-auto styled-scrollbar">
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_import_mode')}</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
              className="bg-bg-elevated border border-border-subtle rounded-lg px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-primary cursor-pointer"
            >
              <option value="append">{t('claw.mm_import_append')}</option>
              <option value="new">{t('claw.mm_import_new')}</option>
              <option value="replace">{t('claw.mm_import_replace')}</option>
            </select>
          </label>
          <div className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-text-primary font-medium">{t('claw.mm_import_json')}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border-subtle hover:border-brand-primary text-[13px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            >
              <Upload size={14} strokeWidth={1.8} />
              {fileName || t('claw.mm_select_file')}
            </button>
            {readError && (
              <small className="text-red-400 text-[11px]">{readError}</small>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-5 py-4 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[13px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer border border-border-subtle">
            {t('claw.mm_cancel')}
          </button>
          <button
            onClick={() => onImport(fileContent, mode)}
            disabled={!fileContent}
            className="px-4 py-1.5 rounded-lg text-[13px] font-semibold text-black bg-gradient-to-br from-[#C4915E] to-[#D4A574] hover:brightness-110 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('claw.mm_import_apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm dialog ──

function ConfirmDialog({
  title, message, onCancel, onOk,
}: {
  title: string
  message: string
  onCancel: () => void
  onOk: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1100]">
      <div className="w-[380px] max-w-[90vw] bg-bg-surface border border-border-subtle rounded-2xl p-5 shadow-2xl">
        <h3 className="text-[16px] text-text-primary font-semibold mb-2.5">{title}</h3>
        <p className="text-[13px] text-text-secondary mb-4 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2.5">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-[13px] text-text-primary bg-bg-elevated hover:brightness-110 cursor-pointer border border-border-subtle">
            {t('claw.mm_cancel')}
          </button>
          <button onClick={onOk} className="px-4 py-1.5 rounded-lg text-[13px] text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer transition-colors">
            {t('claw.mm_confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
