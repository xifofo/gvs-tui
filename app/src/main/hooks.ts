/**
 * 下载开始 / 完成钩子：系统通知开关 + 可选用户命令模板（如 rclone copy "{file}" remote:）。
 * 命令在后台独立运行（不阻塞下载队列），输出写到日志文件，超时强制结束。
 */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookEvent, HookRun, HookSettings } from '@shared/api'

export const DEFAULT_HOOKS: HookSettings = {
  start: { notify: false, command: '' },
  complete: { notify: true, command: '' },
  timeoutSec: 600,
  ed2k: false,
}

export function normalizeHooks(raw: unknown): HookSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HookSettings>
  const ev = (v: unknown, d: HookSettings['start']) => {
    const o = (v && typeof v === 'object' ? v : {}) as Partial<HookSettings['start']>
    return { notify: typeof o.notify === 'boolean' ? o.notify : d.notify, command: typeof o.command === 'string' ? o.command.slice(0, 2000) : d.command }
  }
  const t = Number(r.timeoutSec)
  return {
    start: ev(r.start, DEFAULT_HOOKS.start),
    complete: ev(r.complete, DEFAULT_HOOKS.complete),
    timeoutSec: Number.isFinite(t) ? Math.max(5, Math.min(86_400, Math.round(t))) : DEFAULT_HOOKS.timeoutSec,
    ed2k: typeof r.ed2k === 'boolean' ? r.ed2k : DEFAULT_HOOKS.ed2k,
  }
}

export type HookVars = { file: string; dir: string; title: string; episode: string; ed2k: string }
export const HOOK_PLACEHOLDERS: Array<keyof HookVars> = ['file', 'dir', 'title', 'episode', 'ed2k']

/**
 * 替换 {file} {dir} {title} {episode} {ed2k}。值里的引号、换行和 shell 元字符换成安全字符，
 * 模板自己负责加引号（"{file}"），这样标题里的 & | ; 等不会变成额外的命令。
 */
export function renderHook(template: string, vars: HookVars): string {
  const safe = (v: string) => v.replace(/[\r\n]+/g, ' ').replace(/["`$]/g, "'").replace(/[&|;<>^%!]/g, '_')
  return template.replace(/\{(file|dir|title|episode|ed2k)\}/g, (_, k: keyof HookVars) => safe(vars[k] ?? ''))
}

export type HookDeps = {
  logDir: string
  now?: () => number
  /** 测试注入 */
  spawnImpl?: typeof spawn
}

/** 后台运行一次钩子命令；结束（或超时）时 onDone 收到最终记录 */
export function runHook(event: HookEvent, template: string, vars: HookVars, timeoutSec: number, deps: HookDeps, onDone: (r: HookRun) => void): HookRun {
  const now = deps.now ?? Date.now
  const command = renderHook(template, vars)
  const startedAt = now()
  const log = join(deps.logDir, `${startedAt}-${event}.log`)
  const run: HookRun = { event, command, startedAt, finishedAt: 0, exitCode: null, state: 'running', log, message: '' }
  try {
    mkdirSync(dirname(log), { recursive: true })
    const out = createWriteStream(log)
    out.write(`$ ${command}\n`)
    const child = (deps.spawnImpl ?? spawn)(command, { shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], cwd: vars.dir || undefined })
    child.stdout?.pipe(out, { end: false })
    child.stderr?.pipe(out, { end: false })
    const timer = setTimeout(() => {
      run.state = 'timeout'
      run.message = `超时 ${timeoutSec} 秒，已结束`
      try {
        // Windows 上 shell 是 cmd.exe，只杀它不会带走子进程
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        else if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }
    }, timeoutSec * 1000)
    child.on('error', (e) => { run.message = e.message })
    child.on('close', (code) => {
      clearTimeout(timer)
      run.finishedAt = now()
      run.exitCode = code
      if (run.state !== 'timeout') run.state = code === 0 ? 'ok' : 'failed'
      if (!run.message && run.state === 'failed') run.message = `退出码 ${code}`
      out.end(`\n[exit ${code}] ${run.message}\n`)
      onDone({ ...run })
    })
  } catch (e) {
    run.state = 'failed'
    run.finishedAt = now()
    run.message = e instanceof Error ? e.message : String(e)
    onDone({ ...run })
  }
  return { ...run }
}
