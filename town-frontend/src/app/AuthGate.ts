/**
 * AuthGate — 小镇应用的“门卫”。
 *
 * 在整个 3D 场景 / WebSocket 初始化之前，先问一句后端：“我现在登录了没？”
 * 你可以把它想象成进小区前先刷一下门禁——刷过了才让往里走，没刷过就请你去门口登记（/login）。
 *
 * 设计约定（对齐 SPEC / MODULES）：
 *   - 只认后端 /api/auth/status 返回的布尔结果，前端不碰任何密码逻辑。
 *   - 未登录：跳转 /login，并中止后续初始化（不 new Engine / new WebSocket）。
 *   - 已登录：放行，main.ts 继续走原逻辑（浏览器发起 WS 时会自动带 Cookie）。
 *   - 网络异常：fail-open —— 继续原逻辑，但打一条 console.warn，
 *     避免状态接口临时不可达时把整个应用锁死。
 */

import { apiUrl } from '@/utils/api-base'

interface AuthStatusResponse {
  loggedIn?: boolean
}

/** 状态接口地址，保持相对路径，天然同域（浏览器自动带 Cookie）。 */
const AUTH_STATUS_URL = apiUrl('/api/auth/status')

/** 未登录时的去向。 */
const LOGIN_URL = apiUrl('/login')

/**
 * 确认当前访问者已登录。
 *
 * @returns 是否放行后续初始化：
 *   - true  → 已登录（或状态接口不可达时 fail-open），main.ts 继续初始化；
 *   - false → 未登录，已触发跳转到 /login，调用方应立即 return，别再初始化任何东西。
 */
export async function ensureAuthed(): Promise<boolean> {
  try {
    const res = await fetch(AUTH_STATUS_URL, {
      method: 'GET',
      // 显式带上同域 Cookie，稳妥起见（同源默认也会带）。
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })

    // 后端可能在极端情况下直接对未登录返回非 2xx；这里按“未登录”处理。
    if (!res.ok) {
      console.warn(`[AuthGate] /api/auth/status 返回 ${res.status}，视为未登录，跳转登录页`)
      redirectToLogin()
      return false
    }

    const data = (await res.json()) as AuthStatusResponse

    if (data && data.loggedIn === true) {
      // 已登录，放行。
      return true
    }

    // 明确未登录 → 拦下来，去登录页。
    redirectToLogin()
    return false
  } catch (err) {
    // 网络/解析异常：fail-open，别把整个应用锁死，但留个记录方便排查。
    console.warn('[AuthGate] 登录状态检查失败，按 fail-open 继续初始化：', err)
    return true
  }
}

/** 跳转到后端直出的登录页，并记住来时的路径，方便登录后跳回。 */
function redirectToLogin(): void {
  const next = encodeURIComponent(location.pathname + location.search)
  location.href = `${LOGIN_URL}?next=${next}`
}
