import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { GwClient } from './client.ts'
import { asString, isObj } from './util.ts'
import { prepareIQSubtitles, selectIQSubtitles, type IQSubtitleTags } from './iq-subtitles.ts'

// Source language IDs follow the same catalog used by the IQ provider.
const LANGUAGES: Record<number, [string, string]> = {
  1: ['zho', '简体中文'], 2: ['zho', '繁体中文'], 3: ['eng', '英语'],
  4: ['kor', '韩语'], 5: ['jpn', '日语'], 6: ['fra', '法语'], 18: ['tha', '泰语'],
  21: ['msa', '马来语'], 23: ['vie', '越南语'], 24: ['ind', '印尼语'],
  26: ['spa', '西班牙语'], 27: ['por', '葡萄牙语'], 28: ['ara', '阿拉伯语'],
  143: ['por', '葡萄牙语'], 152: ['spa', '西班牙语'], 157: ['tha', '泰语'], 161: ['vie', '越南语'],
}

export function iqcnSubtitleTags(sub: Record<string, unknown>): IQSubtitleTags {
  const id = Number(sub.language_id)
  const [language, title] = LANGUAGES[id] ?? ['und', `字幕语言 ${Number.isFinite(id) ? id : '未知'}`]
  return { language, title: asString(sub.title) || asString(sub.name) || title, ai: sub.ai === true }
}

/** Domestic retrieval contract, shared IQ subtitle selection/conversion rules. */
export async function prepareIQCNSubtitles(cli: GwClient, plan: Record<string, unknown>, planId: string, work: string, signal?: AbortSignal) {
  const available = (Array.isArray(plan.subtitles) ? plan.subtitles.filter(isObj) : []).map(sub => ({ ...iqcnSubtitleTags(sub), sub }))
  const sources = selectIQSubtitles(available)
  const files = []
  for (const { sub, ...tags } of sources) {
    signal?.throwIfAborted()
    const formats = Array.isArray(sub.formats) ? sub.formats : []
    const format = formats.includes('srt') ? 'srt' : formats.includes('webvtt') ? 'webvtt' : ''
    if (!format) continue
    const index = Number(sub.index)
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('爱奇艺国内版字幕编号无效')
    const result = await cli.invoke('iqcn', 'download-subtitle', { planId, index, format }, {}, { timeoutMs: 150000 })
    signal?.throwIfAborted()
    const raw = Buffer.from(asString(result.data), 'base64')
    if (!raw.length || raw.length > 16 * 1024 * 1024 || Number(result.bytes) !== raw.length || Number(result.index) !== index || result.format !== format || Number(result.language_id) !== Number(sub.language_id)) {
      throw new Error('爱奇艺国内版字幕内容或语言与选择不一致')
    }
    const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw, { maxOutputLength: 16 * 1024 * 1024 }) : raw
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!/(?:\d+:)?\d{2}:\d{2}[,.]\d{3}\s+-->\s+(?:\d+:)?\d{2}:\d{2}[,.]\d{3}/.test(text)) throw new Error('爱奇艺国内版字幕缺少有效时间轴')
    const path = join(work, `iqcn-sub-${index}.${format === 'srt' ? 'srt' : 'vtt'}`)
    writeFileSync(path, text, { mode: 0o600 })
    files.push({ path, ...tags })
  }
  return prepareIQSubtitles(files, work, signal)
}
