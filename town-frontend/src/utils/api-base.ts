/**
 * API 路径工具
 *
 * 把绝对路径转为相对路径（去掉前导斜杠），使 fetch 相对 document.baseURI 解析。
 * vite 插件在反代场景注入 <base>，因此相对路径会自动带上前缀。
 */

/**
 * 把绝对路径转为相对路径（去掉前导斜杠）。
 *
 * @param path 以 "/" 开头的绝对路径，如 "/citizen-workshop/_api/load"
 * @returns 去掉前导斜杠的相对路径，如 "citizen-workshop/_api/load"
 */
export function apiUrl(path: string): string {
  if (!path) return path
  // 已经是相对路径或完整 URL（http://、blob:、data: 等）原样返回
  if (!path.startsWith('/') || /^(blob:|data:|https?:)/.test(path)) return path
  return path.slice(1)
}
