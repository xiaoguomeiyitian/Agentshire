// src/plugin/auth.ts —— 小镇页面密码登录鉴权核心（叶子模块，不反向依赖任何业务模块）
// 依赖：仅 node 内置 http / crypto 类型与自身内存状态（Map）。谁都能引它，它谁都不引。
// 负责人：小烈（后端）
//
// 设计要点（见 SPEC.md / MODULES.md）：
// - 开关语义（翻转后）：env AGENTSHIRE_TOWN_PASSWORD 非空 = 开启密码登录；未设置 = 免密直进（null = 免密模式）。不再把 config.password 当密码来源。
// - 会话：randomUUID 随机 token 存内存 Map，HttpOnly + SameSite=Lax + Path=/ + Max-Age Cookie 续命
// - 失败计数 + 临时锁：连错 5 次锁 5 分钟（429）
// - 密码校验用 crypto.timingSafeEqual 恒定时间比较，防计时攻击
// - 白名单放行：GET /login、POST /api/login、GET /api/auth/status、/login-assets/*

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { stateDir } from "./paths.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7天
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

const sessions = new Map<string, number>(); // token -> 过期时间戳
const failCounts = new Map<string, { n: number; until: number }>(); // key(如IP) -> 失败计数/锁定到

// ── Session 持久化（重启不丢失）──
let _sessionFile: string | null = null;
function sessionFile(): string {
  if (_sessionFile) return _sessionFile;
  _sessionFile = join(stateDir(), "agentshire-sessions.json");
  return _sessionFile;
}
let sessionLoaded = false;

/** 从磁盘加载 session（启动时调用一次，惰性加载） */
function loadSessions(): void {
  if (sessionLoaded) return;
  sessionLoaded = true;
  try {
    const file = sessionFile();
    if (!existsSync(file)) return;
    const raw = readFileSync(file, "utf-8");
    const obj = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    for (const [token, exp] of Object.entries(obj)) {
      if (exp > now) sessions.set(token, exp); // 过滤已过期的
    }
  } catch { /* 文件不存在或解析失败，忽略 */ }
}

/** 把 session 写入磁盘（防抖：合并多次连续写入） */
let writeTimer: ReturnType<typeof setTimeout> | null = null;
function persistSessions(): void {
  if (writeTimer) return; // 已有挂起的写入
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const file = sessionFile();
      mkdirSync(dirname(file), { recursive: true });
      const obj: Record<string, number> = {};
      for (const [token, exp] of sessions) obj[token] = exp;
      writeFileSync(file, JSON.stringify(obj), "utf-8");
    } catch { /* 写入失败不影响运行 */ }
  }, 1000);
}

/**
 * 是否启用密码登录：唯一由环境变量 AGENTSHIRE_TOWN_PASSWORD 决定。
 * 非空 → 开启密码登录；未设置/空 → 免密直进。
 */
export function isPasswordAuthEnabled(): boolean {
  const v = process.env.AGENTSHIRE_TOWN_PASSWORD;
  return !!v && v.length > 0;
}

/** 读密码：仅读 env AGENTSHIRE_TOWN_PASSWORD，非空即该值，否则 null（免密模式）。config 参数保留但忽略（不再作为密码来源）。 */
export function getTownPassword(_config?: Record<string, unknown>): string | null {
  const fromEnv = process.env.AGENTSHIRE_TOWN_PASSWORD;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null; // 免密模式
}

/** 从 req.headers.cookie 解析出 session token；无则 null */
export function parseSessionToken(req: IncomingMessage): string | null {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(/(?:^|;\s*)town_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** 查内存映射，token 合法且未过期返回 true（过期则顺手清除并持久化） */
export function isValidSession(token: string | null): boolean {
  if (!token) return false;
  loadSessions(); // 惰性加载磁盘 session
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    persistSessions();
    return false;
  }
  return true;
}

/** 恒定时间比较，防计时攻击 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 生成随机 token，存入映射并 Set-Cookie（HttpOnly+SameSite=Lax+Path=/+Max-Age） */
export function createSession(res: ServerResponse): void {
  loadSessions();
  const token = randomUUID();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  persistSessions();
  const secure = process.env.AGENTSHIRE_HTTPS === "1" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `town_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000,
    )};${secure}`,
  );
}

/** 白名单判断：GET /login、POST /api/login、GET /api/auth/status、/login-assets/* */
export function isWhitelisted(urlPath: string, method: string): boolean {
  if (urlPath === "/login" && method === "GET") return true;
  if (urlPath === "/api/login" && method === "POST") return true;
  if (urlPath === "/api/auth/status" && method === "GET") return true;
  if (urlPath.startsWith("/login-assets/")) return true;
  return false;
}

/** 处理 GET /api/auth/status：返回 { loggedIn: boolean } */
export function handleAuthStatus(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ loggedIn: isValidSession(parseSessionToken(req)) }));
}

/** 读取请求体，转成字符串（上限 1MB，超出直接断流） */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

// 登录页 HTML（由后端直出，单文件 + 内联 style，零外部依赖）。
// 副标题处用 __SUBTITLE__ 占位，错误文案处用 __ERROR__ 占位，serveLoginPage 替换。
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>进入夏尔 · 登录</title>
<style>
  :root{
    --color-brand-primary:#D4A574;
    --color-brand-hover:#C08E57;
    --color-bg:#1C1B1A;
    --color-bg-accent:#26241F;
    --color-card:#2A2825;
    --color-card-border:#3A362F;
    --color-text-primary:#F5F5F7;
    --color-text-muted:#9A948C;
    --color-input-bg:#211F1D;
    --color-input-border:#3A362F;
    --color-error:#E86A5C;
    --color-success:#45E796;
    --color-btn-text:#1C1B1A;
    --radius-card:16px;
    --radius-field:10px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 50% 0%,var(--color-bg-accent) 0%,var(--color-bg) 60%);
    color:var(--color-text-primary);padding:20px;
  }
  .login-card{
    width:360px;max-width:90vw;background:var(--color-card);
    border:1px solid var(--color-card-border);border-radius:var(--radius-card);
    padding:40px 32px;box-shadow:0 12px 40px rgba(0,0,0,0.35);text-align:center;
  }
  .login-badge{
    width:56px;height:56px;border-radius:50%;margin:0 auto 16px;
    display:flex;align-items:center;justify-content:center;font-size:30px;
    background:rgba(212,165,116,0.14);border:1px solid rgba(212,165,116,0.3);
  }
  .login-title{font-size:24px;font-weight:600;letter-spacing:-0.2px;margin-bottom:8px}
  .login-subtitle{font-size:14px;font-weight:400;color:var(--color-text-muted);line-height:1.5;margin-bottom:28px}
  .login-input{
    width:100%;height:48px;padding:0 14px;font-size:15px;color:var(--color-text-primary);
    background:var(--color-input-bg);border:1px solid var(--color-input-border);
    border-radius:var(--radius-field);outline:none;transition:border-color .15s ease,box-shadow .15s ease;
  }
  .login-input::placeholder{color:var(--color-text-muted)}
  .login-input:focus{border-color:var(--color-brand-primary);box-shadow:0 0 0 3px rgba(212,165,116,0.18)}
  .login-input.is-error{border-color:var(--color-error)}
  .login-error{font-size:13px;font-weight:500;color:var(--color-error);margin-top:8px;text-align:left;min-height:18px}
  .login-btn{
    width:100%;height:48px;margin-top:20px;font-size:15px;font-weight:600;letter-spacing:.2px;
    color:var(--color-btn-text);background:var(--color-brand-primary);border:none;
    border-radius:var(--radius-field);cursor:pointer;transition:background .15s ease,transform .05s ease;
  }
  .login-btn:hover{background:var(--color-brand-hover)}
  .login-btn:active{transform:translateY(1px)}
  .login-btn:disabled{opacity:.7;cursor:not-allowed}
  .login-footer{font-size:12px;color:#6E6860;margin-top:24px}
  .shake{animation:shake .4s ease}
  @keyframes shake{
    0%,100%{transform:translateX(0)}
    20%,60%{transform:translateX(-6px)}
    40%,80%{transform:translateX(6px)}
  }
</style>
</head>
<body>
  <form class="login-card" method="POST" action="/api/login" id="login-form">
    <div class="login-badge">🦫</div>
    <h1 class="login-title">欢迎回到夏尔</h1>
    <p class="login-subtitle">__SUBTITLE__</p>
    <input class="login-input" type="password" name="password"
           placeholder="请输入访问密码" autocomplete="current-password" autofocus>
    <div class="login-error">__ERROR__</div>
    <button class="login-btn" type="submit">进入小镇</button>
    <p class="login-footer">🦫 卡皮巴拉守护着这座小镇</p>
  </form>
<script>
(function(){
  var form = document.getElementById('login-form');
  var errEl = form.querySelector('.login-error');
  var btn = form.querySelector('.login-btn');

  form.addEventListener('submit', function(e){
    e.preventDefault();
    var pwd = form.querySelector('input[name=password]').value;
    btn.disabled = true;
    btn.textContent = '进入中...';
    fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pwd })
    }).then(function(resp){
      if (resp.ok) {
        location.href = '.';
      } else {
        return resp.json().catch(function(){ return { error: '密码错误' }; }).then(function(d){
          throw new Error(d.error || '密码错误');
        });
      }
    }).catch(function(err){
      btn.disabled = false;
      btn.textContent = '进入小镇';
      errEl.textContent = err.message || '登录失败';
      form.querySelector('.login-input').classList.add('is-error');
      form.classList.add('shake');
      setTimeout(function(){ form.classList.remove('shake'); }, 400);
    });
  });
})();
</script>
</body>
</html>`;

/** 直出登录页 HTML（不依赖 dist）：GET /login 时 res.end(html) */
export function serveLoginPage(
  res: ServerResponse,
  opts?: { error?: string; noPassword?: boolean },
): void {
  let html = LOGIN_HTML;
  const subtitle = opts?.noPassword
    ? "小镇未配置访问密码，请联系管理员设置 AGENTSHIRE_TOWN_PASSWORD"
    : "输入访问密码，慢慢来，小镇一直在。";
  const error = opts?.error ?? "";
  html = html
    .replace("__SUBTITLE__", subtitle)
    .replace("__ERROR__", error);
  // 错误态：高亮输入框 + 卡片抖动（呼应 visual.md 交互规范）
  if (error) {
    html = html
      .replace('class="login-input"', 'class="login-input is-error"')
      .replace('class="login-card"', 'class="login-card shake"');
  }
  res.writeHead(opts?.error ? 401 : 200, {
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

/** 处理 POST /api/login：读 body 密码→恒定时间比较→失败计数/锁定(429)→成功 createSession + 重定向/200 */
export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  config?: Record<string, unknown>,
): Promise<void> {
  const password = getTownPassword(config);
  const raw = await readBody(req);
  let submitted = "";
  try {
    const j = JSON.parse(raw);
    submitted = j.password ?? "";
  } catch {
    const m = raw.match(/password=([^&]*)/);
    submitted = m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }
  const wantJson =
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json");

  if (password === null) {
    // 免密模式：直接放行（防御性分支，正常不会被走到）。
    createSession(res);
    if (wantJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      // 相对路径：从 /login 跳到上级目录（首页）
      res.writeHead(302, {
        Location: ".",
        "Set-Cookie": res.getHeader("Set-Cookie") as string,
      });
      res.end();
    }
    return;
  }

  const ip = req.socket.remoteAddress || "unknown";
  const f = failCounts.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) {
    if (wantJson) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "尝试过于频繁，请5分钟后再试" }));
    } else {
      serveLoginPage(res, { error: "尝试过于频繁，请5分钟后再试" });
    }
    return;
  }

  if (safeEqual(submitted, password)) {
    failCounts.delete(ip);
    createSession(res);
    if (wantJson) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      // 相对路径：从 /login 跳到上级目录（首页）
      res.writeHead(302, {
        Location: ".",
        "Set-Cookie": res.getHeader("Set-Cookie") as string,
      });
      res.end();
    }
  } else {
    f.n += 1;
    if (f.n >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
    failCounts.set(ip, f);
    if (wantJson) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "密码错误" }));
    } else {
      serveLoginPage(res, { error: "密码错误，请重试" });
    }
  }
}

/**
 * 统一中间件：返回 true=已放行本次请求(调用方 return 结束)，false=未处理(继续原逻辑)
 * 逻辑：命中登录白名单→自行处理并返回 true；已登录→返回 false(放行给原逻辑)；
 *       未登录 且 页面类→302 /login 返回 true；未登录 且 API/资产类→401 返回 true。
 */
export async function requireAuth(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  config?: Record<string, unknown>,
): Promise<boolean> {
  const realPath = urlPath;

  // 免密模式：/api/auth/status 返回已登录；其余请求直接放行给原逻辑。
  if (!isPasswordAuthEnabled()) {
    if (realPath === "/api/auth/status" && (req.method || "GET") === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ loggedIn: true }));
      return true;
    }
    return false; // 其余请求直接放行给原逻辑
  }

  if (isWhitelisted(realPath, req.method || "GET")) {
    if (realPath === "/login") {
      serveLoginPage(res);
      return true;
    }
    if (realPath === "/api/login") {
      await handleLogin(req, res, config);
      return true;
    }
    if (realPath === "/api/auth/status") {
      handleAuthStatus(req, res);
      return true;
    }
    return true; // /login-assets/* 等静态白名单资源
  }

  if (isValidSession(parseSessionToken(req))) return false; // 放行给原逻辑

  // 未登录：区分页面请求 vs API 请求
  // API 请求（accept: application/json 或路径以 /api/ /_api/ /board/ 开头）→ 401 JSON
  // 页面请求（accept: text/html 或普通 GET）→ 302 到 login
  const accept = req.headers.accept || "";
  const isApiRequest =
    accept.includes("application/json") ||
    realPath.startsWith("/api/") ||
    realPath.includes("/_api/") ||
    realPath.startsWith("/board/");
  if (
    !isApiRequest &&
    (accept.includes("text/html") || (req.method || "GET") === "GET")
  ) {
    // 用 HTML + JS 跳转代替 302，解决反代无结尾斜杠时相对路径丢端口的问题。
    // 浏览器先规范化 URL（补结尾斜杠），再相对跳转到 login，保证前缀完整。
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><script>` +
        `(function(){` +
        `var p=location.pathname;` +
        `if(p.charAt(p.length-1)!=='/'){location.replace(p+'/'+location.search+location.hash);return;}` +
        `location.replace('login');` +
        `})();` +
        `</script></head><body></body></html>`,
    );
  } else {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  }
  return true;
}
