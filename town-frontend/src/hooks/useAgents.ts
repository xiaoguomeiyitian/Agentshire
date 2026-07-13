import { useState, useEffect } from 'react'
import { t } from '../i18n'
import { apiUrl } from '@/utils/api-base'

export interface AgentInfo {
  id: string
  name: string
  avatarUrl?: string
  avatarId?: string
  specialty?: string
  type: 'steward' | 'citizen'
  online?: boolean
  agentId?: string
  modelRef?: string
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const resp = await fetch(apiUrl('/citizen-workshop/_api/load-published'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const data = await resp.json()
        if (cancelled || !data.config) return

        const config = data.config
        const characters: any[] = config.characters ?? []
        const result: AgentInfo[] = []

        for (const entry of characters) {
          if (entry.role === 'user') continue
          const avatarUrl = entry.avatarUrl && !entry.avatarUrl.startsWith('data:') ? entry.avatarUrl : undefined
          const avatarIdRaw = entry.avatarId ?? ''
          const fallbackAvatar = avatarIdRaw && !avatarIdRaw.startsWith('custom-')
            ? `/assets/avatars/${avatarIdRaw}.webp`
            : undefined
          result.push({
            id: entry.role === 'steward' ? 'steward' : entry.id,
            name: entry.name || (entry.role === 'steward' ? t('steward') : t('resident')),
            avatarUrl: avatarUrl || fallbackAvatar,
            avatarId: avatarIdRaw || undefined,
            specialty: entry.role === 'steward' ? (entry.specialty || t('steward')) : (entry.specialty || entry.industry || ''),
            type: entry.role === 'steward' ? 'steward' : 'citizen',
            online: entry.role === 'steward' ? true : !!(entry.agentEnabled && entry.agentId),
            agentId: entry.agentId,
            modelRef: entry.modelRef || undefined,
          })
        }

        result.sort((a, b) => {
          if (a.type === 'steward') return -1
          if (b.type === 'steward') return 1
          if (a.online && !b.online) return -1
          if (!a.online && b.online) return 1
          return 0
        })

        setAgents(result)
      } catch (err) {
        console.warn('[useAgents] Failed to load:', err)
        setAgents([{ id: 'steward', name: t('steward'), type: 'steward', specialty: t('ai_steward'), online: true }])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { agents, loading }
}
