/**
 * WebSocket URL 解析工具
 *
 * 优先级：?ws= 显式参数 > baseURI 路径前缀推导 > 同源 port-1 约定
 */

/**
 * 从 document.baseURI 推导反代路径前缀。
 * @returns { container, port } 或 null
 */
export function detectReverseProxyPrefix(): { container: string; port: string } | null {
  if (typeof window === 'undefined' || !window.location) return null
  try {
    const base = new URL(document.baseURI)
    const m = base.pathname.match(/^\/([a-zA-Z0-9_-]+)\/(\d+)(?:\/|$)/)
    if (!m) return null
    return { container: m[1], port: m[2] }
  } catch {
    return null
  }
}

/**
 * 推导 WebSocket URL。
 *
 * @param explicitWsParam 来自 URL ?ws= 参数的显式值（可为 null/空）
 * @param defaultWsPort 默认 WS 端口（直连场景下使用），默认 20008
 * @returns 完整的 ws:// 或 wss:// URL
 */
export function resolveWsUrl(explicitWsParam?: string | null, defaultWsPort = 20008): string {
  // 1) 显式 ?ws= 参数优先
  if (explicitWsParam) return explicitWsParam

  if (typeof window === 'undefined' || !window.location) {
    return `ws://localhost:${defaultWsPort}`
  }

  const loc = window.location
  const isSecure = loc.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  const host = loc.hostname || 'localhost'

  // 2) 反代路径前缀：wss://host/container/wsPort（WS 端口 = HTTP 端口 - 1）
  const proxy = detectReverseProxyPrefix()
  if (proxy) {
    const wsPort = Number(proxy.port) - 1
    return `${scheme}://${host}/${proxy.container}/${wsPort}`
  }

  // 3) 直连场景：同源 port-1 约定
  const httpPort = loc.port ? Number(loc.port) : 0
  const wsPort = httpPort ? httpPort - 1 : defaultWsPort
  return `${scheme}://${host}:${wsPort}`
}
