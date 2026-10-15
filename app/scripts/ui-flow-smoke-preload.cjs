// Synthetic IPC only: this preload never imports the production main process.
const { contextBridge } = require('electron')
const handlers = new Map()
const calls = []
const clone = value => JSON.parse(JSON.stringify(value))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const providers = ['youku', 'tencent', 'hongguo', 'huangguo', 'douyin', 'mewatch', 'hamivideo', 'iq', 'iqcn', 'mgtv', 'bilibili', 'migu']
const title = '山海回声'
function poster(index) {
  const colors = ['#45675c', '#537284', '#88705b', '#715c70']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="${colors[index % colors.length]}"/><circle cx="220" cy="110" r="52" fill="#e4d4ac" opacity=".7"/><path d="M0 320L100 145L205 340L300 210V420H0" fill="#172d30" opacity=".55"/><text x="30" y="370" fill="#f6f0df" font-family="sans-serif" font-size="32">${index % 2 ? '远方来信' : title}</text></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
const settings = {
  host: 'https://gateway.example.invalid', desktopProxy: '', keyMasked: 'offline-fixture', hasKey: true,
  outDir: 'D:/GVS/Downloads', tmpDir: '', releaseGroup: 'GVS', includeEpisodeTitle: true,
  tmdbKey: '', tmdbLang: 'zh-CN', threads: 4, tencentObservations: false, hamiClient: 'tv',
  tencentCookie: '', douyinCookie: '', iqCookie: '', iqProfile: '',
  hongguoNfo: true, huangguoNfo: true, hongguoFmt: 'mkv', huangguoFmt: 'mkv',
}
const state = {
  configured: true, connecting: true, keyName: '离线界面验证', keyError: '', providers,
  tunnel: { ok: false, err: '', enabled: true }, settings, version: '0.1.39', platform: 'win32',
  accounts: providers.map((provider, i) => ({ provider, short: i < 2 ? '已登录' : '待检查', summary: '模拟账号状态，不连接真实账号', tone: i < 2 ? 'ok' : 'muted' })),
  tools: [{ name: 'ffmpeg', ok: true, note: '离线模拟' }, { name: 'MP4Box', ok: true, note: '离线模拟' }],
}
const cards = provider => Array.from({ length: 4 }, (_, i) => ({
  provider, id: `${provider}-show-${i}`, title: i ? ['山海回声 · 特别篇', '远方来信', '山海之间'][i - 1] : title,
  poster: poster(i), desc: '一封迟到的来信，让两个久别的人再次踏上旅途。沿着海岸寻找记忆，也在平凡生活中重新理解相遇。',
  meta: '2026 · 剧情 · 全 40 集', score: '8.7', vip: i === 0, target: 'detail', mediaKind: 'show',
}))
const episodes = Array.from({ length: 44 }, (_, i) => ({
  vid: `fixture-episode-${i + 1}`, title: i < 40 ? `第 ${i + 1} 集 · ${['风从海边来', '重逢的旧时光', '写给未来的信', '没有说完的故事'][i % 4]}` : `番外 ${i - 39} · 海岸日记`,
  number: i < 40 ? i + 1 : i - 39, group: 'S01', collection: i < 40 ? '正片' : '番外', duration: i < 40 ? 2580 + i * 3 : 980,
  languages: [{ vid: `fixture-episode-${i + 1}`, lang: '国语', langcode: 'zh-CN' }],
}))
const audios = [
  { id: 'zh-aac', lang: '国语', label: 'AAC 立体声', codec: 'AAC · 192 kbps', isDefault: true, selected: true, embedded: false },
  { id: 'zh-eac3', lang: '国语', label: '杜比全景声', codec: 'E-AC-3 · 768 kbps', isDefault: false, selected: false, embedded: false },
  { id: 'zh-dts', lang: '国语', label: 'DTS 5.1', codec: 'DTS · 1.5 Mbps', isDefault: false, selected: false, embedded: false },
  { id: 'yue-aac', lang: '粤语', label: 'AAC 立体声', codec: 'AAC · 192 kbps', isDefault: false, selected: false, embedded: false },
  { id: 'en-aac', lang: '英语', label: 'AAC 立体声', codec: 'AAC · 192 kbps', isDefault: false, selected: false, embedded: false },
]
const qualities = [
  ['4K · 60fps', 3840, 2160, 'dolbyvision', 'HEVC', 60], ['4K · 60fps', 3840, 2160, 'hdr10', 'HEVC', 60],
  ['4K 超清', 3840, 2160, 'sdr', 'HEVC', 25], ['1080P 高码率', 1920, 1080, 'sdr', 'AVC', 25],
  ['1080P · 60fps', 1920, 1080, 'sdr', 'HEVC', 60], ['1080P 高清', 1920, 1080, 'sdr', 'AVC', 25],
  ['720P 清晰', 1280, 720, 'sdr', 'AVC', 25], ['480P 流畅', 852, 480, 'sdr', 'AVC', 25],
].map(([label, width, height, hdr, codec, fps], index) => ({
  index, label, title: label, stream: `${hdr}|${codec.toLowerCase()}`, width, height, hdr, codec, fps,
  size: (8 - index) * 420 * 1024 * 1024, drm: '', audios,
}))
let jobs = ['running', 'paused', 'failed', 'done'].map((jobState, i) => ({
  id: i + 1, groupId: `fixture-existing-${i}`, groupTitle: ['长风入海', '远方来信', '夏日往事', '山间小路'][i],
  provider: i === 2 ? 'tencent' : 'youku', poster: poster(i), label: 'S01E01', quality: '1080P 高清',
  status: { running: '下载中 · 12.8 MB/s', paused: '已暂停', failed: '失败', done: '完成' }[jobState],
  pct: jobState === 'running' ? 0.43 : jobState === 'done' ? 1 : 0, log: '', err: jobState === 'failed' ? '离线示例：网络连接暂时不可用' : '', note: '',
  state: jobState, output: jobState === 'done' ? 'D:/GVS/Downloads/山间小路/S01E01.mkv' : '', createdAt: Date.now() - 3600000, finishedAt: jobState === 'done' ? Date.now() - 180000 : 0,
}))
const update = { status: 'idle', version: '', current: '0.1.39', percent: 0, message: '', url: '', auto: false }
const emit = (event, payload) => { for (const callback of handlers.get(event) || []) callback(clone(payload)) }
let connectionStarted = false
let nextProbeDelay = 180
const snapshot = () => ({ ready: !state.connecting && state.tunnel.ok, calls: clone(calls), jobs: clone(jobs), settings: clone(settings) })
contextBridge.exposeInMainWorld('__uiFlowFixture', {
  snapshot,
  pushState() { emit('state', { ...state, settings: { ...settings }, keyName: '离线状态刷新' }) },
  delayNextProbe(ms) { nextProbeDelay = ms },
})
contextBridge.exposeInMainWorld('gvs', {
  on(event, callback) {
    const listeners = handlers.get(event) || []
    listeners.push(callback)
    handlers.set(event, listeners)
    return () => { const index = listeners.indexOf(callback); if (index >= 0) listeners.splice(index, 1) }
  },
  async call(method, ...args) {
    const call = { method, args: clone(args), ready: !state.connecting && state.tunnel.ok }
    calls.push(call)
    switch (method) {
      case 'state':
        if (!connectionStarted) {
          connectionStarted = true
          setTimeout(() => { state.connecting = false; state.tunnel.ok = true; emit('state', state) }, 1200)
        }
        return clone(state)
      case 'jobs': return clone(jobs)
      case 'updateState': return clone(update)
      case 'catalog': return [{ id: 'featured', title: '精选', mode: 'home', available: true }, { id: 'rank', title: '热播榜', mode: 'rank', available: true }]
      case 'browse': return { cards: cards(args[0]), channels: [], more: false, next: '', notice: '' }
      case 'parseLink':
        if (args[0] === '慢速旧查询') { await delay(600); call.completed = true; return { kind: 'youku', vid: 'stale-link' } }
        call.completed = true
        return { kind: 'none' }
      case 'searchTargets': return ['youku', 'tencent', 'iqcn']
      case 'searchProvider': await delay(args[0] === 'tencent' ? 180 : 60); return { provider: args[0], cards: cards(args[0]), error: '' }
      case 'detail':
      case 'detailFromLink':
        await delay(120)
        return { provider: method === 'detail' ? args[0] : 'youku', id: 'fixture-show', title, poster: poster(0), desc: '一封迟到的来信，让两个久别的人再次踏上旅途。沿着海岸寻找记忆，也在平凡生活中重新理解相遇。故事从一座安静的小城开始，在山与海之间，记录那些未曾说出口的告别。', category: '电视剧', year: 2026, tags: ['剧情', '都市'], score: '8.7', vip: true, drm: '', kind: 'show', episodeCount: 40, episodes: clone(episodes), pickNoun: '集' }
      case 'probe': {
        const duration = nextProbeDelay
        nextProbeDelay = 180
        await delay(duration)
        call.completed = true
        return { token: 701, qualities: clone(qualities), audios: clone(audios), vip: { canPlay: true, isVip: true, hasTrial: false, note: '' }, warning: '' }
      }
      case 'namingPreview': return { folder: `D:/GVS/Downloads/${title} (2026)/Season 01`, file: `${title}.S01E${String(args[0].episodes[0].number).padStart(2, '0')}.${qualities[args[0].quality].label}.GVS.mkv`, note: '其余集数自动命名' }
      case 'publicationPreferences': return null
      case 'savePublicationPreferences': return
      case 'enqueue': {
        // Delay intentionally makes a same-tick double click observable.
        await delay(300)
        const request = args[0]
        jobs.push(...request.episodes.map((episode, i) => ({ id: 100 + jobs.length + i, groupId: 'fixture-enqueued', groupTitle: request.detail.title, provider: request.detail.provider, poster: poster(0), label: `S01E${String(episode.number).padStart(2, '0')}`, quality: qualities[request.quality].label, status: '排队中', pct: 0, log: '', err: '', note: '', state: 'queued', output: '', createdAt: Date.now(), finishedAt: 0 })))
        emit('jobs', jobs)
        return request.episodes.length
      }
      case 'cacheInfo': return { posters: 12 * 1024 * 1024, temp: 0 }
      case 'saveSettings': await delay(250); Object.assign(settings, args[0]); emit('state', state); call.completed = true; return clone(state)
      case 'providerSession':
        if (args[0].provider === 'migu') return {provider:'migu',state:'pending',authenticated:false,summary:'使用咪咕视频 App 扫码并确认',qrDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',url:'https://passport.migu.cn/qrc/offline',interval:3}
        if (args[0].provider === 'mgtv' && args[0].op === 'start') return {provider:'mgtv',state:'pending',authenticated:false,summary:'使用芒果 TV App 扫码并确认',qrDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',url:'https://oauth.mgtv.com/2.0/multicode_login?uid=mock',interval:3}
        if (args[0].provider === 'bilibili') return {provider:'bilibili',state:'authenticated',authenticated:true,summary:'B 站 Web 会话已验证；网关重启需重新导入'}
        return { provider: args[0].provider, state: 'ready', authenticated: false, summary: '离线界面模拟' }
      case 'tencentDiagnostics': return []
      case 'checkUpdate': return { ...update, status: 'error', message: 'GitHub 更新检查达到请求限额（403）。请在 60 分钟后重试，或打开官方发布页。', url: 'https://github.com/my-name-is-alan/gvs-tui/releases' }
      case 'installUpdate': return
      case 'youkuQrStart': await delay(900); call.completed = true; return { images: [{ title: '离线二维码', image: poster(0) }], hint: '仅验证弹窗生命周期，不连接账号' }
      case 'youkuQrPoll': return { done: false, message: '离线等待扫码', tone: 'muted' }
      case 'qrCancel': return
      case 'pauseJob':
      case 'resumeJob':
      case 'retryJob': jobs = jobs.map(job => job.id === args[0] ? { ...job, state: method === 'pauseJob' ? 'paused' : 'queued', status: method === 'pauseJob' ? '已暂停' : '排队中' } : job); emit('jobs', jobs); return
      case 'pauseAll': jobs = jobs.map(job => ['queued', 'running'].includes(job.state) ? { ...job, state: 'paused', status: '已暂停' } : job); emit('jobs', jobs); return
      case 'resumeAll': jobs = jobs.map(job => job.state === 'paused' ? { ...job, state: 'queued', status: '排队中' } : job); emit('jobs', jobs); return
      case 'clearFinished': jobs = jobs.filter(job => job.state !== 'done'); emit('jobs', jobs); return
      default: throw new Error(`Unexpected offline smoke IPC method: ${method}`)
    }
  },
})
