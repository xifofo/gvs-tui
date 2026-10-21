/** 下载历史 + 钩子 + ed2k 的主进程编排（数据库：Electron 自带 node:sqlite） */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import type { HistoryEntry, HookEvent, HookRun, HookSettings, JobView } from '@shared/api'
import { HistoryDB, type SqlDb } from './history-db'
import { historyFromJob, migrateJobs, type TaskLike } from './download-history'
import { normalizeHooks, runHook } from './hooks'
import type { ED2KResult } from '../../../src/integrations/plutofish/publication-retention.ts'

export type HistoryServiceDeps = {
  dir: string
  openDb: (path: string) => SqlDb
  notify: (title: string, body: string) => void
  patchJob: (id: number, fn: (v: JobView) => void) => void
  createWorker: (path: string) => Worker
  computeFile?: (path: string, signal?: AbortSignal, progress?: (done: number, total: number) => void) => Promise<ED2KResult>
  log: (msg: string) => void
}

const sizeOf = (p: string) => { try { return statSync(p).size } catch { return 0 } }

export class HistoryService {
  readonly db: HistoryDB
  private hooks: HookSettings
  private readonly hooksPath: string
  private readonly running = new Map<number, Promise<string>>()

  constructor(private readonly deps: HistoryServiceDeps) {
    mkdirSync(deps.dir, { recursive: true })
    this.db = new HistoryDB(deps.openDb(join(deps.dir, 'history.sqlite')))
    this.hooksPath = join(deps.dir, 'hooks.json')
    let raw: unknown = null
    try { raw = existsSync(this.hooksPath) ? JSON.parse(readFileSync(this.hooksPath, 'utf8')) : null } catch { raw = null }
    this.hooks = normalizeHooks(raw)
  }

  hookSettings(): HookSettings { return structuredClone(this.hooks) }
  saveHookSettings(s: HookSettings): HookSettings {
    this.hooks = normalizeHooks(s)
    writeFileSync(this.hooksPath, JSON.stringify(this.hooks, null, 2))
    return this.hookSettings()
  }

  migrate(jobs: Array<{ view: JobView; task: TaskLike }>): void {
    const n = migrateJobs(this.db, jobs, sizeOf)
    if (n) this.deps.log(`history: imported ${n} completed jobs`)
  }

  onStart(view: JobView, task: TaskLike): void {
    const h = this.hooks.start
    if (h.notify) this.deps.notify('开始下载', `${view.groupTitle} ${view.label}`)
    if (h.command.trim()) this.fire('start', view, task, '')
  }

  onComplete(view: JobView, task: TaskLike): void {
    let entry: HistoryEntry | null = null
    try {
      entry = this.db.record(historyFromJob(view, task, sizeOf(view.output)))
      const id = entry.id
      this.deps.patchJob(view.id, (v) => { v.historyId = id })
    } catch (e) {
      this.deps.log(`history: record failed ${e instanceof Error ? e.message : e}`)
    }
    const h = this.hooks.complete
    if (h.notify) this.deps.notify('下载完成', `${view.groupTitle} ${view.label}`)
    const needEd2k = this.hooks.ed2k || /\{ed2k\}/.test(h.command)
    if (entry && needEd2k) {
      void this.computeEd2k(entry.id, view.id).then((link) => { if (h.command.trim()) this.fire('complete', view, task, link) }, () => { if (h.command.trim()) this.fire('complete', view, task, '') })
    } else if (h.command.trim()) this.fire('complete', view, task, '')
  }

  private fire(event: HookEvent, view: JobView, task: TaskLike, ed2k: string): void {
    const template = event === 'start' ? this.hooks.start.command : this.hooks.complete.command
    const file = event === 'complete' ? view.output : ''
    const vars = { file, dir: file ? dirname(file) : '', title: view.groupTitle, episode: task.kind === 'movie' ? view.label : view.label, ed2k }
    const put = (r: HookRun) => this.deps.patchJob(view.id, (v) => {
      const list = (v.hooks ?? []).filter((x) => !(x.event === r.event && x.startedAt === r.startedAt))
      v.hooks = [...list, r].slice(-6)
    })
    put(runHook(event, template, vars, this.hooks.timeoutSec, { logDir: join(this.deps.dir, 'hook-logs') }, (r) => {
      put(r)
      this.deps.log(`hook ${event} job=${view.id} ${r.state} exit=${r.exitCode}`)
    }))
  }

  /** 后台线程算 ed2k，结果写库；同一条记录并发调用复用同一个任务 */
  computeEd2k(historyId: number, jobId?: number): Promise<string> {
    const running = this.running.get(historyId)
    if (running) return running
    const entry = this.db.byId(historyId)
    const p = new Promise<string>((resolve, reject) => {
      if (!entry) return reject(new Error('记录不存在'))
      if (entry.ed2kLink) return resolve(entry.ed2kLink)
      if (!entry.filePath || !existsSync(entry.filePath)) return reject(new Error('本地文件已不存在，无法计算 ed2k'))
      const set = (s: NonNullable<JobView['ed2k']>) => { if (jobId) this.deps.patchJob(jobId, (v) => { v.ed2k = s }) }
      set({ state: 'running', pct: 0, link: '' })
      if (this.deps.computeFile) {
        void this.deps.computeFile(entry.filePath, undefined, (done, total) => set({ state: 'running', pct: done / total, link: '' })).then(result => {
          this.db.setEd2k(entry.id, result.hash, result.link)
          set({ state: 'done', pct: 1, link: result.link })
          resolve(result.link)
        }).catch(error => {
          set({ state: 'failed', pct: 0, link: '', message: error instanceof Error ? error.message : 'ED2K 计算失败' })
          reject(error)
        })
        return
      }
      const w = this.deps.createWorker(entry.filePath)
      w.on('message', (m: { type: string; done?: number; total?: number; hash?: string; link?: string; message?: string }) => {
        if (m.type === 'progress' && m.total) set({ state: 'running', pct: m.done! / m.total, link: '' })
        else if (m.type === 'done') {
          this.db.setEd2k(entry.id, m.hash!, m.link!)
          set({ state: 'done', pct: 1, link: m.link! })
          void w.terminate()
          resolve(m.link!)
        } else if (m.type === 'error') {
          set({ state: 'failed', pct: 0, link: '', message: m.message })
          void w.terminate()
          reject(new Error(m.message))
        }
      })
      w.on('error', (e) => { set({ state: 'failed', pct: 0, link: '', message: e.message }); reject(e) })
    }).finally(() => this.running.delete(historyId))
    this.running.set(historyId, p)
    return p
  }

  label(entry: HistoryEntry): string { return `${entry.showTitle} ${entry.label || basename(entry.filePath)}` }
}
