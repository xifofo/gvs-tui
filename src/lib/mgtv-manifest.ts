import { fetchMediaProbe } from './proxy'

type ManifestResult = { url: string; durationSeconds: number; segmentCount: number }

/** Ignore missing, boolean and malformed duration fields; preserve fractional seconds. */
export function mgtvExpectedDuration(...values: unknown[]): number | undefined {
  const seconds = values.map(value => {
    if (typeof value !== 'number' && typeof value !== 'string') return 0
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  })
  return Math.max(...seconds) || undefined
}

export function mgtvDurationCovers(actual: number, expected: number): boolean {
  if (!Number.isFinite(expected) || expected <= 0) return false
  // Keep the existing long-program allowance; short clips need a smaller one.
  const tolerance = expected > 30 ? Math.max(10, expected * .05) : Math.max(.25, expected * .05)
  return Number.isFinite(actual) && actual > 0 && actual >= expected - tolerance
}

function validURL(raw: string, base?: string): string {
  const url = new URL(raw, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('芒果播放清单地址无效')
  return url.href
}

/**
 * Checks the local HLS playlist before a mgtv download. The gateway's
 * top-level `preview` flag is not reliable on the TV endpoint, so the
 * playlist duration must also cover a positive expected program duration.
 * Return the checked media URL so the downloader uses this exact playlist.
 */
export async function verifyMgtvManifest(
  raw: string,
  headers: Record<string, string>,
  expectedDuration: number | undefined,
  signal?: AbortSignal,
): Promise<ManifestResult> {
  signal?.throwIfAborted()
  const expected = mgtvExpectedDuration(expectedDuration)
  if (expected === undefined) throw new Error('芒果未提供有效整集时长，无法确认完整内容；请刷新分集或取流后重试')
  let url = validURL(raw)
  const visited = new Set<string>()
  for (let depth = 0; depth < 4; depth++) {
    signal?.throwIfAborted()
    if (visited.has(url)) throw new Error('芒果播放清单重复，无法确认完整内容')
    visited.add(url)
    const timeout = AbortSignal.timeout(20_000)
    const readSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    let text: string
    try {
      response = await fetchMediaProbe(url, { headers, signal: readSignal })
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {})
        throw new Error(`HTTP ${response.status}`)
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) throw new Error('芒果播放清单过大，无法确认完整内容')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && error.message.startsWith('芒果播放清单过大')) throw error
      throw new Error('芒果播放清单读取失败，无法确认完整内容；请刷新画质后重试', { cause: error })
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (lines[0] !== '#EXTM3U') throw new Error('芒果返回的内容不是有效播放清单')
    const variant = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'))
    if (variant >= 0) {
      if (lines.filter(line => line.startsWith('#EXT-X-STREAM-INF:')).length !== 1) throw new Error('芒果主清单包含多个版本，无法确认所选画质；请重新取流')
      const child = lines[variant + 1]
      if (!child || child.startsWith('#')) throw new Error('芒果主清单缺少媒体版本')
      url = validURL(child, response.url || url)
      continue
    }
    const durations: number[] = []
    let pending: number | undefined
    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        if (pending !== undefined) throw new Error('芒果播放清单分段缺少地址')
        const duration = line.slice(8).split(',')[0]!.trim()
        const seconds = /^\d+(?:\.\d+)?$/.test(duration) ? Number(duration) : NaN
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('芒果播放清单含无效分段时长')
        pending = seconds
      } else if (!line.startsWith('#')) {
        if (pending === undefined) throw new Error('芒果播放清单分段缺少时长')
        validURL(line, response.url || url)
        durations.push(pending)
        pending = undefined
      }
    }
    if (pending !== undefined || !durations.length) throw new Error('芒果播放清单缺少媒体分段')
    if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('芒果播放清单尚未结束，可能是试看')
    const durationSeconds = durations.reduce((sum, seconds) => sum + seconds, 0)
    if (!mgtvDurationCovers(durationSeconds, expected)) {
      throw new Error('芒果播放清单明显短于整集时长，可能是试看')
    }
    return { url: validURL(response.url || url), durationSeconds, segmentCount: durations.length }
  }
  throw new Error('芒果播放清单嵌套过深，无法确认完整内容')
}
