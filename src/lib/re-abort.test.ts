import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runM3u8dl } from './media.ts'

/** Stop a fake downloader that spawned a child, like RE's shaka-packager. */
const NESTED_SCRIPT = `
const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'ignore' })
require('node:fs').writeFileSync(process.argv[1], String(child.pid))
setInterval(() => {}, 1000)
`

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('aborting runM3u8dl kills the whole process tree and reports the abort reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-re-abort-'))
  const pidFile = join(dir, 'grandchild.pid')
  try {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort('pause'), 1200)
    const started = Date.now()
    await expect(runM3u8dl(process.execPath, ['-e', NESTED_SCRIPT, pidFile], '', undefined, undefined, undefined, ctrl.signal))
      .rejects.toBe('pause')
    // A killed process tree closes fast; a hung child would keep it open.
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(existsSync(pidFile)).toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // On Windows `child.kill()` alone would leave this one running and holding
    // the RE temp files, which is exactly what a resume must not race.
    expect(alive(grandchild)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)

test('an already aborted signal rejects before spawning anything', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-re-preabort-'))
  const pidFile = join(dir, 'grandchild.pid')
  try {
    const ctrl = new AbortController()
    ctrl.abort('cancel')
    await expect(runM3u8dl(process.execPath, ['-e', NESTED_SCRIPT, pidFile], '', undefined, undefined, undefined, ctrl.signal))
      .rejects.toBe('cancel')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(existsSync(pidFile)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 30_000)

test('an exhausted CDN retry is still reported as a CDN denial, not as a stop', async () => {
  const script = `process.stdout.write('WARN: HTTP 403 Forbidden\\nretry attempts have been exhausted')`
  await expect(runM3u8dl(process.execPath, ['-e', script], ''))
    .rejects.toMatchObject({ name: 'CdnDenied' })
}, 30_000)

test('a download failure without a signal still reports its own error', async () => {
  await expect(runM3u8dl(process.execPath, ['-e', `process.stdout.write('ERROR: Failed')`], ''))
    .rejects.toThrow('N_m3u8DL-RE 下载失败')
}, 30_000)
