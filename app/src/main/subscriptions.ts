import type { DetailView, EnqueueRequest, EpisodeView, ProbeResult, Provider } from '@shared/api'
import { pickBest, shouldUpgrade, DEFAULT_RULES, type RuleCandidate } from '../shared/rule-groups'
import { mgtvShowId } from '../shared/calendar'
import {
  DEFAULT_INTERVAL_MIN, diffEpisodes, jitter, nextCheckAt, nextRetryAt, retryDelay, subKey,
  type SubCheck, type SubEpisode, type SubscribeRequest, type Subscription, type SubscriptionPatch, type SubsView,
} from '../shared/subscription'

/**
 * 订阅后台检查器。不依赖 Electron：网关操作、持久化、通知都由外面注入，方便测试。
 * 每 TICK_MS 看一眼哪些订阅到点了，串行检查（不并发打网关）。
 */
export type SubDeps = {
  /** 下载历史里已有这一集（文件删了也算），订阅不再重复下载 */
  isDownloaded?: (provider: Provider, vid: string) => boolean
  detail(provider: Provider, id: string): Promise<DetailView>
  probe(provider: Provider, episodes: EpisodeView[], accountId?: string): Promise<ProbeResult>
  enqueue(req: EnqueueRequest): number | Promise<number>
  notify(title: string, body: string, sub: Subscription): void
  changed(view: SubsView): void
  load(): string | null
  save(json: string): void
  now?: () => number
  log?: (line: string) => void
}

type FileShape = { version: 1; paused: boolean; intervalMinutes: number; subs: Subscription[] }

export const TICK_MS = 30_000

/** 「第 3、4 集」；没有集号时按个数说 */
function episodesLabel(eps: Array<{ number: number }>): string {
  const nums = eps.map((e) => e.number).filter((n) => n > 0)
  return nums.length ? `第 ${nums.join('、')} 集` : `${eps.length} 个新视频`
}

export function candidatesOf(probe: ProbeResult): RuleCandidate[] {
  return probe.qualities.map((q) => ({
    index: q.index, height: q.height, width: q.width, codec: q.codec, hdr: q.hdr, label: q.label, size: q.size, fps: q.fps,
    audios: (q.audios.length ? q.audios : probe.audios).map((a) => ({ id: a.id, label: a.label, codec: a.codec, lang: a.lang })),
  }))
}

export class SubscriptionManager {
  private subs: Subscription[] = []
  private paused = false
  private intervalMinutes = DEFAULT_INTERVAL_MIN
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastRunAt = 0
  private readonly now: () => number

  constructor(private readonly deps: SubDeps) {
    this.now = deps.now ?? Date.now
    this.load()
  }

  private load(): void {
    try {
      const raw = this.deps.load()
      if (!raw) return
      const f = JSON.parse(raw) as Partial<FileShape>
      this.paused = !!f.paused
      this.intervalMinutes = Math.max(1, Number(f.intervalMinutes) || DEFAULT_INTERVAL_MIN)
      this.subs = Array.isArray(f.subs) ? f.subs.filter((s) => s && s.id && s.provider && s.showId) : []
      // 旧版从追剧日历订阅的芒果节目存的是裸 clipId，网关会当成 vid 拒绝
      for (const s of this.subs) if (s.provider === 'mgtv') s.showId = mgtvShowId(s.showId)
    } catch (e) {
      this.deps.log?.(`subs: load failed ${e instanceof Error ? e.message : e}`)
    }
  }

  private persist(): void {
    const f: FileShape = { version: 1, paused: this.paused, intervalMinutes: this.intervalMinutes, subs: this.subs }
    this.deps.save(JSON.stringify(f, null, 1))
    this.deps.changed(this.view())
  }

  view(): SubsView {
    return { subs: this.subs.map((s) => ({ ...s })), paused: this.paused, intervalMinutes: this.intervalMinutes, running: this.running, lastRunAt: this.lastRunAt }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    setTimeout(() => void this.tick(), 3000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  isPaused(): boolean { return this.paused }

  setPaused(paused: boolean): SubsView {
    this.paused = paused
    this.persist()
    return this.view()
  }

  setInterval(minutes: number): SubsView {
    this.intervalMinutes = Math.min(1440, Math.max(1, Math.round(minutes) || DEFAULT_INTERVAL_MIN))
    for (const s of this.subs) s.nextCheckAt = nextCheckAt(s, this.now(), this.intervalMinutes)
    this.persist()
    return this.view()
  }

  find(provider: string, showId: string): Subscription | undefined {
    return this.subs.find((s) => subKey(s.provider, s.showId) === subKey(provider, showId))
  }

  subscribe(req: SubscribeRequest): Subscription {
    const hit = this.find(req.provider, req.showId)
    if (hit) return hit
    const now = this.now()
    const sub: Subscription = {
      id: `${subKey(req.provider, req.showId)}:${now.toString(36)}`,
      provider: req.provider, showId: req.showId, title: req.title, poster: req.poster, kind: req.kind,
      state: 'N', paused: false,
      rules: req.rules?.trim() || DEFAULT_RULES,
      autoDownload: req.autoDownload ?? true,
      upgrade: req.upgrade ?? false,
      window: req.window ?? null,
      accountId: req.accountId || undefined,
      updateText: req.updateText ?? '', total: 0, episodes: [], newCount: 0, lastCheck: null,
      nextCheckAt: now, createdAt: now,
    }
    this.subs.unshift(sub)
    this.persist()
    return sub
  }

  update(id: string, patch: SubscriptionPatch): Subscription {
    const s = this.get(id)
    Object.assign(s, patch)
    if (patch.paused !== undefined) s.state = patch.paused ? 'S' : s.lastCheck ? 'R' : 'N'
    s.nextCheckAt = nextCheckAt(s, this.now(), this.intervalMinutes)
    this.persist()
    return s
  }

  remove(id: string): void {
    this.subs = this.subs.filter((s) => s.id !== id)
    this.persist()
  }

  markSeen(id?: string): void {
    for (const s of this.subs) if (!id || s.id === id) s.newCount = 0
    this.persist()
  }

  private get(id: string): Subscription {
    const s = this.subs.find((x) => x.id === id)
    if (!s) throw new Error('订阅不存在或已删除')
    return s
  }

  /** 到点的订阅挨个检查；全局暂停时只有手动「立即检查」会跑 */
  async tick(force = false, only?: string): Promise<void> {
    if (this.running) return
    const now = this.now()
    const due = this.subs.filter((s) => (only ? s.id === only : force ? !s.paused : !this.paused && !s.paused && s.nextCheckAt <= now))
    if (!due.length) return
    this.running = true
    this.deps.changed(this.view())
    try {
      for (const s of due) await this.check(s)
    } finally {
      this.running = false
      this.lastRunAt = this.now()
      this.persist()
    }
  }

  checkNow(id?: string): Promise<void> {
    return this.tick(true, id)
  }

  async check(sub: Subscription): Promise<void> {
    const t0 = this.now()
    const result: SubCheck = { at: t0, ok: true, ms: 0, message: '', found: 0 }
    try {
      const d = await this.deps.detail(sub.provider as Provider, sub.showId)
      if (d.title && !sub.title) sub.title = d.title
      if (d.poster && !sub.poster) sub.poster = d.poster
      sub.total = d.episodeCount || sub.total
      const fresh = diffEpisodes(sub.episodes, d.episodes)
      const baseline = sub.state === 'N'
      // 新集先记成待下载，只有真正加入下载（或确认不用再下）才算处理完；失败的下次到点重试，不会被静默跳过。
      for (const e of fresh) {
        sub.episodes.push({ vid: e.vid, number: e.number, title: e.title, firstSeen: t0,
          ...(baseline ? { baseline: true } : sub.autoDownload ? { pending: { reason: '等待下载', attempts: 0, at: t0, retryAt: t0 } } : {}) })
      }
      const parts: string[] = []
      if (baseline) {
        parts.push(`已记录现有 ${fresh.length} 集，之后的新集会自动处理`)
      } else if (fresh.length) {
        result.found = fresh.length
        sub.newCount += fresh.length
        const label = episodesLabel(fresh)
        parts.push(`发现 ${label}`)
        this.deps.notify(`《${sub.title}》更新了`, label, sub)
      }
      const due = sub.autoDownload ? sub.episodes.filter((e) => e.pending && e.pending.retryAt <= t0) : []
      if (due.length) {
        const got = await this.download(sub, d, due)
        parts.push(got.message)
        if (!got.ok) result.ok = false
      } else if (!baseline && !fresh.length) {
        parts.push('没有新集')
        if (sub.upgrade) {
          const up = await this.tryUpgrade(sub, d)
          if (up) parts.splice(0, parts.length, up)
        }
      }
      result.message = parts.join(' · ')
      sub.state = sub.paused ? 'S' : 'R'
    } catch (e) {
      result.ok = false
      result.message = e instanceof Error ? e.message : String(e)
      if (sub.state === 'N') sub.state = 'P'
    }
    result.ms = this.now() - t0
    sub.lastCheck = result
    const next = nextCheckAt(sub, this.now(), this.intervalMinutes)
    // 只给常规间隔加抖动；等下一个播出窗口 / 上线时间点时准点查
    const delay = next - this.now()
    sub.nextCheckAt = Math.min(Number.isFinite(next) && delay <= this.intervalMinutes * 2 * 60_000 ? this.now() + jitter(Math.max(0, delay)) : next,
      Math.max(this.now(), nextRetryAt(sub)))
  }

  /** 待下载的集按规则组挑最好的版本下载；没成功的记下原因和下次重试时间，返回一句状态 */
  private async download(sub: Subscription, d: DetailView, due: SubEpisode[]): Promise<{ ok: boolean; message: string }> {
    const now = this.now()
    let eps = d.episodes.filter((e) => due.some((r) => r.vid === e.vid))
    const missing = due.filter((r) => !eps.some((e) => e.vid === r.vid))
    if (missing.length) this.defer(missing, '平台这次没有返回这一集')
    const had = eps.length
    for (const e of eps) {
      if (!this.deps.isDownloaded?.(d.provider, e.vid)) continue
      const rec = this.episode(sub, e.vid)
      delete rec.pending
      rec.skipped = { by: 'history', at: now }
    }
    eps = eps.filter((e) => this.episode(sub, e.vid).pending)
    if (had && !eps.length) return { ok: true, message: '历史里已下载过，跳过' }
    if (!eps.length) return { ok: !missing.length, message: missing.length ? `${episodesLabel(missing)}暂时取不到，稍后重试` : '无可下载视频' }
    const recs = eps.map((e) => this.episode(sub, e.vid))
    try {
      const probe = await this.deps.probe(d.provider, eps, sub.accountId)
      const m = pickBest(sub.rules, candidatesOf(probe))
      if (!m) {
        this.defer(recs, '规则组没有一档满足，等待更好的版本')
        return { ok: true, message: '规则组没有一档满足，等待更好的版本' }
      }
      const n = await this.deps.enqueue({ ...this.request(d, eps, probe.token, m.index, m.audioIds), accountId: sub.accountId })
      for (const rec of recs) {
        delete rec.pending
        rec.downloaded = { tier: m.tier, label: m.label, at: this.now() }
      }
      this.deps.notify(`《${sub.title}》已加入下载`, `${n} 个任务 · ${m.label}${m.tier ? `（第 ${m.tier + 1} 档）` : ''}`, sub)
      return { ok: true, message: `已下载 ${m.label}` }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      const first = recs.filter((r) => !r.pending?.attempts)
      this.defer(recs, reason)
      if (first.length) this.deps.notify(`《${sub.title}》${episodesLabel(first)}暂未下载`, `${reason}；稍后自动重试`, sub)
      return { ok: false, message: `${episodesLabel(recs)}未能加入下载：${reason}；稍后自动重试` }
    }
  }

  /** 记一次失败并按退避排下次重试 */
  private defer(recs: SubEpisode[], reason: string): void {
    const now = this.now()
    for (const rec of recs) {
      const attempts = (rec.pending?.attempts ?? 0) + 1
      rec.pending = { reason, attempts, at: now, retryAt: now + retryDelay(attempts) }
    }
  }

  private episode(sub: Subscription, vid: string): SubEpisode {
    return sub.episodes.find((x) => x.vid === vid)!
  }

  /** 洗版：只看最近一集没到第一档的已下载集，出现更好的版本就再下一次 */
  private async tryUpgrade(sub: Subscription, d: DetailView): Promise<string> {
    const rec = [...sub.episodes].reverse().find((e) => e.downloaded && e.downloaded.tier > 0)
    if (!rec) return ''
    const ep = d.episodes.find((e) => e.vid === rec.vid)
    if (!ep) return ''
    const probe = await this.deps.probe(d.provider, [ep], sub.accountId)
    const m = pickBest(sub.rules, candidatesOf(probe))
    if (!shouldUpgrade(rec.downloaded!.tier, m)) return ''
    await this.deps.enqueue({ ...this.request(d, [ep], probe.token, m!.index, m!.audioIds), accountId: sub.accountId })
    const from = rec.downloaded!.label
    rec.downloaded = { tier: m!.tier, label: m!.label, at: this.now() }
    this.deps.notify(`《${sub.title}》洗版`, `第 ${rec.number} 集 ${from} → ${m!.label}`, sub)
    return `洗版 第 ${rec.number} 集 → ${m!.label}`
  }

  private request(d: DetailView, eps: EpisodeView[], token: number, quality: number, audioIds: string[]): EnqueueRequest {
    return {
      token,
      detail: { provider: d.provider, id: d.id, title: d.title, year: d.year, kind: d.kind, poster: d.poster },
      episodes: eps, quality, audioIds, tmdb: null,
    }
  }
}
