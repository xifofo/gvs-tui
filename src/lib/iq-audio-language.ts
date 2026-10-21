import { asString } from './util.ts'

// IQ's audio IDs are not subtitle IDs. The official audioInfoList identifies
// 5 as Korean, 6 as Japanese and 157 as Thai. Some gateways fall back to
// subtitle-language IDs or Mandarin when they cannot resolve an audio language. This is only a
// baseline: iqEpisodeAudioCatalog also checks explicit platform editions for
// confirmed unreliable single-language catalogs (including Chinese lid=6).
const AUDIO_LANGUAGES: Record<number, { language: string; name: string; incorrectName: RegExp }> = {
  5: { language: 'kor', name: '韩语', incorrectName: /^(?:日语|日語|Japanese)(?=$|[\s·])/i },
  6: { language: 'jpn', name: '日语', incorrectName: /^(?:法语|法語|French)(?=$|[\s·])/i },
  157: { language: 'tha', name: '泰语', incorrectName: /^(?:普通话|普通話|国语|國語|中文|Mandarin|Chinese)(?=$|[\s·])/i },
}

function audioLanguageId(row: Record<string, unknown>, requestedId = ''): number {
  const id = asString(row.id) || requestedId
  return Number(row.lid ?? (/^\d+:\d+:\d+$/.test(id) ? id.split(':')[0] : NaN))
}

/** iq.com ID 6 is Japanese even when its Cookie route is marked domestic.
 * Only admit the confirmed French mislabel; domestic Mandarin/other IDs keep
 * their own language namespace, including conflicting or missing metadata.
 */
export function hasIQJapaneseAudioMislabel(row: Record<string, unknown>, requestedId = ''): boolean {
  if (audioLanguageId(row, requestedId) !== 6) return false
  const reported = [row.language, row.lang].map(value => asString(value).trim().toLowerCase()).filter(Boolean)
  return reported.length > 0 && reported.every(value => ['fra', 'fre', 'fr', 'french', '法语', '法語'].includes(value))
}

/** Correct known source audio IDs without changing the requested track identity. */
export function normalizeIQAudioLanguage(row: Record<string, unknown>, requestedId = ''): Record<string, unknown> {
  if (row.source === 'domestic' && !hasIQJapaneseAudioMislabel(row, requestedId)) return row
  const lid = audioLanguageId(row, requestedId)
  const known = AUDIO_LANGUAGES[lid]
  if (!known) return row
  const label = asString(row.label).replace(known.incorrectName, known.name)
  const title = asString(row.title).replace(known.incorrectName, known.name)
  return { ...row, lang: known.name, language: known.language,
    ...(label ? { label } : {}), ...(title ? { title } : {}) }
}
