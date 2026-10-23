import { BrowserWindow } from 'electron'
import { authCodeFrom, isAuthRedirect } from '@shared/cr-sso'

const TIMEOUT_MS = 5 * 60 * 1000

/**
 * 干净 Chrome UA。Electron 默认 UA 带 `Electron/44`，源站登录页（reCAPTCHA Enterprise）
 * 会把它当非浏览器环境，注入的授权窗更容易被判成可疑。
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/** 登录窗用的独立 session；退出登录时 core 会 clearStorageData 这个分区。 */
export const CR_SSO_PARTITION = 'persist:cr-sso'

/** will-navigate / will-redirect 的第一个参数在 Electron 44 里是带 url 的 Event。 */
type NavLike = { url?: string; preventDefault?: () => void }

export type CrLoginHandle = {
  /** 拿到授权码时 resolve；超时、关窗、回跳没 code 时 reject。 */
  code: Promise<string>
  /** 把兑换结果写回窗口再关，避免"窗口一闪就没了"看不出成败。 */
  showResult(ok: boolean, message: string): void
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

function statusPage(title: string, detail: string, tone: 'wait' | 'ok' | 'err'): string {
  const color = tone === 'ok' ? '#2f9e44' : tone === 'err' ? '#e03131' : '#4dabf7'
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Crunchyroll</title>
<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e9ecef;
font:15px/1.65 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}.box{max-width:420px;padding:26px 30px;text-align:center}
h1{margin:0 0 10px;font-size:17px;color:${color}}p{margin:0;color:#98a2b3;word-break:break-word}</style></head>
<body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/**
 * 打开 Crunchyroll 授权窗，等 `crunchyroll://auth?code=…` 回跳。
 *
 * 已登录过的情况下 CR 会秒回跳，窗口基本来不及显示登录页——所以命中回跳后不立刻关窗，
 * 而是切到一张状态页，等调用方 `showResult()` 把兑换结果写回来再关。
 *
 * 自定义 scheme 有三条捕获路径，全接上：
 *   will-navigate / will-redirect  正常导航（能 preventDefault，别让系统去开外部应用）
 *   did-navigate                   已经导航过去
 *   did-fail-load                  Chromium 当未知协议拦掉时，validatedURL 仍带原始地址
 */
export function openCrunchyrollLogin(
  authorizeUrl: string,
  log: (msg: string) => void,
): CrLoginHandle {
  let resolveCode: (code: string) => void = () => {}
  let rejectCode: (err: Error) => void = () => {}
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  // 调用方可能只 await code 而不接 showResult；这里兜住未处理的 rejection
  code.catch(() => {})

  const win = new BrowserWindow({
    width: 520,
    height: 800,
    show: true,
    title: 'Crunchyroll 登录',
    autoHideMenuBar: true,
    webPreferences: {
      // 独立 partition：CR 的登录态不污染主窗口，也不与其它平台互相影响
      partition: CR_SSO_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })

  // 主进程日志同时进 run log 和 stdout（dev 下 stdout 直接能看到，排障用）。
  const say = (msg: string): void => {
    log(`cr sso: ${msg}`)
    console.log(`[cr-sso] ${msg}`)
  }

  /** 只留足以辨认的部分：code 是单次凭证，别整条落日志。 */
  const redact = (url: string): string =>
    url.replace(/([?&]code=)([^&#]{4})[^&#]*/i, '$1$2…').slice(0, 140)

  let captured = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const closeSoon = (ms: number): void => {
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy()
    }, ms)
  }

  const showResult = (ok: boolean, message: string): void => {
    if (closed) return
    const page = ok
      ? statusPage('登录成功', message + '\n窗口即将自动关闭。', 'ok')
      : statusPage('登录未完成', message, 'err')
    if (win.isDestroyed()) return
    void win.loadURL(page).catch(() => {})
    closeSoon(ok ? 1800 : 6000)
  }

  const fail = (err: string): void => {
    // 已经拿到 code 就别再把 promise 打成失败：loadURL 的 ERR_ABORTED 常常晚于回跳到达。
    if (closed || captured) return
    closed = true
    if (timer) clearTimeout(timer)
    rejectCode(new Error(err))
    if (!win.isDestroyed()) win.destroy()
  }

  const consider = (url: string): void => {
    if (!isAuthRedirect(url)) return
    if (captured) return
    captured = true
    if (timer) clearTimeout(timer)
    const got = authCodeFrom(url)
    say(`捕获回跳 ${redact(url)} code=${got ? got.slice(0, 6) + '…' : '无'}`)
    if (!got) {
      closed = true
      rejectCode(new Error(`授权回跳里没有 code：${redact(url)}`))
      if (!win.isDestroyed()) win.destroy()
      return
    }
    void win.loadURL(statusPage('登录成功', '正在换取下载令牌…', 'wait')).catch(() => {})
    resolveCode(got)
  }

  const guard = (event: NavLike, legacyUrl?: string): void => {
    const url = event?.url || legacyUrl || ''
    if (!isAuthRedirect(url)) return
    event.preventDefault?.()
    consider(url)
  }

  const wc = win.webContents
  wc.on('will-navigate', guard)
  wc.on('will-redirect', guard)
  wc.on('did-navigate', (_e, url) => {
    if (!captured) say(`did-navigate ${redact(url)}`)
    consider(url)
  })
  // 未知 scheme 被 Chromium 丢掉时，validatedURL 仍是原始地址
  wc.on('did-fail-load', (_e, errorCode, desc, validatedURL, isMainFrame) => {
    if (!isAuthRedirect(validatedURL || '')) say(`did-fail-load ${errorCode} ${desc} main=${isMainFrame}`)
    consider(validatedURL)
  })
  // 登录页不该弹新窗口；真弹了直接拒掉，别让它跑进系统浏览器（那样就截不到 code 了）
  wc.setWindowOpenHandler(({ url }) => {
    say(`window-open 被拒 ${redact(url)}`)
    return { action: 'deny' }
  })
  wc.setUserAgent(CHROME_UA)
  win.on('closed', () => {
    closed = true
    if (timer) clearTimeout(timer)
    if (!captured) rejectCode(new Error('登录窗口已关闭'))
  })

  timer = setTimeout(() => fail('登录超时（5 分钟），请重试'), TIMEOUT_MS)

  say(`打开授权页 ${redact(authorizeUrl)}`)
  void win.loadURL(authorizeUrl).catch((e: unknown) => {
    const msg = String(e)
    say(`loadURL rejected ${msg}`)
    // ERR_ABORTED(-3) 是正常现象：页面内部重定向（含已登录时的秒回跳）会中止最初那次 loadURL，
    // 真正结果看 will-redirect / did-fail-load 里捕获的回跳。
    if (/ERR_ABORTED/.test(msg)) return
    fail('授权页打不开，请检查网络后重试')
  })

  return { code, showResult }
}
