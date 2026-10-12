import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import trayIconPath from '../../build/icon.png?asset'
import { SubscriptionManager } from './subscriptions'
import { fetchCalendar } from './calendar-source'
import type { Subscription } from '@shared/api'
import type { GvsApi, JobView, Tone } from '@shared/api'
import { captureProxyEnv, installIQSourceProxy, patchGlobalWebSocket } from './env'
import { Core } from './core'
import { handlePosterProtocol, registerPosterScheme } from './posters'
import { runLog } from '@tui/runlog.ts'
import { Updater } from './updater'
import { userMessage, userFacing } from '@tui/user-message.ts'

// 开发调试：独立 profile，不和已安装的 GVS 抢单实例锁。
// 同时把 configPath() 依赖的 APPDATA 也指过去（它在每次调用时读环境变量），
// 这样冒烟运行不会碰到真实的 tui.json / 日志。
// 必须在任何 configPath() 调用之前——captureProxyEnv() 就会写日志路径。
if (process.env.GVS_PROFILE_DIR) {
  app.setPath('userData', process.env.GVS_PROFILE_DIR)
  process.env.APPDATA = process.env.GVS_PROFILE_DIR
}
process.env.GVS_VERSION_RECORDS_PATH ||= join(app.getPath('userData'), 'actual-versions.jsonl')

captureProxyEnv()
patchGlobalWebSocket()
installIQSourceProxy()
registerPosterScheme()

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let quitting = false
let trayHintShown = false

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, userFacing(payload))
}

let stateTimer: NodeJS.Timeout | null = null
const core = new Core({
  state: () => {
    if (stateTimer) return
    stateTimer = setTimeout(() => {
      stateTimer = null
      send('gvs:state', core.state())
    }, 50)
  },
  jobs: (jobs: JobView[]) => send('gvs:jobs', jobs),
  toast: (message: string, tone: Tone) => send('gvs:toast', { message, tone }),
})

// ---------------------------------------------------------------- 订阅
const subsPath = () => join(app.getPath('userData'), 'subscriptions.json')
const subs = new SubscriptionManager({
  detail: (p, id) => core.detail(p, id),
  probe: (p, eps) => core.probe(p, eps),
  enqueue: (req) => core.enqueue(req),
  notify: (title, body, sub) => notify(title, body, sub),
  changed: (view) => {
    send('gvs:subs', view)
    refreshTray()
  },
  load: () => (existsSync(subsPath()) ? readFileSync(subsPath(), 'utf8') : null),
  save: (json) => {
    const p = subsPath()
    writeFileSync(p + '.tmp', json)
    renameSync(p + '.tmp', p)
  },
  log: runLog,
})

function notify(title: string, body: string, sub?: Subscription): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false, icon: trayIconPath })
  n.on('click', () => {
    showMainWindow()
    send('gvs:navigate', { view: 'subscriptions', subId: sub?.id })
  })
  n.show()
}

// ---------------------------------------------------------------- 托盘
let tray: Tray | null = null
function refreshTray(): void {
  if (!tray) return
  const paused = subs.isPaused()
  const v = subs.view()
  const fresh = v.subs.reduce((n, s) => n + s.newCount, 0)
  tray.setToolTip(`GVS · ${v.subs.length} 个订阅${fresh ? ` · ${fresh} 集新更新` : ''}${paused ? ' · 已暂停检查' : ''}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 GVS', click: showMainWindow },
      { label: '订阅', click: () => { showMainWindow(); send('gvs:navigate', { view: 'subscriptions' }) } },
      { type: 'separator' },
      { label: paused ? '恢复订阅检查' : '暂停订阅检查', click: () => subs.setPaused(!paused) },
      { label: v.running ? '正在检查…' : '立即检查全部订阅', enabled: !v.running, click: () => void subs.checkNow() },
      { type: 'separator' },
      { label: '退出 GVS', click: () => app.quit() },
    ]),
  )
}
function createTray(): void {
  const img = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  refreshTray()
}

const updater = new Updater((u) => {
  send('gvs:update', u)
  if (u.status === 'ready') send('gvs:toast', { message: `新版本 ${u.version} 已下载，重启即可安装`, tone: 'ok' })
})

const api: { [K in keyof GvsApi]: (...args: Parameters<GvsApi[K]>) => unknown } = {
  state: () => core.state(),
  setup: (host, key, proxy) => core.setup(host, key, proxy),
  saveSettings: (patch) => core.saveSettings(patch),
  catalog: (p) => core.catalog(p),
  browse: (p, s, c) => core.browse(p, s, c),
  tencentDiagnostics: (jobID) => core.tencentDiagnostics(jobID),
  providerSession: (command) => core.providerSession(command),
  parseLink: (t) => core.parseLink(t),
  searchTargets: () => core.searchTargets(),
  searchProvider: (p, q) => core.searchProvider(p, q),
  detail: (p, id, hint) => core.detail(p, id, hint),
  detailFromLink: (l, hint) => core.detailFromLink(l, hint),
  probe: (p, eps) => core.probe(p, eps),
  namingPreview: (r) => core.namingPreview(r),
  tmdbSearch: (t, tv) => core.tmdbSearch(t, tv),
  tmdbSeasons: (id) => core.tmdbSeasons(id),
  enqueue: (r) => core.enqueue(r),
  jobs: () => core.jobList(),
  retryJob: (id) => core.retryJob(id),
  pauseJob: (id) => core.pauseJob(id),
  resumeJob: (id) => core.resumeJob(id),
  removeJob: (id, deleteFiles) => core.removeJob(id, deleteFiles),
  pauseAll: () => core.pauseAll(),
  resumeAll: () => core.resumeAll(),
  clearFinished: () => core.clearFinished(),
  cacheInfo: () => core.cacheInfo(),
  clearCache: () => core.clearCache(),
  openPath: async (p) => {
    const err = await shell.openPath(p || core.outDir())
    if (err) throw new Error(err)
  },
  showItem: (p) => shell.showItemInFolder(p),
  chooseDir: async (start) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: (start || '').trim() || core.outDir(),
    })
    return r.canceled ? '' : (r.filePaths[0] ?? '')
  },
  youkuQrStart: () => core.youkuQrStart(),
  iqcnQrStart: () => core.iqcnQrStart(),
  iqcnQrPoll: () => core.iqcnQrPoll(),
  bilibiliQrStart: () => core.bilibiliQrStart(),
  bilibiliQrPoll: () => core.bilibiliQrPoll(),
  youkuQrPoll: () => core.youkuQrPoll(),
  youkuRenew: () => core.youkuRenew(),
  tencentQrStart: () => core.tencentQrStart(),
  tencentQrPoll: () => core.tencentQrPoll(),
  qrCancel: () => core.qrCancel(),
  updateState: () => updater.view(),
  checkUpdate: () => updater.check(true),
  installUpdate: () => updater.install(),
  subscriptions: () => subs.view(),
  subscribe: (req) => {
    const sub = subs.subscribe(req)
    void subs.checkNow(sub.id)
    return sub
  },
  updateSubscription: (id, patch) => subs.update(id, patch),
  unsubscribe: (id) => subs.remove(id),
  checkSubscriptions: (id) => subs.checkNow(id),
  setSubscriptionsPaused: (paused) => subs.setPaused(paused),
  setSubscriptionInterval: (minutes) => subs.setInterval(minutes),
  markSubscriptionsSeen: (id) => subs.markSeen(id),
  calendar: () => fetchCalendar(),
}

ipcMain.handle('gvs:call', async (_e, method: string, args: unknown[]) => {
  const fn = (api as Record<string, (...a: unknown[]) => unknown>)[method]
  if (!fn) return { ok: false, error: '当前客户端暂不支持此操作，请更新后重试。' }
  try {
    return { ok: true, data: userFacing(await fn(...(args ?? []))) }
  } catch (e) {
    runLog(`ipc ${method} failed: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, error: userMessage(e) }
  }
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'GVS',
    backgroundColor: '#f4f2ec',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show()
  })
  // 关窗口 = 收到托盘继续检查订阅；真正退出走托盘菜单「退出」
  win.on('close', (e) => {
    if (quitting || !tray) return
    e.preventDefault()
    win?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      notify('GVS 仍在后台运行', '订阅会继续按时检查；右键托盘图标可以暂停或退出。')
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const devURL = process.env.ELECTRON_RENDERER_URL
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(devURL && url.startsWith(devURL))) e.preventDefault()
  })
  if (devURL) void win.loadURL(devURL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

app.on('second-instance', showMainWindow)

app.whenReady().then(() => {
  // macOS 需要编辑菜单，复制/粘贴快捷键才生效；Windows 不要菜单栏。
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null,
  )
  handlePosterProtocol()
  if (process.platform === 'win32') app.setAppUserModelId('shop.videohack.gvs')
  createWindow()
  try {
    createTray()
  } catch (e) {
    runLog(`tray: create failed ${e instanceof Error ? e.message : e}`)
  }
  void core.boot().catch(() => {})
  subs.start()
  updater.start()
  app.on('activate', showMainWindow)
})

// Windows 上 Electron 退出不会顺手杀子进程（N_m3u8DL-RE / ffmpeg 会继续占着文件写），
// 所以第一次 before-quit 先拦住退出，等 core 把任务停干净并落盘 jobs.json，再真正退出。
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  // 用户如果就是不想等就强杀（任务管理器 / cmd 里按 Ctrl+C），别让系统干等。
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => app.exit(0))
  updater.stop()
  subs.stop()
  tray?.destroy()
  tray = null
  void (async () => {
    try {
      await core.shutdown()
    } catch (e) {
      runLog(`quit: shutdown failed ${e instanceof Error ? e.message : e}`)
    }
    core.dispose()
    // 这条日志是排查「关不掉 / 关了还有子进程」的第一个抓手。
    runLog('quit: shutdown done')
    app.quit()
  })()
})
// 有托盘时窗口只是隐藏，不会走到这里；托盘创建失败时保持原来的行为
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit()
})
