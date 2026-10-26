/**
 * Crunchyroll 网页会话登录（etp_rt）。
 *
 * 背景：CR 的 SSO 设备授权页对当前 client_id 只渲染 loading（无请求、无按钮），
 * 拿不到授权码也就换不到 refresh_token；password grant 也已被服务端废弃。
 * 还能走通的是网页登录态：网页登录后拿 etp_rt cookie，网关用
 * grant_type=etp_rt_cookie 换 access_token（见网关 v3.9.111）。
 *
 * 这里用 Chrome DevTools Protocol 驱动本机 Chrome：打开登录页 → 填邮箱/密码 →
 * 轮询 cookie 拿 etp_rt。复用已在跑的 9222 调试端口；没有就拉起一个独立
 * profile 的 Chrome，不动用户现有窗口。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_DEBUG_URL = 'http://127.0.0.1:9222'
export const LOGIN_URL = 'https://sso.crunchyroll.com/login'

export type CdpCookie = { name: string; value: string }

/** 从 CDP 返回的 cookie 列表里取 etp_rt。 */
export function etpRtFromCookies(cookies: CdpCookie[]): string {
  const hit = cookies.find((c) => c && c.name === 'etp_rt' && typeof c.value === 'string')
  return hit ? hit.value.trim() : ''
}

/** 登录表单是否渲染完成（页面是客户端渲染，只能轮询 DOM）。 */
export function loginFormReady(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as { email?: unknown; pass?: unknown }
  return o.email === true && o.pass === true
}

/** 生成填表并提交的 JS；用 JSON.stringify 避免引号/换行注入。 */
export function buildLoginScript(email: string, password: string): string {
  return `(() => {
    const setVal = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, v);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    };
    const e = document.querySelector('input[type=email],input[name=email]');
    const p = document.querySelector('input[type=password],input[name=password]');
    if (!e || !p) return 'no-input';
    setVal(e, ${JSON.stringify(email)});
    setVal(p, ${JSON.stringify(password)});
    const btn = [...document.querySelectorAll('button')].find(b => /^(登入|登錄|Log in|Sign in)/i.test((b.innerText||'').trim()));
    if (!btn) return 'no-button';
    btn.click();
    return 'submitted';
  })()`
}

/** 在页面里用 etp_rt 换一次 access_token，确认网关侧可用。 */
export function buildVerifyScript(): string {
  return `(async () => {
    const r = await fetch('https://www.crunchyroll.com/auth/v1/token', {
      method: 'POST', credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic bm9haWhkZXZtXzZpeWcwYThsMHE6'
      },
      body: 'device_id=gw-tui&device_type=Chrome%20on%20macOS&grant_type=etp_rt_cookie'
    });
    const t = await r.text();
    let ok = false, reason = '';
    try {
      const j = JSON.parse(t);
      ok = typeof j.access_token === 'string' && j.access_token.length > 0;
      reason = ok ? '' : String(j.error || j.reason || '');
    } catch { reason = 'decode'; }
    return JSON.stringify({ status: r.status, ok, reason });
  })()`
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/** 极简 CDP 客户端（Runtime / Network / Target 三个域够用）。 */
export class CdpConnection {
  private next = 1
  private pending = new Map<number, Pending>()

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } }
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (typeof msg.id !== 'number') return
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'))
      else p.resolve(msg.result)
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('Chrome 调试连接已断开'))
      this.pending.clear()
    })
  }

  static connect(url: string, timeoutMs = 5000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
      if (!WS) throw new Error('当前运行时没有 WebSocket')
      const ws = new WS(url)
      const timer = setTimeout(() => reject(new Error('连接 Chrome 调试端口超时')), timeoutMs)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new CdpConnection(ws))
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('连接 Chrome 调试端口失败'))
      })
    })
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<unknown> {
    const id = this.next++
    const p = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP ${method} 超时`))
        }
      }, timeoutMs)
    })
    this.ws.send(JSON.stringify({ id, method, params }))
    return p
  }

  close(): void {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

/** 统计调试端口是否在跑。 */
export async function debugEndpointUp(base: string, timeoutMs = 1200): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(`${base.replace(/\/+$/, '')}/json/version`, { signal: ctl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

/** 平台相关的 Chrome 可执行文件候选。 */
export function chromeCandidates(platform = process.platform): string[] {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
  }
  if (platform === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean) as string[]
    return roots.flatMap((r) => [
      join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ])
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
}

/** 确保有一个可连接的 Chrome 调试端口：已在跑就复用，否则拉起独立 profile。 */
export async function ensureChromeDebug(base = DEFAULT_DEBUG_URL, timeoutMs = 15000): Promise<void> {
  if (await debugEndpointUp(base)) return
  const port = new URL(base).port || '9222'
  const bin = chromeCandidates().find((p) => p.includes('/') || p.includes('\\') ? existsSync(p) : true)
  if (!bin) throw new Error('没找到 Chrome；请安装 Chrome，或先用 --remote-debugging-port=9222 启动它')
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(tmpdir(), 'gvs-cr-login')}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  try {
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (e) {
    throw new Error(`启动 Chrome 失败：${e instanceof Error ? e.message : String(e)}`)
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await debugEndpointUp(base)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Chrome 调试端口没有起来；可手动执行 open -a "Google Chrome" --args --remote-debugging-port=9222')
}

async function newTarget(base: string, url: string): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  const r = await fetch(`${base.replace(/\/+$/, '')}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!r.ok) throw new Error(`创建标签页失败 HTTP ${r.status}`)
  const j = (await r.json()) as { id?: string; webSocketDebuggerUrl?: string }
  if (!j.webSocketDebuggerUrl) throw new Error('Chrome 没返回 webSocketDebuggerUrl')
  return { id: j.id || '', webSocketDebuggerUrl: j.webSocketDebuggerUrl }
}

async function evalJson(conn: CdpConnection, expression: string): Promise<unknown> {
  const res = (await conn.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
    result?: { value?: unknown }
    exceptionDetails?: { text?: string }
  }
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || '页面脚本执行失败')
  const v = res.result?.value
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return v }
  }
  return v
}

async function getCookies(conn: CdpConnection): Promise<CdpCookie[]> {
  const res = (await conn.call('Network.getCookies', {
    urls: ['https://www.crunchyroll.com/', 'https://sso.crunchyroll.com/'],
  })) as { cookies?: CdpCookie[] }
  return res.cookies || []
}

export type CrLoginOptions = {
  email: string
  password: string
  debugUrl?: string
  timeoutMs?: number
  onStatus?: (message: string) => void
}

/**
 * 自动登录并返回 etp_rt；失败抛错并带上阶段说明。
 * 凭据只在本次函数调用里使用，不落盘、不写日志。
 */
export async function crLogin(opts: CrLoginOptions): Promise<string> {
  const base = (opts.debugUrl || DEFAULT_DEBUG_URL).replace(/\/+$/, '')
  const total = opts.timeoutMs ?? 90_000
  const status = opts.onStatus ?? (() => {})
  const email = opts.email.trim()
  if (!email || !opts.password) throw new Error('需要 Crunchyroll 邮箱和密码')

  status('准备 Chrome 调试端口…')
  await ensureChromeDebug(base)

  const t = await newTarget(base, LOGIN_URL)
  const conn = await CdpConnection.connect(t.webSocketDebuggerUrl)
  try {
    await conn.call('Page.enable')
    await conn.call('Network.enable')

    // 已登录（浏览器里有 etp_rt）就直接复用
    const existing = etpRtFromCookies(await getCookies(conn))
    if (existing) {
      status('已登录，复用现有网页会话')
      return existing
    }

    status('等待登录表单…')
    const formDeadline = Date.now() + Math.min(40_000, total)
    let ready = false
    while (Date.now() < formDeadline) {
      const state = await evalJson(conn, `JSON.stringify({
        email: !!document.querySelector('input[type=email],input[name=email]'),
        pass: !!document.querySelector('input[type=password],input[name=password]')
      })`)
      if (loginFormReady(state)) { ready = true; break }
      await new Promise((r) => setTimeout(r, 700))
    }
    if (!ready) throw new Error('没等到登录表单（可能需要邮箱验证或被人机校验拦下）')

    status('提交账号密码…')
    const filled = await evalJson(conn, buildLoginScript(email, opts.password))
    if (filled !== 'submitted') throw new Error(`填表失败：${String(filled)}`)

    status('等待 etp_rt…')
    const cookieDeadline = Date.now() + Math.min(45_000, total)
    while (Date.now() < cookieDeadline) {
      await new Promise((r) => setTimeout(r, 1000))
      const rt = etpRtFromCookies(await getCookies(conn))
      if (rt) {
        status('校验会话…')
        const v = (await evalJson(conn, buildVerifyScript())) as { ok?: boolean; status?: number; reason?: string }
        if (!v || v.ok !== true) {
          throw new Error(`会话校验失败 HTTP ${v?.status ?? '?'} ${v?.reason ?? ''}`.trim())
        }
        status('登录成功')
        return rt
      }
    }
    throw new Error('登录后没拿到 etp_rt（可能要求邮箱验证或人工确认）')
  } finally {
    conn.close()
  }
}
