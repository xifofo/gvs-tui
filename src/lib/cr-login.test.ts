import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DEBUG_URL,
  buildLoginScript,
  buildVerifyScript,
  chromeCandidates,
  crLogin,
  ensureChromeDebug,
  etpRtFromCookies,
  loginFormReady,
} from './cr-login.ts'

describe('etpRtFromCookies', () => {
  test('取 etp_rt 的值', () => {
    expect(etpRtFromCookies([
      { name: 'c_locale', value: 'zh-TW' },
      { name: 'etp_rt', value: '  9185458c-32cc-47f3-a90f-3e3f4188da58 ' },
    ])).toBe('9185458c-32cc-47f3-a90f-3e3f4188da58')
  })

  test('缺失/脏数据返回空串', () => {
    expect(etpRtFromCookies([])).toBe('')
    expect(etpRtFromCookies([{ name: 'etp_rt', value: '' }])).toBe('')
  })
})

describe('loginFormReady', () => {
  test('两个输入框都在才算就绪', () => {
    expect(loginFormReady({ email: true, pass: true })).toBe(true)
    expect(loginFormReady({ email: true, pass: false })).toBe(false)
    expect(loginFormReady('nope')).toBe(false)
    expect(loginFormReady(null)).toBe(false)
  })
})

describe('buildLoginScript', () => {
  test('用 JSON 字符串包凭据，引号/换行不会破坏脚本', () => {
    const email = 'a"b@example.com'
    const password = 'p"a\nss\\word'
    const js = buildLoginScript(email, password)
    expect(js).toContain(JSON.stringify(email))
    expect(js).toContain(JSON.stringify(password))
    expect(js).toContain("querySelector('input[type=email],input[name=email]')")
    expect(js).toContain("return 'submitted'")
  })
})

describe('buildVerifyScript', () => {
  test('用 etp_rt_cookie grant 校验会话', () => {
    const js = buildVerifyScript()
    expect(js).toContain('grant_type=etp_rt_cookie')
    expect(js).toContain('credentials: \'include\'')
    expect(js).toContain('access_token')
  })
})

describe('chromeCandidates', () => {
  test('macOS 优先 Google Chrome', () => {
    expect(chromeCandidates('darwin')[0]).toContain('Google Chrome.app')
  })

  test('linux 回落到命令名', () => {
    expect(chromeCandidates('linux')).toContain('google-chrome')
  })
})

describe('ensureChromeDebug', () => {
  test('调试端口已在跑时直接复用，不拉起新进程', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        if (u.pathname === '/json/version') {
          return new Response(JSON.stringify({ Browser: 'fake' }), { headers: { 'content-type': 'application/json' } })
        }
        return new Response('not found', { status: 404 })
      },
    })
    try {
      await ensureChromeDebug(`http://127.0.0.1:${server.port}`, 3000)
    } finally {
      server.stop(true)
    }
    expect(DEFAULT_DEBUG_URL).toContain('9222')
  })
})

describe('crLogin 参数校验', () => {
  test('缺少邮箱/密码直接报错', async () => {
    await expect(crLogin({ email: '', password: 'x' })).rejects.toThrow('需要 Crunchyroll 邮箱和密码')
    await expect(crLogin({ email: 'a@b.c', password: '' })).rejects.toThrow('需要 Crunchyroll 邮箱和密码')
  })
})
