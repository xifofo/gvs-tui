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
    enqueue: (r: EnqueueRequest) => { enq.push(r); return r.episodes.length },
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
