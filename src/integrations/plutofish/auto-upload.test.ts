/** Offline scheduler checks; no real PlutoFish or 115 requests. */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlutoFishConnection } from './connection.ts'
import { PublicationWorker } from './publication-worker.ts'
import { completePublication, preparePublication } from './publication.ts'
import type { PublicationDraft } from './publication-types.ts'
import type { DlTask } from '../../lib/jobs.ts'

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'gvs-auto-upload-'))
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.test', key: 'fixture' }), verify: async () => ({
    id: 'pub', name: 'Fixture', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: 'Source' }, categories: [{ value: 'tv', label: '剧集' }],
  }) })
  await connection.verify()
  let enabled = false
  const views = new Map<string, PublicationDraft>(), starts: string[] = []
  let hold: string | undefined, finish: (() => void) | undefined
  connection.request = async <T>(_binding: unknown, route: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
    const input = payload as { action?: string; taskKey: string }
    if (route === 'range-proofs/pending') return { jobs: [] } as T
    if (route === 'tasks/report') return { outcome: 'applied' } as T
    if (route === 'files/report' || route === 'files/ed2k') return { accepted: true } as T
    if (route === 'uploads/prepare') {
      if (input.action === 'start') {
        starts.push(input.taskKey)
        if (hold === input.taskKey) await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal?.reason)
          signal?.addEventListener('abort', abort, { once: true })
          finish = () => { signal?.removeEventListener('abort', abort); resolve() }
        })
      }
      return { dispatch: { status: 'ready', fileId: '123', pickCode: 'fixture-file' } } as T
    }
    throw new Error(`Unexpected route ${route}`)
  }
  const makeWorker = () => new PublicationWorker(connection, draft => views.set(draft.fileKey, draft), {
    directory, manual: true, autoUpload: () => enabled,
    retention: { settings: () => ({ hours: 0 }) },
  })
  let worker = makeWorker()
  const drafts = [1, 2, 3, 4].map(n => {
    const path = join(directory, `Show.S01E0${n}.1080p.WEB-DL.SDR.AVC.mkv`)
    writeFileSync(path, Buffer.alloc(1024, n))
    return completePublication(preparePublication({ provider: 'youku', sourceWorkId: 'show', series: 'Show', title: `Episode ${n}`, vid: `ep${n}`,
      season: 1, episode: n, tmdbId: 123, quality: '1080', codec: 'h264', group: '', plot: '' } as DlTask, connection.view(), 'tv'), path,
    { file: { size: 1024 }, media: { status: 'probed', width: 1920, height: 1080, codec: 'h264', dynamicRange: 'SDR' } })
  })
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 100; i++) {
      await worker.tick()
      if (predicate()) return
      await Bun.sleep(5)
    }
    throw new Error('Upload scheduler did not reach the expected state')
  }
  return {
    drafts, views, starts, until, directory,
    get worker() { return worker },
    setEnabled(value: boolean) { enabled = value; worker.refreshUploadPolicy() },
    hold(key: string) { hold = key },
    finish() { finish?.() },
    async restart() { await worker.close(); worker = makeWorker(); worker.restored() },
    async close() { await worker.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

test('re-enabling uploads only new tasks while existing waiting and paused tasks survive restart', async () => {
  const f = await fixture(), [first, second, paused, fresh] = f.drafts as [PublicationDraft, PublicationDraft, PublicationDraft, PublicationDraft]
  try {
    for (const draft of [first, second, paused]) f.worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: draft.output, err: '' })
    f.worker.control(paused.fileKey, 'pause')
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([])
    expect(f.views.get(first.fileKey)?.progress?.awaitingManual).toBe(true)
    await f.restart()
    await f.worker.tick()
    expect(f.starts).toEqual([])
    expect(f.views.get(first.fileKey)?.progress?.awaitingManual).toBe(true)
    f.worker.control(first.fileKey, 'resume')
    await f.restart() // The explicit request remains authorized after a restart.
    await f.until(() => f.views.get(first.fileKey)?.progress?.stage === 'completed')
    expect(f.starts).toEqual([first.fileKey])
    expect(f.views.get(second.fileKey)?.progress?.awaitingManual).toBe(true)
    f.setEnabled(true)
    expect(f.views.get(second.fileKey)?.progress?.awaitingManual).toBe(true)
    await f.restart()
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([first.fileKey])
    expect(f.views.get(second.fileKey)?.progress?.awaitingManual).toBe(true)
    f.worker.event(fresh, { id: 4, done: true, status: '完成', pct: 1, log: fresh.output, err: '' })
    await f.until(() => f.views.get(fresh.fileKey)?.progress?.stage === 'completed')
    expect(f.starts).toEqual([first.fileKey, fresh.fileKey])
    expect(f.views.get(second.fileKey)?.progress?.awaitingManual).toBe(true)
    expect(f.views.get(paused.fileKey)?.progress?.stage).toBe('paused')
    f.worker.control(second.fileKey, 'resume')
    await f.until(() => f.views.get(second.fileKey)?.progress?.stage === 'completed')
    expect(f.starts).toEqual([first.fileKey, fresh.fileKey, second.fileKey])
  } finally { await f.close() }
})

test('turning off lets the active upload finish and holds the next file', async () => {
  const f = await fixture(), [first, next] = f.drafts as [PublicationDraft, PublicationDraft, PublicationDraft]
  try {
    f.setEnabled(true)
    f.hold(first.fileKey)
    f.worker.event(first, { id: 1, done: true, status: '完成', pct: 1, log: first.output, err: '' })
    await f.until(() => f.starts.length === 1)
    f.worker.event(next, { id: 2, done: true, status: '完成', pct: 1, log: next.output, err: '' })
    // Prepare the next file while the single upload slot is occupied.
    await f.until(() => f.views.get(next.fileKey)?.progress?.phase === 'hashing')
    f.setEnabled(false)
    expect(f.views.get(first.fileKey)?.progress?.awaitingManual).toBe(false)
    expect(f.views.get(next.fileKey)?.progress?.awaitingManual).toBe(true)
    f.finish()
    await f.until(() => f.views.get(first.fileKey)?.progress?.stage === 'completed')
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([first.fileKey])
    expect(f.views.get(next.fileKey)?.progress?.awaitingManual).toBe(true)
    f.setEnabled(true)
    await f.restart()
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([first.fileKey])
    expect(f.views.get(next.fileKey)?.progress?.awaitingManual).toBe(true)
  } finally { await f.close() }
})

test('tasks added or downloading while off remain manual even when they finish after re-enabling', async () => {
  const f = await fixture(), [first, second] = f.drafts as [PublicationDraft, PublicationDraft]
  try {
    f.worker.register({ ...first, output: '', measured: undefined })
    f.setEnabled(true)
    f.worker.event({ ...second, output: '', measured: undefined }, { id: 2, status: '下载中', pct: 0.5, log: '', err: '' })
    f.setEnabled(false)
    f.setEnabled(true)
    await f.restart()
    for (const draft of [first, second]) f.worker.event(draft, { id: 1, done: true, status: '完成', pct: 1, log: draft.output, err: '' })
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([])
    expect(f.views.get(first.fileKey)?.progress?.awaitingManual).toBe(true)
    expect(f.views.get(second.fileKey)?.progress?.awaitingManual).toBe(true)
  } finally { await f.close() }
})

test('old waiting snapshots migrate without starting an upload after re-enabling', async () => {
  const f = await fixture(), [first] = f.drafts as [PublicationDraft]
  try {
    f.worker.event(first, { id: 1, done: true, status: '完成', pct: 1, log: first.output, err: '' })
    await f.worker.close()
    const file = join(f.directory, first.fileKey.replace(':', '-') + '.state.json')
    const old = JSON.parse(readFileSync(file, 'utf8'))
    delete old.autoUploadBlocked
    old.draft.progress = { ...f.views.get(first.fileKey)!.progress }
    delete old.draft.progress.autoUploadBlocked
    old.draft.progress.awaitingManual = true
    writeFileSync(file, JSON.stringify(old))
    f.setEnabled(true)
    await f.restart()
    for (let i = 0; i < 5; i++) await f.worker.tick()
    expect(f.starts).toEqual([])
    expect(f.views.get(first.fileKey)?.progress?.awaitingManual).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).autoUploadBlocked).toBe(true)
  } finally { await f.close() }
})


test('relink before upload keeps a renamed file across restart and waits for an explicit upload', async () => {
  const f = await fixture(), [first] = f.drafts as [PublicationDraft]
  try {
    f.worker.event(first, { id: 1, done: true, status: '完成', pct: 1, log: first.output, err: '' })
    await f.worker.prepareRelink(first.fileKey)
    const path = join(f.directory, 'New.Title.S01E01.1080p.YOUKU.WEB-DL.SDR.AVC.mkv')
    renameSync(first.output, path)
    f.worker.relink({ ...first, output: path })
    expect(f.views.get(first.fileKey)?.output).toBe(path)
    expect(f.views.get(first.fileKey)?.progress?.stage).toBe('paused')
    f.setEnabled(true)
    await f.restart()
    for (let i = 0; i < 3; i++) await f.worker.tick()
    expect(f.views.get(first.fileKey)?.output).toBe(path)
    expect(f.starts).toEqual([])
    f.worker.control(first.fileKey, 'resume')
    await f.until(() => f.views.get(first.fileKey)?.progress?.stage === 'completed')
    expect(f.starts).toEqual([first.fileKey])
    expect(() => f.worker.assertCanRelink(first.fileKey)).toThrow('开始上传')
  } finally { await f.close() }
})
