// gvs-img://poster/?u=<url>&p=<provider>
// 海报统一走主进程：带 Referer 直连 CDN、磁盘缓存；红果的 HEIC 用内置 ffmpeg 转 JPG
// （Chromium 不解 HEIC）。
import { app, protocol } from 'electron'
import { createDecipheriv, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { headersFor, referer } from '@tui/media.ts'
import { lookBundledFFmpeg } from '@tui/tools.ts'
import { runLog } from '@tui/runlog.ts'

export const POSTER_SCHEME = 'gvs-img'

export function registerPosterScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: POSTER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

const inflight = new Map<string, Promise<{ body: Buffer; type: string }>>()
let converting = 0
const waiters: Array<() => void> = []

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (converting >= 2) await new Promise<void>((r) => waiters.push(r))
  converting++
  try {
    return await run()
  } finally {
    converting--
    waiters.shift()?.()
  }
}

function sniff(b: Buffer): string {
  if (b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1')
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return 'image/heic'
    if (/^avi[fs]$/.test(brand)) return 'image/avif'
  }
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp'
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif'
  return 'application/octet-stream'
}

// 黄果 AI 站封面是加密的（站点 crypto-worker.js：AES-128-CBC、无填充，key/iv 以字符码写死）。
const ascii = (codes: string) => Buffer.from(codes.split('_').map((n) => String.fromCharCode(Number(n))).join(''))
const HG_KEY = ascii('102_53_100_57_54_53_100_102_55_53_51_51_54_50_55_48')
const HG_IV = ascii('57_55_98_54_48_51_57_52_97_98_99_50_102_98_101_49')

function decryptCover(b: Buffer): Buffer | null {
  const n = b.length - (b.length % 16)
  if (n < 16) return null
  try {
    const d = createDecipheriv('aes-128-cbc', HG_KEY, HG_IV)
    d.setAutoPadding(false)
    const out = Buffer.concat([d.update(b.subarray(0, n)), d.final()])
    return sniff(out).startsWith('image/') ? out : null
  } catch {
    return null
  }
}

function heicToJpeg(src: Buffer, dir: string, key: string): Promise<Buffer> {
  return slot(
    () =>
      new Promise((resolve, reject) => {
        const input = join(dir, `${key}.heic`)
        const output = join(dir, `${key}.conv.jpg`)
        writeFileSync(input, src)
        execFile(
          lookBundledFFmpeg() || 'ffmpeg',
          ['-v', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', output],
          { windowsHide: true, timeout: 20_000 },
          (err) => {
            rmSync(input, { force: true })
            if (err || !existsSync(output)) return reject(err ?? new Error('heic convert failed'))
            const out = readFileSync(output)
            rmSync(output, { force: true })
            resolve(out)
          },
        )
      }),
  )
}

function cacheDir(): string {
  return join(app.getPath('userData'), 'posters')
}

/**
 * 缓存 key：完整 URL 去掉「每次请求都变」的签名参数后取 sha1。
 * 只留 origin+pathname 是不够的：`/get?id=1` 和 `/get?id=2` 会撞成同一张图。
 */
const VOLATILE_PARAMS = [
  'x-expires',
  'x-signature',
  'sign',
  'signature',
  'auth_key',
  'expires',
  'token',
  't',
  'ts',
  'e',
  's',
]

/** x-oss-process 会换出不同尺寸的图，属于资源本身，不能当签名参数丢掉。 */
const KEEP_PARAMS = ['x-oss-process']

export function cacheKeyFor(url: string): string {
  let stable = url
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) {
      const low = k.toLowerCase()
      if (KEEP_PARAMS.includes(low)) continue
      // x-oss-* 里同时有 algorithm/credential/date/expires/signature/signedheaders…
      if (low.startsWith('x-oss-') || VOLATILE_PARAMS.includes(low)) u.searchParams.delete(k)
    }
    stable = u.toString()
  } catch {
    /* 不是合法 URL：原样做 key，后面 fetch 会失败并记日志 */
  }
  return createHash('sha1').update(stable).digest('hex')
}

/** 海报缓存上限；超过就按 mtime 从旧到新删到 250MB 以下。 */
const MAX_CACHE_BYTES = 300 * 1024 * 1024
const TARGET_CACHE_BYTES = 250 * 1024 * 1024
const SWEEP_INTERVAL = 60_000
let lastSweep = 0

function cacheFiles(dir: string): Array<{ path: string; size: number; mtime: number }> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .flatMap((d) => {
        const p = join(dir, d.name)
        try {
          const st = statSync(p)
          return [{ path: p, size: st.size, mtime: st.mtimeMs }]
        } catch {
          return [] // 正被 ffmpeg 改写 / 刚被删掉
        }
      })
  } catch {
    return []
  }
}

/** 写完之后顺手收一次；一分钟最多扫一次，别把协议处理拖慢。 */
function trimCache(dir: string): void {
  const now = Date.now()
  if (now - lastSweep < SWEEP_INTERVAL) return
  lastSweep = now
  const files = cacheFiles(dir)
  let total = files.reduce((n, f) => n + f.size, 0)
  if (total <= MAX_CACHE_BYTES) return
  files.sort((a, b) => a.mtime - b.mtime)
  for (const f of files) {
    if (total <= TARGET_CACHE_BYTES) break
    try {
      rmSync(f.path, { force: true })
      total -= f.size
    } catch {
      /* 下次再删 */
    }
  }
}

/** 海报缓存占用（字节）。 */
export function posterCacheSize(): number {
  return cacheFiles(cacheDir()).reduce((n, f) => n + f.size, 0)
}

/** 清空海报缓存。正在写入的临时文件删不掉就留着，下次清理再处理。 */
export function clearPosterCache(): void {
  for (const f of cacheFiles(cacheDir())) {
    try {
      rmSync(f.path, { force: true })
    } catch {
      /* ignore */
    }
  }
  inflight.clear()
}

async function load(url: string, provider: string): Promise<{ body: Buffer; type: string }> {
  const dir = cacheDir()
  mkdirSync(dir, { recursive: true })
  const key = cacheKeyFor(url)
  const cached = join(dir, `${key}.img`)
  if (existsSync(cached)) {
    const body = readFileSync(cached)
    return { body, type: sniff(body) }
  }
  const res = await fetch(url, { headers: headersFor(referer(provider)), signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`poster http ${res.status}`)
  let body: Buffer = Buffer.from(await res.arrayBuffer())
  let type = sniff(body)
  if (!type.startsWith('image/')) {
    const plain = decryptCover(body)
    if (!plain) throw new Error(`poster not an image (${res.headers.get('content-type')}, ${body.length}B)`)
    body = plain
    type = sniff(body)
  }
  if (type === 'image/heic') {
    body = await heicToJpeg(body, dir, key)
    type = 'image/jpeg'
  }
  writeFileSync(cached, body)
  trimCache(dir)
  return { body, type }
}

export function handlePosterProtocol(): void {
  protocol.handle(POSTER_SCHEME, async (req) => {
    const u = new URL(req.url)
    const raw = u.searchParams.get('u') ?? ''
    const provider = u.searchParams.get('p') ?? ''
    // 卡片上可能是协议相对地址（`//img.x/y.jpg`），补全后再校验。
    const target = raw.startsWith('//') ? `https:${raw}` : raw
    if (!/^https?:\/\//i.test(target)) return new Response(null, { status: 400 })
    let job = inflight.get(target)
    if (!job) {
      job = load(target, provider).finally(() => inflight.delete(target))
      inflight.set(target, job)
    }
    try {
      const { body, type } = await job
      return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'cache-control': 'max-age=86400' } })
    } catch (e) {
      runLog(`poster fail ${provider} ${target.slice(0, 120)} ${e instanceof Error ? e.message : e}`)
      return new Response(null, { status: 404 })
    }
  })
}
