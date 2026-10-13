import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookRun } from '@shared/api'
import { normalizeHooks, renderHook, runHook } from './hooks'

const vars = { file: 'D:\\dl\\剧 & 名\\a.mkv', dir: 'D:\\dl\\剧 & 名', title: '剧"名; rm -rf', episode: 'S01E02', ed2k: 'ed2k://|file|a.mkv|3|AB|/' }

test('renderHook substitutes placeholders and neutralises shell metacharacters in values', () => {
  expect(renderHook('rclone copy "{file}" remote:{episode}', vars)).toBe('rclone copy "D:\\dl\\剧 _ 名\\a.mkv" remote:S01E02')
  expect(renderHook('echo "{title}"', vars)).toBe("echo \"剧'名_ rm -rf\"")
  expect(renderHook('echo {ed2k} {unknown}', vars)).toBe('echo ed2k://_file_a.mkv_3_AB_/ {unknown}')
})

test('normalizeHooks fills defaults and clamps timeout', () => {
  expect(normalizeHooks(null)).toEqual({ start: { notify: false, command: '' }, complete: { notify: true, command: '' }, timeoutSec: 600, ed2k: false })
  expect(normalizeHooks({ timeoutSec: 1, complete: { command: 'x' } }).timeoutSec).toBe(5)
  expect(normalizeHooks({ complete: { command: 'x' } }).complete).toEqual({ notify: true, command: 'x' })
})

test('runHook runs detached, logs output and reports exit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'))
  const done = await new Promise<HookRun>((res) => runHook('complete', 'echo hi-{episode}', { ...vars, dir: '' }, 30, { logDir: dir }, res))
  expect([done.state, done.exitCode]).toEqual(['ok', 0])
  expect(readFileSync(done.log, 'utf8')).toContain('hi-S01E02')
})

test('runHook enforces the timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-'))
  const cmd = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30'
  const done = await new Promise<HookRun>((res) => runHook('start', cmd, { ...vars, dir: '' }, 0.3 as number, { logDir: dir }, res))
  expect(done.state).toBe('timeout')
}, 15_000)
