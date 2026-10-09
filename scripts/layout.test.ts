import './vue-sfc.ts'
import { expect, test, spyOn } from 'bun:test'
import { PassThrough, Writable } from 'node:stream'
import { defineComponent, h } from '@vue/runtime-core'
import { createApp, useRenderer } from 'vue-termui'
import { displayWidth } from '../src/lib/text'
import { Runtime } from '../src/runtime'
import type { JobEvt } from '../src/lib/jobs'
import type { Job, Snapshot, TMDBHit } from '../src/types'

// Real terminal render buffers catch clipping and FFI errors that TS cannot.
test('responsive screens preserve controls and selected details across terminal sizes', async () => {
  const Root = (await import('../src/Root.vue')).default
  const cases = [
    ['quality-tencent', ['编码', '体积', '已选画质', '已选音轨']],
    ['quality-audio', ['DTS:X', '已选音轨', '空格 勾选']],
    ['jobs-error', ['失败阶段：封装', '读取原始时间戳失败', '99%']],
    ['settings-advanced', ['腾讯高级', 'caption=all', '修改后立即保存']],
    ['settings-gateway', ['网关代理', '127.0.0.1:7897', '修改后立即保存']],
    ['detail-movie', ['版本 30', 'm 类型']],
    ['confirm-long', ['电影 · 2026', '保存目录', '文件名示例']],
    ['tmdb-loading', ['正在搜索 TMDB', 's 跳过']],
    ['tmdb-empty', ['未找到匹配影片', 'r 重试']],
    ['tmdb-error', ['TMDB 搜索失败', '连接超时', 'r 重试']],
    ['tmdb-seasons', ['选择 TMDB 季号', '第 4 季', 'S04', '沿用平台季号', 'esc 保留编号']],
    ['tmdb-seasons-loading', ['正在读取 TMDB 季列表', 'esc 保留编号']],
    ['tmdb-seasons-error', ['季列表读取失败', '连接超时', 'r 重试', 'esc 保留编号']],
    ['tmdb-season-groups', ['选择 TMDB 季号', '[Seasons]', '黄风岭篇', 'S13', '沿用平台季号']],
    ['tmdb-season-groups-warning', ['剧集分组读取不完整', '黄风岭篇', 'S13', 'r 重试']],
    ['workspace', ['热播榜', '离线演示']],
    ['workspace-long-title', ['很长的中文节目标题', 'F1 帮助']],
    ['results', ['搜索结果', '红果']],
    ['filters', ['体裁', '● 全部', '○ 真人', '⏎ 应用']],
    ['job-detail', ['演示任务', '失败：连接超时', '诊断日志']],
  ] as const
  try {
    for (const [width, height] of [[60, 18], [80, 24], [100, 30], [140, 40], [160, 60]]) {
      for (const [scene, expected] of cases) {
        process.env.GVS_PREVIEW = scene
        process.env.GVS_PREVIEW_CURSOR = '0'
        let renderer: any
        const Probe = defineComponent({ setup() { renderer = useRenderer(); return () => h(Root) } })
        const errors: unknown[] = []
        const app = await createApp(Probe, null, {
          stdin: new PassThrough() as any,
          stdout: new Writable({ write(_chunk, _enc, done) { done() } }) as any,
          width, height, exitOnCtrlC: false, consoleMode: 'disabled', screenMode: 'main-screen',
        })
        app.config.errorHandler = error => errors.push(error)
        try {
          app.mount()
          await Bun.sleep(100)
          expect(errors).toHaveLength(0)
          const frame = new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true))
          const lines = frame.trimEnd().split('\n')
          expect(lines.length).toBe(height)
          expect(lines.every(line => displayWidth(line) <= width)).toBe(true)
          expect(lines.at(-1)).toContain('F1 帮助')
          expect(lines.at(-1)!.match(/F1 帮助/g)).toHaveLength(1)
          if (width === 160) expect(lines.at(-1)).toContain('F2 搜索  F3 任务  F4 设置')
          if (width === 160 && scene === 'workspace') expect(lines.at(-1)).toContain('f 筛选')
          if (scene.startsWith('quality')) expect(lines[0]).toContain('画质')
          if (scene.startsWith('tmdb')) expect(lines[0]).toContain('匹配')
          for (const text of expected) expect(frame).toContain(text)
          if (scene === 'tmdb-loading' || scene === 'tmdb-error') expect(frame).not.toContain('未找到匹配')
          if (scene === 'tmdb-loading') expect(lines.at(-1)).not.toContain('重试')
          if (scene === 'quality-tencent') expect(frame).not.toContain('fps fps')
        } finally { app.unmount(); renderer?.destroy() }
      }
    }
  } finally {
    delete process.env.GVS_PREVIEW
    delete process.env.GVS_PREVIEW_CURSOR
  }
}, 15000)

// A static snapshot cannot reproduce stale computed state: update the same
// selected task through the real download event callback without moving focus.
test('live job progress refreshes the list, summary, counts and final path together', async () => {
  const Root = (await import('../src/Root.vue')).default
  const previousPreview = process.env.GVS_PREVIEW
  process.env.GVS_PREVIEW = 'interactive'
  let runtime: Runtime
  let renderer: any
  const subscribe = Runtime.prototype.onSnapshot
  const subscription = spyOn(Runtime.prototype, 'onSnapshot').mockImplementation(function (this: Runtime, listener) {
    runtime = this
    return subscribe.call(this, listener)
  })
  const Probe = defineComponent({ setup() { renderer = useRenderer(); return () => h(Root) } })
  let app: Awaited<ReturnType<typeof createApp>> | undefined
  try {
    // Both the side panel and the lower panel must react to background events.
    for (const width of [140, 80]) {
      const errors: unknown[] = []
      app = await createApp(Probe, null, {
        stdin: new PassThrough() as any,
        stdout: new Writable({ write(_chunk, _enc, done) { done() } }) as any,
        width, height: 24, exitOnCtrlC: false, consoleMode: 'disabled', screenMode: 'main-screen',
      })
      app.config.errorHandler = error => errors.push(error)
      app.mount()
      await Bun.sleep(180)
      const internal = runtime! as unknown as { jobs: Job[]; logs: Map<number, string[]>; hub: { onEvt: (event: JobEvt) => void } }
      internal.jobs = [{ id: 1, title: '追凶者也 maxplus', status: '下载', phase: '下载', pct: 0.13, log: '0 B/1 B  0 B/s', err: '' }]
      runtime!.handleKey('f3')
      const frame = () => new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true))
      const check = async (phase: string, pct: number, detail: string, counts: string) => {
        await Bun.sleep(120)
        const rendered = frame()
        expect(rendered).toContain(`${phase} · ${pct}%`)
        expect(rendered.match(new RegExp(`\\b${pct}%`, 'g'))).toHaveLength(2)
        expect(rendered).toContain(detail)
        expect(rendered).toContain(counts)
        expect(runtime!.snapshot.cursor).toBe(0)
      }
      await check('阶段：下载', 13, '0 B/1 B', '进行中 1')
      const firstSnapshot = runtime!.snapshot
      internal.hub.onEvt({ id: 1, status: '下载', pct: 0.55, log: '550 MB/1 GB  8 MB/s', err: '' })
      await check('阶段：下载', 55, '550 MB/1 GB', '进行中 1')
      internal.hub.onEvt({ id: 1, status: '封装', pct: 0.99, log: '封装 990 MB/1 GB', err: '' })
      await check('阶段：封装', 99, '封装 990 MB/1 GB', '进行中 1')
      internal.hub.onEvt({ id: 1, status: '完成', pct: 1, log: '/downloads/movie.mkv', err: '', done: true })
      await check('阶段：完成', 100, '/downloads/movie.mkv', '完成 1')
      expect(frame()).toContain('保存位置')
      expect(frame()).not.toContain('0 B/1 B')
      // Published snapshots must not be retroactively changed by later events.
      expect(firstSnapshot.jobs[0]!.pct).toBe(0.13)
      internal.jobs.push({ id: 2, title: '第二个任务', status: '排队', pct: 0, log: '', err: '' })
      internal.hub.onEvt({ id: 2, status: '下载', pct: 0.4, log: '下载中', err: '' })
      await Bun.sleep(120)
      expect(frame()).toContain('第二个任务')
      expect(frame()).toContain('2 个任务')
      runtime!.handleKey('down')
      internal.hub.onEvt({ id: 2, status: '失败', pct: 0.4, log: '', err: '连接中断', done: true })
      await Bun.sleep(120)
      expect(frame()).toContain('失败阶段：下载 · 40%')
      expect(frame()).toContain('失败原因：连接中断')
      expect(frame()).toContain('失败 1')
      // A wrapped title must not displace the fixed status or hide the final log.
      internal.jobs[1]!.title = '第二个任务的完整长标题'.repeat(10)
      internal.logs.set(2, [...Array.from({ length: 70 }, (_, i) => `诊断日志 ${i + 1}`), '最后一行 END'])
      runtime!.handleKey('enter')
      await Bun.sleep(120)
      expect(runtime!.snapshot.jobDetailLines![1]).toBe('状态 失败 · 40%')
      expect(runtime!.snapshot.jobDetailLines!.join('')).toContain(internal.jobs[1]!.title)
      expect(frame()).toContain('状态 失败 · 40%')
      runtime!.handleKey('pagedown')
      expect(runtime!.snapshot.logOffset).toBe(16)
      runtime!.handleKey('end')
      await Bun.sleep(120)
      expect(frame()).toContain('最后一行 END')
      expect(frame()).toContain('状态 失败 · 40%')
      expect(errors).toHaveLength(0)
      app.unmount()
      app = undefined
      renderer.destroy()
      renderer = undefined
    }
  } finally {
    app?.unmount()
    renderer?.destroy()
    subscription.mockRestore()
    if (previousPreview === undefined) delete process.env.GVS_PREVIEW
    else process.env.GVS_PREVIEW = previousPreview
  }
}, 10000)


test('TMDB shows loading from the first snapshot until results, errors or empty responses settle', async () => {
  const Root = (await import('../src/Root.vue')).default
  const previousPreview = process.env.GVS_PREVIEW
  process.env.GVS_PREVIEW = 'interactive'
  let runtime: Runtime
  let renderer: any
  const snapshots: Snapshot[] = []
  const subscribe = Runtime.prototype.onSnapshot
  const subscription = spyOn(Runtime.prototype, 'onSnapshot').mockImplementation(function (this: Runtime, listener) {
    runtime = this
    return subscribe.call(this, snapshot => { snapshots.push(snapshot); listener(snapshot) })
  })
  const Probe = defineComponent({ setup() { renderer = useRenderer(); return () => h(Root) } })
  let app: Awaited<ReturnType<typeof createApp>> | undefined
  try {
    const errors: unknown[] = []
    app = await createApp(Probe, null, {
      stdin: new PassThrough() as any,
      stdout: new Writable({ write(_chunk, _enc, done) { done() } }) as any,
      width: 80, height: 24, exitOnCtrlC: false, consoleMode: 'disabled', screenMode: 'main-screen',
    })
    app.config.errorHandler = error => errors.push(error)
    app.mount()
    await Bun.sleep(180)
    runtime!.handleKey('enter')
    await Bun.sleep(100)
    runtime!.handleKey('enter')
    const internal = runtime! as any
    const work = internal.work.bind(runtime!)
    let resolveSearch!: (hits: TMDBHit[]) => void
    let rejectSearch!: (error: Error) => void
    let calls = 0
    // Retain work()'s busy/finally emissions, only substitute the network operation.
    internal.work = () => work(() => {
      calls++
      return new Promise<TMDBHit[]>((resolve, reject) => { resolveSearch = resolve; rejectSearch = reject })
    })
    const frame = () => new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true))
    snapshots.length = 0
    const first = internal.matchTMDB()
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0]!.busy).toBe(false)
    expect(snapshots[0]!.tmdbState).toBe('loading')
    expect(snapshots.every(s => s.tmdbState === 'loading')).toBe(true)
    await Bun.sleep(120)
    expect(frame()).toContain('正在搜索 TMDB')
    expect(frame()).not.toContain('暂无匹配候选')
    expect(frame()).not.toContain('未找到匹配')
    expect(frame()).not.toContain('r 重试')
    runtime!.handleKey('r')
    expect(calls).toBe(1)
    resolveSearch([{ id: 123, name: '检索结果标题', title: '', year: 2026, kind: 'show' }])
    await first
    // Even work()'s last intermediate snapshot must retain the loading state.
    expect(snapshots.slice(0, -1).every(s => s.tmdbState === 'loading')).toBe(true)
    expect(snapshots.at(-1)!.tmdbState).toBe('ready')
    await Bun.sleep(120)
    expect(frame()).toContain('检索结果标题')
    expect(frame()).not.toContain('正在搜索 TMDB')

    runtime!.handleKey('r')
    await Bun.sleep(120)
    expect(frame()).toContain('正在搜索 TMDB')
    expect(frame()).not.toContain('检索结果标题')
    rejectSearch(new Error('连接超时，请检查代理'))
    await Bun.sleep(120)
    expect(frame()).toContain('TMDB 搜索失败')
    expect(frame()).toContain('连接超时')
    expect(frame()).not.toContain('未找到匹配')
    runtime!.handleKey('r')
    await Bun.sleep(120)
    expect(frame()).toContain('正在搜索 TMDB')
    expect(frame()).not.toContain('连接超时')
    resolveSearch([])
    await Bun.sleep(120)
    expect(frame()).toContain('未找到匹配影片')
    expect(frame()).not.toContain('正在搜索 TMDB')

    runtime!.handleKey('r')
    runtime!.handleKey('s')
    resolveSearch([{ id: 456, name: '过期结果', title: '', year: 2026, kind: 'movie' }])
    await Bun.sleep(120)
    expect(runtime!.snapshot.scene).toBe('confirm')
    expect(runtime!.snapshot.tmdbState).toBe('idle')
    expect(frame()).not.toContain('过期结果')
    expect(errors).toHaveLength(0)
  } finally {
    app?.unmount()
    renderer?.destroy()
    subscription.mockRestore()
    if (previousPreview === undefined) delete process.env.GVS_PREVIEW
    else process.env.GVS_PREVIEW = previousPreview
  }
}, 10000)
