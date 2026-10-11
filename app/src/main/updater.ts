// 从 GitHub Release 自动更新。
//
// 仓库里同时有 TUI 的发布（v0.2.x），electron-updater 的 GitHub provider 只认
// 「Latest release」，会拿到 TUI 的发布。所以这里自己挑出最新的 desktop-v* 发布，
// 再把那个发布的下载目录作为 generic 源交给 electron-updater（读 latest.yml、
// 下载、校验 sha512）。
//
// Windows（NSIS）：自动下载，下载完提示重启安装；不重启则退出时安装。
// macOS：没有代码签名，Squirrel.Mac 不允许自动替换，只提示并打开发布页。
import { app, net, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UpdateState } from '@shared/api'
import { runLog } from '@tui/runlog.ts'
import { DesktopReleaseClient, RELEASES_URL, newer, releaseFromURL, type ReleaseCache } from './updater-release'
import { downloadFailureMessage, failedCheckState } from './updater-state'

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export class Updater {
  private state: UpdateState = { status: 'idle', version: '', current: app.getVersion(), percent: 0, message: '', url: '', auto: false }
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private flight: Promise<UpdateState> | null = null
  private manualRequested = false
  private readonly releases: DesktopReleaseClient
  private cacheWrite: Promise<void> = Promise.resolve()

  constructor(private readonly emit: (s: UpdateState) => void) {
    const cachePath = join(app.getPath('userData'), 'desktop-update-cache.json')
    let cache: unknown
    try { if (statSync(cachePath).size < 64 * 1024) cache = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { /* First launch or invalid cache. */ }
    this.releases = new DesktopReleaseClient({
      fetch: (url, init) => net.fetch(url, init), cache,
      save: (value: ReleaseCache) => {
        const text = JSON.stringify(value)
        this.cacheWrite = this.cacheWrite.then(async () => {
          await mkdir(dirname(cachePath), { recursive: true })
          await writeFile(`${cachePath}.tmp`, text, 'utf8')
          await rename(`${cachePath}.tmp`, cachePath)
        }).catch(() => runLog('updater cache write failed'))
      },
    })
    this.state.auto = app.isPackaged && process.platform === 'win32'
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = { info: (m: unknown) => runLog(`updater ${m}`), warn: (m: unknown) => runLog(`updater warn ${m}`), error: (m: unknown) => runLog(`updater error ${m}`), debug: () => {} }
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version, percent: 100, message: '' }))
    // An inconsistent channel file must not erase the newer release found by the API.
    autoUpdater.on('update-not-available', () => {
      if (this.state.status !== 'ready') this.set({ status: 'available', message: '该发布暂未提供适用于当前系统的更新包，可打开官方发布页查看。' })
    })
    autoUpdater.on('error', (e) => this.downloadFailed(e))
  }

  view(): UpdateState {
    return { ...this.state }
  }

  private set(patch: Partial<UpdateState>): void {
    Object.assign(this.state, patch)
    this.emit(this.view())
  }

  private downloadFailed(error: unknown): void {
    runLog(`update download failed: ${error instanceof Error ? error.message : String(error)}`)
    if (this.state.status === 'ready') return
    // Keep the official release actionable even if an automatic package download fails.
    this.set({ status: this.state.version ? 'available' : 'error', message: downloadFailureMessage(error), url: this.state.url || RELEASES_URL })
  }

  start(): void {
    if (!app.isPackaged || this.timer) return // 开发版不检查
    this.startupTimer = setTimeout(() => { this.startupTimer = null; void this.check(false) }, 15_000)
    this.timer = setInterval(() => void this.check(false), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.timer = this.startupTimer = null
  }

  check(manual: boolean): Promise<UpdateState> {
    if (this.flight) {
      this.manualRequested ||= manual
      return this.flight
    }
    if (this.state.status === 'downloading' || this.state.status === 'ready') return Promise.resolve(this.view())
    this.manualRequested = manual
    this.flight = this.checkOnce(manual).finally(() => { this.flight = null })
    return this.flight
  }

  private async checkOnce(manual: boolean): Promise<UpdateState> {
    const before = this.view()
    if (manual || before.status === 'idle') this.set({ status: 'checking', message: '' })
    try {
      const result = await this.releases.check(manual)
      if (!result.verified) {
        runLog(`update check deferred: ${result.message}`)
        this.set(failedCheckState(before, this.view(), this.manualRequested, result.message, result.url))
        return this.view()
      }
      const rel = result.release
      const version = rel?.version ?? ''
      if (!rel || !newer(version, this.state.current)) {
        this.set({ status: 'latest', version: version || this.state.current, message: '', url: RELEASES_URL })
        return this.view()
      }
      this.set({ status: 'available', version, url: rel.url, message: '' })
      if (!this.state.auto) {
        if (!app.isPackaged && manual) this.set({ message: '开发版不自动安装' })
        return this.view()
      }
      autoUpdater.setFeedURL({ provider: 'generic', url: `${RELEASES_URL}/download/${rel.tag}` })
      await autoUpdater.checkForUpdates() // autoDownload=true：发现即下载
    } catch (e) {
      // Release lookup returns controlled failure results; exceptions here come from the package updater.
      this.downloadFailed(e)
    }
    return this.view()
  }

  install(): void {
    if (this.state.status === 'ready') {
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
      return
    }
    if (this.state.url === RELEASES_URL || releaseFromURL(this.state.url)) void shell.openExternal(this.state.url)
  }
}
