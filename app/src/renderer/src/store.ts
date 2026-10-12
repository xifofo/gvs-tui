import { reactive } from 'vue'
import { ipcArgs } from '@shared/ipc-args'
import { userMessage, userFacing } from '@shared/user-message'
import type {
  AppState,
  Card,
  DetailView,
  DetailHint,
  EpisodeView,
  GvsApi,
  JobView,
  ProbeResult,
  Provider,
  SearchResult,
  UpdateState,
  Tone,
} from '@shared/api'
import { DEFAULT_UI_PREFS, pushRecent, type UiPrefs } from '@shared/ui-prefs'
import { visibleProviders } from '@shared/provider-registry'

export type View = 'home' | 'discover' | 'search' | 'detail' | 'quality' | 'downloads' | 'settings' | 'accounts' | 'calendar' | 'subscriptions'
/** 'account' 保留为兼容别名：账号已移到独立的「账号」页。 */
export type SettingsTab = 'download' | 'account' | 'gateway' | 'naming' | 'about'

// 参数可能是 Vue 响应式代理，IPC 的结构化克隆不认；统一转成纯数据再发。
export const gvs = <K extends keyof GvsApi>(method: K, ...args: Parameters<GvsApi[K]>): ReturnType<GvsApi[K]> =>
  window.gvs.call(method, ...ipcArgs(args))

type Toast = { id: number; message: string; tone: Tone }

export const store = reactive({
  state: null as AppState | null,
  jobs: [] as JobView[],
  view: 'home' as View,
  history: [] as View[],

  query: '',
  search: null as SearchResult | null,
  searching: false,
  searchError: '',
  /** 还在搜的平台 */
  searchPending: [] as Provider[],

  detail: null as DetailView | null,
  detailLoading: false,
  detailError: '',
  /** 卡片上已有的标题/海报：详情接口没给时兜底，骨架屏也能先显示 */
  detailHint: null as DetailHint | null,
  /** 选中的集 vid */
  picked: [] as string[],
  detailCollection: '',
  /** 同一部剧在其它平台的搜索结果（合并搜索时带入），详情页用来切换平台 */
  detailAlternates: [] as Card[],
  /** 当前剧集页是从哪张卡片打开的（用于平台切换） */
  detailCard: null as Card | null,
  /** 画质面板直接嵌在剧集页里（不再单独跳到画质页） */
  qualityInline: false,

  settingsTab: 'download' as SettingsTab,
  dlFilter: 'all' as 'all' | 'active' | 'paused' | 'failed' | 'done',

  probe: null as ProbeResult | null,
  probeEpisodes: [] as EpisodeView[],
  probing: false,
  probeError: '',

  /** Ctrl+K 命令面板 */
  paletteOpen: false,
  /** 账号中心右侧抽屉当前平台 */
  accountDrawer: null as Provider | null,
  /** 首次引导进行中（连上网关后继续第 2、3 步） */
  onboarding: false,
  /** 搜索页的平台筛选（空 = 全部） */
  searchFilter: [] as Provider[],

  qr: null as null | 'youku' | 'tencent' | 'iqcn' | 'mgtv' | 'migu' | 'bilibili',
  /** 打开着的确认框数量：Esc 返回时要避开 */
  dialogCount: 0,
  update: null as UpdateState | null,
  toasts: [] as Toast[],
})

/** 还有弹窗挡在前面（Esc 归弹窗管） */
export const modalOpen = () => store.qr !== null || store.dialogCount > 0 || store.paletteOpen || store.accountDrawer !== null

let toastId = 0
export function toast(message: string, tone: Tone = 'muted'): void {
  const id = ++toastId
  store.toasts.push({ id, message: tone === 'err' || tone === 'warn' ? userMessage(message) : message, tone })
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id)
    if (i >= 0) store.toasts.splice(i, 1)
  }, tone === 'err' ? 7000 : 3500)
}

export const errText = userMessage

let searchGen = 0
let detailGen = 0
let probeGen = 0

function leaveView(next: View): void {
  if (next === store.view) return
  if (store.view === 'search') { ++searchGen; store.searching = false; store.searchPending = [] }
  if (store.view === 'detail') {
    ++detailGen
    store.detailLoading = false
    if (store.qualityInline && next !== 'settings') {
      ++probeGen
      if (store.probing && !store.probe) store.probeError = '画质加载已中断，请点击重试继续。'
      store.probing = false
    }
  }
  if (store.view === 'quality') {
    ++probeGen
    if (store.probing && !store.probe) store.probeError = '画质加载已中断，请点击重试继续。'
    store.probing = false
  }
}

export function go(view: View): void {
  if (store.view === view) return
  leaveView(view)
  store.history.push(store.view)
  if (store.history.length > 30) store.history.shift()
  store.view = view
}

export function back(fallback: View = 'home'): void {
  const next = store.history.pop() ?? fallback
  leaveView(next)
  store.view = next
}

export function openSettings(tab: SettingsTab): void {
  if (tab === 'account') return go('accounts')
  store.settingsTab = tab
  go('settings')
}

/** 当前 UI 偏好（未连接时用默认值） */
export function prefs(): UiPrefs {
  return store.state?.settings.ui ?? DEFAULT_UI_PREFS
}

let prefsQueue: Promise<unknown> = Promise.resolve()
/** 乐观更新本地 UI 偏好，再写回主进程（tui.json desktopUi） */
export function savePrefs(patch: Partial<UiPrefs>): Promise<void> {
  const st = store.state
  if (st) st.settings.ui = { ...prefs(), ...patch }
  const run = prefsQueue.then(async () => {
    try {
      store.state = await gvs('saveSettings', { ui: patch })
    } catch (e) {
      toast(errText(e), 'err')
    }
  })
  prefsQueue = run
  return run
}

/** 按用户排序、去掉隐藏的平台 */
export function shownProviders(): Provider[] {
  return visibleProviders(store.state?.providers ?? [], prefs())
}

/** 侧栏高亮：详情/画质页归到进来的那一栏；发现页归在首页下 */
export function section(): View {
  if (store.view === 'discover') return 'home'
  if (store.view !== 'detail' && store.view !== 'quality') return store.view
  for (let i = store.history.length - 1; i >= 0; i--) {
    const v = store.history[i]
    if (v === 'search') return 'search'
    if (v === 'discover' || v === 'home') return 'home'
  }
  return 'search'
}

export async function runSearch(raw: string): Promise<void> {
  const q = raw.trim()
  if (!q) return
  store.query = q
  go('search')
  void savePrefs({ recentSearches: pushRecent(prefs().recentSearches, q) })
  const gen = ++searchGen
  store.searching = true
  store.searchError = ''
  store.search = { query: q, groups: [], ms: 0 }
  store.searchPending = []
  const t0 = Date.now()
  try {
    const link = await gvs('parseLink', q)
    if (gen !== searchGen) return
    if (link.kind !== 'none') {
      await openDetailWith(() => gvs('detailFromLink', link))
      return
    }
    const hidden = new Set(prefs().hiddenProviders)
    const targets = (await gvs('searchTargets')).filter((p) => !hidden.has(p))
    if (gen !== searchGen) return
    store.searchPending = [...targets]
    await Promise.all(
      targets.map(async (p) => {
        const g = await gvs('searchProvider', p, q)
        if (gen !== searchGen || !store.search) return
        store.search.groups.push(userFacing(g))
        store.search.ms = Date.now() - t0
        store.searchPending = store.searchPending.filter((x) => x !== p)
      }),
    )
  } catch (e) {
    if (gen === searchGen) store.searchError = errText(e)
  } finally {
    if (gen === searchGen) store.searching = false
  }
}

async function openDetailWith(load: () => Promise<DetailView>, hint?: DetailHint | null): Promise<void> {
  go('detail')
  const gen = ++detailGen
  ++probeGen
  store.probe = null
  store.detail = null
  store.detailError = ''
  store.detailLoading = true
  store.picked = []
  store.detailCollection = ''
  store.detailHint = hint ?? null
  store.qualityInline = false
  try {
    const d = await load()
    if (gen !== detailGen) return
    store.detail = d
    // 提示里的海报/标题兜住接口没给的情况
    if (hint?.poster && !d.poster) d.poster = hint.poster
    // 只有一集/一个版本时直接选上；多集不预选，让用户自己挑
    if (d.focusVid && d.episodes.some(e => e.vid === d.focusVid)) store.picked = [d.focusVid]
    else if (d.episodes.length === 1) store.picked = [d.episodes[0]!.vid]
  } catch (e) {
    if (gen === detailGen) store.detailError = errText(e)
  } finally {
    if (gen === detailGen) store.detailLoading = false
  }
}

export function openDetail(provider: Provider, id: string, hint?: DetailHint): Promise<void> {
  return openDetailWith(() => gvs('detail', provider, id, hint), hint)
}

/** 优酷单视频：id 是 vid，走链接解析 */
export function openVideo(vid: string, hint?: DetailHint): Promise<void> {
  return openDetailWith(() => gvs('detailFromLink', { kind: 'youku', vid }, hint), hint)
}

/** 卡片统一入口：能开详情就开详情，只能搜就搜，预约类不动作。alternates：同一部剧的其它平台结果 */
export function openCard(c: Card, alternates: Card[] = []): void {
  if (c.target === 'unavailable') return
  store.detailAlternates = alternates.filter((a) => a.target !== 'unavailable')
  store.detailCard = c
  const hint = { title: c.title, poster: c.poster, mediaKind: c.mediaKind }
  if (c.provider === 'mgtv' || c.provider === 'bilibili' || c.provider === 'migu') { if (c.id) void openDetail(c.provider,c.id,hint) }
  else if (c.video && c.provider === 'tencent') void openDetailWith(() => gvs('detailFromLink', { kind: 'tencent', vid: c.id, cid: '', url: '' }, hint), hint)
  else if (c.video) void openVideo(c.id, hint)
  else if (c.target === 'detail' && c.id) void openDetail(c.provider, c.id, hint)
  else void runSearch(c.query || c.title)
}

export async function openQuality(): Promise<void> {
  const d = store.detail
  if (!d) return
  const eps = d.episodes.filter((e) => store.picked.includes(e.vid))
  if (!eps.length) return
  store.probeEpisodes = eps
  store.probe = null
  store.probeError = ''
  store.probing = true
  // 画质面板嵌在剧集页内；不在剧集页时（旧入口）仍跳到独立画质页
  if (store.view === 'detail') store.qualityInline = true
  else go('quality')
  const gen = ++probeGen
  try {
    const result = await gvs('probe', d.provider, eps)
    if (gen === probeGen && store.detail === d) store.probe = result
  } catch (e) {
    if (gen === probeGen) store.probeError = errText(e)
  } finally {
    if (gen === probeGen) store.probing = false
  }
}

export function initStore(): void {
  window.gvs.on('state', (s) => (store.state = userFacing(s)))
  window.gvs.on('jobs', (j) => (store.jobs = userFacing(j)))
  window.gvs.on('toast', (t) => toast(t.message, t.tone))
  window.gvs.on('update', (u) => (store.update = u))
  void gvs('updateState').then((u) => (store.update = u)).catch(() => {})
  void gvs('state').then((s) => (store.state = s)).catch((e) => toast(errText(e), 'err'))
  void gvs('jobs').then((j) => (store.jobs = j)).catch((e) => toast(errText(e), 'err'))
}

export function hasProvider(p: Provider): boolean {
  return !!store.state?.providers.includes(p)
}

/** 相对时间：刚刚 / 3 分钟前 / 3 小时前 / 2 天前 */
export function ago(ms: number): string {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60e3) return '刚刚'
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`
  return `${Math.floor(d / 86400e3)} 天前`
}

export function human(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}
