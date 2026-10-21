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

/** Correct known source audio IDs without changing the requested track identity. */
export function normalizeIQAudioLanguage(row: Record<string, unknown>, requestedId = ''): Record<string, unknown> {
  if (row.source === 'domestic') return row
  const id = asString(row.id) || requestedId
  const lid = Number(row.lid ?? (/^\d+:\d+:\d+$/.test(id) ? id.split(':')[0] : NaN))
  const known = AUDIO_LANGUAGES[lid]
  if (!known) return row
  const label = asString(row.label).replace(known.incorrectName, known.name)
  const title = asString(row.title).replace(known.incorrectName, known.name)
  return { ...row, lang: known.name, language: known.language,
    ...(label ? { label } : {}), ...(title ? { title } : {}) }
}
