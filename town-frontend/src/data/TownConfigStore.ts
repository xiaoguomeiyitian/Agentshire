import type { TownConfig } from './TownConfig'

const CONFIG_KEY = 'agentshire_config'
const ACTIVE_SESSION_KEY = 'agentshire_active_session'
const CURRENT_VERSION = 4
const MAX_SESSIONS_TO_KEEP = 5

export class TownConfigStore {
  private sessionId: string | null = null

  setSessionId(id: string): void {
    this.sessionId = id
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, id)
    } catch {
      // ignore
    }
  }

  getSessionId(): string | null {
    if (this.sessionId) return this.sessionId
    try {
      this.sessionId = localStorage.getItem(ACTIVE_SESSION_KEY)
      return this.sessionId
    } catch {
      return this.sessionId
    }
  }

  getScopedKey(baseKey: string): string {
    const sessionId = this.getSessionId()
    return sessionId ? `${baseKey}_${sessionId}` : baseKey
  }

  load(): TownConfig | null {
    try {
      const raw = localStorage.getItem(CONFIG_KEY)
      if (!raw) return null
      const config = JSON.parse(raw) as TownConfig
      if ((config.version ?? 0) < CURRENT_VERSION) {
        console.log(`[TownConfigStore] Outdated config v${config.version ?? 0}, upgrading to v${CURRENT_VERSION}`)
        this.clear()
        return null
      }
      return config
    } catch {
      return null
    }
  }

  save(config: TownConfig): void {
    try {
      this.gcStaleEntries()
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    } catch {
      console.warn('[TownConfigStore] Failed to save config')
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(CONFIG_KEY)
    } catch {
      // ignore
    }
  }

  exists(): boolean {
    return localStorage.getItem(CONFIG_KEY) !== null
  }

  private gcStaleEntries(): void {
    try {
      const staleKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (k.startsWith('agentshire_config_') ||
            k.startsWith('agentshire_clock_') ||
            k.startsWith('agentshire_snapshot_')) {
          staleKeys.push(k)
        }
      }

      if (staleKeys.length === 0) return

      const currentSession = this.getSessionId()
      const sessionIds = new Set(
        staleKeys.map(k => {
          const parts = k.split('_')
          return parts[parts.length - 1]
        }),
      )

      if (sessionIds.size <= MAX_SESSIONS_TO_KEEP) return

      const toRemove = staleKeys.filter(k => !currentSession || !k.endsWith(currentSession))
      const sortedByAge = toRemove.sort()
      const removeCount = Math.max(0, sessionIds.size - MAX_SESSIONS_TO_KEEP)
      let removed = 0
      for (const k of sortedByAge) {
        if (removed >= removeCount * 3) break
        localStorage.removeItem(k)
        removed++
      }
      if (removed > 0) {
        console.log(`[TownConfigStore] GC: removed ${removed} stale localStorage entries`)
      }
    } catch {
      // GC is best-effort
    }
  }
}
