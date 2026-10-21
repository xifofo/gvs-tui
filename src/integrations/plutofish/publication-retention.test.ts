/** 只用临时视频、假时钟和假服务器验证清理边界；任何真实 115 请求均不允许。 */
import { test, expect } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { PlutoFishConnection } from './connection.ts'
import { PublicationRetention } from './publication-retention.ts'
import type { PublicationState } from './publication-state.ts'
import { ed2kFile } from '../../lib/ed2k.ts'
import { useLocalFile } from '../../lib/local-file-use.ts'
import { loadRetentionSettings, saveRetentionSettings } from './retention-settings.ts'

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'publication-retention-')), path = join(directory, 'video.mkv')
  writeFileSync(path, 'abcdefgh')
  const sourceAccount = { id: 'source', alias: 'source', name: 'Source' }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.test', key: 'test' }),
    verify: async () => ({ id: 'publisher', name: 'Publisher', kind: 'publisher', sourceAccount }) })
  await connection.verify()
  const state: PublicationState = {
    draft: { schemaVersion: 1, binding: { url: 'https://example.test', publisherId: 'publisher', sourceAccount },
      fileKey: 'gvs-f1:' + 'a'.repeat(64), releaseKey: 'r', title: 'video', categoryLabel: 'movie', kind: 'video', output: path,
      updatedAt: new Date().toISOString(), workTarget: { mediaType: 'movie', category: 'movie', sourceWorkId: '1' } },
    snapshot: { taskKey: 'gvs-f1:' + 'a'.repeat(64), releaseKey: 'r', title: 'video', workTarget: { mediaType: 'movie', category: 'movie' },
      sourceAccount: 'source', stage: 'completed', attempt: 1, sequence: 2, downloadPercent: 100, uploadPercent: 100, sizeBytes: 8, uploadedBytes: 8 },
    acknowledged: 2, completedAt: 1_000_000,
    checkpoint: { file: { size: 8, mtimeMs: lstatSync(path).mtimeMs, sha1: createHash('sha1').update('abcdefgh').digest('hex').toUpperCase(), preId: 'B'.repeat(40) },
      partSize: 1024, parts: [], resource: { fileId: '1', pickCode: 'pick', preId: 'B'.repeat(40) } },
  }
  let now = state.completedAt!, hours = 24, calls = 0, removed = 0
  connection.request = async <T>(_binding: unknown, route: string): Promise<T> => {
    expect(route).toBe('files/ed2k'); calls++; return { accepted: true } as T
  }
  const options = { now: () => now, settings: () => ({ hours }) }
  const retention = new PublicationRetention(connection, () => {}, () => {}, () => { removed++ }, options)
  const states = new Map([[state.draft.fileKey, state]])
  const signal = new AbortController().signal
  return { directory, path, connection, state, options, states, signal, retention, calls: () => calls, removed: () => removed,
    advance: (ms: number) => { now += ms }, hours: (value: number) => { hours = value },
    close: async () => { await retention.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) } }
}

test('发布完成后 24 小时才删除；保存摘要与校验身份后清理只删除视频', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.directory, 'video.nfo'), 'keep')
    f.retention.tick(f.states, f.signal); await f.retention.close()
    expect(f.calls()).toBe(1); expect(f.state.retention?.acknowledged).toBeTrue()
    expect(f.state.draft.retention).toEqual({ state: 'retained', ed2kSaved: true, deleteAt: f.state.completedAt! + 24 * 3_600_000 })
    f.advance(24 * 3_600_000 - 1); f.retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBeTrue()
    f.advance(60_001); f.retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBeFalse(); expect(f.removed()).toBe(1)
    expect(f.state.draft.retention?.state).toBe('deleted')
    expect(f.state.retention?.deletedAt).toBeDefined()
    expect(existsSync(join(f.directory, 'video.nfo'))).toBeTrue()
  } finally { await f.close() }
})

test('成品完成立即计算 ED2K，上传无需等它；资源登记成功后才补记', async () => {
  const f = await fixture()
  try {
    f.state.snapshot.stage = 'processing'; f.state.checkpoint!.resource = undefined
    f.retention.tick(f.states, f.signal); await f.retention.close()
    expect(f.state.retention?.ed2k).toContain('ed2k://'); expect(f.calls()).toBe(0)
    f.state.snapshot.stage = 'completed'; f.state.checkpoint!.resource = { fileId: '1', pickCode: 'p', preId: 'B'.repeat(40) }
    f.retention.tick(f.states, f.signal); await f.retention.close()
    expect(f.calls()).toBe(1)
  } finally { await f.close() }
})

test('自动计算向界面推送字节进度；保存回执失败保留已生成状态，不重新读取文件', async () => {
  const f = await fixture()
  let finish!: () => void, computes = 0, saves = 0
  const gate = new Promise<void>(resolve => { finish = resolve })
  const views: Array<PublicationState['draft']['ed2k']> = []
  const retention = new PublicationRetention(f.connection, () => { saves++ }, state => { views.push(structuredClone(state.draft.ed2k)) }, () => {}, {
    ...f.options, compute: async (path, signal, progress) => {
      computes++
      progress?.(3, 8); progress?.(3.01, 8)
      await gate
      return ed2kFile(path, progress, signal)
    },
  })
  try {
    f.connection.request = async () => { throw new Error('response lost') }
    retention.start(f.states, f.signal)
    expect(views.map(view => view?.pct)).toEqual([0, 0.375])
    expect(saves).toBe(0)
    finish(); await retention.close()
    expect(f.state.draft.ed2k?.state).toBe('done')
    expect(f.state.draft.ed2k?.link).toBe(f.state.retention?.ed2k)
    expect(f.state.retention?.acknowledged).toBeFalse()
    expect(f.state.draft.retention?.state).toBe('waiting_save')
    f.advance(60_001)
    f.connection.request = async <T>(): Promise<T> => ({ accepted: true }) as T
    retention.start(f.states, f.signal); await retention.close()
    expect(computes).toBe(1)
    expect(f.state.retention?.acknowledged).toBeTrue()
  } finally { finish(); await retention.close(); await f.close() }
})

test('计算失败结束进度提示，稍后重试可以正常完成', async () => {
  const f = await fixture()
  let fail = true
  const retention = new PublicationRetention(f.connection, () => {}, () => {}, () => {}, {
    ...f.options, compute: async (path, signal, progress) => {
      progress?.(4, 8)
      if (fail) throw new Error('read failed')
      return ed2kFile(path, progress, signal)
    },
  })
  try {
    retention.start(f.states, f.signal); await retention.close()
    expect(f.state.draft.ed2k?.state).toBe('failed')
    expect(f.state.retention?.ed2k).toBeUndefined()
    fail = false; f.advance(60_001)
    retention.start(f.states, f.signal); await retention.close()
    expect(f.state.draft.ed2k?.state).toBe('done')
  } finally { await retention.close(); await f.close() }
})

test('回执丢失保留视频，重启复用已保存 ED2K；计时不重置', async () => {
  const f = await fixture()
  try {
    f.advance(25 * 3_600_000)
    f.connection.request = async () => { throw new Error('response lost') }
    f.retention.tick(f.states, f.signal); await f.retention.close()
    expect(existsSync(f.path)).toBeTrue(); expect(f.state.retention?.acknowledged).toBeFalse()
    const restored = structuredClone(f.state), states = new Map([[restored.draft.fileKey, restored]])
    f.connection.request = async <T>(): Promise<T> => ({ accepted: true }) as T
    const restarted = new PublicationRetention(f.connection, () => {}, () => {}, () => {}, { ...f.options, compute: async () => { throw new Error('must reuse saved ED2K') } })
    restarted.tick(states, f.signal); await restarted.close(); f.advance(60_001); restarted.tick(states, f.signal)
    expect(existsSync(f.path)).toBeFalse(); expect(restored.completedAt).toBe(1_000_000)
  } finally { await f.close() }
})

test('正在读取的任务先完成；配置关闭或延长可以取消待清理', async () => {
  const f = await fixture()
  try {
    f.retention.tick(f.states, f.signal); await f.retention.close()
    const release = useLocalFile(f.path)
    f.advance(25 * 3_600_000); f.retention.tick(f.states, f.signal)
    expect(f.state.retention?.retiring).toBeTrue(); expect(existsSync(f.path)).toBeTrue()
    expect(f.state.draft.retention?.state).toBe('busy')
    f.hours(48); f.advance(60_001); f.retention.tick(f.states, f.signal)
    expect(f.state.retention?.retiring).toBeFalse()
    release(); f.hours(0); f.advance(72 * 3_600_000); f.retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBeTrue()
    f.hours(24); f.advance(60_001); f.retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBeFalse()
  } finally { await f.close() }
})

test.each(['changed', 'symlink', 'unsynced', 'cancelled'] as const)('不会删除已变更或不满足完成条件的文件：%s', async kind => {
  const f = await fixture()
  try {
    f.retention.tick(f.states, f.signal); await f.retention.close()
    if (kind === 'changed') writeFileSync(f.path, 'ijklmnop')
    if (kind === 'symlink') { const other = join(f.directory, 'other.mkv'); writeFileSync(other, 'abcdefgh'); rmSync(f.path); symlinkSync(other, f.path) }
    if (kind === 'unsynced') f.state.acknowledged = 0
    if (kind === 'cancelled') f.state.snapshot.stage = 'cancelled'
    f.advance(25 * 3_600_000); f.retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBeTrue()
    if (kind === 'changed' || kind === 'symlink') expect(f.state.retention?.retiring).toBeFalse()
  } finally { await f.close() }
})

test('旧清单第一次恢复才起算，配置损坏不能自动删除', async () => {
  const f = await fixture()
  try {
    f.state.completedAt = undefined
    f.advance(100 * 3_600_000)
    f.retention.tick(f.states, f.signal); await f.retention.close()
    expect(Number(f.state.completedAt)).toBe(1_000_000 + 100 * 3_600_000)
    const path = join(f.directory, 'retention.json')
    expect(loadRetentionSettings(path)).toEqual({ hours: 24 })
    expect(saveRetentionSettings({ hours: 0 }, path)).toEqual({ hours: 0 })
    expect(() => saveRetentionSettings({ hours: -1 }, path)).toThrow()
    writeFileSync(path, '{broken')
    const broken = new PublicationRetention(f.connection, () => {}, () => {}, () => {}, { ...f.options, settings: () => loadRetentionSettings(path) })
    f.advance(25 * 3_600_000)
    expect(() => broken.tick(f.states, f.signal)).toThrow(); expect(existsSync(f.path)).toBeTrue()
    expect(f.state.draft.retention?.state).toBe('policy_error')
    expect((await ed2kFile(f.path)).sha1).toBe(f.state.checkpoint!.file.sha1)
  } finally { await f.close() }
})

test('宿主关闭删除许可时保留文件和校验能力，恢复许可后再清理', async () => {
  const f = await fixture()
  let allowed = false
  const retention = new PublicationRetention(f.connection, () => {}, () => {}, () => {}, { ...f.options, canDelete: () => allowed })
  try {
    retention.tick(f.states, f.signal); await retention.close()
    f.advance(25 * 3600000); retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBe(true)
    expect(f.state.retention?.retiring).not.toBe(true)
    expect(f.state.draft.retention?.state).toBe('busy')
    allowed = true; f.advance(60001); retention.tick(f.states, f.signal)
    expect(existsSync(f.path)).toBe(false)
  } finally { await retention.close(); await f.close() }
})
