// @desc Tests for auth.ts: town page password authentication
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock stateDir before importing auth (auth.ts uses stateDir at module load for SESSION_FILE)
vi.mock('../paths.js', () => ({
  stateDir: () => '/tmp/agentshire-test-state',
  initStateDir: vi.fn(),
}))

import {
  isPasswordAuthEnabled,
  getTownPassword,
  parseSessionToken,
  isValidSession,
  createSession,
  isWhitelisted,
  handleAuthStatus,
  serveLoginPage,
  handleLogin,
  requireAuth,
} from '../auth.js'

// Helper: build a minimal mock IncomingMessage
function mockReq(opts: {
  cookie?: string
  method?: string
  url?: string
  body?: string
  accept?: string
  contentType?: string
  remoteAddress?: string
} = {}): any {
  const req: any = {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: {
      cookie: opts.cookie,
      accept: opts.accept,
      'content-type': opts.contentType,
    },
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
  }
  if (opts.body !== undefined) {
    // Simulate readable stream
    req.on = (event: string, cb: (chunk?: any) => void) => {
      if (event === 'data') cb(opts.body)
      if (event === 'end') cb()
    }
    req.destroy = () => {}
  }
  return req
}

// Helper: build a minimal mock ServerResponse
function mockRes(): any {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, any>,
    body: '',
    ended: false,
    writeHead(code: number, headers?: any) {
      res.statusCode = code
      if (headers) res.headers = { ...res.headers, ...headers }
    },
    setHeader(k: string, v: any) {
      res.headers[k] = v
    },
    getHeader(k: string) {
      return res.headers[k]
    },
    end(data?: any) {
      res.ended = true
      if (data !== undefined) res.body = data
    },
  }
  return res
}

describe('auth.ts', () => {
  const ORIGINAL_ENV = process.env.AGENTSHIRE_TOWN_PASSWORD

  beforeEach(() => {
    // Clear env before each test
    delete process.env.AGENTSHIRE_TOWN_PASSWORD
    delete process.env.AGENTSHIRE_HTTPS
  })

  afterEach(() => {
    // Restore
    if (ORIGINAL_ENV !== undefined) process.env.AGENTSHIRE_TOWN_PASSWORD = ORIGINAL_ENV
    else delete process.env.AGENTSHIRE_TOWN_PASSWORD
  })

  describe('isPasswordAuthEnabled', () => {
    it('returns false when env not set', () => {
      expect(isPasswordAuthEnabled()).toBe(false)
    })

    it('returns true when env is non-empty', () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'secret123'
      expect(isPasswordAuthEnabled()).toBe(true)
    })

    it('returns false when env is empty string', () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = ''
      expect(isPasswordAuthEnabled()).toBe(false)
    })
  })

  describe('getTownPassword', () => {
    it('returns null when env not set', () => {
      expect(getTownPassword({ password: 'config-pw' })).toBeNull()
    })

    it('returns env value when set (ignores config.password)', () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'env-pw'
      expect(getTownPassword({ password: 'config-pw' })).toBe('env-pw')
    })
  })

  describe('parseSessionToken', () => {
    it('returns null when no cookie header', () => {
      const req = mockReq({})
      expect(parseSessionToken(req)).toBeNull()
    })

    it('parses token from cookie', () => {
      const req = mockReq({ cookie: 'foo=bar; town_session=abc123; baz=qux' })
      expect(parseSessionToken(req)).toBe('abc123')
    })

    it('returns null when town_session not present', () => {
      const req = mockReq({ cookie: 'foo=bar; baz=qux' })
      expect(parseSessionToken(req)).toBeNull()
    })

    it('decodes URL-encoded token', () => {
      const req = mockReq({ cookie: 'town_session=a%20b%2Fc' })
      expect(parseSessionToken(req)).toBe('a b/c')
    })
  })

  describe('isValidSession', () => {
    it('returns false for null token', () => {
      expect(isValidSession(null)).toBe(false)
    })

    it('returns false for unknown token', () => {
      expect(isValidSession('nonexistent')).toBe(false)
    })

    it('returns true for valid unexpired token', () => {
      const res = mockRes()
      createSession(res)
      const cookie = res.headers['Set-Cookie'] as string
      const token = cookie.match(/town_session=([^;]+)/)![1]
      expect(isValidSession(token)).toBe(true)
    })

    it('returns false and clears expired token', () => {
      // Manually inject an expired token into the sessions map via createSession + time travel
      const res = mockRes()
      createSession(res)
      const cookie = res.headers['Set-Cookie'] as string
      const token = cookie.match(/town_session=([^;]+)/)![1]
      // Override Date.now to simulate expiry
      const realNow = Date.now
      Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000
      expect(isValidSession(token)).toBe(false)
      Date.now = realNow
    })
  })

  describe('createSession', () => {
    it('sets HttpOnly SameSite=Lax cookie', () => {
      const res = mockRes()
      createSession(res)
      const cookie = res.headers['Set-Cookie'] as string
      expect(cookie).toContain('town_session=')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
    })

    it('adds Secure flag when AGENTSHIRE_HTTPS=1', () => {
      process.env.AGENTSHIRE_HTTPS = '1'
      const res = mockRes()
      createSession(res)
      const cookie = res.headers['Set-Cookie'] as string
      expect(cookie).toContain('Secure;')
    })
  })

  describe('isWhitelisted', () => {
    it('allows GET /login', () => {
      expect(isWhitelisted('/login', 'GET')).toBe(true)
    })

    it('rejects POST /login', () => {
      expect(isWhitelisted('/login', 'POST')).toBe(false)
    })

    it('allows POST /api/login', () => {
      expect(isWhitelisted('/api/login', 'POST')).toBe(true)
    })

    it('allows GET /api/auth/status', () => {
      expect(isWhitelisted('/api/auth/status', 'GET')).toBe(true)
    })

    it('allows /login-assets/* prefix', () => {
      expect(isWhitelisted('/login-assets/style.css', 'GET')).toBe(true)
    })

    it('rejects protected page /', () => {
      expect(isWhitelisted('/', 'GET')).toBe(false)
    })
  })

  describe('handleAuthStatus', () => {
    it('returns loggedIn false for no session', () => {
      const req = mockReq({})
      const res = mockRes()
      handleAuthStatus(req, res)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ loggedIn: false })
    })

    it('returns loggedIn true for valid session', () => {
      const sres = mockRes()
      createSession(sres)
      const token = (sres.headers['Set-Cookie'] as string).match(/town_session=([^;]+)/)![1]
      const req = mockReq({ cookie: `town_session=${token}` })
      const res = mockRes()
      handleAuthStatus(req, res)
      expect(JSON.parse(res.body)).toEqual({ loggedIn: true })
    })
  })

  describe('serveLoginPage', () => {
    it('returns 200 with no error', () => {
      const res = mockRes()
      serveLoginPage(res)
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('欢迎回到夏尔')
    })

    it('returns 401 with error message', () => {
      const res = mockRes()
      serveLoginPage(res, { error: '密码错误' })
      expect(res.statusCode).toBe(401)
      expect(res.body).toContain('密码错误')
      expect(res.body).toContain('is-error')
      expect(res.body).toContain('shake')
    })

    it('shows no-password subtitle when noPassword=true', () => {
      const res = mockRes()
      serveLoginPage(res, { noPassword: true })
      expect(res.body).toContain('未配置访问密码')
    })
  })

  describe('handleLogin', () => {
    it('accepts correct JSON password', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'correct'
      const req = mockReq({
        method: 'POST',
        body: JSON.stringify({ password: 'correct' }),
        contentType: 'application/json',
        accept: 'application/json',
      })
      const res = mockRes()
      await handleLogin(req, res)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
      expect(res.headers['Set-Cookie']).toContain('town_session=')
    })

    it('rejects wrong password with 401', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'correct'
      const req = mockReq({
        method: 'POST',
        body: JSON.stringify({ password: 'wrong' }),
        contentType: 'application/json',
        accept: 'application/json',
      })
      const res = mockRes()
      await handleLogin(req, res)
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.body).ok).toBe(false)
    })

    it('accepts form-encoded password', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'formpw'
      const req = mockReq({
        method: 'POST',
        body: 'password=formpw',
        contentType: 'application/x-www-form-urlencoded',
      })
      const res = mockRes()
      await handleLogin(req, res)
      expect(res.statusCode).toBe(302)
      expect(res.headers['Location']).toBe('.')
    })

    it('locks out after 5 failures (429)', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'pw'
      const makeReq = () =>
        mockReq({
          method: 'POST',
          body: JSON.stringify({ password: 'bad' }),
          contentType: 'application/json',
          accept: 'application/json',
        })
      for (let i = 0; i < 5; i++) {
        const res = mockRes()
        await handleLogin(makeReq(), res)
      }
      const res = mockRes()
      await handleLogin(makeReq(), res)
      expect(res.statusCode).toBe(429)
    })

    it('passes through in no-password mode', async () => {
      const req = mockReq({
        method: 'POST',
        body: JSON.stringify({ password: 'anything' }),
        contentType: 'application/json',
        accept: 'application/json',
      })
      const res = mockRes()
      await handleLogin(req, res)
      expect(res.statusCode).toBe(200)
      expect(res.headers['Set-Cookie']).toContain('town_session=')
    })
  })

  describe('requireAuth', () => {
    it('passes through all requests when auth disabled', async () => {
      const req = mockReq({ url: '/', method: 'GET' })
      const res = mockRes()
      const handled = await requireAuth(req, res, '/')
      expect(handled).toBe(false)
    })

    it('serves /login when auth enabled and not logged in', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'pw'
      const req = mockReq({ url: '/login', method: 'GET' })
      const res = mockRes()
      const handled = await requireAuth(req, res, '/login')
      expect(handled).toBe(true)
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('欢迎回到夏尔')
    })

    it('redirects to login (relative) for protected page when not authenticated', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'pw'
      const req = mockReq({ url: '/', method: 'GET', accept: 'text/html' })
      const res = mockRes()
      const handled = await requireAuth(req, res, '/')
      expect(handled).toBe(true)
      // Auth uses HTML + JS redirect (200) instead of 302 to handle reverse-proxy
      // trailing-slash issues. The HTML body contains a script that redirects to 'login'.
      expect(res.statusCode).toBe(200)
      expect(res.headers['Content-Type']).toContain('text/html')
      expect(String(res.body)).toContain("location.replace('login')")
    })

    it('returns 401 for API POST when not authenticated', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'pw'
      const req = mockReq({ url: '/api/data', method: 'POST', accept: 'application/json' })
      const res = mockRes()
      const handled = await requireAuth(req, res, '/api/data')
      expect(handled).toBe(true)
      expect(res.statusCode).toBe(401)
    })

    it('passes through when valid session present', async () => {
      process.env.AGENTSHIRE_TOWN_PASSWORD = 'pw'
      const sres = mockRes()
      createSession(sres)
      const token = (sres.headers['Set-Cookie'] as string).match(/town_session=([^;]+)/)![1]
      const req = mockReq({ url: '/', method: 'GET', cookie: `town_session=${token}` })
      const res = mockRes()
      const handled = await requireAuth(req, res, '/')
      expect(handled).toBe(false)
    })
  })
})
