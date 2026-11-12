/** 节点等待只退避原任务；使用临时文件和离线服务，不访问真实网盘。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import { completePublication, preparePublication } from './publication.ts'
import { PublisherError } from './retry.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { TaskSnapshot } from './publication-state.ts'
import type { DlTask } from '../../lib/jobs.ts'

test('节点等待按 5 秒、10 秒退避，恢复后沿原身份完成且不产生失败上报', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pf-worker-wait-'))
  const path = join(directory, 'Show.S01E01.mkv')
  writeFileSync(path, Buffer.alloc(1024, 9))
  const identity = { id: 'pub', name: 'Publisher', kind: 'publisher' as const, sourceAccount: { id: 'source', alias: 'source', name: 'Source' }, categories: [{ value: 'short', label: '短剧' }] }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.test', key: 'offline-only' }), verify: async () => identity })
  await connection.verify()
  const draft = completePublication(preparePublication({ provider: 'hongguo', sourceWorkId: 'series1', title: '第一集', series: '作品', vid: 'ep1', season: 1, episode: 1, tmdbId: 0, quality: '1080', codec: 'h264', group: '', plot: '' } as DlTask,
    connection.view(), 'short', '0', '/', { existingReleaseId: 'a'.repeat(32) }), path,
    { media: { status: 'probed', width: 1080, height: 1920, codec: 'h264', dynamicRange: 'SDR' }, file: { size: 1024 } })
  let now = Date.now(), attempts = 0, view = draft
  const keys: string[] = [], reports: TaskSnapshot[] = []
  connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, payload: unknown): Promise<T> => {
    const input = payload as { action?: string; taskKey?: string }
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') { reports.push(structuredClone(payload as TaskSnapshot)); return { outcome: 'applied' } as T }
    if (route === 'files/ed2k') return { accepted: true } as T
    if (input.action === 'release' || input.action === 'heartbeat') return {} as T
    if (route === 'files/report') return { outcome: 'applied' } as T
    keys.push(input.taskKey!)
    if (++attempts <= 2) throw new PublisherError('等待执行节点恢复，将自动继续原上传任务', true, undefined,
      { stage: '申请上传', code: 'CLOUD_WAITING_WORKER', httpStatus: 503 })
    return { dispatch: { status: 'ready', fileId: '123', pickCode: 'original', filePickCode: 'finished' } } as T
  }
  const worker = new PublicationWorker(connection, value => { view = value }, { directory, manual: true, now: () => now })
  const pump = async (done: () => boolean) => {
    for (let i = 0; i < 200; i++) {
      await worker.tick()
      if (done()) return
      await Bun.sleep(5)
    }
    throw Error(`未到达预期状态：${view.progress?.stage}/${attempts}`)
  }
  try {
    worker.register(draft)
    worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: path, err: '' })
    await pump(() => attempts === 1 && view.progress?.stage === 'processing' && !!view.progress.error)
    now += 4999
    await worker.tick(); expect(attempts).toBe(1)
    now++
    await pump(() => attempts === 2 && view.progress?.stage === 'processing' && !!view.progress.error)
    now += 9999
    await worker.tick(); expect(attempts).toBe(2)
    now++
    await pump(() => view.progress?.stage === 'completed')
    await worker.tick()
    expect(attempts).toBe(3)
    expect(new Set(keys)).toEqual(new Set([draft.fileKey]))
    expect(reports.some(r => r.stage === 'failed')).toBe(false)
    expect(new Set(reports.map(r => r.attempt))).toEqual(new Set([1, 2]))
    expect(reports.at(-1)?.attempt).toBe(2)
  } finally {
    await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true })
  }
})
