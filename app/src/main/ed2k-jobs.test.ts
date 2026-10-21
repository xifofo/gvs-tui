/** 假后台线程验证共享、取消与文件占用，不启动 Electron 或访问网盘。 */
import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import { createED2KComputer } from './ed2k-jobs'
import { ed2kFile } from './ed2k'
import { localFileInUse } from '../../../src/lib/local-file-use.ts'

test('历史与发布端共享计算，取消一个调用不打断另一个；变更文件不能复用摘要', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ed2k-jobs-')), path = join(dir, 'video.mkv')
  writeFileSync(path, 'abc')
  const workers: Array<EventEmitter & { terminate(): Promise<number> }> = []
  const compute = createED2KComputer(() => {
    const worker = Object.assign(new EventEmitter(), { terminate: async () => { worker.emit('exit', 0); return 0 } })
    workers.push(worker)
    return worker as unknown as Worker
  })
  try {
    const progress: number[] = []
    const abort = new AbortController(), first = compute(path, abort.signal).catch(() => null), second = compute(path, undefined, (done, total) => { progress.push(done / total) })
    expect(workers.length).toBe(1)
    workers[0]!.emit('message', { type: 'progress', done: 1, total: 3 })
    expect(progress).toEqual([1 / 3])
    abort.abort(); expect(await first).toBe(null)
    expect(localFileInUse(path)).toBe(true)
    const result = await ed2kFile(path)
    workers[0]!.emit('message', { type: 'done', ...result })
    expect((await second).link).toBe(result.link)
    expect(localFileInUse(path)).toBe(false)
    expect((await compute(path)).link).toBe(result.link)
    expect(workers.length).toBe(1)
    writeFileSync(path, 'changed')
    const next = compute(path)
    expect(workers.length).toBe(2)
    workers[1]!.emit('message', { type: 'done', ...await ed2kFile(path) })
    expect((await next).size).toBe(7)
    const last = new AbortController()
    writeFileSync(path, 'new content')
    const cancelled = compute(path, last.signal).catch(() => null)
    last.abort(); expect(await cancelled).toBe(null)
    expect(localFileInUse(path)).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
