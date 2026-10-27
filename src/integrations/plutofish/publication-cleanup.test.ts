/** 清理测试只使用临时文件与内存服务端；覆盖完成边界、掉线重试、重启和分批，不访问 115。 */
import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlutoFishConnection } from './connection.ts'
import { PublicationCleanup } from './publication-cleanup.ts'
import { PublicationStore, type PublicationState } from './publication-state.ts'
import { PublicationWorker } from './publication-worker.ts'
import { PublicationRetention } from './publication-retention.ts'
import { savePublication } from './publication-store.ts'
import type { PublicationDraft } from './publication-types.ts'

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'publication-cleanup-'))
  const sourceAccount = { id: 'source', alias: 'source', name: 'Source' }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.test', key: 'secret' }),
    verify: async () => ({ id: 'publisher', name: 'Publisher', kind: 'publisher', sourceAccount, categories: [] }) })
  await connection.verify()
  const store = new PublicationStore(directory), states = new Map<string, PublicationState>()
  const create = (n: number) => {
    const key = `gvs-f1:${n.toString(16).padStart(64, '0')}`
    const draft: PublicationDraft = { schemaVersion: 1, binding: { url: 'https://example.test', publisherId: 'publisher', sourceAccount },
      fileKey: key, releaseKey: 'release', title: 'Episode', categoryLabel: '短剧', workTarget: { mediaType: 'tv', category: 'short', sourceProvider: 'test', sourceWorkId: 'work', title: 'Work' },
      kind: 'video', output: join(directory, `${n}.mkv`), episodeNumber: n, updatedAt: new Date().toISOString(),
      progress: { stage: 'completed', downloadPercent: 100, uploadPercent: 100, uploadedBytes: 8, sizeBytes: 8, synced: true, error: '' } }
    const state: PublicationState = { draft, acknowledged: 2, snapshot: { taskKey: key, releaseKey: 'release', sourceAccount: 'source', workTarget: draft.workTarget,
      title: 'Episode', attempt: 1, sequence: 2, stage: 'completed', downloadPercent: 100, uploadPercent: 100, sizeBytes: 8, uploadedBytes: 8 },
      checkpoint: { file: { size: 8, sha1: 'A'.repeat(40), preId: 'B'.repeat(40), mtimeMs: 1 }, partSize: 1024, parts: [], resource: { fileId: '1', pickCode: 'p', preId: 'B'.repeat(40) } } }
    states.set(key, state); store.save(state); savePublication(draft, directory)
    return state
  }
  const remove = (state: PublicationState) => { store.removeCompleted(state); states.delete(state.draft.fileKey) }
  const close = () => { store.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) }
  return { directory, connection, store, states, create, remove, close }
}

test('删除成品后先撤销服务端资格，再清掉两份本地清单，下载历史不会在重启时重新入队', async () => {
  const f = await fixture()
  let worker: PublicationWorker | undefined
  try {
    const state = f.create(1), calls: unknown[] = []
    const stem = join(f.directory, state.draft.fileKey.replace(':', '-'))
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      expect(route).toBe('range-proofs/forget')
      expect(existsSync(`${stem}.json`)).toBeTrue()
      expect(existsSync(`${stem}.state.json`)).toBeTrue()
      calls.push(body)
      return { accepted: true } as T
    }
    await new PublicationCleanup(f.connection, f.remove).tick(f.states, new AbortController().signal)
    expect(calls).toEqual([{ taskKeys: [state.draft.fileKey] }])
    expect(f.states.size).toBe(0)
    expect(existsSync(`${stem}.json`)).toBeFalse()
    expect(existsSync(`${stem}.state.json`)).toBeFalse()
    expect(f.store.load()).toEqual([])
    f.store.close()
    worker = new PublicationWorker(f.connection, () => {}, { directory: f.directory, manual: true })
    worker.register(state.draft)
    expect(worker.restored()).toEqual([])
  } finally { await worker?.close(); f.close() }
})

test('未完成、完成回执未确认、成品仍在或父目录不可访问都保留', async () => {
  const f = await fixture()
  try {
    const uploading = f.create(1); uploading.snapshot.stage = 'uploading'
    const unsynced = f.create(2); unsynced.acknowledged = 1
    const present = f.create(3); writeFileSync(present.draft.output, 'abcdefgh')
    const unavailableDirectory = f.create(4); unavailableDirectory.draft.output = join(f.directory, 'unmounted', 'video.mkv')
    const foreign = f.create(5); foreign.draft.binding.publisherId = 'another-publisher'
    const pending = f.create(6); pending.pendingFailures = [{ ...pending.snapshot, stage: 'failed', sequence: 1 }]
    f.store.save(pending)
    f.connection.request = async () => { throw new Error('must not send cleanup') }
    await new PublicationCleanup(f.connection, f.remove).tick(f.states, new AbortController().signal)
    expect(f.states.size).toBe(6)
    expect(f.store.load()).toHaveLength(6)
    expect(() => f.store.removeCompleted(uploading)).toThrow('未完成')
    expect(() => f.store.removeCompleted(unsynced)).toThrow('未完成')
    expect(() => f.store.removeCompleted(pending)).toThrow('未完成')
  } finally { f.close() }
})

test('清理回执丢失不删记录，重启后可重放清理', async () => {
  const f = await fixture()
  try {
    const state = f.create(1)
    f.connection.request = async () => { throw new Error('response lost') }
    await expect(new PublicationCleanup(f.connection, f.remove).tick(f.states, new AbortController().signal)).rejects.toThrow('response lost')
    expect(f.store.load()).toHaveLength(1)
    f.connection.request = async <T>(): Promise<T> => ({ accepted: true }) as T
    const restored = new Map(f.store.load().map(s => [s.draft.fileKey, s]))
    await new PublicationCleanup(f.connection, s => { f.store.removeCompleted(s); restored.delete(s.draft.fileKey) }).tick(restored, new AbortController().signal)
    expect(restored.size).toBe(0)
    expect(f.store.load()).toHaveLength(0)
    expect(state.snapshot.stage).toBe('completed')
  } finally { f.close() }
})

test('服务端未确认或请求中取消都不能清理本地状态', async () => {
  const f = await fixture()
  try {
    f.create(1)
    f.connection.request = async <T>(): Promise<T> => ({ accepted: false }) as T
    await expect(new PublicationCleanup(f.connection, f.remove).tick(f.states, new AbortController().signal)).rejects.toThrow('未确认')
    const abort = new AbortController()
    f.connection.request = async <T>(): Promise<T> => { abort.abort(); return { accepted: true } as T }
    await expect(new PublicationCleanup(f.connection, f.remove).tick(f.states, abort.signal)).rejects.toThrow()
    expect(f.store.load()).toHaveLength(1)
  } finally { f.close() }
})

test('大量历史按 50 条分批清理，删除前页不影响后续检查', async () => {
  const f = await fixture()
  try {
    for (let i = 1; i <= 55; i++) f.create(i)
    const batches: number[] = []
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      expect(route).toBe('range-proofs/forget'); batches.push((body as { taskKeys: string[] }).taskKeys.length)
      return { accepted: true } as T
    }
    const cleanup = new PublicationCleanup(f.connection, f.remove), signal = new AbortController().signal
    await cleanup.tick(f.states, signal)
    await cleanup.tick(f.states, signal)
    expect(batches).toEqual([50, 5])
    expect(f.store.load()).toHaveLength(0)
  } finally { f.close() }
})

test('下载历史落盘失败仍保留发布清单，防止重启后旧历史重新上传', async () => {
  const f = await fixture()
  try {
    f.create(1)
    f.connection.request = async <T>(): Promise<T> => ({ accepted: true }) as T
    const cleanup = new PublicationCleanup(f.connection, f.remove, () => { throw new Error('history write failed') })
    await expect(cleanup.tick(f.states, new AbortController().signal)).rejects.toThrow('history write failed')
    expect(f.states.size).toBe(1)
    expect(f.store.load()).toHaveLength(1)
  } finally { f.close() }
})

test('手动删文件后先同步已删除状态再保存历史，历史失败可恢复且不会先删清单', async () => {
  const f = await fixture()
  try {
    const state = f.create(1), events: string[] = []
    f.connection.request = async <T>(): Promise<T> => ({ accepted: true }) as T
    const retention = new PublicationRetention(f.connection, s => f.store.save(s), () => events.push('status'), () => {})
    const cleanup = new PublicationCleanup(f.connection, s => { events.push('remove'); f.remove(s) }, () => {
      expect(state.draft.retention?.state).toBe('deleted')
      events.push('history')
      throw new Error('history write failed')
    }, s => retention.deleted(s))
    await expect(cleanup.tick(f.states, new AbortController().signal)).rejects.toThrow('history write failed')
    expect(events).toEqual(['status', 'history'])
    expect(f.states.size).toBe(1)
    expect(f.store.load()[0]?.retention?.deletedAt).toBeNumber()
    await new PublicationCleanup(f.connection, f.remove, () => {
      expect(state.draft.retention?.state).toBe('deleted')
    }, s => retention.deleted(s)).tick(f.states, new AbortController().signal)
    expect(f.states.size).toBe(0)
  } finally { f.close() }
})

test('校验发现删除后可优先清理，无需等下一次一分钟扫描', async () => {
  const f = await fixture()
  try {
    const state = f.create(1); writeFileSync(state.draft.output, 'abcdefgh')
    let calls = 0
    f.connection.request = async <T>(): Promise<T> => { calls++; return { accepted: true } as T }
    const cleanup = new PublicationCleanup(f.connection, f.remove), signal = new AbortController().signal
    await cleanup.tick(f.states, signal)
    rmSync(state.draft.output)
    cleanup.missing(state)
    await cleanup.tick(f.states, signal)
    expect(calls).toBe(1)
    expect(f.store.load()).toHaveLength(0)
  } finally { f.close() }
})

test('宿主确认整目录已删除后落盘删除事实，父目录缺失也能在重启后撤销校验资格', async () => {
  const f = await fixture()
  let worker: PublicationWorker | undefined
  try {
    const removed = f.create(1); removed.draft.output = join(f.directory, 'deleted-folder', 'video.mkv'); f.store.save(removed)
    const unfinished = f.create(2); unfinished.snapshot.stage = 'uploading'; f.store.save(unfinished)
    const unsynced = f.create(3); unsynced.acknowledged = 1; f.store.save(unsynced)
    f.store.close()
    worker = new PublicationWorker(f.connection, () => {}, { directory: f.directory, manual: true })
    worker.localFilesDeleted([removed.draft.fileKey, unfinished.draft.fileKey, unsynced.draft.fileKey])
    await worker.close(); worker = undefined
    const restored = new Map(f.store.load().map(s => [s.draft.fileKey, s]))
    expect(restored.get(removed.draft.fileKey)?.retention?.deletedAt).toBeNumber()
    expect(restored.get(unfinished.draft.fileKey)?.retention?.deletedAt).toBeUndefined()
    expect(restored.get(unsynced.draft.fileKey)?.retention?.deletedAt).toBeUndefined()
    const calls: unknown[] = []
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      expect(route).toBe('range-proofs/forget'); calls.push(body); return { accepted: true } as T
    }
    await new PublicationCleanup(f.connection, s => { f.store.removeCompleted(s); restored.delete(s.draft.fileKey) }).tick(restored, new AbortController().signal)
    expect(calls).toEqual([{ taskKeys: [removed.draft.fileKey] }])
    expect(restored.has(removed.draft.fileKey)).toBe(false)
  } finally { await worker?.close(); f.close() }
})
