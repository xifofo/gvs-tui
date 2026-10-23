/** 终端状态机用离线连接验证识别回填、退出和手动修改保护。 */
import { afterEach, expect, spyOn, test } from 'bun:test'
import { Runtime } from '../../runtime'
const runtimes: Runtime[] = []
afterEach(() => { for (const r of runtimes.splice(0)) r.close() })
function result() {
  const work = { tmdbId: '123', mediaType: 'tv', title: '星海纪行', originalTitle: 'Stars', englishTitle: 'Stars', year: 2024, posterUrl: '', category: { name: '动画番剧', value: 'anime', label: '动画番剧', status: 'matched' } }
  return { status: 'compatible', canAutoFill: true, reasons: [], truncated: false, selectionBasis: '', parsed: { title: 'Stars', mediaType: 'tv', seasonNumber: 2, episodeNumber: 3, resolution: '', source: '', warnings: [] }, work, workTarget: { tmdbId: '123', mediaType: 'tv', category: 'anime' }, candidates: [] }
}
async function setup() {
  const runtime = new Runtime({ simulate: true }); runtimes.push(runtime); await Bun.sleep(120)
  const r = runtime as any
  Object.defineProperty(r.plutofish, 'ready', { get: () => true })
  spyOn(r.plutofish, 'view').mockReturnValue({ status: 'verified', url: 'http://127.0.0.1:1234', identity: { id: 'p', sourceAccount: { id: 's', alias: 'offline' }, categories: [{ value: 'anime', label: '动画番剧' }] } })
  r.scene = 'confirm'; r.publicationCategory = ''; r.detailTitle = 'Stars'; r.eps = [{ vid: 'ep3', number: 3, season: 1 }]
  r.pending = [{ provider: 'youku', sourceWorkId: 'show', title: '第三集', series: 'Stars', kind: 'show', vid: 'ep3', season: 1, episode: 3, year: 2024, height: 1080, quality: '1080p', group: 'test', codec: 'hevc', tmdbId: 0, nameDots: '', languages: [], plot: '' }]
  return { runtime, r }
}
test('终端识别作品、分类与季号，保留平台集号并进入确认页', async () => {
  const { r } = await setup(); spyOn(r.plutofish, 'request').mockResolvedValue(result())
  await r.recognizePending('Stars.S02E99.mkv')
  expect(r.pending[0].tmdbId).toBe(123); expect(r.pending[0].season).toBe(2); expect(r.pending[0].episode).toBe(3)
  expect(r.pending[0].series).toBe('星海纪行'); expect(r.publicationCategory).toBe('anime'); expect(r.scene).toBe('confirm')
})
test('识别期间离开确认页，迟到回包不能把用户带回或覆盖作品', async () => {
  const { r, runtime } = await setup(); let finish!: (v: unknown) => void
  spyOn(r.plutofish, 'request').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = r.recognizePending('Stars.mkv'); runtime.handleKey('escape'); finish(result()); await pending
  expect(r.scene).toBe('quality'); expect(r.pending[0].tmdbId).toBe(0)
})
test('识别期间草稿变化，旧结果不改分类', async () => {
  const { r } = await setup(); let finish!: (v: unknown) => void
  spyOn(r.plutofish, 'request').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = r.recognizePending('Stars.mkv'); r.publicationCategory = 'manual'; finish(result()); await pending
  expect(r.publicationCategory).toBe('manual'); expect(r.pending[0].tmdbId).toBe(0)
})

test('已授权终端选完画质后自动识别，无需本地 TMDB Key', async () => {
  const { r } = await setup(); const call = spyOn(r.plutofish, 'request').mockResolvedValue(result())
  r.simulated = false; r.detailProv = 'youku'; r.scene = 'quality'; r.cfg.tmdbKey = ''
  try {
    await r.afterQuality()
    expect(call).toHaveBeenCalledTimes(1); expect(r.scene).toBe('confirm')
    expect(r.publicationCategory).toBe('anime'); expect(r.pending[0].tmdbId).toBe(123)
  } finally { r.simulated = true }
})
