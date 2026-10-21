/**
 * 下载历史（SQLite）：每完成一集记一行。文件被删掉（传到网盘后清理）也照样算「已下载」，
 * 供剧集页状态、订阅去重、搜索徽标使用。
 * 运行时用 Electron 自带的 node:sqlite（无原生依赖，打包后 Windows 可用）；测试注入 bun:sqlite。
 */
import type { HistoryEntry, HistoryQuery } from '@shared/api'

/** node:sqlite 与 bun:sqlite 共有的最小接口 */
export type SqlStmt = { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
export type SqlDb = { exec(sql: string): void; prepare(sql: string): SqlStmt; close(): void }

export type HistoryInput = Omit<HistoryEntry, 'id' | 'ed2k' | 'ed2kLink'> & { ed2k?: string; ed2kLink?: string }

const COLS = 'id, job_key, provider, show_id, show_title, vid, season, episode, label, title, quality, audio, size, file_path, ed2k, ed2k_link, completed_at'
type Row = Record<string, unknown>
const toEntry = (r: Row): HistoryEntry => ({
  id: Number(r.id), jobKey: String(r.job_key ?? ''), provider: String(r.provider) as HistoryEntry['provider'], showId: String(r.show_id ?? ''),
  showTitle: String(r.show_title ?? ''), vid: String(r.vid ?? ''), season: Number(r.season ?? 0), episode: Number(r.episode ?? 0),
  label: String(r.label ?? ''), title: String(r.title ?? ''), quality: String(r.quality ?? ''), audio: String(r.audio ?? ''),
  size: Number(r.size ?? 0), filePath: String(r.file_path ?? ''), ed2k: String(r.ed2k ?? ''), ed2kLink: String(r.ed2k_link ?? ''),
  completedAt: Number(r.completed_at ?? 0),
})

/** groupId = provider:showId:时间戳；showId 自身可能带冒号（clip:123） */
export function showIdOfGroup(groupId: string): string {
  const parts = groupId.split(':')
  return parts.length >= 3 ? parts.slice(1, -1).join(':') : parts[1] ?? ''
}

export class HistoryDB {
  constructor(private readonly db: SqlDb) {
    db.exec(`CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL, show_id TEXT NOT NULL DEFAULT '', show_title TEXT NOT NULL DEFAULT '',
      vid TEXT NOT NULL DEFAULT '', season INTEGER NOT NULL DEFAULT 0, episode INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL DEFAULT '', audio TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0, file_path TEXT NOT NULL DEFAULT '', ed2k TEXT NOT NULL DEFAULT '', ed2k_link TEXT NOT NULL DEFAULT '',
      completed_at INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS downloads_show ON downloads(provider, show_id);
    CREATE INDEX IF NOT EXISTS downloads_vid ON downloads(provider, vid);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`)
  }

  /** 记录（同一 job_key 再次完成时覆盖：洗版/重下） */
  record(e: HistoryInput): HistoryEntry {
    this.db.prepare(`INSERT INTO downloads (job_key, provider, show_id, show_title, vid, season, episode, label, title, quality, audio, size, file_path, ed2k, ed2k_link, completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(job_key) DO UPDATE SET quality=excluded.quality, audio=excluded.audio, size=excluded.size, file_path=excluded.file_path,
        completed_at=excluded.completed_at, ed2k=CASE WHEN excluded.ed2k <> '' THEN excluded.ed2k ELSE downloads.ed2k END,
        ed2k_link=CASE WHEN excluded.ed2k_link <> '' THEN excluded.ed2k_link ELSE downloads.ed2k_link END`)
      .run(e.jobKey, e.provider, e.showId, e.showTitle, e.vid, e.season, e.episode, e.label, e.title, e.quality, e.audio, e.size, e.filePath, e.ed2k ?? '', e.ed2kLink ?? '', e.completedAt)
    return this.byJobKey(e.jobKey)!
  }

  byJobKey(key: string): HistoryEntry | null {
    const r = this.db.prepare(`SELECT ${COLS} FROM downloads WHERE job_key = ?`).get(key) as Row | undefined
    return r ? toEntry(r) : null
  }

  byId(id: number): HistoryEntry | null {
    const r = this.db.prepare(`SELECT ${COLS} FROM downloads WHERE id = ?`).get(id) as Row | undefined
    return r ? toEntry(r) : null
  }

  setEd2k(id: number, hash: string, link: string): void {
    this.db.prepare('UPDATE downloads SET ed2k = ?, ed2k_link = ? WHERE id = ?').run(hash, link, id)
  }

  list(q: HistoryQuery = {}): { items: HistoryEntry[]; total: number } {
    const where: string[] = []
    const args: unknown[] = []
    if (q.text?.trim()) { where.push('(show_title LIKE ? OR title LIKE ? OR file_path LIKE ?)'); const t = `%${q.text.trim()}%`; args.push(t, t, t) }
    if (q.provider) { where.push('provider = ?'); args.push(q.provider) }
    if (q.showId) { where.push('show_id = ?'); args.push(q.showId) }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM downloads ${w}`).get(...args) as Row).n)
    const limit = Math.max(1, Math.min(500, q.limit ?? 50))
    const rows = this.db.prepare(`SELECT ${COLS} FROM downloads ${w} ORDER BY completed_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, limit, Math.max(0, q.offset ?? 0)) as Row[]
    return { items: rows.map(toEntry), total }
  }

  /** 某部剧已下载的集；分集 VID 可跨同平台的节目 ID 别名匹配。 */
  forShow(provider: string, showId: string, episodeVids: readonly string[] = []): HistoryEntry[] {
    const rows = this.db.prepare(`SELECT ${COLS} FROM downloads WHERE provider = ? AND show_id = ? ORDER BY season, episode`).all(provider, showId) as Row[]
    const found = new Map(rows.map(row => [Number(row.id), row]))
    const vids = [...new Set(episodeVids.filter(v => typeof v === 'string' && v.length > 0))]
    // 长栏目也能查询；兼容 SQLite 较低的绑定参数数量上限。
    for (let start = 0; start < vids.length; start += 500) {
      const batch = vids.slice(start, start + 500)
      const matches = this.db.prepare(`SELECT ${COLS} FROM downloads WHERE provider = ? AND vid IN (${batch.map(() => '?').join(',')})`).all(provider, ...batch) as Row[]
      for (const row of matches) found.set(Number(row.id), row)
    }
    return [...found.values()].map(toEntry).sort((a, b) => a.season - b.season || a.episode - b.episode || a.id - b.id)
  }

  hasVid(provider: string, vid: string): boolean {
    return !!vid && !!this.db.prepare('SELECT 1 FROM downloads WHERE provider = ? AND vid = ? LIMIT 1').get(provider, vid)
  }

  /** 每部剧已下载集数：provider:showId → n（搜索徽标） */
  showCounts(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const r of this.db.prepare('SELECT provider, show_id, COUNT(*) AS n FROM downloads GROUP BY provider, show_id').all() as Row[]) out[`${r.provider}:${r.show_id}`] = Number(r.n)
    return out
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id)
  }

  meta(k: string): string | null {
    const r = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as Row | undefined
    return r ? String(r.v) : null
  }

  setMeta(k: string, v: string): void {
    this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
  }
}
