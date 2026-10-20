import { expect, test } from 'bun:test'
import { mgtvEpisodeMetadata, type MgtvMetadataFetch } from './mgtv-episodes'
import { webVideoDetail } from './web-video-providers'
import { parseEpisodes } from './episodes'

const episode = (vid = '23627606') => ({ vid, id: vid, clipId: '796160', number: '1',
  title: '2025-10-15', subtitle: '第1期：五组家庭青海聚会开启', duration: 0, isIntact: true })
const catalogRow = (id = '23627606', time = '78:37') => ({ video_id: id, clip_id: '796160', src_clip_id: '796160',
  t3: '当家爸爸的聚会 第1期：王永鸿家欢迎仪式浓度超标 小米小宇宙小姐妹暖心贴贴', t2: '第1期：五组家庭青海聚会开启', time })
const reply = (list: Record<string, unknown>[], page = 1, pages = 1) => Response.json({ code: 200,
  data: { list, current_page: page, total_page: pages } })

test('mobile MGTV dates and zero durations are supplemented by exact VID from the public catalog', async () => {
  const d = { id: 'clip:796160', vid: '23627606', episodes: [episode(), { ...episode('23657710'), number: '2' }] }
  const eps = await mgtvEpisodeMetadata(d, async (url, init) => {
    expect(new URL(url).searchParams.get('video_id')).toBe('23627606')
    expect(new URL(url).hostname).toBe('pcweb.api.mgtv.com')
    expect(new Headers(init.headers).get('referer')).toBe('https://www.mgtv.com/')
    expect(new Headers(init.headers).has('cookie')).toBe(false)
    return reply([catalogRow('23657710', '68:24'), catalogRow()])
  })
  expect(parseEpisodes({ episodes: eps }).map(ep => [ep.vid, ep.duration, ep.number]))
    .toEqual([['23627606', 4717, 1], ['23657710', 4104, 2]])
  expect(eps[0]?.title).toBe(catalogRow().t3)
  expect(d.episodes[0]?.title).toBe('2025-10-15')
})

test('complete gateway metadata needs no public request or change', async () => {
  const e = { ...episode(), title: '完整标题', duration: 4717 }
  expect(await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [e] }, async () => { throw new Error('must not fetch') }))
    .toEqual([e])
})

test('public metadata never replaces a meaningful gateway title or positive duration', async () => {
  const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [
    { ...episode(), title: '完整平台标题' }, { ...episode('23657710'), duration: 5000 },
  ] }, async () => reply([catalogRow(), catalogRow('23657710', '68:24')]))
  expect(eps[0]).toMatchObject({ title: '完整平台标题', duration: 4717 })
  expect(eps[1]?.duration).toBe(5000)
})

test('only exact videos and clips can supply duration, never the show or the same episode number', async () => {
  const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', duration: 9999, episodes: [episode()] }, async () => reply([
    { ...catalogRow(), clip_id: 'other' }, { ...catalogRow(), src_clip_id: 'other' },
    { ...catalogRow('unrelated'), t1: '1' },
  ]))
  expect(eps[0]).toMatchObject({ title: episode().subtitle, duration: 0, number: '1' })
})

test('ambiguous duplicate catalog entries do not supply metadata', async () => {
  const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [episode()] }, async () => reply([
    catalogRow(), { ...catalogRow(), time: '12:30' },
  ]))
  expect(eps[0]?.duration).toBe(0)
})

test('public catalog pagination fills remaining VIDs without appending or reordering videos', async () => {
  const pages: number[] = []
  const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [episode('23657710'), episode()] }, async url => {
    const page = Number(new URL(url).searchParams.get('page')); pages.push(page)
    return reply(page === 1 ? [catalogRow(), catalogRow('extra')] : [catalogRow('23657710', '01:08:24')], page, 2)
  })
  expect(pages).toEqual([1, 2])
  expect(eps.map(e => [e.vid, e.duration])).toEqual([['23657710', 4104], ['23627606', 4717]])
})

test('a catalog which repeats its first page stops instead of looping', async () => {
  let calls = 0
  const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [episode(), episode('23657710')] }, async () => {
    calls++; return reply([catalogRow()], 1, 10)
  })
  expect(calls).toBe(2)
  expect(eps.map(e => e.duration)).toEqual([4717, 0])
})

test('network, HTTP, envelope, invalid clock and oversized responses retain usable gateway titles', async () => {
  const failures: MgtvMetadataFetch[] = [
    async () => { throw new Error('timeout') },
    async () => new Response('', { status: 503 }),
    async () => Response.json({ code: 30001, data: {} }),
    async () => new Response('not JSON'),
    async () => new Response(' '.repeat(1024 * 1024 + 1)),
    async () => reply([catalogRow('23627606', '78:99')]),
  ]
  for (const fetcher of failures) {
    const eps = await mgtvEpisodeMetadata({ id: 'clip:796160', episodes: [episode()] }, fetcher)
    expect(eps).toHaveLength(1)
    expect(eps[0]?.duration).toBe(0)
    expect(eps[0]?.title).not.toBe('2025-10-15')
  }
})

test('shared MGTV detail enriches all gateway pages while retaining groups and focus', async () => {
  const d = await webVideoDetail(async (_p, _a, input) => ({
    id: 'clip:796160', vid: '23627606', hasMore: !input.cursor, nextCursor: input.cursor ? '' : 'next',
    episodes: input.cursor ? [{ ...episode('23657710'), isIntact: false, number: '2' }] : [episode()],
  }), 'mgtv', 'https://www.mgtv.com/b/796160/23627606.html', async () => reply([catalogRow(), catalogRow('23657710', '68:24')]))
  expect(d.focusVid).toBe('23627606')
  expect(d.episode_groups).toEqual(['正片', '其他视频'])
  const eps = parseEpisodes(d)
  expect(eps.map(e => [e.vid, e.duration, e.collection])).toEqual([
    ['23627606', 4717, '正片'], ['23657710', 4104, '其他视频'],
  ])
})
