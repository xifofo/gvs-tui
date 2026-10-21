/** 分段校验测试只使用临时本地文件和内存网关，验证重启、文件缺失、篡改、撤权与摘要复用。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PlutoFishConnection } from './connection.ts'
import { PublicationProofs, type ProofJob } from './publication-proofs.ts'
import { PublicationStore, type PublicationState } from './publication-state.ts'
import { completePublication, preparePublication } from './publication.ts'
import { fingerprint } from './upload-file.ts'
import type { DlTask } from '../../lib/jobs.ts'
import type { PublicationDraft } from './publication-types.ts'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'publisher-proof-'))
  const path = join(directory, 'file.mkv'), bytes = Buffer.from('abcdefgh')
  writeFileSync(path, bytes)
  const identity = { id: 'pub', name: 'Publisher', kind: 'publisher' as const, sourceAccount: { id: 'source', alias: 'source', name: 'Source' }, categories: [{ value: 'short', label: '短剧' }] }
  const connection = new PlutoFishConnection({ load: () => ({ url: 'https://example.com', key: 'secret' }), verify: async () => identity })
  await connection.verify()
  const draft = completePublication(preparePublication({ provider: 'hongguo', sourceWorkId: 's1', title: '第一集', series: '作品', vid: 'e1', season: 1, episode: 1, tmdbId: 0, quality: '1080', codec: 'h264', group: '', plot: '' } as DlTask, connection.view(), 'short'), path,
    { media: { status: 'probed', width: 1080, height: 1920, codec: 'h264', dynamicRange: 'SDR' }, file: { size: bytes.length } })
  const file = await fingerprint(path, new AbortController().signal)
  const state: PublicationState = { draft, acknowledged: 1, checkpoint: { file, partSize: 1024, parts: [], resource: { fileId: '123', pickCode: 'p', preId: file.preId } }, snapshot: {
    taskKey: draft.fileKey, releaseKey: draft.releaseKey, sourceAccount: 'source', workTarget: draft.workTarget, title: draft.title,
    attempt: 1, sequence: 1, stage: 'completed', downloadPercent: 100, uploadPercent: 100, sizeBytes: bytes.length, uploadedBytes: bytes.length,
  } }
  const job: ProofJob = { id: 'a'.repeat(32), taskKey: draft.fileKey, sha1: file.sha1, sizeBytes: file.size, signCheck: '2-5' }
  const cleanup = () => { connection.close(); rmSync(directory, { recursive: true, force: true }) }
  return { directory, path, connection, state, job, cleanup }
}

/** 只控制内存回执的结束时机，不替换文件读取或访问外部服务。 */
function proofGate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('本地最多两个校验任务，同一成品直到最后一份回执完成才允许清理', async () => {
  const f = await setup()
  const gates = [proofGate(), proofGate(), proofGate()]
  const entered = [proofGate(), proofGate(), proofGate()]
  const proofs = new PublicationProofs(f.connection, () => {})
  const jobs = ['a', 'b', 'c'].map(c => ({ ...f.job, id: c.repeat(32) }))
  let active = 0, peak = 0, reports = 0
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs } as T
    const index = jobs.findIndex(job => job.id === (body as { id: string }).id)
    reports++; active++; peak = Math.max(peak, active)
    entered[index]!.resolve()
    await gates[index]!.promise
    active--
    return { accepted: true } as T
  }
  const work = proofs.tick([f.state], new AbortController().signal)
  try {
    await Promise.all([entered[0]!.promise, entered[1]!.promise])
    expect(reports).toBe(2)
    expect(proofs.isUsing(f.state)).toBeTrue()
    gates[0]!.resolve()
    await entered[2]!.promise
    gates[2]!.resolve()
    await Bun.sleep(5)
    expect(proofs.isUsing(f.state)).toBeTrue()
    gates[1]!.resolve()
    await work
    expect(peak).toBe(2)
    expect(reports).toBe(3)
    expect(proofs.isUsing(f.state)).toBeFalse()
  } finally {
    gates.forEach(gate => gate.resolve())
    await work.catch(() => {})
    f.cleanup()
  }
})

test('并发回执失败后不领取第三个任务，等待已开始的任务结束再退出', async () => {
  const f = await setup(), gate = proofGate(), entered = proofGate()
  const proofs = new PublicationProofs(f.connection, () => {})
  let reports = 0, settled = false
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs: ['a', 'b', 'c'].map(c => ({ ...f.job, id: c.repeat(32) })) } as T
    reports++
    if ((body as { id: string }).id === f.job.id) throw new Error('offline report failure')
    entered.resolve()
    await gate.promise
    return { accepted: true } as T
  }
  const work = proofs.tick([f.state], new AbortController().signal).then(
    () => { settled = true; return undefined },
    error => { settled = true; return error as Error },
  )
  try {
    await entered.promise
    await Bun.sleep(5)
    expect(settled).toBeFalse()
    expect(proofs.isUsing(f.state)).toBeTrue()
    gate.resolve()
    expect((await work)?.message).toBe('offline report failure')
    expect(reports).toBe(2)
    expect(proofs.isUsing(f.state)).toBeFalse()
  } finally { gate.resolve(); await work; f.cleanup() }
})

test('重启从发布清单恢复本地校验，同一范围多人订阅只计算一次且不请求源账号', async () => {
  const f = await setup()
  const store = new PublicationStore(join(f.directory, 'state'))
  const reports: Record<string, unknown>[] = []
  try {
    store.save(f.state); store.close()
    const restored = store.load()
    let polls = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') { polls++; return { jobs: [f.job, { ...f.job, id: 'b'.repeat(32) }] } as T }
      expect(route).toBe('range-proofs/report')
      reports.push(body as Record<string, unknown>)
      // 第一份回执后移除本地成品，第二个相同范围仍复用本批摘要。
      rmSync(f.path, { force: true })
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    await proofs.tick(restored, new AbortController().signal)
    await proofs.tick(restored, new AbortController().signal)
    expect(polls).toBe(1)
    expect(reports).toHaveLength(2)
    expect(reports.every(r => r.signValue === createHash('sha1').update('cdef').digest('hex').toUpperCase())).toBeTrue()
    expect(JSON.stringify(reports)).not.toContain('signKey')
  } finally { store.close(); f.cleanup() }
})

for (const kind of ['missing', 'changed', 'out-of-range'] as const) test(`${kind} 保持等待且不请求网盘补读`, async () => {
  const f = await setup()
  try {
    if (kind === 'missing') rmSync(f.path)
    if (kind === 'changed') writeFileSync(f.path, 'changed file')
    if (kind === 'out-of-range') f.job.signCheck = '0-999999999'
    const reports: unknown[] = [], messages: string[] = []
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [f.job] } as T
      expect(route).toBe('range-proofs/report'); reports.push(body)
      return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, (_state, message) => { if (message) messages.push(message) }).tick([f.state], new AbortController().signal)
    expect(reports).toEqual([{ id: f.job.id, taskKey: f.job.taskKey, unavailable: true }])
    expect(messages).toHaveLength(1)
    expect(f.state.snapshot.stage).toBe('completed')
  } finally { f.cleanup() }
})

test('错误文件身份或已取消会话不能提交摘要', async () => {
  const f = await setup()
  try {
    let reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [{ ...f.job, sha1: 'F'.repeat(40) }] } as T
      reports++; return { accepted: true } as T
    }
    await expect(new PublicationProofs(f.connection, () => {}).tick([f.state], new AbortController().signal)).rejects.toThrow('文件身份不一致')
    const abort = new AbortController(); abort.abort()
    await expect(new PublicationProofs(f.connection, () => {}).tick([f.state], abort.signal)).rejects.toThrow()
    expect(reports).toBe(0)
    f.connection.close()
    await new PublicationProofs(f.connection, () => {}).tick([f.state], new AbortController().signal)
    expect(reports).toBe(0)
  } finally { f.cleanup() }
})

test('一千条上传历史中的最后一个文件首轮即可校验，请求不携带历史列表', async () => {
  const f = await setup()
  try {
    const states = Array.from({ length: 1000 }, (_, i) => ({ ...f.state, draft: { ...f.state.draft, fileKey: `history-${i}` } }))
    f.job.taskKey = states[999]!.draft.fileKey
    let polls = 0, reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') {
        polls++
        expect(body).toEqual({ after: '' })
        return { jobs: [f.job] } as T
      }
      expect(body).toEqual({ id: f.job.id, taskKey: f.job.taskKey, signValue: createHash('sha1').update('cdef').digest('hex').toUpperCase() })
      reports++
      return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, () => {}).tick(states, new AbortController().signal)
    expect(polls).toBe(1)
    expect(reports).toBe(1)
  } finally { f.cleanup() }
})

test('真实待办超过一页时连续领取，最后一页后才恢复 15 秒轮询', async () => {
  const f = await setup()
  try {
    const jobs = Array.from({ length: 101 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
    let polls = 0, reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') {
        polls++
        expect(body).toEqual({ after: polls === 1 ? '' : jobs[99]!.id })
        return (polls === 1 ? { jobs: jobs.slice(0, 100), nextCursor: jobs[99]!.id } : { jobs: jobs.slice(100) }) as T
      }
      reports++
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    const signal = new AbortController().signal
    await proofs.tick([f.state], signal)
    expect(reports).toBe(100)
    await proofs.tick([f.state], signal)
    expect(reports).toBe(101)
    await proofs.tick([f.state], signal)
    expect(polls).toBe(2)
  } finally { f.cleanup() }
})

test('本机清单已清空也能回报不可用，下一页不会被缺失记录挡住', async () => {
  const f = await setup()
  try {
    const reports: unknown[] = []
    let polls = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') {
        polls++
        return (polls === 1 ? { jobs: [f.job], nextCursor: f.job.id } : { jobs: [] }) as T
      }
      reports.push(body)
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    await proofs.tick([], new AbortController().signal)
    await proofs.tick([], new AbortController().signal)
    expect(polls).toBe(2)
    expect(reports).toEqual([{ id: f.job.id, taskKey: f.job.taskKey, unavailable: true }])
  } finally { f.cleanup() }
})

test('重复上传的旧任务记录不在本机时可使用同绑定同内容成品，回执仍对应服务端任务', async () => {
  const f = await setup()
  try {
    f.job.taskKey = 'old-upload'
    let reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [f.job] } as T
      expect(body).toEqual({ id: f.job.id, taskKey: 'old-upload', signValue: createHash('sha1').update('cdef').digest('hex').toUpperCase() })
      reports++
      return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, () => {}).tick([f.state], new AbortController().signal)
    expect(reports).toBe(1)
  } finally { f.cleanup() }
})

test('无效游标和重复挑战在读取文件及回传前被拒绝', async () => {
  const f = await setup()
  try {
    let reports = 0
    for (const reply of [{ jobs: [], nextCursor: f.job.id }, { jobs: [f.job, f.job] }, { jobs: [f.job], nextCursor: 'invalid' }]) {
      f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
        if (route === 'range-proofs/pending') return reply as T
        reports++
        return { accepted: true } as T
      }
      await expect(new PublicationProofs(f.connection, () => {}).tick([f.state], new AbortController().signal)).rejects.toThrow('回执无效')
    }
    expect(reports).toBe(0)
  } finally { f.cleanup() }
})

test('恢复相同内容但时间戳改变时重算完整 SHA1，保留原任务继续校验', async () => {
  const f = await setup()
  try {
    f.state.checkpoint!.file.mtimeMs -= 5000
    let saved = 0, reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [f.job] } as T
      expect((body as { signValue?: string }).signValue).toBe(createHash('sha1').update('cdef').digest('hex').toUpperCase())
      reports++; return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, () => {}, () => { saved++ }).tick([f.state], new AbortController().signal)
    expect(saved).toBe(1)
    expect(reports).toBe(1)
  } finally { f.cleanup() }
})

test('协商成功后等待新任务，收到任务时使用最新本地清单，处理后立即续接', async () => {
  const f = await setup()
  try {
    let states: PublicationState[] = []
    let polls = 0, reports = 0
    let deliver!: (value: unknown) => void
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') {
        polls++
        if (polls === 1) {
          expect(body).toEqual({ after: '' })
          return { jobs: [], waitSupported: true } as T
        }
        expect(body).toEqual({ after: '', waitSeconds: 25 })
        if (polls === 2) return await new Promise<unknown>(resolve => { deliver = resolve }) as T
        return { jobs: [], waitSupported: true } as T
      }
      expect((body as { signValue?: string }).signValue).toBe(createHash('sha1').update('cdef').digest('hex').toUpperCase())
      reports++
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    const signal = new AbortController().signal
    await proofs.tick(() => states, signal)
    const waiting = proofs.tick(() => states, signal)
    // 等待期间刚完成上传，收件时需要看到新状态，而非误报文件缺失。
    states = [f.state]
    deliver({ jobs: [f.job], waitSupported: true })
    await waiting
    expect(reports).toBe(1)
    await proofs.tick(() => states, signal)
    expect(polls).toBe(3)
    // 异常立即返回空长轮询时不紧密重试。
    await proofs.tick(() => states, signal)
    expect(polls).toBe(3)
  } finally { f.cleanup() }
})

test('不可用待办等待手动处理时不形成长轮询忙循环', async () => {
  const f = await setup()
  try {
    let polls = 0, reports = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
      if (route === 'range-proofs/pending') { polls++; return { jobs: [f.job], waitSupported: true } as T }
      reports++
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    await proofs.tick([], new AbortController().signal)
    await proofs.tick([], new AbortController().signal)
    expect(polls).toBe(1)
    expect(reports).toBe(1)
  } finally { f.cleanup() }
})

test('独立收件循环等待期间仍同步新任务，关闭会取消长请求', async () => {
  const f = await setup()
  const { PublicationWorker } = await import('./publication-worker.ts')
  const directory = join(f.directory, 'worker')
  const store = new PublicationStore(directory)
  store.save(f.state); store.close()
  let worker: InstanceType<typeof PublicationWorker> | undefined
  try {
    let polls = 0, reports = 0, cancelled = false
    let waiting!: () => void
    const inWait = new Promise<void>(resolve => { waiting = resolve })
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, _body: unknown, signal?: AbortSignal): Promise<T> => {
      if (route === 'tasks/report') { reports++; return { outcome: 'applied' } as T }
      expect(route).toBe('range-proofs/pending')
      if (++polls === 1) return { jobs: [], waitSupported: true } as T
      waiting()
      return await new Promise<T>((_resolve, reject) => {
        signal!.addEventListener('abort', () => { cancelled = true; reject(signal!.reason) }, { once: true })
      })
    }
    worker = new PublicationWorker(f.connection, () => {}, { directory, manual: true })
    await worker.tick()
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([inWait, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('long poll did not start')), 1000) })])
    } finally { clearTimeout(deadline) }
    worker.register({ ...f.state.draft, fileKey: `gvs-f1:${'e'.repeat(64)}`, output: '', progress: undefined })
    await worker.tick()
    expect(reports).toBe(1)
    expect(cancelled).toBeFalse()
    await worker.close()
    expect(cancelled).toBeTrue()
  } finally { await worker?.close(); f.cleanup() }
})
