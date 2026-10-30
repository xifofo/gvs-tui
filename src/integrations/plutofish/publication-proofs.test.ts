/** 分段校验测试只使用临时本地文件和内存网关，验证重启、文件缺失、篡改、撤权与摘要复用。 */
import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PlutoFishConnection } from './connection.ts'
import { PublicationProofs, PUBLICATION_PROOF_CONCURRENCY, type ProofJob } from './publication-proofs.ts'
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

test('两千个挑战在慢回执期间持续收件，保持十六个在途上限且关闭前等待所有读取退出', async () => {
  const f = await setup(), held = proofGate(), completed = proofGate()
  const abort = new AbortController(), proofs = new PublicationProofs(f.connection, () => {})
  // 使用不同的真实范围，避免压测只命中同一个摘要缓存；总共读取并校验约 125 MiB。
  const bytes = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => i % 251))
  writeFileSync(f.path, bytes)
  const file = await fingerprint(f.path, abort.signal)
  f.state.checkpoint!.file = file
  f.state.snapshot.sizeBytes = file.size
  const jobs = Array.from({ length: 2000 }, (_, i) => {
    const start = i * 509 % (bytes.length - 65536)
    return { ...f.job, id: (i + 1).toString(16).padStart(32, '0'), sha1: file.sha1, sizeBytes: file.size, signCheck: `${start}-${start + 65535}` }
  })
  const expected = new Map(jobs.map(job => {
    const [start, end] = job.signCheck.split('-').map(Number) as [number, number]
    return [job.id, createHash('sha1').update(bytes.subarray(start, end + 1)).digest('hex').toUpperCase()]
  }))
  const pending = new Map(jobs.map(job => [job.id, job]))
  const seen = new Set<string>()
  let active = 0, peak = 0, finished = 0, polls = 0
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') {
      polls++
      const after = (body as { after: string }).after
      const page = [...pending.values()].filter(job => job.id > after).slice(0, 101)
      return { jobs: page.slice(0, 100), ...(page.length > 100 ? { nextCursor: page[99]!.id } : {}), waitSupported: true } as T
    }
    const report = body as { id: string; signValue: string }
    expect(report.signValue).toBe(expected.get(report.id)!)
    expect(seen.has(report.id)).toBeFalse()
    seen.add(report.id)
    active++; peak = Math.max(peak, active)
    // 第一份回执一直不结束；后续页也必须被领取，不能等第一整页完成。
    if (report.id === jobs[0]!.id) await held.promise
    else await Bun.sleep(40)
    pending.delete(report.id)
    active--; finished++
    if (finished === jobs.length - 1) completed.resolve()
    return { accepted: true } as T
  }
  const started = performance.now()
  const work = proofs.run(() => [f.state], abort.signal)
  try {
    await completed.promise
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(30_000)
    // 20 页加少量尾部回查，不应每释放一个槽都重新领取已取得的页尾。
    expect(polls).toBeLessThan(60)
    expect(seen.size).toBe(2000)
    expect(peak).toBe(PUBLICATION_PROOF_CONCURRENCY)
    expect(proofs.isUsing(f.state)).toBeTrue()
    held.resolve()
    abort.abort()
    await work
    expect(finished).toBe(2000)
    expect(proofs.isUsing(f.state)).toBeFalse()
    console.info(`本地校验离线压测：2000 个挑战、40ms 模拟回执、1 个持续慢回执，其余完成耗时 ${elapsed.toFixed(0)}ms，峰值 ${peak}，领取请求 ${polls} 次`)
  } finally { held.resolve(); abort.abort(); await work; f.cleanup() }
}, 20_000)

test('后台回执失败后重查原挑战，其他已成功回执不重复发送', async () => {
  const f = await setup(), completed = proofGate(), abort = new AbortController()
  const jobs = Array.from({ length: 20 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
  const pending = new Map(jobs.map(job => [job.id, job])), calls = new Map<string, number>()
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs: [...pending.values()].filter(job => job.id > (body as { after: string }).after), waitSupported: true } as T
    const id = (body as { id: string }).id, count = (calls.get(id) ?? 0) + 1
    calls.set(id, count)
    if (id === jobs[0]!.id && count === 1) throw new Error('temporary report failure')
    pending.delete(id)
    if (!pending.size) completed.resolve()
    return { accepted: true } as T
  }
  const proofs = new PublicationProofs(f.connection, () => {})
  const work = proofs.run(() => [f.state], abort.signal)
  try {
    await completed.promise
    abort.abort(); await work
    expect(calls.get(jobs[0]!.id)).toBe(2)
    expect([...calls.values()].filter(count => count === 1)).toHaveLength(19)
  } finally { abort.abort(); await work; f.cleanup() }
})

test('只见到在途挑战时，回执完成立即续接领取，不等待轮询计时器', async () => {
  const f = await setup(), held = proofGate(), duplicateSeen = proofGate(), resumed = proofGate()
  const abort = new AbortController(), proofs = new PublicationProofs(f.connection, () => {})
  // 固定时钟使轮询期限不会自行到达，只能由真实回执完成唤醒。
  const now = Date.now(), clock = spyOn(Date, 'now').mockReturnValue(now)
  let polls = 0
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
    if (route === 'range-proofs/pending') {
      if (++polls <= 2) {
        if (polls === 2) duplicateSeen.resolve()
        return { jobs: [f.job], waitSupported: true } as T
      }
      resumed.resolve()
      return { jobs: [], waitSupported: true } as T
    }
    await held.promise
    return { accepted: true } as T
  }
  const work = proofs.run(() => [f.state], abort.signal)
  try {
    await duplicateSeen.promise
    await Bun.sleep(5)
    held.resolve()
    const woken = await Promise.race([resumed.promise.then(() => true), Bun.sleep(1000).then(() => false)])
    expect(woken).toBeTrue()
    expect(polls).toBe(3)
  } finally { held.resolve(); abort.abort(); await work; clock.mockRestore(); f.cleanup() }
})

test('十六个回执在途时关闭会取消所有请求，队列剩余任务不启动且文件占用全部释放', async () => {
  const f = await setup(), entered = proofGate(), abort = new AbortController()
  const proofs = new PublicationProofs(f.connection, () => {})
  const jobs = Array.from({ length: 100 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
  let reports = 0, cancelled = 0
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, _body: unknown, signal?: AbortSignal): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs, waitSupported: true } as T
    if (++reports === PUBLICATION_PROOF_CONCURRENCY) entered.resolve()
    return await new Promise<T>((_resolve, reject) => {
      signal!.addEventListener('abort', () => { cancelled++; reject(signal!.reason) }, { once: true })
    })
  }
  const work = proofs.run(() => [f.state], abort.signal)
  try {
    await entered.promise
    abort.abort(); await work
    expect(reports).toBe(16)
    expect(cancelled).toBe(16)
    expect(proofs.isUsing(f.state)).toBeFalse()
  } finally { abort.abort(); await work; f.cleanup() }
})

test('下一页查询途中旧回执失败，迟到分页不能覆盖首页重放位置', async () => {
  const f = await setup(), failReport = proofGate(), queryEntered = proofGate(), releaseQuery = proofGate(), completed = proofGate()
  const abort = new AbortController(), proofs = new PublicationProofs(f.connection, () => {})
  const jobs = Array.from({ length: 20 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
  const pending = new Map(jobs.map(job => [job.id, job]))
  let polls = 0, firstAttempts = 0
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') {
      const after = (body as { after: string }).after
      if (++polls === 2) { queryEntered.resolve(); await releaseQuery.promise }
      if (polls === 3) expect(after).toBe('')
      return { jobs: [...pending.values()].filter(job => job.id > after), waitSupported: true } as T
    }
    const id = (body as { id: string }).id
    if (id === jobs[0]!.id && ++firstAttempts === 1) {
      await failReport.promise
      throw new Error('late report failure')
    }
    pending.delete(id)
    if (!pending.size) completed.resolve()
    return { accepted: true } as T
  }
  const work = proofs.run(() => [f.state], abort.signal)
  try {
    await queryEntered.promise
    failReport.resolve()
    await Bun.sleep(10)
    releaseQuery.resolve()
    await completed.promise
    abort.abort(); await work
    expect(firstAttempts).toBe(2)
    expect(pending.size).toBe(0)
  } finally { failReport.resolve(); releaseQuery.resolve(); abort.abort(); await work; f.cleanup() }
})

test('消费已领取页尾时前一页回执失败，停止启动页尾并保留首页重放', async () => {
  const f = await setup(), failFirst = proofGate(), holdLater = proofGate(), filled = proofGate()
  const abort = new AbortController(), proofs = new PublicationProofs(f.connection, () => {})
  const jobs = Array.from({ length: 21 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
  let polls = 0, laterReports = 0, now = Date.now()
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') {
      if (++polls === 1) return { jobs: [jobs[0]], nextCursor: jobs[0]!.id, waitSupported: true } as T
      if (polls === 2) return { jobs: jobs.slice(1), waitSupported: true } as T
      expect((body as { after: string }).after).toBe('')
      return { jobs: [], waitSupported: true } as T
    }
    if ((body as { id: string }).id === jobs[0]!.id) {
      await failFirst.promise
      throw new Error('previous page report failed')
    }
    if (++laterReports === PUBLICATION_PROOF_CONCURRENCY - 1) filled.resolve()
    await holdLater.promise
    return { accepted: true } as T
  }
  let consuming: Promise<void> | undefined
  try {
    await proofs.tick([f.state], abort.signal, true)
    consuming = proofs.tick([f.state], abort.signal, true)
    await filled.promise
    failFirst.resolve()
    expect(await Promise.race([consuming.then(() => true), Bun.sleep(1000).then(() => false)])).toBeTrue()
    expect(laterReports).toBe(PUBLICATION_PROOF_CONCURRENCY - 1)
    now += 1000
    await proofs.tick([f.state], abort.signal, true)
    expect(polls).toBe(3)
  } finally {
    abort.abort(); failFirst.resolve(); holdLater.resolve()
    await consuming
    await Bun.sleep(0)
    clock.mockRestore(); f.cleanup()
  }
})

test('本地最多十六个校验任务，同一成品直到最后一份回执完成才允许清理', async () => {
  const f = await setup()
  const count = PUBLICATION_PROOF_CONCURRENCY
  const gates = Array.from({ length: count + 1 }, proofGate)
  const entered = Array.from({ length: count + 1 }, proofGate)
  const proofs = new PublicationProofs(f.connection, () => {})
  const jobs = Array.from({ length: count + 1 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') }))
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
    await Promise.all(entered.slice(0, count).map(gate => gate.promise))
    expect(reports).toBe(count)
    expect(proofs.isUsing(f.state)).toBeTrue()
    gates[0]!.resolve()
    await entered[count]!.promise
    gates.slice(2).forEach(gate => gate.resolve())
    await Bun.sleep(5)
    expect(proofs.isUsing(f.state)).toBeTrue()
    gates[1]!.resolve()
    await work
    expect(peak).toBe(count)
    expect(reports).toBe(count + 1)
    expect(proofs.isUsing(f.state)).toBeFalse()
  } finally {
    gates.forEach(gate => gate.resolve())
    await work.catch(() => {})
    f.cleanup()
  }
})

test('并发回执失败后不领取额外任务，等待所有已开始任务结束再退出', async () => {
  const f = await setup(), gate = proofGate(), entered = proofGate()
  const proofs = new PublicationProofs(f.connection, () => {})
  let reports = 0, settled = false
  f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
    if (route === 'range-proofs/pending') return { jobs: Array.from({ length: PUBLICATION_PROOF_CONCURRENCY + 1 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') })) } as T
    reports++
    if ((body as { id: string }).id === '1'.padStart(32, '0')) throw new Error('offline report failure')
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
    expect(reports).toBe(PUBLICATION_PROOF_CONCURRENCY)
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

test('真实待办超过一页时连续领取，最后一页后才进入短轮询退避', async () => {
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

test('短轮询活跃时一秒补领，连续空闲逐步退避并在新任务到达后恢复', async () => {
  const f = await setup()
  let now = Date.now(), polls = 0, reports = 0, hasJob = false
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  try {
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
      if (route === 'range-proofs/pending') {
        polls++
        return { jobs: hasJob ? [f.job] : [], waitSupported: false } as T
      }
      hasJob = false; reports++
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    const signal = new AbortController().signal
    await proofs.tick([f.state], signal)
    for (const delay of [1000, 2000, 4000, 8000, 15_000, 15_000]) {
      const previous = polls
      now += delay - 1
      await proofs.tick([f.state], signal)
      expect(polls).toBe(previous)
      now++
      await proofs.tick([f.state], signal)
      expect(polls).toBe(previous + 1)
    }
    hasJob = true; now += 15_000
    await proofs.tick([f.state], signal)
    expect(reports).toBe(1)
    hasJob = true; now += 1000
    await proofs.tick([f.state], signal)
    expect(reports).toBe(2)
  } finally { clock.mockRestore(); f.cleanup() }
})

test('正常批量摘要回传不重复发布任务状态，避免触发每份回执的清单写盘', async () => {
  const f = await setup()
  try {
    let reports = 0, updates = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: Array.from({ length: 100 }, (_, i) => ({ ...f.job, id: (i + 1).toString(16).padStart(32, '0') })) } as T
      reports++
      return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, () => { updates++ }).tick([f.state], new AbortController().signal)
    expect(reports).toBe(100)
    expect(updates).toBe(0)
  } finally { f.cleanup() }
})

test('本地文件暂不可用的提示在恢复成功后清除，之后的成功摘要不再重复刷新', async () => {
  const f = await setup()
  let now = Date.now()
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const messages: (string | undefined)[] = [], reports: unknown[] = []
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [f.job], waitSupported: true } as T
      reports.push(body)
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, (_state, message) => { messages.push(message) })
    const signal = new AbortController().signal
    rmSync(f.path)
    await proofs.tick([f.state], signal)
    expect(messages).toEqual(['本机成品暂不可用，其他客户端仍可继续校验'])
    expect(reports).toEqual([{ id: f.job.id, taskKey: f.job.taskKey, unavailable: true }])
    writeFileSync(f.path, 'abcdefgh')
    now += 60_000
    await proofs.tick([f.state], signal)
    expect(messages).toEqual(['本机成品暂不可用，其他客户端仍可继续校验', undefined])
    expect(reports.at(-1)).toEqual({ id: f.job.id, taskKey: f.job.taskKey, signValue: createHash('sha1').update('cdef').digest('hex').toUpperCase() })
    await proofs.tick([f.state], signal)
    expect(reports).toHaveLength(3)
    expect(messages).toHaveLength(2)
  } finally { clock.mockRestore(); f.cleanup() }
})

test('同 Key 下本机清单为空时静默跳过，仍继续翻页且不打断持有文件的客户端', async () => {
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
    expect(reports).toEqual([])
    // 第二个客户端以同一身份领取相同挑战，仍能使用自己的本地成品响应。
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') return { jobs: [f.job] } as T
      reports.push(body)
      return { accepted: true } as T
    }
    await new PublicationProofs(f.connection, () => {}).tick([f.state], new AbortController().signal)
    expect(reports).toEqual([{ id: f.job.id, taskKey: f.job.taskKey, signValue: createHash('sha1').update('cdef').digest('hex').toUpperCase() }])
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

test('其他客户端的待办不会形成长轮询忙循环，也不会回报不可用', async () => {
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
    expect(reports).toBe(0)
  } finally { f.cleanup() }
})

test('登记已触发校验但本机尚未完成时先跳过，完成后可在原窗口内响应', async () => {
  const f = await setup()
  let now = Date.now()
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  try {
    f.state.snapshot.stage = 'uploading'
    const reports: unknown[] = []
    let polls = 0
    f.connection.request = async <T>(_binding: PublicationDraft['binding'], route: string, body: unknown): Promise<T> => {
      if (route === 'range-proofs/pending') { polls++; return { jobs: [f.job], waitSupported: true } as T }
      reports.push(body)
      return { accepted: true } as T
    }
    const proofs = new PublicationProofs(f.connection, () => {})
    const signal = new AbortController().signal
    await proofs.tick(() => [f.state], signal)
    expect(reports).toEqual([])
    f.state.snapshot.stage = 'completed'
    await proofs.tick(() => [f.state], signal)
    expect(polls).toBe(1)
    now += 1000
    await proofs.tick(() => [f.state], signal)
    expect(polls).toBe(2)
    expect(reports).toEqual([{ id: f.job.id, taskKey: f.job.taskKey, signValue: createHash('sha1').update('cdef').digest('hex').toUpperCase() }])
  } finally { clock.mockRestore(); f.cleanup() }
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
