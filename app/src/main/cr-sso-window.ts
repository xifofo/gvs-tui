import { BrowserWindow } from 'electron'
import { authCodeFrom, isAuthRedirect } from '@shared/cr-sso'

const TIMEOUT_MS = 5 * 60 * 1000

/**
 * 干净 Chrome UA。Electron 默认 UA 带 `Electron/44`，源站登录页（reCAPTCHA Enterprise）
 * 会把它当非浏览器环境，注入的授权窗更容易被判成可疑。
 */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/** will-navigate / will-redirect 的第一个参数在 Electron 44 里是带 url 的 Event。 */
type NavLike = { url?: string; preventDefault?: () => void }

/**
 * 打开 Crunchyroll 授权窗，等 `crunchyroll://auth?code=…` 回跳。
 *
 * 命中后立刻关窗并返回 code；超时、用户关窗、回跳里没有 code 都会 reject。
 * 自定义 scheme 有三条可能的捕获路径，全接上：
 *   will-navigate / will-redirect  正常导航（能 preventDefault，别让系统去开外部应用）
 *   did-navigate                   已经导航过去
 *   did-fail-load                  Chromium 当未知协议拦掉时，validatedURL 仍带原始地址
 */
export function openCrunchyrollLogin(
  authorizeUrl: string,
  log: (msg: string) => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 800,
      show: true,
      title: 'Crunchyroll 登录',
      autoHideMenuBar: true,
      webPreferences: {
        // 独立 partition：CR 的登录态不污染主窗口，也不与其它平台互相影响
        partition: 'persist:cr-sso',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    })

    let done = false
    const finish = (code: string, err?: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      if (code) resolve(code)
      else reject(new Error(err || '登录未完成'))
    }

    const timer = setTimeout(() => finish('', '登录超时（5 分钟），请重试'), TIMEOUT_MS)

    const consider = (url: string): void => {
      if (!isAuthRedirect(url)) return
      log(`cr sso: 捕获授权回跳 ${url.slice(0, 48)}…`)
      const code = authCodeFrom(url)
      finish(code, code ? undefined : '授权回跳里没有 code，请重试')
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
    wc.on('did-navigate', (_e, url) => consider(url))
    // 未知 scheme 被 Chromium 丢掉时，validatedURL 仍是原始地址
    wc.on('did-fail-load', (_e, _code, _desc, validatedURL) => consider(validatedURL))
    // 登录页不该弹新窗口；真弹了直接拒掉，别让它跑进系统浏览器（那样就截不到 code 了）
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setUserAgent(CHROME_UA)
    win.on('closed', () => finish('', '登录窗口已关闭'))

    void win.loadURL(authorizeUrl).catch((e: unknown) => {
      log(`cr sso: loadURL failed ${String(e)}`)
      finish('', '授权页打不开，请检查网络后重试')
    })
  })
}
