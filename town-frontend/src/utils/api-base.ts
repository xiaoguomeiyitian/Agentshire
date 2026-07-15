/**
 * API 路径工具
 *
 * 把绝对路径转为带反代前缀的相对路径。
 * 反代场景下 location.pathname 形如 /<container>/<port>/town.html，
 * 提取前缀后拼接，使 fetch 请求自动带上反代路径。
 */

import { detectReverseProxyPrefix } from './ws-url'

/** 缓存反代前缀，避免每次调用 apiUrl 都重新匹配 */
let _proxyPrefix: string | undefined

function getProxyPrefix(): string {
  if (_proxyPrefix === undefined) {
    const proxy = detectReverseProxyPrefix()
    _proxyPrefix = proxy ? `/${proxy.container}/${proxy.port}` : ''
  }
  return _proxyPrefix
}

/**
 * 把绝对路径转为带反代前缀的路径。
 *
 * @param path 以 "/" 开头的绝对路径，如 "/citizen-workshop/_api/load"
 * @returns 带前缀的路径，反代场景如 "/agentshire/55210/citizen-workshop/_api/load"，
 *          直连场景如 "/citizen-workshop/_api/load"
 */
export function apiUrl(path: string): string {
  if (!path) return path
  // 已经是相对路径或完整 URL（http://、blob:、data: 等）原样返回
  if (!path.startsWith('/') || /^(blob:|data:|https?:)/.test(path)) return path
  return getProxyPrefix() + path
}
