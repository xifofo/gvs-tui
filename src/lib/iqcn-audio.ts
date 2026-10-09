import { appendFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { Audio } from '../types.ts'
import type { GwClient } from './client.ts'
import { asString, isObj } from './util.ts'
import { orderedDownload } from './ordered-download.ts'

const LIMIT = 32 << 20
export const iqcnLanguage = (id: number): string => id === 1 ? 'zho' : 'und'

export function iqcnAudios(data: Record<string, unknown>): Audio[] {
  const seen = new Set<string>()
  const rows = (Array.isArray(data.audios) ? data.audios.filter(isObj) : []).filter(row => {
    const id = asString(row.aid)
    if (!id || seen.has(id)) return false
    seen.add(id); return true
  })
  const preferred = rows.find(row => row.selected === true) ?? rows.find(row => row.has_independent_files === true) ?? rows[0]
  return rows.map(row => {
    const codec = asString(row.cf).toUpperCase()
    const name = asString(row.name) || `语言 ${Number(row.language_id)}`
    const quality = row.ct === 5 ? '高码率' : row.ct === 1 ? '标准 · 随视频' : ''
    // AID changes between episodes; persist the language/type/bitrate choice,
    // then bind it to the current episode's exact source AID at download time.
    return { id: `iqcn:${Number(row.language_id)}:${Number(row.ct)}:${Number(row.bid)}:${asString(row.cf)}`, vid: asString(row.aid), label: [name, codec, quality].filter(Boolean).join(' · '), lang: name,
      codec, isDefault: row === preferred, selected: row === preferred }
  })
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>
async function boundedFetch(url: string, fetcher: Fetcher, signal?: AbortSignal): Promise<Buffer> {
  const timeout = AbortSignal.timeout(60000)
  const active = signal ? AbortSignal.any([signal, timeout]) : timeout
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetcher(url, { signal: active, redirect: 'manual' })
    if (res.status !== 200 || !res.body) { await res.body?.cancel(); throw new Error('音轨源站响应失败') }
    reader = res.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      active.throwIfAborted()
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > LIMIT) throw new Error('音轨对象超过大小限制')
      chunks.push(Buffer.from(item.value))
    }
    if (!size) throw new Error('音轨对象为空')
    return Buffer.concat(chunks)
  } catch {
    signal?.throwIfAborted()
    throw new Error('爱奇艺音轨直连下载失败')
  } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock() }
}

export async function downloadIQCNAudio(cli: GwClient, planId: string, audioId: string, destination: string, threads: number, signal?: AbortSignal, fetcher: Fetcher = fetch, extractEmbedded?: () => Promise<void>): Promise<{ language: string; title: string }> {
  const result = await cli.invoke('iqcn', 'audio', { planId, audioId }, {}, { timeoutMs: 150000 })
  signal?.throwIfAborted()
  if (result.transport !== 'local-audio-v1' || result.audioId !== audioId) throw new Error('网关未返回所选音轨，请同步更新网关和 App')
  const info = { language: iqcnLanguage(Number(result.language_id)), title: [asString(result.name), asString(result.codec).toUpperCase()].filter(Boolean).join(' · ') || '独立音轨' }
  if (result.embedded === true) {
    if (!extractEmbedded) throw new Error('所选标准音轨需要从视频提取')
    await extractEmbedded()
    return info
  }
  if (!Array.isArray(result.parts) || !result.parts.length) throw new Error('所选独立音轨没有文件')
  const parts = result.parts.map((value, index) => {
    if (!isObj(value) || value.index !== index) throw new Error('音轨分段顺序无效')
    const url = new URL(asString(value.dispatch))
    if (url.protocol !== 'https:' || url.hostname !== 'data.video.ptqy.gitv.tv' || url.port || url.username || url.password || url.hash || !url.pathname.startsWith('/videos/v0/')) throw new Error('音轨调度地址无效')
    return url
  })
  writeFileSync(destination, '', { mode: 0o600 })
  try {
    await orderedDownload({ sizes: parts.map(() => LIMIT), budget: LIMIT * Math.min(8, Math.max(1, threads)), threads, signal,
      pull: async (index, abort) => {
        const dispatch = parts[index]!
        let last: unknown
        for (let attempt = 0; attempt < 2; attempt++) {
          abort.throwIfAborted()
          try {
            const body = await boundedFetch(dispatch.href, fetcher, abort)
            if (body.length > 65536) throw new Error('音轨调度响应过大')
            const data = JSON.parse(body.toString())
            if (String(data.e) !== '0') throw new Error('音轨调度失败')
            const url = new URL(asString(data.l))
            if (url.protocol !== 'https:' || !url.hostname.endsWith('.ptqy.gitv.tv') || url.username || url.password || url.port || url.hash || url.pathname !== dispatch.pathname) throw new Error('音轨调度返回了其他文件')
            const raw = await boundedFetch(url.href, fetcher, abort)
            const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: LIMIT }) : raw
            if (!bytes.length) throw new Error('音轨对象为空')
            return bytes
          } catch (error) { abort.throwIfAborted(); last = error }
        }
        throw new Error('所选音轨分段下载失败', { cause: last })
      },
      write: bytes => { appendFileSync(destination, bytes) },
    })
    return info
  } catch (error) { try { unlinkSync(destination) } catch {} throw error }
}
