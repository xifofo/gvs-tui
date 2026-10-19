import { isUnknownAudioLanguage } from './audio-language.ts'
import { hasIQJapaneseAudioMislabel, normalizeIQAudioLanguage } from './iq-audio-language.ts'
import { mp4Lang } from './mp4box.ts'
import { asString, isObj } from './util.ts'

type AudioChoice = { id: string; lang?: string; label?: string; codec?: string; isDefault?: boolean }
type Episode = { title: string; audioTracks?: readonly AudioChoice[] }
export type IQEpisodeAudio = { requestedId: string; id: string; language: string; isDefault: boolean; editionFallback: boolean; reportedLanguage?: string; row: Record<string, unknown> }

function language(row: Record<string, unknown>): string {
  const names: Record<string, string> = { 普通話: 'zho', 國語: 'zho', 日語: 'jpn', 韩语: 'kor', 韓語: 'kor', 泰语: 'tha', 泰語: 'tha' }
  for (const value of [row.language, row.lang]) {
    const text = asString(value).trim()
    if (isUnknownAudioLanguage(text)) continue
    const code = names[text] || mp4Lang(text)
    if (code !== 'und') return code
  }
  return ''
}

function variant(id: string): string {
  return /^\d+:(\d+):(\d+)$/.exec(id)?.slice(1).join(':') || ''
}

function codec(value: unknown): string {
  const text = asString(value).trim().toLowerCase()
  if (/^(e-?ac-?3|ec-?3|ddp|dolby)$/.test(text)) return 'eac3'
  if (/^(ac-?3|dd)$/.test(text)) return 'ac3'
  return text
}

/** Only an explicit platform episode edition can disambiguate unreliable IQ labels.
 * A TMDB original language, country, or the user's previously selected dub cannot.
 */
function editionLanguage(title: string): { code: string; name: string } | undefined {
  const names: Record<string, { code: string; name: string }> = {
    中文: { code: 'zho', name: '普通话' }, 国语: { code: 'zho', name: '普通话' }, 國語: { code: 'zho', name: '普通话' },
    普通话: { code: 'zho', name: '普通话' }, 普通話: { code: 'zho', name: '普通话' },
    日文: { code: 'jpn', name: '日语' }, 日语: { code: 'jpn', name: '日语' }, 日語: { code: 'jpn', name: '日语' },
    韩文: { code: 'kor', name: '韩语' }, 韓文: { code: 'kor', name: '韩语' }, 韩语: { code: 'kor', name: '韩语' }, 韓語: { code: 'kor', name: '韩语' },
    泰文: { code: 'tha', name: '泰语' }, 泰语: { code: 'tha', name: '泰语' }, 泰語: { code: 'tha', name: '泰语' },
    英文: { code: 'eng', name: '英语' }, 英语: { code: 'eng', name: '英语' }, 英語: { code: 'eng', name: '英语' },
  }
  const matches = [...title.matchAll(/[（(【\[]\s*(中文|国语|國語|普通话|普通話|日文|日语|日語|韩文|韓文|韩语|韓語|泰文|泰语|泰語|英文|英语|英語)版\s*[）)】\]]/g)]
    .map(match => names[match[1]!]!)
  return matches.length && matches.every(match => match.code === matches[0]!.code) ? matches[0] : undefined
}

function episodeAudioCatalog(data: Record<string, unknown>, title: string): {
  rows: Record<string, unknown>[]; corrections: Map<string, { from: string; to: string }>
} {
  const raw = (Array.isArray(data.audios) ? data.audios.filter(isObj) : []).filter(row => asString(row.id))
  const rows = raw.map(row => normalizeIQAudioLanguage({ ...row, ...(data.source === 'domestic' ? { source: 'domestic' } : {}) }))
  const edition = editionLanguage(title)
  const corrections = new Map<string, { from: string; to: string }>()
  // Retain domestic language namespaces unless the entire catalog has the
  // confirmed iq.com ID-6/French mislabel. Its Cookie route can be domestic;
  // explicit Chinese editions still need their existing edition correction.
  if ((data.source === 'domestic' || rows.some(row => row.source === 'domestic')) &&
      !(raw.length && raw.every(row => hasIQJapaneseAudioMislabel(row)))) return { rows, corrections }
  // Some episodes of an explicitly labelled Japanese/Thai/etc. edition expose
  // only lid=1 in DASH even though the album uses its real language ID. Never
  // apply this to a multilingual catalog or a differently identified dub.
  const fallback = edition && rows.length && rows.every(row => /^1:\d+:\d+$/.test(asString(row.id)) &&
    (row.lid === undefined || Number(row.lid) === 1) && ['', 'zho'].includes(language(row)))
  // Confirmed on the Chinese Mermaid edition: DASH exposes only lid=6 with
  // the gateway's erroneous French label, but the downloaded speech is Chinese.
  // Require an explicit Chinese edition AND this exact unreliable single-ID
  // shape. Genuine Japanese labels and multilingual catalogs remain intact.
  const chineseFallback = edition?.code === 'zho' && raw.length && raw.every(row =>
    /^6:\d+:\d+$/.test(asString(row.id)) && (row.lid === undefined || Number(row.lid) === 6) &&
    ['', 'fra'].includes(language(row)))
  if (!edition || !fallback && !chineseFallback) return { rows, corrections }
  const corrected = rows.map(row => {
    const from = language(row)
    if (from !== edition.code) corrections.set(asString(row.id), { from, to: edition.code })
    return { ...row, language: edition.code, lang: edition.name,
      label: asString(row.label).replace(/^(?:普通话|普通話|国语|國語|中文|Mandarin|Chinese|日语|日語|Japanese|法语|法語|French)(?=$|[\s·])/i, edition.name) }
  })
  return { rows: corrected, corrections }
}

export function iqEpisodeAudioCatalog(data: Record<string, unknown>, title: string): Record<string, unknown>[] {
  return episodeAudioCatalog(data, title).rows
}

/** Resolve each saved selection against this episode, without changing the saved
 * selection (or its work-directory identity). Codec/bitrate and dub stay distinct.
 */
export function selectIQEpisodeAudios(data: Record<string, unknown>, episode: Episode): IQEpisodeAudio[] {
  const { rows: available, corrections } = episodeAudioCatalog(data, episode.title)
  const requested = episode.audioTracks?.length ? episode.audioTracks : available.filter(row => row.default === true)
    .map(row => ({ id: asString(row.id), lang: asString(row.lang), codec: asString(row.codec), isDefault: true }))
  if (!requested.length) throw new Error('当前集没有返回默认独立音轨，请刷新音轨列表。')
  const used = new Set<string>()
  return requested.map(wanted => {
    const domestic = data.source === 'domestic' || available.some(row => row.source === 'domestic')
    let normalized = normalizeIQAudioLanguage({ ...wanted, ...(domestic ? { source: 'domestic' } : {}) })
    // Old queues may contain the incorrect label from this same catalog. Only
    // repair a saved ID for which the current episode proves the correction.
    const correction = corrections.get(wanted.id)
    if (correction && ['', correction.from].includes(language(normalized))) {
      normalized = { ...normalized, language: correction.to, lang: correction.to }
    }
    const wantedLanguage = language(normalized), wantedVariant = variant(wanted.id), wantedCodec = codec(wanted.codec)
    const compatible = (row: Record<string, unknown>) =>
      (!wantedLanguage || language(row) === wantedLanguage) &&
      (!wantedCodec || codec(row.codec) === wantedCodec)
    // Exact IDs remain valid for old/opaque catalogs. A changed ID requires a
    // known matching language AND the same codec/bitrate variant, not just AAC.
    let matches = available.filter(row => asString(row.id) === wanted.id && compatible(row))
    if (!matches.length && wantedLanguage) matches = available.filter(row => compatible(row) &&
      (wantedVariant ? variant(asString(row.id)) === wantedVariant : !!wantedCodec))
    if (matches.length > 1) throw new Error('当前集有多个符合所选条件的音轨，无法确定对应版本，请刷新音轨列表。')
    const match = matches[0], id = asString(match?.id)
    if (!match || !id) throw new Error('当前集缺少所选语言或规格的音轨，请刷新音轨列表并重新选择。')
    if (used.has(id)) throw new Error('当前集无法分别匹配所选音轨，请刷新音轨列表并重新选择。')
    used.add(id)
    const reportedLanguage = corrections.get(id)?.from
    return { requestedId: wanted.id, id, language: language(match) || 'und', isDefault: wanted.isDefault === true,
      editionFallback: reportedLanguage !== undefined, reportedLanguage, row: match }
  })
}

/** Validate refreshed audio responses too; never join bytes from another ID. */
export function iqSelectedAudioResponse(data: Record<string, unknown>, selected: IQEpisodeAudio): Record<string, unknown> {
  const audio = normalizeIQAudioLanguage({ ...data, ...(selected.row.source === 'domestic' ? { source: 'domestic' } : {}) }, selected.id)
  const responseLanguage = language(audio)
  if ((asString(audio.id) && asString(audio.id) !== selected.id) ||
      (codec(audio.codec) && codec(selected.row.codec) && codec(audio.codec) !== codec(selected.row.codec)) ||
      (responseLanguage && selected.language !== 'und' && responseLanguage !== selected.language &&
        !(selected.editionFallback && responseLanguage === selected.reportedLanguage))) {
    throw new Error('当前集返回了不同版本的音轨，请刷新音轨列表后重试。')
  }
  // The catalog was checked against the selected language/explicit edition;
  // the audio action can repeat the same known incorrect label for that ID.
  return { ...audio, language: selected.language === 'und' ? asString(audio.language) || 'und' : selected.language }
}
