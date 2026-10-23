/** 回环服务验证账号、鉴权、回填边界与连接变化，不请求 TMDB 或网盘。 */
import { afterEach, expect, test } from 'bun:test'
import { PlutoFishConnection } from './connection'
import { recognizeFile, validateRecognition } from './recognition'
import type { Recognition } from './recognition-types'
const closers: Array<() => void> = []
afterEach(() => { for (const close of closers.splice(0)) close() })
function fixture(): Recognition {
  const work = { tmdbId: '123', mediaType: 'tv' as const, title: '星海纪行', originalTitle: 'Stars', englishTitle: 'Stars', year: 2024, posterUrl: '', category: { name: '动画番剧', value: 'anime', label: '动画番剧', status: 'matched' as const } }
  return { status: 'compatible', canAutoFill: true, reasons: [], truncated: false, selectionBasis: '', parsed: { title: 'Stars', mediaType: 'tv', seasonNumber: 2, episodeNumber: 3, resolution: '1080p', source: 'WEB-DL', warnings: [] }, work, workTarget: { tmdbId: '123', mediaType: 'tv', category: 'anime' }, candidates: [{ work, conflicts: [] }] }
}
async function setup(handler: (request: Request) => Promise<Response> | Response) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler }); closers.push(() => server.stop(true))
  const source = { id: 'second', alias: 'selected', name: '第二账号' }
  const connection = new PlutoFishConnection({ load: () => ({ url: '', key: '' }), save: () => {}, verify: async () => ({ id: 'p', name: '测试', kind: 'publisher', sourceAccount: { id: 'first', alias: 'default', name: '默认' }, sourceAccounts: [source], categories: [{ value: 'anime', label: '动画番剧' }] }) })
  await connection.verify({ url: server.url.origin, key: 'test-only' }); closers.push(() => connection.close())
  return { connection, binding: { url: server.url.origin, publisherId: 'p', sourceAccount: source } }
}
test('固定所选账号和鉴权；无效文件名不发送请求', async () => {
  let calls = 0
  const { connection, binding } = await setup(async request => {
    calls++; expect(new URL(request.url).pathname).toBe('/api/v1/publisher/tmdb/recognize')
    expect(request.headers.get('authorization')).toBe('Bearer test-only')
    expect(await request.json()).toEqual({ sourceAccount: 'selected', fileName: 'Stars.S02E03.mkv' })
    return Response.json(fixture())
  })
  expect((await recognizeFile(connection, binding, 'Stars.S02E03.mkv')).workTarget?.category).toBe('anime')
  for (const name of ['', ' ', 'a\n.mkv', 'x'.repeat(1001)]) await expect(recognizeFile(connection, binding, name)).rejects.toThrow('请输入')
  expect(calls).toBe(1)
})
test('歧义、停用分类、跨季和伪成功不能回填', () => {
  for (const change of [
    (r: Recognition) => { r.status = 'ambiguous' }, (r: Recognition) => { r.work!.category.status = 'disabled' },
    (r: Recognition) => { r.workTarget!.category = 'wrong' }, (r: Recognition) => { r.workTarget!.tmdbId = '999' },
    (r: Recognition) => { r.parsed.seasonEnd = 3 }, (r: Recognition) => { r.truncated = true },
  ]) { const r = fixture(); change(r); expect(() => validateRecognition(r)).toThrow('无效') }
  const r = fixture(); r.status = 'ambiguous'; r.canAutoFill = false; r.workTarget = null
  expect(validateRecognition(r).canAutoFill).toBe(false)
})
test('旧服务和上游故障保留连接与手动入口', async () => {
  for (const status of [404, 502]) {
    const { connection, binding } = await setup(() => Response.json({ error: { code: 'NOT_FOUND' } }, { status }))
    await expect(recognizeFile(connection, binding, 'Stars.mkv')).rejects.toThrow(status === 404 ? '尚不支持' : '识别失败')
    expect(connection.ready).toBe(true)
  }
})
test('换连接后，旧识别请求必须失效', async () => {
  let start!: () => void, release!: () => void
  const received = new Promise<void>(resolve => { start = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  const { connection, binding } = await setup(async () => { start(); await hold; return Response.json(fixture()) })
  const pending = recognizeFile(connection, binding, 'Stars.mkv').then(() => false, () => true)
  await received; await connection.verify({ url: binding.url, key: 'changed' }); release(); expect(await pending).toBe(true)
})
