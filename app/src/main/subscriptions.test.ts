import { expect, test } from 'bun:test'
import type { DetailView, EnqueueRequest, ProbeResult } from '@shared/api'
import { SubscriptionManager } from './subscriptions'

function harness() {
  let now = new Date(2026, 9, 12, 10).getTime()
  let eps = [1, 2].map((n) => ({ vid: `v${n}`, title: `第${n}集`, number: n, group: '', duration: 0, languages: [] }))
  let qualities: ProbeResult['qualities'] = [
    { index: 0, label: '1080P', title: '', stream: '', width: 1920, height: 1080, size: 1, codec: 'avc', drm: '', hdr: '', fps: 25, audios: [] },
  ]
  const enq: EnqueueRequest[] = []
  const notes: string[] = []
  let saved = ''
  const deps = {
    detail: async () => ({ provider: 'tencent', id: 's1', title: '剧', poster: '', desc: '', category: '', year: 2026, tags: [], score: '', vip: false, drm: '', kind: 'show', episodeCount: eps.length, episodes: eps, pickNoun: '集' }) as DetailView,
    probe: async () => ({ token: 7, qualities, audios: [{ id: 'aac', label: '普通话', lang: 'zh', codec: 'aac', isDefault: true, selected: true, embedded: true }], vip: null, warning: '' }),
    enqueue: (r: EnqueueRequest): number | Promise<number> => { enq.push(r); return r.episodes.length },
    notify: (t: string, b: string) => void notes.push(`${t}|${b}`),
    changed: () => {},
    load: () => saved || null,
    save: (j: string) => { saved = j },
    now: () => now,
  }
  const m = new SubscriptionManager(deps)
  return {
    m, enq, notes, deps,
    advance: (min: number) => { now += min * 60_000 },
    setEps: (n: number) => { eps = Array.from({ length: n }, (_, i) => ({ vid: `v${i + 1}`, title: '', number: i + 1, group: '', duration: 0, languages: [] })) },
    setQualities: (q: typeof qualities) => { qualities = q },
    saved: () => saved,
  }
}

test('first check records baseline, later checks download new episodes by rules', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: '4K > 1080P > any' })
  h.m.stop()
  await h.m.checkNow(s.id)
  let v = h.m.view().subs[0]!
  expect([v.state, v.episodes.length, v.newCount, h.enq.length]).toEqual(['R', 2, 0, 0])
  // 没到点不查
  h.setEps(3)
  await h.m.tick()
  expect(h.m.view().subs[0]!.episodes.length).toBe(2)
  h.advance(10)
  await h.m.tick()
  v = h.m.view().subs[0]!
  expect([v.episodes.length, v.newCount, h.enq.length]).toEqual([3, 1, 1])
  expect(h.enq[0]!.episodes.map((e) => e.vid)).toEqual(['v3'])
  expect([h.enq[0]!.quality, h.enq[0]!.audioIds, h.enq[0]!.token]).toEqual([0, ['aac'], 7])
  expect(v.episodes[2]!.downloaded?.tier).toBe(1)
  expect(h.notes.length).toBe(2)
})

test('subscription waits for title resolution and does not record a rejected asynchronous enqueue as downloaded', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  h.m.stop()
  await h.m.checkNow(s.id)
  h.setEps(3)
  let reject!: (reason: Error) => void
  h.deps.enqueue = () => new Promise((_resolve, fail) => { reject = fail })
  const checking = h.m.checkNow(s.id)
  await Bun.sleep(1)
  expect(h.m.view().subs[0]!.episodes.find(e => e.vid === 'v3')?.downloaded).toBeUndefined()
  reject(new Error('发布端或源账号已改变'))
  await checking
  expect(h.m.view().subs[0]!.episodes.find(e => e.vid === 'v3')?.downloaded).toBeUndefined()
  expect(h.notes.some(note => note.includes('已加入下载'))).toBe(false)
})

test('upgrade re-downloads when a better tier appears; persistence round-trips', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: '4K > any', upgrade: true })
  h.m.stop()
  await h.m.checkNow(s.id)
  h.setEps(3)
  await h.m.checkNow(s.id)
  expect(h.enq.length).toBe(1)
  h.setQualities([{ index: 0, label: '4K', title: '', stream: '', width: 3840, height: 2160, size: 2, codec: 'hevc', drm: '', hdr: '', fps: 25, audios: [] }])
  await h.m.checkNow(s.id)
  expect(h.enq.length).toBe(2)
  const v = h.m.view().subs[0]!
  expect(v.episodes[2]!.downloaded?.tier).toBe(0)
  expect(v.lastCheck?.message.startsWith('洗版')).toBe(true)
  // 同一档不会再洗
  await h.m.checkNow(s.id)
  expect(h.enq.length).toBe(2)
  const again = new SubscriptionManager({ ...h.deps, load: () => h.saved() })
  expect(again.view().subs[0]!.episodes.length).toBe(3)
})

test('pause / dedupe / failures', async () => {
  const h = harness()
  const a = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show' })
  const b = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show' })
  h.m.stop()
  expect(a.id).toBe(b.id)
  h.m.update(a.id, { paused: true })
  expect(h.m.view().subs[0]!.state).toBe('S')
  h.m.update(a.id, { paused: false })
  h.deps.detail = async () => { throw new Error('网关 401') }
  const m2 = new SubscriptionManager({ ...h.deps, load: () => h.saved() })
  await m2.checkNow()
  const v = m2.view().subs[0]!
  expect([v.state, v.lastCheck?.ok, v.lastCheck?.message]).toEqual(['P', false, '网关 401'])
})

test('legacy mgtv subscriptions with bare clipId are migrated to clip:ID on load', () => {
  const h = harness()
  h.m.subscribe({ provider: 'mgtv', showId: '912960', title: '芒果剧', poster: '', kind: 'show', rules: '1080P > any' })
  h.m.stop()
  const raw = h.saved()
  const again = new SubscriptionManager({ ...h.deps, load: () => raw })
  again.stop()
  expect(again.view().subs[0]!.showId).toBe('clip:912960')
})

test('auto-download skips episodes already in download history', async () => {
  const h = harness()
  const done = new Set(['v3'])
  const m = new SubscriptionManager({ ...h.deps, isDownloaded: (_p: string, vid: string) => done.has(vid) })
  const s = m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: '1080P > any' })
  m.stop()
  await m.checkNow(s.id)
  h.setEps(4)
  await m.checkNow(s.id)
  expect(h.enq.length).toBe(1)
  expect(h.enq[0]!.episodes.map((e) => e.vid)).toEqual(['v4'])
})

test('a failed auto-download stays pending with its reason and is retried until it is queued', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  h.m.stop()
  await h.m.checkNow(s.id)
  h.setEps(4)
  const enqueue = h.deps.enqueue
  h.deps.enqueue = () => { throw new Error('请选择资源分类') }
  await h.m.checkNow(s.id)
  let v = h.m.view().subs[0]!
  const ep = (vid: string) => h.m.view().subs[0]!.episodes.find((e) => e.vid === vid)!
  expect([v.lastCheck?.ok, ep('v3').pending?.reason, ep('v3').pending?.attempts, ep('v4').pending?.attempts]).toEqual([false, '请选择资源分类', 1, 1])
  expect(v.lastCheck?.message).toContain('第 3、4 集未能加入下载：请选择资源分类')
  expect(h.notes.filter((n) => n.includes('暂未下载')).length).toBe(1)
  // 下次检查不晚于重试时间；没到重试时间不重试
  expect(v.nextCheckAt).toBeLessThanOrEqual(ep('v3').pending!.retryAt)
  h.advance(5)
  await h.m.tick()
  expect(ep('v3').pending?.attempts).toBe(1)
  // 第二次失败不再重复通知，退避加倍
  h.advance(6)
  await h.m.tick()
  expect([ep('v3').pending?.attempts, h.notes.filter((n) => n.includes('暂未下载')).length]).toEqual([2, 1])
  expect(ep('v3').pending!.retryAt - ep('v3').pending!.at).toBe(20 * 60_000)
  // 恢复后补下两集，待重试清空
  h.deps.enqueue = enqueue
  h.advance(21)
  await h.m.tick()
  v = h.m.view().subs[0]!
  expect(h.enq.map((r) => r.episodes.map((e) => e.vid))).toEqual([['v3', 'v4']])
  expect([ep('v3').pending, ep('v4').downloaded?.label, v.lastCheck?.ok]).toEqual([undefined, '1080P', true])
})

test('an episode without a qualifying tier waits for it instead of being skipped for good', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: '4K' })
  h.m.stop()
  await h.m.checkNow(s.id)
  h.setEps(3)
  await h.m.checkNow(s.id)
  const v3 = () => h.m.view().subs[0]!.episodes.find((e) => e.vid === 'v3')!
  expect([h.enq.length, v3().pending?.reason, h.m.view().subs[0]!.lastCheck?.ok]).toEqual([0, '规则组没有一档满足，等待更好的版本', true])
  h.setQualities([{ index: 0, label: '4K', title: '', stream: '', width: 3840, height: 2160, size: 2, codec: 'hevc', drm: '', hdr: '', fps: 25, audios: [] }])
  h.advance(11)
  await h.m.tick()
  expect([h.enq.length, v3().downloaded?.label, v3().pending]).toEqual([1, '4K', undefined])
})

test('pending retries survive a restart', async () => {
  const h = harness()
  const s = h.m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  h.m.stop()
  await h.m.checkNow(s.id)
  h.setEps(3)
  h.deps.enqueue = () => { throw new Error('PlutoFish 版本查询失败（HTTP 502）') }
  await h.m.checkNow(s.id)
  const again = new SubscriptionManager({ ...h.deps, enqueue: (r: EnqueueRequest) => { h.enq.push(r); return 1 }, load: () => h.saved() })
  again.stop()
  expect(again.view().subs[0]!.episodes.find((e) => e.vid === 'v3')?.pending?.reason).toBe('PlutoFish 版本查询失败（HTTP 502）')
  h.advance(11)
  await again.tick()
  expect(h.enq.map((r) => r.episodes.map((e) => e.vid))).toEqual([['v3']])
})

const releaseId = 'r'.repeat(32)
const progressOf = (episodes: number[] | null, latestEpisode?: number) => {
  const calls: EnqueueRequest[] = []
  const progress = async (req: EnqueueRequest) => { calls.push(req); return { releaseId, episodes, ...(latestEpisode !== undefined ? { latestEpisode } : {}) } }
  return { calls, progress }
}

test('new device: the first check follows PlutoFish progress and fills the missing episode', async () => {
  const h = harness()
  h.setEps(6)
  const p = progressOf([1, 2, 3, 5])
  const m = new SubscriptionManager({ ...h.deps, progress: p.progress })
  const s = m.subscribe({ provider: 'tencent', showId: 's1', title: '尚公主', poster: '', kind: 'show', rules: 'any' })
  m.stop()
  await m.checkNow(s.id)
  const v = m.view().subs[0]!
  expect(h.enq.map((r) => r.episodes.map((e) => e.number))).toEqual([[4, 6]])
  expect(v.episodes.filter((e) => e.skipped?.by === 'plutofish').map((e) => e.number)).toEqual([1, 2, 3, 5])
  expect([v.release?.id, v.lastCheck?.ok]).toEqual([releaseId, true])
  expect(v.lastCheck?.message).toBe('已记录现有 6 集，之后的新集会自动处理 · 按 PlutoFish 进度补下第 4、6 集 · 已下载 1080P · PlutoFish 已有第 1–3、5 集')
  // 下一次核对沿用这个版本，换 115 账号后发布标识变了也能接上
  h.setEps(7)
  await m.checkNow(s.id)
  expect(p.calls.at(-1)?.preferredReleaseId).toBe(releaseId)
  expect(h.enq.at(-1)?.preferredReleaseId).toBe(releaseId)
})

test('an episode another device or account already published is not downloaded again', async () => {
  const h = harness()
  let have = [1, 2]
  const m = new SubscriptionManager({ ...h.deps, progress: async () => ({ releaseId, episodes: have }) })
  const s = m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  m.stop()
  await m.checkNow(s.id)
  expect(h.enq.length).toBe(0)
  h.setEps(3)
  have = [1, 2, 3]
  await m.checkNow(s.id)
  const v = m.view().subs[0]!
  expect([h.enq.length, v.episodes[2]!.skipped?.by, v.episodes[2]!.pending, v.lastCheck?.message]).toEqual([0, 'plutofish', undefined, '发现 第 3 集 · PlutoFish 已有第 3 集，跳过'])
})

test('without a PlutoFish version yet the baseline stays and only new episodes download', async () => {
  const h = harness()
  const m = new SubscriptionManager({ ...h.deps, progress: async () => null })
  const s = m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  m.stop()
  await m.checkNow(s.id)
  expect([h.enq.length, m.view().subs[0]!.lastCheck?.message]).toEqual([0, '已记录现有 2 集，之后的新集会自动处理'])
  h.setEps(3)
  await m.checkNow(s.id)
  expect(h.enq.map((r) => r.episodes.map((e) => e.vid))).toEqual([['v3']])
  expect(m.view().subs[0]!.release).toBeUndefined()
})

test('episodes skipped by an older version are recovered from PlutoFish progress', async () => {
  const h = harness()
  h.setEps(5)
  const legacy = { version: 1, paused: false, intervalMinutes: 5, subs: [{ id: 'tencent:s1:x', provider: 'tencent', showId: 's1', title: '尚公主', poster: '', kind: 'show', state: 'R', paused: false,
    rules: 'any', autoDownload: true, upgrade: false, window: null, updateText: '', total: 5, newCount: 0, lastCheck: null, nextCheckAt: 0, createdAt: 0,
    episodes: [1, 2, 3, 4, 5].map((n) => ({ vid: `v${n}`, number: n, title: '', firstSeen: 0, ...(n === 4 ? {} : { downloaded: { tier: 0, label: '1080P', at: 0 } }) })) }] }
  const m = new SubscriptionManager({ ...h.deps, load: () => JSON.stringify(legacy), progress: async () => ({ releaseId, episodes: [1, 2, 3, 5] }) })
  m.stop()
  await m.tick()
  expect(h.enq.map((r) => r.episodes.map((e) => e.number))).toEqual([[4]])
  expect(m.view().subs[0]!.lastCheck?.message).toBe('按 PlutoFish 进度补下第 4 集 · 已下载 1080P')
  // 核对过后 6 小时内不重复探测
  h.advance(10)
  await m.tick()
  expect(h.enq.length).toBe(1)
})

test('a failed PlutoFish lookup keeps new episodes pending; old servers without an episode list only skip up to the latest episode', async () => {
  const h = harness()
  let fail = true
  const m = new SubscriptionManager({ ...h.deps, progress: async () => { if (fail) throw new Error('PlutoFish 版本查询失败（HTTP 502）'); return { releaseId, episodes: null, latestEpisode: 3 } } })
  const s = m.subscribe({ provider: 'tencent', showId: 's1', title: '剧', poster: '', kind: 'show', rules: 'any' })
  m.stop()
  await m.checkNow(s.id)
  expect([m.view().subs[0]!.lastCheck?.ok, m.view().subs[0]!.lastCheck?.message]).toEqual([false, '已记录现有 2 集，之后的新集会自动处理 · PlutoFish 进度核对失败：PlutoFish 版本查询失败（HTTP 502）'])
  h.setEps(4)
  await m.checkNow(s.id)
  expect(m.view().subs[0]!.episodes.filter((e) => e.pending).map((e) => e.number)).toEqual([3, 4])
  fail = false
  h.advance(11)
  await m.tick()
  const v = m.view().subs[0]!
  expect(h.enq.map((r) => r.episodes.map((e) => e.number))).toEqual([[4]])
  expect(v.episodes.map((e) => e.skipped?.by ?? (e.downloaded ? 'downloaded' : 'baseline'))).toEqual(['plutofish', 'plutofish', 'plutofish', 'downloaded'])
})
