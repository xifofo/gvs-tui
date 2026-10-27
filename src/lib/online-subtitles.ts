import { spawn } from 'node:child_process'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mkvLang } from './mkvmerge.ts'
import { withMkvGroupTags } from './release-group.ts'
import { isObj } from './util.ts'

/**
 * Crunchyroll 的字幕不在 DASH 清单里，而是源站单独给的签名直链
 * （`{locale, format:"ass", url}`，URL 自带 `~hmac`，**不需要认证头**）。
 * 网关 play/resolve 会把这张表原样带回来，这里负责落盘与挂轨。
 */
export type OnlineSubtitle = { id: string; lang: string; label: string; format: string; url: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 从网关回包里读字幕表（resolve/probe 都有 `subtitles[]`）。 */
export function onlineSubtitles(data: Record<string, unknown>): OnlineSubtitle[] {
  const rows = Array.isArray(data.subtitles) ? data.subtitles.filter(isObj) : []
  return rows.map(s => ({
    id: str(s.id) || str(s.locale),
    lang: str(s.lang) || str(s.locale) || str(s.id),
    label: str(s.label) || str(s.locale) || str(s.id),
    format: (str(s.format) || 'ass').toLowerCase(),
    url: str(s.url),
  })).filter(s => !!s.id && !!s.url)
}

/** 只保留用户勾选的语言；没有勾选就没有字幕。 */
export function pickSubtitles(all: readonly OnlineSubtitle[], selected: readonly string[] | undefined): OnlineSubtitle[] {
  if (!selected?.length) return []
  const want = new Set(selected)
  return all.filter(s => want.has(s.id))
}

const SUB_EXT: Record<string, string> = { ass: 'ass', ssa: 'ass', vtt: 'vtt', srt: 'srt', ttml: 'ttml' }

/** 字幕文件名：`<语言>.<ext>`，去掉会破坏路径的字符。 */
export function subtitleFileName(sub: OnlineSubtitle): string {
  const ext = SUB_EXT[sub.format] ?? 'ass'
  const base = (sub.label || sub.lang || sub.id).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
  return `${base || sub.id}.${ext}`
}

/** 下载字幕到 work 目录。源站是签名直链，不带任何认证头。 */
export async function downloadSubtitles(
  subs: readonly OnlineSubtitle[],
  dir: string,
  signal?: AbortSignal,
): Promise<Array<{ path: string; sub: OnlineSubtitle }>> {
  if (!subs.length) return []
  await mkdir(dir, { recursive: true })
  const out: Array<{ path: string; sub: OnlineSubtitle }> = []
  for (const sub of subs) {
    signal?.throwIfAborted()
    const res = await fetch(sub.url, { signal: signal ?? AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`字幕下载失败 (${sub.label}): HTTP ${res.status}`)
    const body = new Uint8Array(await res.arrayBuffer())
    if (!body.length) throw new Error(`字幕为空 (${sub.label})`)
    const path = join(dir, subtitleFileName(sub))
    await writeFile(path, body)
    out.push({ path, sub })
  }
  return out
}

/**
 * mkvmerge 追加字幕轨的参数。
 * 每条字幕带语言、标题、默认/强制标记，顺序与 `files` 一致。
 */
export function attachSubtitleArgs(
  video: string,
  dest: string,
  files: ReadonlyArray<{ path: string; sub: OnlineSubtitle; isDefault?: boolean }>,
): string[] {
  const args = [video]
  for (const f of files) {
    const lang = mkvLang(f.sub.lang || f.sub.id)
    args.push('--language', `0:${lang}`, '--track-name', `0:${f.sub.label || f.sub.id}`)
    args.push('--default-track-flag', `0:${f.isDefault ? 1 : 0}`, '--forced-display-flag', '0:0')
    args.push('--sub-charset', '0:UTF-8', f.path)
  }
  args.push('-o', dest)
  return args
}

function run(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal })
  let log = ''
  child.stdout.on('data', (d: Buffer) => { log += d.toString() })
  child.stderr.on('data', (d: Buffer) => { log += d.toString() })
  child.on('error', (e) => reject(signal?.aborted ? (signal.reason ?? e) : e))
  child.on('close', (code) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('已停止')); return }
    // mkvmerge: 0 ok，1 警告但文件已写
    if (code === 0 || code === 1) resolve()
    else reject(new Error(`mkvmerge: exit ${code} ${log.slice(0, 300)}`))
  })
  return promise
}

/** 把字幕挂进已下载的 mkv。先写临时文件再替换，失败不破坏原视频。 */
export async function attachSubtitles(
  mkvmerge: string,
  video: string,
  files: ReadonlyArray<{ path: string; sub: OnlineSubtitle; isDefault?: boolean }>,
  signal?: AbortSignal,
  group = '',
): Promise<void> {
  if (!files.length) return
  const dest = `${video}.subs.mkv`
  try {
    await withMkvGroupTags(dest, group, tags => run(mkvmerge, [...tags, ...attachSubtitleArgs(video, dest, files)], signal))
    await rename(dest, video)
  } catch (e) {
    await rm(dest, { force: true }).catch(() => {})
    throw e
  }
}
