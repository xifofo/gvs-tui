import { asString } from './util.ts'

// IQ's audio IDs are not subtitle IDs. The official audioInfoList identifies
// 6 as Japanese and 157 as Thai. Some gateways fall back to subtitle-language
// IDs or Mandarin when they cannot resolve an audio language.
const AUDIO_LANGUAGES: Record<number, { language: string; name: string; incorrectName: RegExp }> = {
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
